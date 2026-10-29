// tests-manual/test_m5_failure_cancel.ts
import 'dotenv/config';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';
import { createOrder } from '../src/services/order.service.js';
import { handleJobFailure, kitchenWorker, workerConnection } from '../src/workers/kitchen.worker.js';
import { kitchenQueue } from '../src/queues/kitchen.queue.js';
import { redisConnection } from '../src/config/redis.js';
import { OrderStatus } from '@prisma/client';

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signToken = (userId: string) =>
    jwt.sign({ userId, role: 'STUDENT' }, JWT_SECRET, { expiresIn: '15m' });

async function runM5() {
    console.log('--- MANUAL TEST M5: WORKER FAILURE AUTO-CANCEL & STOCK RESTORATION ---');

    // 1. Setup Student & Menu Item with known initial stock
    const student = await prisma.user.create({
        data: {
            name: 'Student M5',
            email: `student_m5_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    const initialStock = 10;
    const menuItem = await prisma.menuItem.create({
        data: {
            name: `M5 Failure Meal ${crypto.randomUUID().slice(0, 4)}`,
            price: 120,
            stockCount: initialStock,
            isAvailable: true,
            category: 'DINNER',
        },
    });

    console.log(`[Setup] Student ID: ${student.id}`);
    console.log(`[Setup] Created Menu Item "${menuItem.name}" with Initial Stock = ${initialStock}`);

    // 2. Connect Student via Socket.io
    const events: any[] = [];
    const socket = ioClient(SERVER_URL, {
        auth: { token: signToken(student.id) },
        transports: ['websocket', 'polling'],
    });

    await new Promise<void>((r) => socket.on('connect', () => r()));
    console.log(`[Connect] Socket connected (id: ${socket.id}) in room "${student.id}"`);

    socket.on('order:status', (data) => {
        console.log(`  >>> Client A RAW: Event received -> status = "${data.status}" (orderId: ${data.orderId})`);
        events.push(data);
    });

    // 3. Place order for quantity: 2
    console.log('\n[Step 1] Placing order (Qty: 2)...');
    const order = await createOrder(student.id, {
        items: [{ menuItemId: menuItem.id, quantity: 2 }],
    });
    console.log(`[Step 1] Order placed -> ID: ${order.id}, Status: ${order.status}`);

    // Verify stock decremented to 8
    const stockAfterOrder = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
    console.log(`[Stock Check] Stock immediately after order = ${stockAfterOrder?.stockCount} (Expected: 8)`);
    await sleep(800);

    // 4. Simulate terminal worker failure (exhausted retries: attempt 3 of 3)
    console.log('\n[Step 2] Simulating terminal worker failure (attempts: 3/3 exhausted)...');
    const mockTerminalJob: any = {
        id: order.id,
        data: { orderId: order.id },
        attemptsMade: 3,
        opts: { attempts: 3 },
    };

    await handleJobFailure(mockTerminalJob, new Error('Simulated kitchen worker cooking failure'));
    await sleep(1500);

    // 5. Verify database status and restored stock
    const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
    const restoredItem = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });

    console.log('\n--- VERIFICATION: DATABASE STATE ---');
    console.log(`Order status in DB:   ${dbOrder?.status} (Expected: CANCELLED)`);
    console.log(`Stock in DB:          ${restoredItem?.stockCount} (Expected: 10, Restored Exactly Once)`);

    // 6. Test Idempotency: Duplicate failure event must NOT restore stock twice or crash
    console.log('\n[Step 3] Simulating duplicate failure event (double-cancel protection check)...');
    await handleJobFailure(mockTerminalJob, new Error('Duplicate failure event'));
    const stockAfterDupe = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
    console.log(`Stock after duplicate: ${stockAfterDupe?.stockCount} (Expected: 10, NOT double-restored)`);

    // 7. Results summary
    console.log('\n========================================');
    console.log('       CLIENT A RAW EVENT LOGS          ');
    console.log('========================================');
    events.forEach((e, i) => {
        console.log(`Event ${i + 1}: status = ${e.status}, orderId = ${e.orderId}`);
    });
    console.log('========================================');

    const cancelledEvents = events.filter((e) => e.status === 'CANCELLED');
    console.log(`CANCELLED events received by Client A: ${cancelledEvents.length} (Expected: Exactly 1)`);
    console.log(`Stock properly restored: ${restoredItem?.stockCount === initialStock ? 'PASS' : 'FAIL'}`);

    socket.close();
    await kitchenWorker.close();
    await workerConnection.quit();
    await kitchenQueue.close();
    await redisConnection.quit();
    await prisma.$disconnect();
    process.exit(0);
}

runM5().catch((e) => {
    console.error('M5 error:', e);
    process.exit(1);
});
