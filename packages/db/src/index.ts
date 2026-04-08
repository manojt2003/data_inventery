import { PrismaClient } from "../generated/prisma/client";
import { config } from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PrismaPg } from "@prisma/adapter-pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// http-backend runs with cwd outside this package; load DB env from this package explicitly
config({ path: path.join(__dirname, "../.env") })
config({ path: path.join(__dirname, "../../../.env.local") })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl?.trim()) {
    throw new Error(
        "DATABASE_URL is missing. Set it in packages/db/.env or in the process environment.",
    )
}


export let prismaClient = new PrismaClient({
    adapter: new PrismaPg(databaseUrl),
})

type CreateProductInput = {
    name: string
    sku: string
    price: number
    companyId: number
    warehouseId: number
    initialQuantity?: number
}

export const createProduct = async (input: CreateProductInput) => {
    const {
        name,
        sku,
        price,
        companyId,
        warehouseId,
        initialQuantity = 0,
    } = input

    const skuExists = await prismaClient.product.findUnique({ where: { sku } })
    if (skuExists) {
        throw new Error("SKU_EXISTS")
    }

    const warehouse = await prismaClient.warehouse.findUnique({
        where: { id: warehouseId },
    })

    if (!warehouse) {
        throw new Error("WAREHOUSE_NOT_FOUND")
    }

    if (warehouse.companyId !== companyId) {
        throw new Error("WAREHOUSE_COMPANY_MISMATCH")
    }

    return prismaClient.$transaction(async (tx) => {
        const product = await tx.product.create({
            data: {
                name,
                sku,
                price: price.toFixed(2),
                companyId,
            },
        })

        await tx.inventory.create({
            data: {
                productId: product.id,
                warehouseId,
                quantity: initialQuantity,
            },
        })

        return product
    })
}