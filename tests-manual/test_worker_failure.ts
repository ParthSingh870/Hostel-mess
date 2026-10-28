// tests-manual/test_worker_failure.ts
import prisma from '../src/config/prisma.js';
import { createOrder } from '../src/services/order.service.js';
import { handleJobFailure, kitchenWorker, workerConnection } from '../src/workers/kitchen.worker.js';
import { kitchenQueue } from '../src/queues/kitchen.queue.js';
import { redisConnection } from '../src/config/redis.js';
import { OrderStatus } from '@prisma/client';
import crypto from 'crypto';

async function testFailureAndStockRestoration() {
    console.log('--- SLICE S5 MANUAL TEST: Failure Handling, Auto-Cancel & Stock Restoration ---');

    try {
        // 1. Setup Student & Dedicated Menu Item with known stock
        let student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
        if (!student) {
            student = await prisma.user.create({
                data: {
                    name: 'Failure Test Student',
                    email: `fail-student-${crypto.randomUUID().slice(0, 6)}@test.com`,
                    password: 'Password123!',
                    role: 'STUDENT',
                },
            });
        }

        const initialStock = 10;
        const menuItem = await prisma.menuItem.create({
            data: {
                name: `Failure Test Thali ${crypto.randomUUID().slice(0, 4)}`,
                description: 'Testing stock restoration on exhausted retries',
                price: 150,
                stockCount: initialStock,
                isAvailable: true,
                category: 'DINNER',
            },
        });
        console.log(`[Setup]: Created Menu Item "${menuItem.name}" with Initial Stock = ${initialStock}`);

        // 2. Place order for quantity 2
        console.log('\n--- Step 1: Placing Order (Quantity: 2) ---');
        const order = await createOrder(student.id, {
            items: [{ menuItemId: menuItem.id, quantity: 2 }],
        });
        console.log(`Order created: ${order.id} | Status: ${order.status}`);

        // Verify stock decremented by 2 in DB
        const postOrderStock = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
        console.log(`[Stock Check]: Post-order stock = ${postOrderStock?.stockCount} (Expected: 8)`);
        if (postOrderStock?.stockCount !== 8) {
            throw new Error(`Stock decrement failed! Expected 8, got ${postOrderStock?.stockCount}`);
        }

        // 3. Simulate Worker Retry 1 & 2 (Retrying with backoff, NOT cancelled yet)
        console.log('\n--- Step 2: Simulating Transient Retries (Attempts 1 and 2 of 3) ---');
        const mockJobAttempt1: any = {
            id: order.id,
            data: { orderId: order.id },
            attemptsMade: 1,
            opts: { attempts: 3 },
        };
        await handleJobFailure(mockJobAttempt1, new Error('Transient network glitch in kitchen'));

        const checkRetryStatus = await prisma.order.findUnique({ where: { id: order.id } });
        console.log(`[Status Check after Attempt 1]: ${checkRetryStatus?.status} (Expected: PLACED)`);
        if (checkRetryStatus?.status !== OrderStatus.PLACED) {
            throw new Error('Order should not be cancelled before exhausting all attempts!');
        }

        // 4. Simulate Exhausted Retries (Attempt 3 of 3)
        console.log('\n--- Step 3: Simulating Exhausted Retries (Attempt 3 of 3) ---');
        const mockJobAttempt3: any = {
            id: order.id,
            data: { orderId: order.id },
            attemptsMade: 3,
            opts: { attempts: 3 },
        };
        await handleJobFailure(mockJobAttempt3, new Error('Kitchen burner permanently exploded'));

        // 5. Verify Order is CANCELLED and Stock is Restored
        console.log('\n--- Step 4: Verifying Auto-Cancellation & Stock Restoration ---');
        const cancelledOrder = await prisma.order.findUnique({ where: { id: order.id } });
        console.log(`[Order Status]: ${cancelledOrder?.status} (Expected: CANCELLED)`);

        const restoredItem = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
        console.log(`[Stock Restored]: ${restoredItem?.stockCount} (Expected: 10)`);

        if (cancelledOrder?.status === OrderStatus.CANCELLED && restoredItem?.stockCount === initialStock) {
            console.log('✅ PASS: Order auto-cancelled and stock restored to original count (10)!');
        } else {
            console.log('❌ FAIL: Order status or stock restoration mismatch.');
        }

        // 6. Test Idempotency / Double-Cancel Protection
        console.log('\n--- Step 5: Testing Double-Cancel Protection ---');
        // If another failure event fires for the same order, stock must NOT increment again
        await handleJobFailure(mockJobAttempt3, new Error('Duplicate failure event'));
        const stockAfterDuplicate = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
        console.log(`[Stock Check after duplicate event]: ${stockAfterDuplicate?.stockCount} (Expected: 10)`);
        if (stockAfterDuplicate?.stockCount === initialStock) {
            console.log('✅ PASS: Stock was NOT double-restored! Idempotency intact.');
        } else {
            console.log('❌ FAIL: Stock was incremented multiple times!');
        }

    } catch (err: any) {
        console.error('Test Error:', err.message);
    } finally {
        console.log('\nClosing worker and queue connections...');
        await kitchenWorker.close();
        await workerConnection.quit();
        await kitchenQueue.close();
        await redisConnection.quit();
        await prisma.$disconnect();
        console.log('--- SLICE S5 TEST FINISHED ---');
        process.exit(0);
    }
}

testFailureAndStockRestoration();

