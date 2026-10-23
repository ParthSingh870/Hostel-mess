# Manual & Integration Test Scripts

> [!WARNING]
> **DATABASE WRITE WARNING**
> These scripts interact with, write to, and modify data inside the database configured in `.env`.
> **ONLY run these scripts against a local, development, or testing database.**
> **NEVER run these scripts against a production database.**

---

## Overview

This directory contains standalone testing scripts used to manually verify business logic, race conditions, concurrency locks, state transitions, and RBAC rules without relying on external testing frameworks.

Each script dynamically resolves `.env` from the project root (`../.env`) and uses dynamically generated credentials per run so secrets are never hardcoded or printed to the console.

---

## Scripts

### 1. `test-all.ts`
- **What it does:** Complete 24-step end-to-end integration test covering Health check, Registration validations, Login authentication, RBAC authorization, Menu CRUD & soft-delete, Order placement, State machine transitions, Stock auto-restoration, and Deactivated item restrictions.
- **Database Impact:** Creates test users, test menu items, and test orders.
- **How to run:**
  ```bash
  # From project root:
  npm run test:manual:suite
  # OR using tsx directly:
  npx tsx tests-manual/test-all.ts
  ```

---

### 2. `test_dupe.cjs`
- **What it does:** Tests concurrent registration collision handling. Fires two identical registration HTTP requests at the exact same millisecond to verify that the database unique constraint (`P2002`) collision is gracefully caught and returns `409 Conflict` instead of crashing.
- **Database Impact:** Inserts 1 new user row into `User` table.
- **How to run:**
  ```bash
  # From project root:
  npm run test:manual:dupe
  # OR from tests-manual/:
  node test_dupe.cjs
  ```

---

### 3. `test_concurrent_order.cjs`
- **What it does:** Tests concurrent inventory deduction race conditions. Simulates two students simultaneously placing an order for a menu item with `stockCount = 1`. Verifies that exactly one order succeeds (`201`), one order fails (`400 Insufficient stock`), and the final stock is exactly `0` (never negative).
- **Database Impact:** Creates a test student, creates an order and order item, and decrements menu item stock.
- **Prerequisite:** An item with ID `22222222-2222-2222-2222-222222222222` and `stockCount = 1` in the database (or set via `TEST_ITEM_ID`).
- **How to run:**
  ```bash
  # From project root:
  npm run test:manual:concurrency
  # OR from tests-manual/:
  node test_concurrent_order.cjs
  ```

---

### 4. `test_double_cancel.cjs`
- **What it does:** Tests double cancellation race condition on a single order. Simultaneously sends two `CANCELLED` status update requests to verify that conditional atomic updates (`updateMany` count === 1) ensure stock is restored **only once**.
- **Database Impact:** Creates a test student and an order, modifies order status, and restores item stock (+2).
- **Prerequisite:** A menu item with ID `33333333-3333-3333-3333-333333333333` with known stock in the database (or set via `TEST_PANEER_ID`), and an active user with `STAFF` role (`staff_rule@test.com`).
- **How to run:**
  ```bash
  # From project root:
  npm run test:manual:double-cancel
  # OR from tests-manual/:
  node test_double_cancel.cjs
  ```
