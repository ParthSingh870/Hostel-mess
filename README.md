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

- **Runtime & Language:** Node.js (v22 Alpine), TypeScript (NodeNext ESM)
- **Web Framework:** Express.js 5
- **Database & ORM:** PostgreSQL 16 (Local Docker) / Neon Serverless PostgreSQL (Cloud), Prisma ORM 5
- **Driver Layer:** Dual-Mode (Standard TCP for local Postgres container; `@prisma/adapter-neon` over WebSocket for Neon Cloud)
- **Caching & Rate Limiting:** Redis 7 Alpine, `ioredis` with custom atomic Lua script
- **Background Queue:** BullMQ 6 (Redis Streams & Hash sets)
- **Real-Time Communication:** Socket.io 4 with `@socket.io/redis-adapter`
- **Validation:** Zod
- **Containerization:** Multi-Stage Dockerfile (Alpine), Docker Compose
- **CI Pipeline:** GitHub Actions with native Service Containers (`postgres:16-alpine`, `redis:7-alpine`) (CI duration: ~31s on GitHub Actions Ubuntu runner)
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
   git clone https://github.com/ParthSingh870/Hostel-mess.git
   cd Hostel-mess
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
   - Docker builds the multi-stage Alpine image (`hostel-mess-backend:latest`, ~107MB compressed content, ~417MB on disk).
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

*Measurement Conditions:* Sample size N=30 requests executed via `tests-manual/bench-menu.ts` from local client (`http://127.0.0.1:3000`), querying remote Neon PostgreSQL (`neondb` in AWS region `us-east-2`) over WAN, with Redis running locally (`localhost:6379`). "Uncached" (Cache MISS) means Redis key `menu:all` is explicitly deleted before each request to force a direct PostgreSQL query.

> [!NOTE]
> *Latency Context:* Development connects over WAN to remote Neon PostgreSQL in AWS `us-east-2` (~270ms–290ms per-request latency). Serving the catalog directly from local Redis RAM yields measured response latencies of 2.07ms (min) and 3.94ms (median), achieving **71.1x faster** response times on median (and up to **129.9x** on min). When Redis is stopped, fail-open fallback latency remains stable (~266ms–279ms) without hanging or failing requests.

---

## Known Limitations

This system is an educational, reliable learning project with known design constraints:

1. **Unqueued Orders on Redis Outage:** If Redis goes down while an order is placed, the database transaction succeeds and marks the order `PLACED`, but the BullMQ queue enqueue fails. These orders are never automatically re-queued when Redis recovers and require manual staff intervention.
2. **Worker Concurrency is Process-Local:** The `concurrency: 3` setting is local to each worker instance. Running multiple worker containers multiplies total concurrent cooking jobs accordingly.
3. **At-Least-Once Delivery:** BullMQ operates under at-least-once delivery semantics. Handlers must maintain idempotent status transitions (e.g. conditional `updateMany` checking current status) to prevent double-processing.
4. **Offline WebSocket Events are Dropped:** Socket.io emits events over ephemeral pub/sub channels. If a student is offline or disconnected when their order transitions to `READY`, the event is dropped. Clients must query `GET /api/orders/my` on reconnect.
5. **Stock Failure Returns 400 Instead of 409:** When menu stock is insufficient, the API returns HTTP `400 Bad Request` rather than HTTP `409 Conflict` to preserve strict compatibility with the existing test suite contract.
6. **Order Endpoint Error Handling Under Concurrency:** Under concurrent bursts (e.g. the concurrent last-stock race test, test_concurrent_order), two distinct error outcomes can occur depending on code path: (a) Prisma interactive transaction timeout or pool queue exhaustion (`ORDER_TX_MAX_WAIT_MS=5000`, `ORDER_TX_TIMEOUT_MS=10000`) throws Prisma `P2028` or `P2024`, which `error.middleware.ts` maps to HTTP `503 Service Unavailable` ("Server is busy, please retry"); (b) Business stock depletion (e.g. concurrent race on menu stock) throws `ItemUnavailableError` in `order.service.ts`, which maps to HTTP `400 Bad Request` ("Insufficient stock for..."). HTTP 400 is never caused by transaction timeouts.
7. **Remote Database Latency Slows Automated Tests:** Vitest suites run serially with 30s timeouts because remote WAN roundtrips to Neon PostgreSQL introduce significant per-query latency.
8. **CI Tests Run on Local Postgres, Not Neon:** The GitHub Actions workflow executes against local `postgres:16-alpine` service containers. While this validates Prisma schema, migrations, and transactional integrity, it does not validate Neon's proprietary WebSocket serverless proxy in CI.
