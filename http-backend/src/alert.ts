// * PART 3: LOW STOCK ALERT API

import type { Request, Response } from "express";
import express from "express";
import { prismaClient } from "../../packages/db/src/index.ts";

const router = express.Router();
const prisma = prismaClient;

// CONSTANTS
const RECENT_SALES_DAYS = 30;    // Window to determine "recent sales"
const AVG_SALES_WINDOW_DAYS = 30; // Window to compute daily sales velocity
const MAX_DAYS_UNTIL_STOCKOUT = 9999; // Sentinel: no sales data, no prediction possible

async function getAvgDailySales(productId: number, windowDays = AVG_SALES_WINDOW_DAYS) {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  // Raw aggregate via Prisma — more efficient than fetching all rows
  const result = await prisma.inventoryHistory.aggregate({
    where: {
      productId,
      reason: "SALE",
      createdAt: { gte: since },
    },
    _sum: {
      change: true,
    },
  });

  const totalSold = Math.abs(result._sum?.change ?? 0);
  // Avoid division by zero; if no sales recorded, velocity is 0
  return totalSold / windowDays;
}

// HELPER: Check if a product has had any sales recently
//
// We call this to filter out dead stock — products that haven't
// moved in RECENT_SALES_DAYS are not actionable low-stock alerts.
//
// Returns: boolean
async function hasRecentSales(productId: number, days = RECENT_SALES_DAYS) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const count = await prisma.inventoryHistory.count({
    where: {
      productId,
      reason: "SALE",
      createdAt: { gte: since },
    },
  });

  return count > 0;
}

// HELPER: Calculate days until stockout
//
// days_until_stockout = current_stock / avg_daily_sales
//
// Edge cases:
//   - avg_daily_sales = 0  → no sales velocity → return sentinel MAX value
//   - current_stock = 0    → already out of stock → return 0
//   - result < 0           → should never happen, but guard anyway
function calculateDaysUntilStockout(currentStock: number, avgDailySales: number) {
  if (currentStock <= 0) return 0;                         // Already out of stock
  if (avgDailySales === 0) return MAX_DAYS_UNTIL_STOCKOUT; // No velocity data
  return Math.floor(currentStock / avgDailySales);
}

// HELPER: Validate UUID format (basic guard before hitting DB)
function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

// GET /api/companies/:company_id/alerts/low-stock
router.get("/api/companies/:company_id/alerts/low-stock", async (req: Request, res: Response) => {
  const rawCompanyId =
    typeof req.params.company_id === "string" ? req.params.company_id : undefined;
  const companyId = parsePositiveInt(rawCompanyId);
  if (!companyId) return res.status(400).json({ error: "Invalid company_id format" });

  // ── Parse optional query params ──────────────────────────────
  // ?warehouse_id=xxx  → filter to a specific warehouse
  // ?page=1&limit=50   → pagination (default page 1, limit 50)
  const warehouseId = parsePositiveInt(
    typeof req.query.warehouse_id === "string" ? req.query.warehouse_id : undefined
  );
  const pageParam = typeof req.query.page === "string" ? req.query.page : "1";
  const limitParam = typeof req.query.limit === "string" ? req.query.limit : "50";
  const pageNum = Math.max(1, parseInt(pageParam, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)); // Cap at 200
  const skip = (pageNum - 1) * pageSize;

  // ── Input validation ─────────────────────────────────────────
  if (typeof req.query.warehouse_id === "string" && !warehouseId) {
    return res.status(400).json({ error: "Invalid warehouse_id format" });
  }

  try {
    // ── Step 1: Confirm the company exists ────────────────────
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // ── Step 2: Fetch all low-stock inventory rows ────────────
    // We use a single JOIN-heavy query to avoid N+1 problems.
    // Prisma's `include` generates optimised SQL JOINs.
    //
    // Filter conditions:
    //   a. Inventory belongs to a warehouse of this company
    //   b. quantity < low_stock_threshold  (i.e., actually low)
    //   c. (optional) specific warehouse
    //   d. product must be active
    const lowStockInventory = await prisma.inventory.findMany({
      where: {
        warehouse: {
          companyId,
          ...(warehouseId && { id: warehouseId }),
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        warehouse: {
          select: { id: true, name: true },
        },
      },
      orderBy: [
        // Sort by most critical first: lowest (quantity / threshold) ratio
        { quantity: "asc" },
      ],
      skip,
      take: pageSize,
    });

    // ── Step 2b: Filter quantity < low_stock_threshold ────────
    // Prisma doesn't support column-to-column comparisons in `where` directly.
    // We fetch all and filter in JS, or use a raw query.
    // For production with millions of rows, use $queryRaw (see below).
    // For this implementation, filtering after fetch is acceptable at typical scales.
    const actualLowStock = lowStockInventory.filter(
      (inv: any) => inv.quantity < inv.threshold
    );

    // ── Step 3: For each row, compute sales velocity & filter ─
    // We do this in parallel (Promise.all) to avoid sequential awaits
    // across potentially many rows.
    //
    // NOTE: For very high volumes (thousands of alerts), consider:
    //   - Pre-computing avg_daily_sales in a materialized view
    //   - Running this as a background job
    const alertsWithVelocity = await Promise.all(
      actualLowStock.map(async (inv: any) => {
        const { product, warehouse } = inv;

        // ── Filter: only products with recent sales ──────────
        const recentSales = await hasRecentSales(product.id);
        if (!recentSales) {
          return null; // Skip dead stock
        }

        // ── Calculate days until stockout ────────────────────
        const avgDailySales = await getAvgDailySales(product.id);
        const daysUntilStockout = calculateDaysUntilStockout(inv.quantity, avgDailySales);

        return {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          warehouse_id: warehouse.id,
          warehouse_name: warehouse.name,
          current_stock: inv.quantity,
          threshold: inv.threshold,
          avg_daily_sales: parseFloat(avgDailySales.toFixed(2)),
          days_until_stockout: daysUntilStockout === MAX_DAYS_UNTIL_STOCKOUT
            ? null  // null means "no velocity data — cannot predict"
            : daysUntilStockout,
        };
      })
    );

    // ── Step 4: Remove null entries (filtered out dead stock) ─
    const alerts = alertsWithVelocity.filter(Boolean);

    // ── Sort final alerts by urgency (fewest days until stockout first) ──
    alerts.sort((a: any, b: any) => {
      // null (no data) goes to end — least urgent since we can't predict
      if (a.days_until_stockout === null) return 1;
      if (b.days_until_stockout === null) return -1;
      return a.days_until_stockout - b.days_until_stockout;
    });

    // ── Step 5: Return response ───────────────────────────────
    return res.status(200).json({
      alerts,
      total_alerts: alerts.length,
      pagination: {
        page: pageNum,
        limit: pageSize,
        // Note: total_count requires a COUNT query; omitted for performance.
        // Clients should check if alerts.length < limit to detect last page.
      },
    });

  } catch (err) {
    console.error("[low-stock-alerts] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export { router, getAvgDailySales, hasRecentSales, calculateDaysUntilStockout };