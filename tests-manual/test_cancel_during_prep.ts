// tests-manual/test_cancel_during_prep.ts
import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import { createOrder, updateOrderStatus } from '../src/services/order.service.js';
import { kitchenQueue } from '../src/queues/kitchen.queue.js';
import { redisConnection } from '../src/config/redis.js';
import { OrderStatus } from '@prisma/client';
import crypto from 'crypto';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testCancelDuringPrep() {
    console.log('--- TEST T4b: Cancel Order During PREPARING & Stock Restoration Check ---');

    try {
        // 1. Get or create a student
        let student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
        if (!student) {
            student = await prisma.user.create({
                data: {
                    name: 'Prep Cancel Student',
                    email: `cancel-student-${crypto.randomUUID().slice(0, 6)}@test.com`,
                    password: 'Password123!',
                    role: 'STUDENT',
                },
            });
        }

        // 2. Create a dedicated menu item with known stock
        const initialStock = 20;
        const menuItem = await prisma.menuItem.create({
            data: {
                name: `Mid-Prep Cancel Thali ${crypto.randomUUID().slice(0, 4)}`,
                description: 'Testing cancellation mid-prep and stock recovery',
                price: 120,
                stockCount: initialStock,
                isAvailable: true,
                category: 'LUNCH',
            },
        });

        console.log(`\n1. Initial Menu Item Created: "${menuItem.name}"`);
        console.log(`   Initial Stock in DB: ${initialStock}`);

        // 3. Place order for quantity 2
        console.log('\n2. Placing Order (Quantity: 2)...');
        const order = await createOrder(student.id, {
            items: [{ menuItemId: menuItem.id, quantity: 2 }],
        });
        console.log(`   Order Created: ${order.id}`);

        // Verify stock decremented to initialStock - 2
        const stockAfterOrder = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
        console.log(`   Stock immediately after order: ${stockAfterOrder?.stockCount} (Expected: ${initialStock - 2})`);
        if (stockAfterOrder?.stockCount !== initialStock - 2) {
            throw new Error(`Stock decrement failed! Expected ${initialStock - 2}, got ${stockAfterOrder?.stockCount}`);
        }

        // 4. Wait for worker (running in Terminal 3) to pick up the job and transition to PREPARING
        console.log('\n3. Waiting for Worker in Terminal 3 to transition order to PREPARING...');
        let orderInDb = await prisma.order.findUnique({ where: { id: order.id } });
        let attempts = 0;
        while (orderInDb?.status !== OrderStatus.PREPARING && attempts < 15) {
            await sleep(1000);
            orderInDb = await prisma.order.findUnique({ where: { id: order.id } });
            attempts++;
            process.stdout.write(`   Polling status... (${attempts}s): ${orderInDb?.status}\r`);
        }
        console.log(`\n   Order Status reached: "${orderInDb?.status}"`);
        if (orderInDb?.status !== OrderStatus.PREPARING) {
            throw new Error(`Worker did not pick up order within 15s. Is "npm run dev:worker" running in Terminal 3?`);
        }
        console.log('   ✅ Worker is actively cooking this order!');

        // 5. Cancel the order WHILE it is PREPARING
        console.log('\n4. Cancelling order mid-prep via updateOrderStatus()...');
        const cancelledOrder = await updateOrderStatus(order.id, OrderStatus.CANCELLED);
        console.log(`   Order Status updated in DB to: "${cancelledOrder?.status}"`);

        // Check stock immediately after cancellation
        const stockAfterCancel = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
        console.log(`   Stock immediately after cancel: ${stockAfterCancel?.stockCount} (Expected: ${initialStock})`);
        if (stockAfterCancel?.stockCount === initialStock) {
            console.log('   ✅ PASS: Stock was restored by 2 immediately on cancellation!');
        } else {
            console.log(`   ❌ FAIL: Stock not restored properly. Expected ${initialStock}, got ${stockAfterCancel?.stockCount}`);
        }

        // 6. Wait for the worker to finish its cooking simulation (prep time, up to 22 seconds)
        console.log('\n5. Waiting 22s for Worker to finish cooking timer and attempt conditional update...');
        console.log('   (Watch Terminal 3 log for: "is no longer in PREPARING status... Skipping mark as READY")');
        await sleep(22000);

        // 7. Verify final integrity
        const finalOrder = await prisma.order.findUnique({ where: { id: order.id } });
        const finalStock = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });

        console.log('\n--- Final Verification ---');
        console.log(`   Final Order Status in DB: "${finalOrder?.status}" (Must be "CANCELLED", NOT "READY")`);
        console.log(`   Final Stock in DB: ${finalStock?.stockCount} (Must be ${initialStock}, restored exactly once)`);

        if (finalOrder?.status === OrderStatus.CANCELLED && finalStock?.stockCount === initialStock) {
            console.log('\n🎉 ✅ TEST T4b PASSED: Mid-prep cancellation respected! Worker skipped mark-as-READY and stock restored exactly once.');
        } else {
            console.log('\n❌ TEST T4b FAILED: Integrity violation!');
        }

    } catch (err: any) {
        console.error('Test Error:', err.message);
    } finally {
        await kitchenQueue.close();
        await redisConnection.quit();
        await prisma.$disconnect();
        console.log('\n--- TEST T4b FINISHED ---');
        process.exit(0);
    }
}

testCancelDuringPrep();

