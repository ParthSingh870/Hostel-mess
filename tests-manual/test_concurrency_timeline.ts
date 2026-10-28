// tests-manual/test_concurrency_timeline.ts
// Set prep simulation time to 2 seconds for this fast timeline verification
process.env.KITCHEN_PREP_SECONDS = '2';

import prisma from '../src/config/prisma.js';
import { createOrder } from '../src/services/order.service.js';
import { kitchenQueue } from '../src/queues/kitchen.queue.js';
import { kitchenWorker, workerConnection } from '../src/workers/kitchen.worker.js';
import { redisConnection } from '../src/config/redis.js';
import { OrderStatus } from '@prisma/client';
import crypto from 'crypto';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testConcurrencyTimeline() {
    console.log('========================================================================');
    console.log('--- SLICE S7: MULTI-ORDER CONCURRENCY TIMELINE VERIFICATION (MAX 3) ---');
    console.log('========================================================================\n');

    try {
        // 1. Setup Student & Menu Item with ample stock (at least 20)
        let student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
        if (!student) {
            student = await prisma.user.create({
                data: {
                    name: 'Timeline Test Student',
                    email: `timeline-${crypto.randomUUID().slice(0, 6)}@test.com`,
                    password: 'Password123!',
                    role: 'STUDENT',
                },
            });
        }

        const menuItem = await prisma.menuItem.create({
            data: {
                name: `Thali Concurrency Batch ${crypto.randomUUID().slice(0, 4)}`,
                description: 'Verifying max 3 concurrent preparations',
                price: 100,
                stockCount: 50,
                isAvailable: true,
                category: 'LUNCH',
            },
        });
        console.log(`Created test item "${menuItem.name}" with stock = 50`);

        // 2. Temporarily pause worker so all 6 orders land in the queue simultaneously
        await kitchenWorker.pause();

        console.log('\nPlacing 6 orders rapidly in parallel...');
        const orderPromises = Array.from({ length: 6 }).map((_, i) =>
            createOrder(student.id, {
                items: [{ menuItemId: menuItem.id, quantity: 1 }],
            })
        );
        const createdOrders = await Promise.all(orderPromises);
        const orderIds = createdOrders.map((o) => o.id);

        console.log(`Successfully created 6 orders (all initial status: PLACED):`);
        orderIds.forEach((id, idx) => console.log(`   Order #${idx + 1}: ${id}`));

        // 3. Resume worker to process orders with concurrency: 3
        console.log('\nResuming worker with concurrency = 3. Polling database every 400ms...\n');
        kitchenWorker.resume();

        let maxConcurrentPreparing = 0;
        let pollCount = 0;
        const maxPolls = 20; // Poll for up to ~8 seconds

        console.log('Time (s) | Order #1 | Order #2 | Order #3 | Order #4 | Order #5 | Order #6 | Currently PREPARING');
        console.log('---------+----------+----------+----------+----------+----------+----------+--------------------');

        while (pollCount < maxPolls) {
            await sleep(400);
            pollCount++;

            const currentOrders = await prisma.order.findMany({
                where: { id: { in: orderIds } },
            });

            // Map order statuses in the original created order
            const statusMap = new Map(currentOrders.map((o) => [o.id, o.status]));
            const statuses = orderIds.map((id) => statusMap.get(id) || 'UNKNOWN');

            const preparingCount = statuses.filter((s) => s === OrderStatus.PREPARING).length;
            if (preparingCount > maxConcurrentPreparing) {
                maxConcurrentPreparing = preparingCount;
            }

            const timeStr = ((pollCount * 400) / 1000).toFixed(1).padStart(6, ' ') + 's';
            const row = statuses.map((s) => s.padEnd(8, ' ').slice(0, 8)).join(' | ');
            console.log(`${timeStr}  | ${row} | ${preparingCount} preparing`);

            const allReady = statuses.every((s) => s === OrderStatus.READY);
            if (allReady) {
                console.log('\nAll 6 orders have reached READY status!');
                break;
            }
        }

        console.log('\n------------------------------------------------------------------------');
        console.log(`Peak Concurrent Preparing Orders: ${maxConcurrentPreparing} / 3`);
        console.log('------------------------------------------------------------------------');

        if (maxConcurrentPreparing <= 3 && maxConcurrentPreparing > 0) {
            console.log('✅ PASS: Concurrency limit strictly enforced! At no point did > 3 orders cook simultaneously.');
        } else {
            console.log(`❌ FAIL: Concurrency limit violated! Found ${maxConcurrentPreparing} concurrent orders.`);
        }

    } catch (err: any) {
        console.error('Timeline Test Error:', err.message);
    } finally {
        console.log('\nCleaning up worker and queue connections...');
        await kitchenWorker.close();
        await workerConnection.quit();
        await kitchenQueue.close();
        await redisConnection.quit();
        await prisma.$disconnect();
        console.log('--- SLICE S7 TIMELINE TEST FINISHED ---');
        process.exit(0);
    }
}

testConcurrencyTimeline();

