# Hostel Mess Backend

[![CI Test Suite](https://github.com/ParthSingh870/Hostel-mess/actions/workflows/test.yml/badge.svg)](https://github.com/ParthSingh870/Hostel-mess/actions/workflows/test.yml)

> A reliable learning project with known limitations, demonstrating robust containerized backend patterns for hostel mess operations, concurrent order placement, asynchronous job queues, and real-time order tracking.

---

## Live Demo

Coming soon after hosting

---

## Problem Statement

Hostel mess management faces severe operational bottlenecks during peak breakfast, lunch, and dinner meal rushes:
1. **High Concurrency & Inventory Races:** Hundreds of students placing orders simultaneously cause race conditions that result in double-booking and negative inventory.
2. **Database Overload:** Repetitive menu reads overload the database during peak rush hours, degrading response times.
3. **Kitchen Bottlenecks:** Direct unthrottled order intake overwhelms kitchen preparation staff and crashes servers if workers run in the same process.
4. **Single-Point Failure Fragility:** If caching or in-memory queuing layers go offline, traditional architectures crash or drop incoming requests entirely.

This system addresses these challenges through isolated transactions, atomic conditional inventory deduction, asynchronous queue throttling, fail-open resilience, and multi-stage containerization.

---

## Architecture Diagram

```mermaid
graph TD
    subgraph Clients["Client Layer"]
        Student["Student Web / Mobile"]
        Staff["Staff / Admin"]
    end

    subgraph Gateway["Docker Compose Network"]
        subgraph AppService["app: Express & Socket.io (Port 3000)"]
            AuthMod["Auth & RBAC Middleware"]
            RateLimiter["Lua Atomic Rate Limiter"]
            MenuController["Menu Controller<br/>(Cache-Aside, 60s TTL)"]
            OrderController["Order Controller (Atomic Tx)"]
            SocketServer["Socket.io Server<br/>(@socket.io/redis-adapter)"]
        end

        subgraph WorkerService["worker: BullMQ Kitchen Worker"]
            KitchenWorker["Worker Process<br/>(Concurrency: 3)"]
        end

        subgraph Infra["Infrastructure Services"]
            RedisSvc[("redis: Redis 7 Alpine<br/>Cache, Queues & Pub/Sub")]
            PostgresSvc[("postgres: PostgreSQL 16 Alpine<br/>Relational Database")]
            MigrateSvc["migrate: One-Shot Service<br/>(prisma migrate deploy)"]
        end
    end

    Student -->|"HTTP REST & WebSocket"| AppService
    Staff -->|"HTTP REST & WebSocket"| AppService

    AppService -->|"Cache Check & Rate Limit"| RedisSvc
    AppService -->|"Enqueue Cooking Job"| RedisSvc
    AppService -->|"Read / Write Transaction"| PostgresSvc
    AppService <-->|"Redis Pub/Sub (Socket.io Adapter)"| RedisSvc

    WorkerService -->|"Consume Cooking Job"| RedisSvc
    WorkerService -->|"Atomic State Update"| PostgresSvc
    WorkerService -->|"Emit Status (PREPARING/READY) via Redis Emitter"| RedisSvc

    MigrateSvc -->|"Deploy Migrations First"| PostgresSvc
```

---

## Tech Stack

- **Runtime & Language:** Node.js (v22 Alpine), TypeScript 7 (`^7.0.2`, NodeNext ESM)
- **Web Framework:** Express.js 5 (`^5.2.1`)
- **Database & ORM:** PostgreSQL 16 (Local Docker) / Neon Serverless PostgreSQL (Cloud), Prisma ORM 5 (`^5.22.0`)
- **Driver Layer:** Dual-Mode (Standard TCP for local Postgres container; `@prisma/adapter-neon` `^5.22.0` over WebSocket for Neon Cloud)
- **Caching & Rate Limiting:** Redis 7 Alpine, `ioredis` `^6.0.0` with custom atomic Lua script
- **Background Queue:** BullMQ 6 (`^6.4.2`) (Redis Streams & Hash sets)
- **Real-Time Communication:** Socket.io 4 (`^4.8.4`) with `@socket.io/redis-adapter` (`^8.3.0`) and `@socket.io/redis-emitter` (`^5.1.0`)
- **Validation & Security:** Zod (`^4.6.2`), bcrypt (`^6.0.0`), jsonwebtoken (`^9.0.3`)
- **Containerization:** Multi-Stage Dockerfile (Alpine, non-root user `node`), Docker Compose
- **CI Pipeline:** GitHub Actions with native Service Containers (`postgres:16-alpine`, `redis:7-alpine`) (CI duration: ~31s on GitHub Actions Ubuntu runner)
- **Automated Testing:** Vitest 5 (`^5.0.5`), Supertest 7 (`^7.3.1`)

---

## Project Structure

```text
hostel-mess-backend/
├── prisma/
│   ├── schema.prisma             # Prisma models, enums, and database configuration
│   └── migrations/               # PostgreSQL schema migration history
├── src/
│   ├── cache/                    # Redis caching helper and fail-open wrapper
│   ├── config/                   # Prisma ORM and Redis client configurations
│   ├── controllers/              # Request handlers for auth, menu, and orders
│   ├── errors/                   # Custom operational error classes (AppError)
│   ├── middlewares/              # JWT auth, RBAC, error handler, rate limiter
│   ├── queues/                   # BullMQ kitchen queue setup and job options
│   ├── realtime/                 # Socket.io server and Redis emitter integration
│   ├── routes/                   # Express route registrations
│   ├── services/                 # Business logic and atomic database transactions
│   ├── utils/                    # Async error wrappers (catchAsync)
│   ├── validators/               # Zod input validation schemas
│   ├── workers/                  # BullMQ kitchen worker background process
│   ├── app.ts                    # Express app configuration and middleware stack
│   └── server.ts                 # HTTP server and WebSocket bootstrap
├── tests/                        # Vitest automated integration test suites
├── docker-compose.yml            # Multi-container orchestration (App, Worker, Postgres, Redis)
├── Dockerfile                    # Multi-stage production container build (Alpine, non-root user node)
├── .env.example                  # Environment variable template with safe dummy values
└── package.json                  # Dependencies and execution scripts
```

---

## Setup via Docker Compose

### Prerequisites
A newcomer requires **ONLY** two tools installed on their host operating system:
1. **Git**
2. **Docker Desktop** (or Docker Engine with Docker Compose)

*(Node.js, TypeScript, PostgreSQL, and Redis are completely containerized and do NOT need to be installed on your host).*

### Step-by-Step Launch

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ParthSingh870/Hostel-mess.git
   cd Hostel-mess
   ```

2. **Copy the environment template:**
   ```bash
   # Windows Command Prompt (CMD):
   copy .env.example .env

   # Windows PowerShell:
   Copy-Item .env.example .env

   # Linux / macOS:
   cp .env.example .env
   ```

3. **Start the entire stack with ONE command:**
   ```bash
   docker compose up --build -d
   ```
   *What happens behind the scenes:*
   - Docker builds the multi-stage Alpine image (`hostel-mess-backend:latest`, running as non-root user `node`).
   - `postgres` and `redis` start and run automated healthchecks.
   - `migrate` container waits for healthy database, runs `prisma migrate deploy`, and exits cleanly.
   - `app` (Express API) and `worker` (BullMQ Kitchen Worker) start once migrations succeed.

4. **Verify services are running:**
   ```bash
   docker compose ps
   ```

5. **Test health check endpoint:**
   ```bash
   curl http://localhost:3000/health
   # Response: {"status":"ok","message":"Server and Neon DB are healthy"}
   ```

6. **Tear down containers:**
   ```bash
   # Stop containers:
   docker compose down

   # Stop and erase all volume data (database and redis data):
   docker compose down -v
   ```

---

## Local Development Setup

### Prerequisites
- Node.js (v20+ or v22 LTS recommended)
- Docker Desktop (for running Postgres and Redis infrastructure)
- Git

### Step-by-Step Local Setup

1. **Clone the repository and enter directory:**
   ```bash
   git clone https://github.com/ParthSingh870/Hostel-mess.git
   cd Hostel-mess
   ```

2. **Copy environment variables:**
   ```bash
   # Windows Command Prompt (CMD):
   copy .env.example .env

   # Windows PowerShell:
   Copy-Item .env.example .env

   # Linux / macOS:
   cp .env.example .env
   ```

3. **Install dependencies and generate Prisma Client:**
   ```bash
   npm ci
   npx prisma generate
   ```

4. **Start PostgreSQL and Redis containers:**
   ```bash
   docker compose up -d postgres redis
   ```

5. **Deploy database migrations:**
   ```bash
   npx prisma migrate deploy
   ```

6. **Start development API server:**
   ```bash
   npm run dev
   ```

7. **Start kitchen worker process (in a separate terminal):**
   ```bash
   npm run dev:worker
   ```

---

## Environment Variables

| Variable | Default Value | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port on which the Express server listens. |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/hostel_mess?schema=public` | Primary PostgreSQL database connection string. |
| `TEST_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/hostel_mess_test?schema=public` | Isolated test database URL used by automated Vitest suites. |
| `REDIS_URL` | `redis://redis:6379` | Redis connection URL for caching, BullMQ, and Socket.io Pub/Sub. |
| `JWT_SECRET` | *Required* | Secret key for signing and verifying HMAC SHA-256 access tokens. |
| `JWT_REFRESH_SECRET` | *Required* | Secret key for signing and verifying refresh tokens. |
| `CORS_ORIGIN` | `*` | Allowed CORS origins for HTTP routes and Socket.io handshakes. |
| `MENU_CACHE_TTL_SECONDS` | `60` | Time-to-live (in seconds) for menu catalog cache in Redis. |
| `ORDER_RATE_LIMIT_MAX` | `5` | Maximum number of orders allowed per time window per student. |
| `ORDER_RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate limit window duration (in seconds). |
| `ORDER_TX_MAX_WAIT_MS` | `5000` | Maximum time Prisma waits to acquire an open transaction client. |
| `ORDER_TX_TIMEOUT_MS` | `10000` | Maximum execution time before Prisma transaction aborts. |
| `KITCHEN_PREP_SECONDS` | `5` | Simulated food preparation delay in the kitchen worker. |
| `SIMULATE_WORKER_FAILURE` | `false` | When set to `true`, forces worker jobs to throw errors to test retry exhaustion. |

---

## Automated & Manual Testing

### How to Run Vitest Automated Tests

For automated integration testing, ensure the following setup:
1. **Environment File**: An active `.env` file copied from `.env.example` must exist in the root directory (providing `JWT_SECRET`, `JWT_REFRESH_SECRET`, and default port settings).
2. **Worker Process Stopped**: Do **NOT** run `npm run dev:worker` while running tests. Automated tests manage order state transitions deterministically; an active background worker will asynchronously pick up and advance orders, causing race conditions in test assertions.
3. **Redis Running**: Redis must be running (e.g. via `docker compose up -d redis`) on `REDIS_URL`. Integration tests automatically isolate their cache and rate limit keys on Redis DB index 1 (`/1`) via `tests/setup.ts`.
4. **Test Database & Guard**: The test runner enforces safety guards (`tests/setup.ts`):
   - `TEST_DATABASE_URL` must be defined.
   - `TEST_DATABASE_URL` must **not** equal `DATABASE_URL` to protect the development database from test teardown truncation.

#### Step 1: Create the Test Database (One-Time Setup)

```bash
docker exec hostel-postgres psql -U postgres -c "CREATE DATABASE hostel_mess_test;"
```

#### Step 2: Apply Migrations to the Test Database

**Windows Command Prompt (CMD):**
```cmd
set DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess_test?schema=public
npx prisma migrate deploy
```

**Windows PowerShell:**
```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess_test?schema=public"
npx prisma migrate deploy
```

**Linux / macOS:**
```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess_test?schema=public" npx prisma migrate deploy
```

#### Step 3: Run the Vitest Suite (26 Tests)

**Windows Command Prompt (CMD):**
```cmd
set DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess?schema=public
set TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess_test?schema=public
set REDIS_URL=redis://127.0.0.1:6379
npm test
```

**Windows PowerShell:**
```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess?schema=public"
$env:TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess_test?schema=public"
$env:REDIS_URL = "redis://127.0.0.1:6379"
npm test
```

**Linux / macOS:**
```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess?schema=public" TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/hostel_mess_test?schema=public" REDIS_URL="redis://127.0.0.1:6379" npm test
```

### Running Manual Concurrency and Stress Scripts

The repository contains specialized standalone scripts in `tests-manual/` to verify specific high-concurrency race conditions:

1. **Concurrent Duplicate Registration (`tests-manual/test_dupe.cjs`):**
   Fires simultaneous registration requests with identical credentials, testing HTTP 409 Conflict rejection.
   ```bash
   npm run test:manual:dupe
   ```
2. **Concurrent Inventory Depletion Race (`tests-manual/test_concurrent_order.cjs`):**
   Tests simultaneous order placement for the last remaining item. Verifies that exactly one order succeeds and the other receives HTTP `400 Bad Request` ("Insufficient stock").
   ```bash
   npm run test:manual:concurrency
   ```
3. **Double Cancellation Race (`tests-manual/test_double_cancel.cjs`):**
   Fires simultaneous cancel requests against the same order. Verifies that exactly one cancel succeeds and stock is restored only once.
   ```bash
   npm run test:manual:double-cancel
   ```
4. **Complete 24-Step Manual Mess Workflow Suite (`tests-manual/test-all.ts`):**
   ```bash
   npm run test:manual:suite
   ```

---

## API Documentation

### Core Endpoints & Access Control

| Method | Endpoint | Auth Required | Allowed Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | None | Public | Health check verifying Express server and database connectivity (`SELECT 1`). |
| `POST` | `/api/auth/register` | None | Public | Register a new student account (public registration assigns `STUDENT` role). |
| `POST` | `/api/auth/login` | None | Public | Authenticate with email/password; returns user info, access token, and refresh token. |
| `POST` | `/api/auth/refresh` | None | Public | Exchange a valid refresh token for a new 15-minute access token. |
| `POST` | `/api/auth/logout` | None | Public | Revoke a refresh token in the database. |
| `GET` | `/api/auth/profile` | Bearer JWT | Any | Get profile details (`id`, `name`, `email`, `role`, `createdAt`) of the logged-in user. |
| `GET` | `/api/menu` | None | Public | Fetch available menu items (`isAvailable: true`). Uses Redis Cache-Aside (`menu:all`). |
| `POST` | `/api/menu` | Bearer JWT | `STAFF`, `ADMIN` | Create a new menu item and invalidate the Redis menu cache. |
| `PATCH` | `/api/menu/:id` | Bearer JWT | `STAFF`, `ADMIN` | Update menu item details and invalidate the Redis menu cache. |
| `DELETE` | `/api/menu/:id` | Bearer JWT | `STAFF`, `ADMIN` | Soft-delete a menu item (`isAvailable: false`) and invalidate the Redis menu cache. |
| `POST` | `/api/orders` | Bearer JWT | `STUDENT` | Place an order. Throttled by rate limiter; executes atomic stock decrement in `$transaction`. |
| `GET` | `/api/orders/my` | Bearer JWT | `STUDENT` | Fetch order history for the authenticated student (enforces strict user isolation). |
| `GET` | `/api/orders` | Bearer JWT | `STAFF`, `ADMIN` | Fetch all orders across the mess with pagination (`page`, `limit`) and status filter. |
| `PATCH` | `/api/orders/:id/status` | Bearer JWT | `STAFF`, `ADMIN` | Transition order status. If `CANCELLED`, restores stock and invalidates menu cache. |
| `PATCH` | `/api/orders/:id/complete`| Bearer JWT | `STAFF`, `ADMIN` | Specialized transition to mark a `READY` order as `COMPLETED`. |

---

## Design Decisions

### 1. Why Transactions for Orders?
Order placement touches multiple database rows: decrementing inventory stock on `MenuItem` and creating `Order` and `OrderItem` records. Wrapping these in a strict Prisma `$transaction` with conditional `updateMany` guarantees:
- **No Race Conditions:** Stock is decremented atomically with `where: { id, stockCount: { gte: quantity } }`.
- **Zero Negative Inventory:** Database-level check constraint `CHECK ("stockCount" >= 0)` guarantees stock never drops below zero even under massive concurrency.
- If any menu item lacks sufficient stock, the entire transaction rolls back completely.

### 2. Why a Queue with Concurrency Limits?
A real kitchen cannot prepare arbitrary numbers of meals simultaneously. Pushing incoming orders into a BullMQ queue with `concurrency: 3` enforces controlled kitchen throughput:
- Prevents database connection exhaustion during peak order spikes.
- Decouples student order acceptance (instant HTTP 201 response) from meal preparation.
- Provides built-in crash recovery (stalled jobs are recovered and resumed if a worker process crashes mid-cooking).

### 3. Why Redis Caching and Rate Limiting?
- **Menu Cache-Aside (`menu:all`):** Mess menus change infrequently, but are viewed repeatedly by students. Caching the serialized catalog in Redis RAM with a 60-second TTL (`MENU_CACHE_TTL_SECONDS=60` in code and `.env`) reduces response latency from ~280ms down to ~3.9ms (over 71x faster on median in benchmarks).
- **Atomic Lua Rate Limiter:** Protects the order creation endpoint from spam or denial-of-service. An atomic Lua script checks and increments user order counts in a single Redis evaluation step, eliminating read-modify-write race conditions.

### 4. Why Fail-Open?
If Redis crashes or runs out of memory, students must not starve. The caching and rate-limiting modules use an isolated Redis client configured with `enableOfflineQueue: false` and strict 1-second timeouts:
- If Redis is down, `getJson(MENU_CACHE_KEY)` logs a warning and queries PostgreSQL directly.
- The order rate limiter logs a warning and lets orders through to the database transaction.
- The system gracefully degrades performance while maintaining 100% operational availability.

### 5. Why a Separate Worker Process?
The BullMQ kitchen worker runs as an independent OS process (and independent Docker container) rather than inside the Express server:
- CPU-intensive tasks, worker restart cycles, or simulated cooking delays cannot block the single-threaded Node.js event loop handling student HTTP and Socket.io traffic.
- Allows independent horizontal scaling (e.g., scaling worker containers up during lunch rush without scaling API gateways).

---

## Benchmark: Redis Caching & Latency

The following latency metrics were measured on `GET /api/menu` (N=30 requests) using `npm run bench:menu` and `npm run bench:menu:down` against the live remote Neon PostgreSQL instance:

| Metric | Cache MISS (Postgres DB) | Cache HIT (Redis RAM) | Redis Stopped (Fail-Open DB) | Speedup (Hit vs Miss) |
| :--- | :--- | :--- | :--- | :--- |
| **Min** | 268.84 ms | 2.07 ms | 265.55 ms | **129.9x** |
| **Median (p50)** | 279.94 ms | 3.94 ms | 279.40 ms | **71.1x** |
| **p95** | 292.86 ms | 5.88 ms | 286.32 ms | **49.8x** |
| **Average** | 281.70 ms | 3.89 ms | 279.14 ms | **72.4x** |

*Measurement Conditions:* Sample size N=30 requests executed via `tests-manual/bench-menu.ts` from local client (`http://127.0.0.1:3000`), querying remote Neon PostgreSQL (`neondb` in AWS region `us-east-2`) over WAN, with Redis running locally (`localhost:6379`).

---

## What is Tested and What is Not

### What is Verified & Tested

- **Static Verification**:
  - TypeScript compilation with zero type errors (`npx tsc --noEmit`).
  - Production bundle build (`npm run build`).
  - Security audit: npm audit clean at time of check.
  - Pattern scan: manual pattern scans of the working tree found no secrets; git history was checked for Neon credential prefixes, external database URLs, and .env was never committed.
- **Automated Integration Tests (Vitest)**:
  - 26 integration tests running across 6 test suites with 100% pass rate.
  - Concurrent order placement race conditions: exactly one request succeeds when competing for final item stock; the other receives 400.
  - Double cancellation race conditions: exactly one cancellation succeeds (200); subsequent cancellation returns 409 Conflict with stock restored strictly once.
- **Manual Verification Suites**:
  - 24-step complete mess workflow (`test:manual:suite`).
  - Concurrent duplicate registration (`test:manual:dupe`, 409 Conflict).
  - Concurrent order stock decrement (`test:manual:concurrency`).
  - Atomic double-cancel stock restoration (`test:manual:double-cancel`).
- **Authentication & Authorization**:
  - Public registration ignores client-supplied roles, strictly assigning `STUDENT`.
  - Wrong password and non-existent email return 400 with sanitized error messages.
  - Refresh token lifecycle: invalid, expired, and revoked refresh tokens return 401.
- **Caching & Invalidation**:
  - `GET /api/menu` cache miss (`X-Cache: MISS`) on first call; subsequent calls hit Redis (`X-Cache: HIT`).
  - Cache TTL set to 60 seconds.
  - Automated invalidation on menu create/update/delete and order placement/cancellation.
- **State Machine & RBAC**:
  - Unidirectional order state transitions (`PLACED` -> `PREPARING` -> `READY` -> `COMPLETED`).
  - Illegal status transitions (e.g. `PLACED` -> `READY`) rejected with 400.
  - Student cannot query all mess orders (`403 Forbidden`); Staff cannot place student orders (`403 Forbidden`).
  - User isolation: students can only view their own orders via `GET /api/orders/my`.
- **Rate Limiting**:
  - Fixed-window rate limiting on `POST /api/orders` (5 orders per 60 seconds).
  - Accurate `X-RateLimit-Remaining` and `Retry-After` headers.
  - Per-user isolation: User A reaching rate limit does not block User B.
  - Concurrent request throttling: bursts exceeding limit return 429.
- **Kitchen Queue & Background Worker**:
  - BullMQ controlled concurrency (`concurrency: 3`): when 7 orders arrive simultaneously, at most 3 are in `PREPARING` state at any given moment.
  - Worker failure recovery: simulated cooking failures trigger 3 exponential retry attempts before marking the order `CANCELLED` and atomically restoring stock.
  - Graceful shutdown on `SIGTERM`.
- **Real-Time WebSockets (Socket.io)**:
  - Handshake authentication: missing or invalid JWT tokens are rejected.
  - Room isolation: each user automatically joins a private room matching their verified `userId`.
  - Real-time event delivery: status transitions (`PLACED`, `PREPARING`, `READY`) emit to the ordering student's private room; other connected sockets receive zero events.
- **Resilience & Fail-Open**:
  - When Redis is stopped, `GET /api/menu` falls back to PostgreSQL (200 OK) without crashing.
  - When Redis is stopped, `POST /api/orders` commits the order and stock decrement to PostgreSQL (201 Created) without hanging (enqueue failed without waiting for the 2.5 s guard; POST completed in ~55 ms on local Docker, not Neon).
- **Containerization**:
  - Multi-stage Alpine Docker build produces minimal production images running as non-root user `node`.
  - Docker Compose full-stack startup, automatic migration execution, healthcheck readiness, and clean teardown.
- **Error Sanitization**:
  - 404, 400 malformed JSON, and 400 Zod validation errors return clean JSON payloads with zero stack traces or internal filesystem paths.

### What is Not Tested / Untested Scenarios

- **Stalled-Job Recovery Timing Under Abrupt Worker SIGKILL:** While BullMQ supports stalled-job lock expiration (default 30s lock duration and 30s stalled interval), clean testing without orphan background processes showed that an active job held by an abruptly killed worker did not automatically re-queue and reach READY within a 60-second observation window; end-to-end BullMQ stalled job recovery timing under abrupt worker process termination remains to be fully measured.
- **Long-term Redis Memory Exhaustion**: Memory limits and LRU key eviction behavior under sustained multi-gigabyte cache load.
- **Multi-Node Redis Clustering**: Failover behavior under Redis Sentinel or Redis Cluster topologies (currently tested against single-instance Redis).
- **Multi-Instance Horizontal Scaling**: Session stickiness and multi-node WebSocket sync across multiple Express API replica containers behind an ingress load balancer.
- **Extreme Database Network Partitions**: Mid-transaction TCP drops to remote cloud databases (Neon WebSocket adapter reconnection resilience).

---

## Known Limitations

This system is an educational, reliable learning project with known design constraints:

1. **Queue Job Loss During Redis Outage:** Because `queueRedisConfig` sets `enableOfflineQueue: false`, commands fail immediately when Redis is down instead of buffering in memory. The 2.5s `Promise.race` in `order.service.ts` acts as a safety guard. In a local Docker test (not Neon), `POST /api/orders` completed in ~55ms, safely committing the order and stock decrement to PostgreSQL. However, enqueue failed without waiting for the 2.5 s guard, and the BullMQ job was lost. The order remains in `PLACED` status in PostgreSQL and is not automatically enqueued for kitchen preparation. A Transactional Outbox Pattern or background reconciliation worker should be implemented to scan and re-enqueue orphaned `PLACED` orders once Redis recovers.
2. **Refresh Token Plaintext Storage:** Refresh tokens are currently stored as raw plaintext JWT strings in the `RefreshToken` database table. Best practice is to store a cryptographic hash (e.g. SHA-256) of the token instead.
3. **Refresh Token Rotation:** Refresh token exchange issues a new access token but reuses the existing refresh token until expiry or manual logout. Implementing Refresh Token Rotation (issuing a new refresh token and invalidating the old one on each refresh) would provide reuse detection.
4. **WebSocket Token via Query Parameter:** While handshake `auth.token` is the primary transport, `socket.ts` falls back to `query.token`. Query parameters can inadvertently appear in server access logs and proxy history.
5. **Worker Concurrency is Process-Local:** The `concurrency: 3` setting is local to each worker instance. Running multiple worker containers multiplies total concurrent cooking jobs accordingly.
6. **At-Least-Once Delivery:** BullMQ operates under at-least-once delivery semantics. Handlers must maintain idempotent status transitions (e.g. conditional `updateMany` checking current status) to prevent double-processing.
7. **Offline WebSocket Events are Dropped:** Socket.io emits events over ephemeral pub/sub channels. If a student is offline or disconnected when their order transitions to `READY`, the event is dropped. Clients must query `GET /api/orders/my` on reconnect.
8. **Pagination Gaps:** `GET /api/orders` supports pagination (`page`, `limit`), but `GET /api/menu` and `GET /api/orders/my` return all matching records without pagination. For large mess deployments, cursor or offset pagination should be added.
9. **Idempotency Keys on Orders:** `POST /api/orders` does not accept a client-generated `Idempotency-Key` header. If a mobile client experiences a network timeout after the database commits but before the response arrives, a client retry could place a duplicate order.
10. **Cloud Database Latency:** Measured latency: median ~278 ms per request from my laptop in India to Neon us-east-2 (N=30). Network roundtrips to remote cloud databases affect interactive transaction hold times under high load compared to co-located or local database instances.
11. **CI Tests Run on Local Postgres, Not Neon:** The GitHub Actions workflow executes against local `postgres:16-alpine` service containers. While this validates Prisma schema, migrations, and transactional integrity, it does not validate Neon's proprietary WebSocket serverless proxy in CI.

---

## Author

**Parth Madhav Singh**  
3rd Year B.Tech, Computer Science and Engineering  
Indian Institute of Information Technology (IIIT) Bhagalpur  

- **GitHub**: [@ParthSingh870](https://github.com/ParthSingh870)  
- **LinkedIn**: [linkedin.com/in/parth-singh-008288330](https://www.linkedin.com/in/parth-singh-008288330)
