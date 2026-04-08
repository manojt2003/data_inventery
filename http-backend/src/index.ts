import express from "express"
import { createProduct, prismaClient } from "../../packages/db/src/index.ts"
import type { Request, Response } from "express"
import { z } from "zod"; // zod for schema validation

const app = express()
app.use(express.json())


const router = express.Router();
const prisma = prismaClient;

app.use(router);

type AppError = {
  statusCode?: number;
  code?: string;
  meta?: { target?: string[] };
  message?: string;
};


const CreateProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(255),
  sku: z
    .string()
    .min(1, "SKU is required")
    .max(100)
    .regex(/^[A-Z0-9\-_]+$/i, "SKU must be alphanumeric with dashes/underscores"),

  // coerce ensures "9.99" string from JSON becomes a number
  price: z.coerce
    .number()
    .positive("Price must be a positive number")
    .multipleOf(0.01, "Price can have at most 2 decimal places"),

  // Optional fields with defaults
  description: z.string().max(1000).optional(),
  unit: z.string().max(50).optional().default("piece"),
  is_active: z.boolean().optional().default(true),

  // Initial placement into a specific warehouse
  warehouse_id: z.string().uuid("warehouse_id must be a valid UUID"),
  initial_quantity: z.coerce
    .number()
    .int()
    .min(0, "Quantity cannot be negative")
    .default(0),

  // Optional: which supplier to link
  supplier_id: z.string().uuid().optional(),
});

router.get("/health",(req, res) => {
  res.json({status: "ok"})
})

router.post("/api/products", async (req: Request, res: Response) => {
 
  const parsed = CreateProductSchema.safeParse(req.body);
  if (!parsed.success) {
    
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const {
    name,
    sku,
    price,
    description,
    unit,
    is_active,
    warehouse_id,
    initial_quantity,
    supplier_id,
  } = parsed.data;

  try {
    // ── Step 2: Wrap everything in a single atomic transaction ──
    // If ANY step fails, ALL changes are rolled back.
    // This prevents orphaned products and inventory inconsistencies.
    const result = await prisma.$transaction(async (tx: any) => {

      // ── Step 3: Enforce SKU uniqueness before insert ──────────
      // Using findUnique is more efficient than catching a unique constraint error
      // because it avoids generating an error object on the DB side.
      const existingProduct = await tx.product.findUnique({
        where: { sku },
        select: { id: true }, // Only fetch the id — we don't need more
      });

      if (existingProduct) {
        // Throw a custom error that we can catch outside the transaction
        throw Object.assign(new Error("SKU_CONFLICT"), {
          statusCode: 409,
          message: `A product with SKU "${sku}" already exists`,
        });
      }

      // ── Step 4: Verify the warehouse exists ──────────────────
      const warehouse = await tx.warehouse.findUnique({
        where: { id: warehouse_id },
        select: { id: true, company_id: true },
      });

      if (!warehouse) {
        throw Object.assign(new Error("WAREHOUSE_NOT_FOUND"), {
          statusCode: 404,
          message: `Warehouse ${warehouse_id} not found`,
        });
      }

      // ── Step 5: Create the product ───────────────────────────
      // Note: NO warehouse_id on the product itself.
      // Warehouse association lives in the Inventory table.
      const product = await tx.product.create({
        data: {
          name,
          sku,
          // Keep 2dp precision for Decimal column without float drift
          price: price.toFixed(2),
          description: description ?? null,
          unit,
          is_active,
          company_id: warehouse.company_id, // Product belongs to company, not warehouse
          ...(supplier_id && {
            product_suppliers: {
              create: { supplier_id, is_primary: true },
            },
          }),
        },
      });

      // ── Step 6: Create inventory record in that warehouse ────
      // If quantity > 0, also create a history record (audit trail)
      const inventory = await tx.inventory.create({
        data: {
          product_id: product.id,
          warehouse_id,
          quantity: initial_quantity,
          low_stock_threshold: 10, // sensible default; can be updated later
        },
      });

      // ── Step 7: Seed inventory history if initial qty > 0 ────
      if (initial_quantity > 0) {
        await tx.inventoryHistory.create({
          data: {
            inventory_id: inventory.id,
            product_id: product.id,
            warehouse_id,
            change_type: "INITIAL_STOCK",
            quantity_change: initial_quantity,
            quantity_after: initial_quantity,
            notes: "Initial stock on product creation",
          },
        });
      }

      return { product, inventory };
    });

    // ── Step 8: Return success response ─────────────────────────
    return res.status(201).json({
      message: "Product created successfully",
      product_id: result.product.id,
      sku: result.product.sku,
      warehouse_id,
      initial_quantity,
    });

  } catch (err: unknown) {
    // ── Error Handling ───────────────────────────────────────────

    // Our custom business logic errors (thrown inside the transaction)
    const appErr = err as AppError;
    if (appErr.statusCode) {
      return res.status(appErr.statusCode).json({ error: appErr.message });
    }

    // Prisma unique constraint violation (race condition fallback)
    // Even with the pre-check, two concurrent requests could both pass
    // the uniqueness check; the DB constraint is the final guard.
    if (appErr.code === "P2002") {
      const field = appErr.meta?.target?.[0] ?? "field";
      return res.status(409).json({
        error: `Conflict: ${field} already exists`,
      });
    }

    // Prisma foreign key violation
    if (appErr.code === "P2003") {
      return res.status(400).json({
        error: "Referenced record does not exist (foreign key violation)",
      });
    }

    // Unknown server error — log internally but don't leak internals to client
    console.error("[create_product] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

export default router;