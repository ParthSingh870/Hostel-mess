// tests-manual/test_m4_manual_patch.ts
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
const signToken = (userId: string, role = 'STUDENT') =>
    jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '15m' });

async function runM4() {
    console.log('--- MANUAL TEST M4: WORKER STOPPED -> MANUAL PATCH /status & PATCH /complete ---');

    // 1. Setup Student & Staff
    const student = await prisma.user.create({
        data: {
            name: 'Student M4',
            email: `student_m4_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    let staff = await prisma.user.findFirst({ where: { role: 'STAFF' } });
    if (!staff) {
        staff = await prisma.user.create({
            data: {
                name: 'Staff M4',
                email: `staff_m4_${crypto.randomUUID().slice(0, 6)}@test.com`,
                password: 'hash',
                role: 'STAFF',
            },
        });
    }

    let menuItem = await prisma.menuItem.findFirst({
        where: { isAvailable: true, stockCount: { gte: 5 } },
    });
    if (!menuItem) {
        menuItem = await prisma.menuItem.create({
            data: {
                name: `Meal M4 ${crypto.randomUUID().slice(0, 4)}`,
                price: 150,
                stockCount: 20,
                isAvailable: true,
                category: 'DINNER',
            },
        });
    }

    const staffToken = signToken(staff.id, 'STAFF');
    const studentToken = signToken(student.id, 'STUDENT');

    // 2. Connect Student socket
    const receivedEvents: any[] = [];
    const socket = ioClient(SERVER_URL, {
        auth: { token: studentToken },
        transports: ['websocket', 'polling'],
    });

    await new Promise<void>((r) => socket.on('connect', () => r()));
    console.log(`[Connect] Student socket connected (id: ${socket.id}) in room "${student.id}"`);

    socket.on('order:status', (data) => {
        console.log(`  >>> Client A RAW: Event received -> status = "${data.status}" (orderId: ${data.orderId})`);
        receivedEvents.push(data);
    });

    // 3. Create an order (PLACED)
    console.log('\n[Step 1] Placing order...');
    const order = await createOrder(student.id, {
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
    });
    console.log(`[Step 1] Order placed -> ID: ${order.id}`);
    await sleep(800);

    // 4. Staff sends manual PATCH /api/orders/:id/status -> PREPARING
    console.log('\n[Step 2] Staff sending HTTP PATCH /api/orders/:id/status -> "PREPARING"...');
    const resPrep = await fetch(`${SERVER_URL}/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ status: 'PREPARING' }),
    });
    const prepData = await resPrep.json();
    console.log(`[Step 2] HTTP Status: ${resPrep.status}`, prepData.message || prepData);
    await sleep(800);

    // 5. Staff sends manual PATCH /api/orders/:id/status -> READY
    console.log('\n[Step 3] Staff sending HTTP PATCH /api/orders/:id/status -> "READY"...');
    const resReady = await fetch(`${SERVER_URL}/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ status: 'READY' }),
    });
    const readyData = await resReady.json();
    console.log(`[Step 3] HTTP Status: ${resReady.status}`, readyData.message || readyData);
    await sleep(800);

    // 6. Staff sends manual PATCH /api/orders/:id/complete -> COMPLETED
    console.log('\n[Step 4] Staff sending HTTP PATCH /api/orders/:id/complete -> "COMPLETED"...');
    const resComp = await fetch(`${SERVER_URL}/api/orders/${order.id}/complete`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
    });
    const compData = await resComp.json();
    console.log(`[Step 4] HTTP Status: ${resComp.status}`, compData.message || compData);
    await sleep(1000);

    // 7. Results summary
    console.log('\n========================================');
    console.log('       CLIENT A RAW EVENT LOGS          ');
    console.log('========================================');
    receivedEvents.forEach((e, i) => {
        console.log(`Event ${i + 1}: status = ${e.status}, orderId = ${e.orderId}`);
    });
    console.log('========================================\n');

    socket.close();
    await prisma.$disconnect();
    process.exit(0);
}

runM4().catch((e) => {
    console.error('M4 error:', e);
    process.exit(1);
});
