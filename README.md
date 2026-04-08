* StockFlow – Inventory Management System (B2B SaaS)

* StockFlow is a backend system for managing inventory across multiple warehouses. It allows businesses to track products, manage stock levels, and integrate with suppliers.

*Tech Stack

Backend: Node.js (Bun runtime)
Framework: Express.js
Database: PostgreSQL
ORM: Prisma
API Testing: Postman

**Project Structure
http-backend/
|
|-- src/
|   |-- index.ts
|   |-- alert.ts
|
|-- packages/
|   |-- db
|   |   |-- prisma
|   |   |   |-- schema.prisma
|   |
|   |-- src
|       |-- index.ts


* Getting Started

** Clone the Repository
        git clone <your-repo-url>
        cd http-backend

** Install Dependencies
        bun install

** Setup Environment Variables
        Create a .env file in the root:

First, run the development server:

```bash
cd http-backend
bun install
bun run dev
```

The server will be available at [http://localhost:4000](http://localhost:4000).

* API Testing (Postman)
    Create Product

    POST /api/products

    {
    "name": "Product A",
    "sku": "PROD-001",
    "price": 10.50,
    "warehouseId": 1,
    "initialQuantity": 100
    }