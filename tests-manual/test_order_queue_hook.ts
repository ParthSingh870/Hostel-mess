// tests-manual/test_order_queue_hook.ts
import prisma from '../src/config/prisma.js';
import { createOrder } from '../src/services/order.service.js';
import { kitchenQueue, enqueueOrder } from '../src/queues/kitchen.queue.js';
import { redisConnection } from '../src/config/redis.js';
import crypto from 'crypto';

async function testOrderQueueHook() {
    console.log('--- SLICE S3 MANUAL TEST: Order Creation -> Kitchen Queue Hook ---');

    let studentUser: any = null;
    let menuItem: any = null;
    let createdOrderId: string | null = null;

    try {
        // 1. Find or create a test student
        studentUser = await prisma.user.findFirst({
            where: { role: 'STUDENT' },
        });

        if (!studentUser) {
            const randomEmail = `test-student-${crypto.randomUUID().slice(0, 8)}@example.com`;
            studentUser = await prisma.user.create({
                data: {
                    name: 'Test Student',
                    email: randomEmail,
                    password: 'Password123!',
                    role: 'STUDENT',
                },
            });
            console.log(`Created test student: ${studentUser.email}`);
        } else {
            console.log(`Using existing student: ${studentUser.email}`);
        }

        // 2. Find or create an available menu item with stock >= 2
        menuItem = await prisma.menuItem.findFirst({
            where: {
                isAvailable: true,
                stockCount: { gte: 2 },
            },
        });

        if (!menuItem) {
            menuItem = await prisma.menuItem.create({
                data: {
                    name: `Queue Test Item ${crypto.randomUUID().slice(0, 5)}`,
                    description: 'Automated test item for queue hook',
                    price: 80,
                    stockCount: 10,
                    isAvailable: true,
                    category: 'LUNCH',
                },
            });
            console.log(`Created test menu item: ${menuItem.name} (Stock: ${menuItem.stockCount})`);
        } else {
            console.log(`Using existing menu item: ${menuItem.name} (Stock: ${menuItem.stockCount})`);
        }

        // 3. Create Order using order.service.ts
        console.log('\n--- Step 1: Calling createOrder() ---');
        const order = await createOrder(studentUser.id, {
            items: [{ menuItemId: menuItem.id, quantity: 1 }],
        });

        createdOrderId = order.id;
        console.log(`✅ Order created in PostgreSQL -> Order ID: ${order.id}, Status: ${order.status}, Total: Rs ${order.totalPrice}`);

        // 4. Inspect Redis BullMQ Kitchen Queue
        console.log('\n--- Step 2: Verifying Job in BullMQ kitchen-queue ---');
        const job = await kitchenQueue.getJob(order.id);

        if (!job) {
            throw new Error(`❌ FAIL: Job with ID "${order.id}" was NOT found in kitchen-queue!`);
        }

        console.log(`✅ PASS: Job found in kitchen-queue!`);
        console.log(`   Job ID: ${job.id}`);
        console.log(`   Job Name: ${job.name}`);
        console.log(`   Job Data:`, job.data);
        console.log(`   Job Options (attempts: ${job.opts.attempts}, backoff: ${JSON.stringify(job.opts.backoff)})`);

        if (job.id === order.id && job.data.orderId === order.id) {
            console.log('✅ PASS: Job ID and Job Data match the created Order ID perfectly!');
        } else {
            console.log('❌ FAIL: Job ID / Data mismatch.');
        }

        // 5. Cleanup test job from queue
        await job.remove();
        console.log('\nCleaned up test job from Redis.');

    } catch (err: any) {
        console.error('\n❌ Test Error:', err.message);
    } finally {
        await kitchenQueue.close();
        await redisConnection.quit();
        await prisma.$disconnect();
        console.log('\n--- Test Finished ---');
        process.exit(0);
    }
}

testOrderQueueHook();
