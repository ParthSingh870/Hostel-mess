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
- **In-Memory Store & Cache:** Redis 7 (Docker)
- **Background Jobs:** BullMQ Kitchen Processing Worker
- **Real-Time Updates:** Socket.io with Redis Adapter & Private User Rooms
- **Automated Testing:** Vitest, Supertest

---

## Getting Started

### 1. Prerequisites
- Node.js (v18+)
- Neon PostgreSQL database account or compatible PostgreSQL instance
- Redis (running via Docker or local daemon on port 6379)

### 2. Environment Setup
Copy `.env.example` to create your local `.env`:
```bash
cp .env.example .env
```
Fill in your database URL, Redis URL, and configuration options:
```env
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
PORT=3000
JWT_SECRET="your_strong_jwt_access_secret"
JWT_REFRESH_SECRET="your_strong_jwt_refresh_secret"
REDIS_URL="redis://localhost:6379"

# Test Database connection string (for automated regression tests)
TEST_DATABASE_URL="postgresql://user:password@test-branch-host/dbname?sslmode=require"

# Cache & Rate Limiting Configuration
MENU_CACHE_TTL_SECONDS=60
ORDER_RATE_LIMIT_MAX=5
ORDER_RATE_LIMIT_WINDOW_SECONDS=60

# Transaction Timeouts (in ms, for remote DB latency tolerance)
ORDER_TX_MAX_WAIT_MS=5000
ORDER_TX_TIMEOUT_MS=10000

# Kitchen Worker Configuration
KITCHEN_PREP_SECONDS=10
SIMULATE_WORKER_FAILURE=false # For testing only: set to true to test retry exhaustion & auto-cancellation
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
- **Kitchen BullMQ Worker:**
  ```bash
  npm run dev:worker
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

## Core Features (Steps 1 to 8)

1. **Authentication & RBAC:** Secure registration and login issuing access (15m) and refresh (7d) tokens. Enforces `STUDENT`, `STAFF`, and `ADMIN` roles.
2. **Menu Management:** Full CRUD on mess menu catalog with Zod validation, price/stock updates, and soft-deactivation.
3. **Atomic Order Placement:** Isolated Prisma `$transaction` with conditional `updateMany` stock decrements ensuring zero race conditions or negative inventory.
4. **Order State Machine:** Enforced state transitions (`PLACED -> PREPARING -> READY -> COMPLETED`). Atomic cancellation locks prevent double stock restoration.
5. **Kitchen Worker & BullMQ:** Distributed queue with retry exhaustion handling, stalled-job crash recovery, and auto-cancellation.
6. **Real-Time WebSocket Updates:** Socket.io with Redis Adapter and private user rooms (`user:${userId}`) emitting events strictly after DB transaction commits.
7. **Redis Caching & Atomic Rate Limiting:**
   - **Cache-Aside (`menu:all`):** Fast in-memory catalog serving with proactive invalidation on every menu write, order creation, manual cancel, and worker auto-cancel.
   - **Atomic Rate Limiter (`POST /orders`):** Hand-rolled atomic Lua script rate limiter (5 orders/60s) strictly by verified `userId` returning HTTP 429 with `Retry-After`.
   - **Fail-Open Architecture:** Dedicated isolated Redis connection (`enableOfflineQueue: false` with 1s timeout) ensuring zero downtime if Redis goes offline.
8. **Production-Ready Error Architecture:** Centralized error handling middleware with domain-specific `AppError` subclasses, structured Zod error payloads, and strict server-side masking for 500 errors.

---

## Step 7: Redis Caching & Rate Limiting Benchmark

### Menu Latency Benchmark (`GET /api/menu`, N=30 requests)

Measured using `npm run bench:menu` and `npm run bench:menu:down` against the live Neon PostgreSQL instance:

| Metric | Cache MISS (Postgres DB) | Cache HIT (Redis RAM) | Redis Stopped (Fail-Open DB) | Speedup (Hit vs Miss) |
|---|---|---|---|---|
| **Min** | 268.84 ms | 2.07 ms | 265.55 ms | **129.9x** |
| **Median (p50)** | 279.94 ms | 3.94 ms | 279.40 ms | **71.1x** |
| **p95** | 292.86 ms | 5.88 ms | 286.32 ms | **49.8x** |
| **Average** | 281.70 ms | 3.89 ms | 279.14 ms | **72.4x** |

> [!NOTE]
> **Geographical Latency & Concurrency Limitation:**
> Measured with a remote database from my laptop; expect far lower latency when co-located.
> - The local development machine connects over WAN to a remote Neon PostgreSQL instance in AWS `us-east-2` (~270ms–290ms RTT per query). Serving the catalog directly from local Redis RAM reduces response latency to ~3ms–5ms (**50.5x to 71.1x faster** on median, and up to **129.9x** on min). When Redis is stopped, fail-open fallback latency remains stable (~266ms–279ms) without hanging or failing requests.
> - Under high concurrency on the exact same menu item (e.g. 5 simultaneous orders), PostgreSQL row-level locks serialize the updates over the WAN connection. While earlier orders commit in ~4s–5s, subsequent queued transactions take up to ~14.9s. Setting `ORDER_TX_TIMEOUT_MS=15000` prevents premature timeouts during cross-region development; co-locating the backend with the database in production reduces this serialization latency to low double-digit milliseconds.

