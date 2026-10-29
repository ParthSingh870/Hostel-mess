// tests-manual/test_m5_real_failure.ts
import 'dotenv/config';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';
import { createOrder } from '../src/services/order.service.js';

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signToken = (userId: string) =>
    jwt.sign({ userId, role: 'STUDENT' }, JWT_SECRET, { expiresIn: '15m' });

async function runRealWorkerFailureTest() {
    console.log('================================================================');
    console.log('   MANUAL TEST C: REAL WORKER FAILURE & ATOMIC RESTORATION      ');
    console.log('================================================================\n');

    // 1. Setup Student & Dedicated Menu Item with known initial stock
    const student = await prisma.user.create({
        data: {
            name: 'Student Test C',
            email: `student_c_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    const initialStock = 10;
    const menuItem = await prisma.menuItem.create({
        data: {
            name: `Meal Test C ${crypto.randomUUID().slice(0, 4)}`,
            price: 150,
            stockCount: initialStock,
            isAvailable: true,
            category: 'DINNER',
        },
    });

    console.log(`[Setup] Student ID: ${student.id}`);
    console.log(`[Setup] Menu Item: "${menuItem.name}"`);
    console.log(`[Stock Before Order]: ${initialStock}\n`);

    // 2. Connect Student Socket
    const events: any[] = [];
    const socket = ioClient(SERVER_URL, {
        auth: { token: signToken(student.id) },
        transports: ['websocket', 'polling'],
    });

    await new Promise<void>((r) => socket.on('connect', () => r()));
    console.log(`[Connect] Socket connected (id: ${socket.id}) in room "${student.id}"\n`);

    socket.on('order:status', (data) => {
        console.log(`  >>> Client Event Received: status = "${data.status}" (orderId: ${data.orderId})`);
        events.push(data);
    });

    // 3. Place Order for Quantity = 2
    console.log('[Action] Placing order for Quantity: 2...');
    const order = await createOrder(student.id, {
        items: [{ menuItemId: menuItem.id, quantity: 2 }],
    });
    console.log(`[Action] Order placed -> ID: ${order.id}, Status: ${order.status}`);

    const stockAfterOrder = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });
    console.log(`[Stock Immediately After Order]: ${stockAfterOrder?.stockCount} (Expected: 8)\n`);

    // 4. Wait for external Kitchen Worker (with SIMULATE_WORKER_FAILURE=true) to retry and fail
    console.log('[Wait] Watching worker terminal: BullMQ will retry ~3 attempts with backoff (1s, 2s, 4s)...');
    console.log('[Wait] Waiting up to 25s for terminal failure & auto-cancel event...');

    const start = Date.now();
    while (!events.some((e) => e.status === 'CANCELLED') && Date.now() - start < 25000) {
        await sleep(500);
    }

    // 5. Verification: Database status and Restored Stock
    const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
    const restoredItem = await prisma.menuItem.findUnique({ where: { id: menuItem.id } });

    console.log('\n========================================');
    console.log('         TEST C VERIFICATION            ');
    console.log('========================================');
    console.log(`Final Order Status in DB:   ${dbOrder?.status} (Expected: CANCELLED)`);
    console.log(`Stock in DB Before Order:   ${initialStock}`);
    console.log(`Stock in DB After Order:    ${stockAfterOrder?.stockCount} (Deducted: 2)`);
    console.log(`Stock in DB After Cancel:   ${restoredItem?.stockCount} (Expected: 10, Restored Exactly Once)`);

    console.log('\n--- CLIENT EVENT STREAM ---');
    events.forEach((e, i) => {
        console.log(`Event ${i + 1}: status = "${e.status}", orderId = ${e.orderId}`);
    });

    const cancelledEvents = events.filter((e) => e.status === 'CANCELLED');
    console.log(`\nTotal CANCELLED events received: ${cancelledEvents.length} (Expected: Exactly 1)`);
    console.log(`Stock Properly Restored:        ${restoredItem?.stockCount === initialStock ? 'PASS' : 'FAIL'}`);
    console.log(`Order Auto-Cancelled in DB:     ${dbOrder?.status === 'CANCELLED' ? 'PASS' : 'FAIL'}`);
    console.log('========================================\n');

    socket.close();
    await prisma.$disconnect();
    process.exit(0);
}

runRealWorkerFailureTest().catch((e) => {
    console.error('Test C error:', e);
    process.exit(1);
});
