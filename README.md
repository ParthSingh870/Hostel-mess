# Hostel Mess Backend

> A reliable learning project with known limitations, demonstrating robust containerized backend patterns for hostel mess operations, concurrent order placement, asynchronous job queues, and real-time order tracking.

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
flowchart TD
    subgraph Clients["Client Layer"]
        Student["Student (Web / Mobile)"]
        Staff["Staff / Admin"]
    end

    subgraph Gateway["Docker Compose Network"]
        subgraph AppService["app: Express & Socket.io (Port 3000)"]
            AuthMod["Auth & RBAC Middleware"]
            RateLimiter["Lua Atomic Rate Limiter"]
            MenuController["Menu Controller (Cache-Aside)"]
            OrderController["Order Controller (Atomic Tx)"]
            SocketServer["Socket.io Server (Rooms: user:id)"]
        end

        subgraph WorkerService["worker: BullMQ Kitchen Worker"]
            KitchenWorker["Worker Process (Concurrency: 3)"]
        end

        subgraph Infra["Infrastructure Services"]
            RedisSvc[("redis: Redis 7 Alpine\n(Cache, BullMQ Queue, Socket Pub/Sub)")]
            PostgresSvc[("postgres: PostgreSQL 16 Alpine\n(Relational Store & Check Constraints)")]
            MigrateSvc["migrate: One-Shot Service\n(npx prisma migrate deploy)"]
        end
    end

    Student -->|HTTP REST / WebSocket| AppService
    Staff -->|HTTP REST / WebSocket| AppService

    AppService -->|Cache Check & Rate Limit| RedisSvc
    AppService -->|Enqueue Cooking Job| RedisSvc
    AppService -->|Read / Write Tx| PostgresSvc
    AppService -->|Redis Adapter Pub/Sub| RedisSvc

    WorkerService -->|Pop Job BLMOVE| RedisSvc
    WorkerService -->|Atomic State Update| PostgresSvc
    WorkerService -->|Emit Status (PREPARING/READY)| RedisSvc

    MigrateSvc -->|Deploy Migrations First| PostgresSvc
```

---

## Tech Stack

- **Runtime & Language:** Node.js (v22 Alpine), TypeScript (NodeNext ESM)
- **Web Framework:** Express.js 5
- **Database & ORM:** PostgreSQL 16 (Local Docker) / Neon Serverless PostgreSQL (Cloud), Prisma ORM 5
- **Driver Layer:** Dual-Mode (Standard TCP for local Postgres container; `@prisma/adapter-neon` over WebSocket for Neon Cloud)
- **Caching & Rate Limiting:** Redis 7 Alpine, `ioredis` with custom atomic Lua script
- **Background Queue:** BullMQ 6 (Redis Streams & Hash sets)
- **Real-Time Communication:** Socket.io 4 with `@socket.io/redis-adapter`
- **Validation:** Zod
- **Containerization:** Multi-Stage Dockerfile (Alpine), Docker Compose
- **CI Pipeline:** GitHub Actions with native Service Containers (`postgres:16-alpine`, `redis:7-alpine`)
- **Automated Testing:** Vitest 5, Supertest 7

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
   git clone https://github.com/your-username/hostel-mess-backend.git
   cd hostel-mess-backend
   ```

2. **Copy the environment template:**
   ```bash
   # Windows Command Prompt:
   copy .env.example .env

   # Linux / macOS:
   cp .env.example .env
   ```

3. **Start the entire stack with ONE command:**
   ```bash
   docker compose up --build -d
   ```
   *What happens behind the scenes:*
   - Docker builds the lean Alpine image (`hostel-mess-backend:latest`).
   - `postgres` and `redis` start and run automated healthchecks.
   - The one-shot `migrate` service runs `prisma migrate deploy` to prepare the database schema.
   - `app` (Express API) and `worker` (BullMQ Kitchen Worker) start up in dependency order.

4. **Verify Health:**
   ```bash
   curl http://localhost:3000/health
   # Response: {"status":"ok","message":"Server and Neon DB are healthy"}
   ```