---

## Error Response Format

All error responses across the application follow a standard, predictable JSON structure:

- **General Errors (4xx / 5xx):**
  ```json
  {
    "message": "Human-readable error description"
  }
  ```

- **Validation Errors (400 Bad Request):**
  ```json
  {
    "message": "Validation failed",
    "errors": [
      {
        "field": "items.0.quantity",
        "message": "Quantity must be at least 1"
      }
    ]
  }
  ```

- **Rate Limiting (429 Too Many Requests):**
  ```json
  {
    "error": "Too Many Requests",
    "message": "Order rate limit exceeded. You can only place 5 orders per 60 seconds.",
    "retryAfterSeconds": 60
  }
  ```

- **Security & Path Masking:** Unknown 500 server errors log the complete stack trace server-side and always return a generic `{"message": "Internal server error"}` to clients, ensuring zero leak of system file paths or internal DB details.

---

## Known Limitations

- **No Unified Success Envelope:** Success responses return data directly (e.g. raw array for `GET /api/menu`, or `{ data, meta }` for paginated orders) rather than a uniform `{ success: true, data }` envelope to preserve backwards-compatibility with existing tests and client consumers.
- **Geographical Latency:** WAN roundtrips to remote Neon PostgreSQL in `us-east-2` add ~270ms RTT per database query; local Redis cache mitigation handles catalog queries in ~3ms.

---

## Testing

### Automated Regression Test Suite (Step 9)

A comprehensive automated test suite powered by **Vitest** and **Supertest** covering critical security, transactional, and architectural paths where a silent bug would cause severe damage.

#### Prerequisites for Running Automated Tests:
1. **Isolated Test Database:** Create an isolated Neon branch (e.g. `test`) and configure its connection string in `.env` as `TEST_DATABASE_URL`.
2. **Redis Running:** Ensure the Redis container is running (`docker start hostel-redis`). Tests automatically use Redis DB index 1 (`/1`) to protect development Redis keys.
3. **Worker Stopped:** The background BullMQ worker must **NOT** be running (`enqueueOrder` is cleanly mocked so tests run instantly without background worker dependencies).

#### Safety & Isolation Guarantees:
- **Dev DB Guard (`tests/setup.ts`):** Fails fast immediately if `TEST_DATABASE_URL` is missing or identical to `DATABASE_URL`. Tests will **NEVER** touch or modify the development database.
- **Redis Isolation:** Tests are routed to Redis database index 1. Tests never invoke `FLUSHALL` or `FLUSHDB`.
- **Serial Execution:** Database-touching test suites execute serially (`fileParallelism: false`) with generous 30s timeouts to prevent cross-suite concurrency collisions on remote serverless databases.
- **Mocks vs Real Components:**
  - *Mocked:* BullMQ queue enqueuing (`enqueueOrder`) and Socket.io realtime broadcasts (`emitOrderStatus`).
  - *Real:* PostgreSQL database transactions (`$transaction`), PostgreSQL `CHECK ("stockCount" >= 0)` constraint, JWT auth & bcrypt hashing, Zod schema validation, centralized `AppError` handlers, and the atomic Redis Lua script rate limiter.

#### Running Automated Tests:
```bash
# Run all automated test suites serially
npm test

# Run tests in interactive watch mode
npm run test:watch

# Run a specific test file:
npm test tests/smoke.test.ts               # Health check and 404 handler
npm test tests/auth.test.ts                # Register, login, refresh, logout, token expiry
npm test tests/menu.test.ts                # RBAC guards, menu CRUD, partial patch, soft-delete
npm test tests/order.test.ts               # Stock decrement & concurrent order race condition
npm test tests/order-status.test.ts        # Lifecycle transitions & double-cancel race condition
npm test tests/error-and-ratelimit.test.ts # Error shapes, path masking & atomic Lua rate limiter
```

---

### Manual & Stress Test Scripts

> [!IMPORTANT]
> Run `test:manual:suite` with the BullMQ worker stopped.

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

# Step 7 Manual Verification Suites:
npm run test:manual:s1          # Cache helper verification
npm run test:manual:s2          # Menu cache HIT/MISS verification
npm run test:manual:s3          # Invalidation lifecycle verification
npm run test:manual:s4          # Atomic order rate limiter (429 & Retry-After)
npm run test:manual:s4-failopen # Fail-open resilience with Redis stopped
npm run bench:menu              # Latency benchmark (MISS vs HIT)
npm run bench:menu:down         # Latency benchmark with Redis stopped
```
Refer to [tests-manual/README.md](tests-manual/README.md) for details.
