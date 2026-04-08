// * PART 3: LOW STOCK ALERT API

import type { Request, Response } from "express";
import express from "express";
import { prismaClient } from "../../packages/db/src/index.ts";

const router = express.Router();
const prisma = prismaClient;

// CONSTANTS
const RECENT_SALES_DAYS = 30;   
const AVG_SALES_WINDOW_DAYS = 30; 
const MAX_DAYS_UNTIL_STOCKOUT = 9999; 

async function getAvgDailySales(productId: number, windowDays = AVG_SALES_WINDOW_DAYS) {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  
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
  
  return totalSold / windowDays;
}

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


function calculateDaysUntilStockout(currentStock: number, avgDailySales: number) {
  if (currentStock <= 0) return 0;                         
  if (avgDailySales === 0) return MAX_DAYS_UNTIL_STOCKOUT; 
  return Math.floor(currentStock / avgDailySales);
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}


router.get("/api/companies/:company_id/alerts/low-stock", async (req: Request, res: Response) => {
  const rawCompanyId =
    typeof req.params.company_id === "string" ? req.params.company_id : undefined;
  const companyId = parsePositiveInt(rawCompanyId);
  if (!companyId) return res.status(400).json({ error: "Invalid company_id format" });
  
  const warehouseId = parsePositiveInt(
    typeof req.query.warehouse_id === "string" ? req.query.warehouse_id : undefined
  );
  const pageParam = typeof req.query.page === "string" ? req.query.page : "1";
  const limitParam = typeof req.query.limit === "string" ? req.query.limit : "50";
  const pageNum = Math.max(1, parseInt(pageParam, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)); 
  const skip = (pageNum - 1) * pageSize;

  if (typeof req.query.warehouse_id === "string" && !warehouseId) {
    return res.status(400).json({ error: "Invalid warehouse_id format" });
  }

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

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
        { quantity: "asc" },
      ],
      skip,
      take: pageSize,
    });

    const actualLowStock = lowStockInventory.filter(
      (inv: any) => inv.quantity < inv.threshold
    );

    const alertsWithVelocity = await Promise.all(
      actualLowStock.map(async (inv: any) => {
        const { product, warehouse } = inv;

        const recentSales = await hasRecentSales(product.id);
        if (!recentSales) {
          return null; 
        }
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
            ? null 
            : daysUntilStockout,
        };
      })
    );

    const alerts = alertsWithVelocity.filter(Boolean);

    alerts.sort((a: any, b: any) => {
      if (a.days_until_stockout === null) return 1;
      if (b.days_until_stockout === null) return -1;
      return a.days_until_stockout - b.days_until_stockout;
    });

    return res.status(200).json({
      alerts,
      total_alerts: alerts.length,
      pagination: {
        page: pageNum,
        limit: pageSize,
      },
    });

  } catch (err) {
    console.error("[low-stock-alerts] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export { router, getAvgDailySales, hasRecentSales, calculateDaysUntilStockout };