5. **Stop the stack:**
   ```bash
   docker compose down
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

## Design Decisions

### 1. Why Transactions for Orders?
Order placement touches multiple database rows: decrementing inventory stock on `MenuItem` and creating `Order` and `OrderItem` records. Wrapping these in a strict Prisma `$transaction` with conditional `updateMany` guarantees:
- **No Race Conditions:** Stock is decremented atomically with `where: { id, stockCount: { gte: quantity } }`.
- **Zero Negative Inventory:** Database-level check constraint `CHECK ("stockCount" >= 0)` guarantees stock never drops below zero even under massive concurrency.
- If any menu item lacks sufficient stock, the entire transaction rolls back completely.

### 2. Why a Queue with Concurrency Limits?
A real kitchen cannot prepare 500 meals simultaneously. Pushing incoming orders into a BullMQ queue with `concurrency: 3` enforces controlled kitchen throughput:
- Prevents database connection exhaustion during peak order spikes.
- Decouples student order acceptance (instant HTTP 201 response) from meal preparation.
- Provides built-in crash recovery (stalled jobs are recovered and resumed if a worker process crashes mid-cooking).

### 3. Why Redis Caching and Rate Limiting?
- **Menu Cache-Aside (`menu:all`):** Mess menus change infrequently (e.g. daily or weekly), but are viewed thousands of times by hungry students. Caching the serialized catalog in Redis RAM reduces response latency from ~280ms down to ~3ms (over 70x faster).
- **Atomic Lua Rate Limiter:** Protects the order creation endpoint from spam or denial-of-service. An atomic Lua script checks and increments user order counts in a single Redis evaluation step, eliminating read-modify-write race conditions.

### 4. Why Fail-Open?
If Redis crashes or runs out of memory, students must not starve. The caching and rate-limiting modules use an isolated Redis client configured with `enableOfflineQueue: false` and strict 1-second timeouts:
- If Redis is down, `getJson(MENU_CACHE_KEY)` logs a warning and queries PostgreSQL directly.
- The order rate limiter logs a warning and lets orders through to the database transaction.
- The system gracefully degrades performance while maintaining 100% operational availability.

### 5. Why a Separate Worker Process?
The BullMQ kitchen worker runs as an independent OS process (and independent Docker container) rather than inside the Express server:
- CPU-intensive tasks, worker restart cycles, or simulated cooking delays (`setTimeout`) cannot block the single-threaded Node.js event loop handling student HTTP and Socket.io traffic.
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

> [!NOTE]
> *Latency Context:* Development connects over WAN to remote Neon PostgreSQL in AWS `us-east-2` (~270ms–290ms RTT per database query). Serving the catalog directly from local Redis RAM reduces response latency to ~3ms–5ms (**50.5x to 71.1x faster** on median, and up to **129.9x** on min). When Redis is stopped, fail-open fallback latency remains stable (~266ms–279ms) without hanging or failing requests.

---

## Known Limitations

This system is an educational, reliable learning project with known design constraints:

1. **Unqueued Orders on Redis Outage:** If Redis goes down while an order is placed, the database transaction succeeds and marks the order `PLACED`, but the BullMQ queue enqueue fails. These orders are never automatically re-queued when Redis recovers and require manual staff intervention.
2. **Worker Concurrency is Process-Local:** The `concurrency: 3` setting is local to each worker instance. Running multiple worker containers multiplies total concurrent cooking jobs accordingly.
3. **At-Least-Once Delivery:** BullMQ operates under at-least-once delivery semantics. Handlers must maintain idempotent status transitions (e.g. conditional `updateMany` checking current status) to prevent double-processing.
4. **Offline WebSocket Events are Dropped:** Socket.io emits events over ephemeral pub/sub channels. If a student is offline or disconnected when their order transitions to `READY`, the event is dropped. Clients must query `GET /api/orders/my` on reconnect.
5. **Stock Failure Returns 400 Instead of 409:** When menu stock is insufficient, the API returns HTTP `400 Bad Request` rather than HTTP `409 Conflict` to preserve strict compatibility with the existing test suite contract.
6. **Unconfirmed T6 Concurrency 400 Cause:** Under extreme concurrent order stress tests (test T6), occasional 400 errors occur whose root cause remains unconfirmed under high connection pressure.
7. **Remote Database Latency Slows Automated Tests:** Vitest suites run serially with 30s timeouts because remote WAN roundtrips to Neon PostgreSQL introduce significant per-query latency.
8. **CI Tests Run on Local Postgres, Not Neon:** The GitHub Actions workflow executes against local `postgres:16-alpine` service containers. While this validates Prisma schema, migrations, and transactional integrity, it does not validate Neon's proprietary WebSocket serverless proxy in CI.
