# Hostel Mess Backend

A resilient, scalable backend service for managing hostel mess operations, meal menus, inventory stock, and student order placement with atomic concurrency control and strict state transitions.

---

## Tech Stack

- **Runtime & Language:** Node.js, TypeScript (ESM)
- **Framework:** Express.js
- **Database & ORM:** Neon Serverless PostgreSQL, Prisma ORM
- **Driver Adapter:** `@prisma/adapter-neon` over WebSocket (Port 443)
- **Validation:** Zod
- **Authentication & Security:** JWT (Access & Refresh Tokens), bcrypt, Role-Based Access Control (RBAC)

---

## Getting Started

### 1. Prerequisites
- Node.js (v18+)
- Neon PostgreSQL database account or compatible PostgreSQL instance

### 2. Environment Setup
Copy `.env.example` to create your local `.env`:
```bash
cp .env.example .env
```
Fill in your database URL and secret keys:
```env
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
PORT=3000
JWT_SECRET="your_strong_jwt_access_secret"
JWT_REFRESH_SECRET="your_strong_jwt_refresh_secret"
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Setup & Migrations
```bash
npx prisma generate
```

### 5. Running the Application

- **Development mode (with auto-reload):**
  ```bash
  npm run dev
  ```
- **Production build:**
  ```bash
  npm run build
  npm start
  ```
- **Health Check:**
  Once started, verify database and server health:
  ```bash
  GET http://localhost:3000/health
  ```

---

## Core Features (Steps 1 to 4)

1. **Authentication & RBAC:** Secure registration and login issuing access (15m) and refresh (7d) tokens. Enforces `STUDENT`, `STAFF`, and `ADMIN` roles.
2. **Menu Management:** Full CRUD on mess menu catalog with Zod validation, price/stock updates, and soft-deactivation.
3. **Atomic Order Placement:** Isolated Prisma `$transaction` with conditional `updateMany` stock decrements ensuring zero race conditions or negative inventory.
4. **Order State Machine:** Enforced state transitions (`PLACED -> PREPARING -> READY -> COMPLETED`). Atomic cancellation locks prevent double stock restoration.
5. **Pagination & API Safety:** Paginated order lists with safe upper limit clamps to prevent DoS attacks.

---

## Testing

Manual and concurrency test scripts are located in `tests-manual/`:
```bash
# Run the complete 24-step integration test suite
npm run test:manual:suite

# Test duplicate registration concurrency
npm run test:manual:dupe

# Test inventory deduction race conditions
npm run test:manual:concurrency

# Test atomic double cancellation
npm run test:manual:double-cancel
```
Refer to [tests-manual/README.md](file:///c:/Users/Parth%20Singh/Desktop/hostel-mess-backend/tests-manual/README.md) for details.
