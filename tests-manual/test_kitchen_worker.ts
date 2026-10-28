// tests-manual/test_kitchen_worker.ts
// Set prep simulation time to 3 seconds for this automated manual test
process.env.KITCHEN_PREP_SECONDS = '3';

import prisma from '../src/config/prisma.js';
import { createOrder, updateOrderStatus } from '../src/services/order.service.js';
import { kitchenQueue } from '../src/queues/kitchen.queue.js';
import { kitchenWorker } from '../src/workers/kitchen.worker.js';
import { redisConnection } from '../src/config/redis.js';
import { OrderStatus } from '@prisma/client';
import crypto from 'crypto';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testWorkerFlow() {
    console.log('--- SLICE S4 MANUAL TEST: Kitchen Worker Processing & Transitions ---');

    try {
        // 1. Setup Student & Menu Item
        let student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
        if (!student) {
            student = await prisma.user.create({
                data: {
                    name: 'Worker Test Student',
                    email: `worker-student-${crypto.randomUUID().slice(0, 6)}@test.com`,
                    password: 'Password123!',
                    role: 'STUDENT',
                },
            });
        }

        let menuItem = await prisma.menuItem.findFirst({
            where: { isAvailable: true, stockCount: { gte: 5 } },
        });
        if (!menuItem) {
            menuItem = await prisma.menuItem.create({
                data: {
                    name: `Worker Meal ${crypto.randomUUID().slice(0, 4)}`,
                    description: 'Test meal for worker',
                    price: 90,
                    stockCount: 15,
                    isAvailable: true,
                    category: 'DINNER',
                },
            });
        }

        // ==========================================
        // TEST CASE 1: Standard Lifecycle (PLACED -> PREPARING -> READY)
        // ==========================================
        console.log('\n--- TEST CASE 1: Standard Lifecycle (PLACED -> PREPARING -> READY) ---');
        const order1 = await createOrder(student.id, {
            items: [{ menuItemId: menuItem.id, quantity: 1 }],
        });
        console.log(`[Order Created]: ${order1.id} (Status in DB: ${order1.status})`);

        // Wait ~1s for worker to pick up job and update to PREPARING
        console.log('Waiting for worker to pick up job and update status to PREPARING...');
        await sleep(1500);

        const preparingOrder = await prisma.order.findUnique({ where: { id: order1.id } });
        console.log(`[Status Check after 1.5s]: ${preparingOrder?.status}`);
        if (preparingOrder?.status === OrderStatus.PREPARING) {
            console.log('✅ PASS: Order status successfully transitioned PLACED -> PREPARING');
        } else {
            console.log(`❌ FAIL: Expected PREPARING, found ${preparingOrder?.status}`);
        }

        // Wait another 3s for cooking simulation to complete and update to READY
        console.log('Waiting for cooking simulation to complete (3s)...');
        await sleep(3500);

        const readyOrder = await prisma.order.findUnique({ where: { id: order1.id } });
        console.log(`[Status Check after 5s total]: ${readyOrder?.status}`);
        if (readyOrder?.status === OrderStatus.READY) {
            console.log('✅ PASS: Order status successfully transitioned PREPARING -> READY');
        } else {
            console.log(`❌ FAIL: Expected READY, found ${readyOrder?.status}`);
        }

        // ==========================================
        // TEST CASE 2: Graceful Skip (Cancelled before worker processing)
        // ==========================================
        console.log('\n--- TEST CASE 2: Graceful Skip if Cancelled (updateMany count === 0) ---');
        // Temporarily pause worker to simulate delay in worker pickup
        await kitchenWorker.pause();

        const order2 = await createOrder(student.id, {
            items: [{ menuItemId: menuItem.id, quantity: 1 }],
        });
        console.log(`[Order 2 Created]: ${order2.id} (Status: ${order2.status})`);

        // Student/Admin cancels order while it is still waiting in queue
        await updateOrderStatus(order2.id, OrderStatus.CANCELLED);
        console.log(`[Order 2 Cancelled via Admin/Service]: Status is now CANCELLED in DB.`);

        // Resume worker so it picks up the job for Order 2
        console.log('Resuming worker to process the cancelled order job...');
        kitchenWorker.resume();
        await sleep(1500);

        const cancelledCheck = await prisma.order.findUnique({ where: { id: order2.id } });
        console.log(`[Order 2 Status Check]: ${cancelledCheck?.status}`);
        if (cancelledCheck?.status === OrderStatus.CANCELLED) {
            console.log('✅ PASS: Worker gracefully skipped the cancelled order without overwriting status or crashing!');
        } else {
            console.log(`❌ FAIL: Status was unexpectedly modified to ${cancelledCheck?.status}`);
        }

    } catch (err: any) {
        console.error('Test Error:', err);
    } finally {
        console.log('\nClosing worker and queue connections...');
        await kitchenWorker.close();
        await kitchenQueue.close();
        await redisConnection.quit();
        await prisma.$disconnect();
        console.log('--- SLICE S4 TEST FINISHED ---');
        process.exit(0);
    }
}

testWorkerFlow();

