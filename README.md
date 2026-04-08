# 🚀 StockFlow – Inventory Management System (B2B SaaS)

StockFlow is a backend system for managing inventory across multiple warehouses. It enables businesses to track products, manage stock levels, and integrate with suppliers efficiently.

---

## 🛠️ Tech Stack

* **Backend:** Node.js (Bun runtime)
* **Framework:** Express.js
* **Database:** PostgreSQL
* **ORM:** Prisma
* **API Testing:** Postman

---

## 📂 Project Structure

```bash
http-backend/
│
├── src/
│   ├── index.ts
│   ├── alert.ts
│
├── packages/
│   ├── db/
│   │   └── prisma/
│   │       └── schema.prisma
│   │
│   └── src/
│       └── index.ts
```

---

## ⚙️ Getting Started

### 1️⃣ Clone the Repository

```bash
git clone <your-repo-url>
cd http-backend
```

---

### 2️⃣ Install Dependencies

```bash
bun install
```

---

### 3️⃣ Setup Environment Variables

Create a `.env` file in the root directory:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/stockflow"
PORT=4000
```

---

## ▶️ Run the Development Server

```bash
cd http-backend
bun install
bun run dev
```

The server will be available at:

👉 http://localhost:4000

---

## 🧪 API Testing (Postman)

### 📦 Create Product

**Endpoint:**

```http
POST /api/products
```

**Request Body:**

```json
{
  "name": "Product A",
  "sku": "PROD-001",
  "price": 10.50,
  "warehouseId": 1,
  "initialQuantity": 100
}
```

---

## 📌 Features

* Multi-warehouse inventory tracking
* Unique SKU enforcement
* Scalable backend architecture
* Prisma ORM for type-safe database operations

---

## 🚧 Future Improvements

* Low stock alert system
* Supplier management integration
* Authentication & authorization
* Real-time inventory updates

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

## 📄 License

MIT License
