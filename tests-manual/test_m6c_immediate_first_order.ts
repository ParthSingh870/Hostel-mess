// tests-manual/test_m6c_immediate_first_order.ts
import 'dotenv/config';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signToken = (userId: string) =>
    jwt.sign({ userId, role: 'STUDENT' }, JWT_SECRET, { expiresIn: '15m' });

async function runM6c() {
    console.log(
        '--- MANUAL TEST M6c: IMMEDIATE ORDER AFTER STARTUP (FIRST EVENT NOT DROPPED) ---'
    );

    // 1. Setup Student & Menu Item
    let student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
    if (!student) {
        student = await prisma.user.create({
            data: {
                name: 'Student M6c',
                email: `student_m6c_${crypto.randomUUID().slice(0, 6)}@test.com`,
                password: 'hash',
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
                name: `M6c Meal ${crypto.randomUUID().slice(0, 4)}`,
                price: 90,
                stockCount: 20,
                isAvailable: true,
                category: 'LUNCH',
            },
        });
    }

    const studentToken = signToken(student.id);

    // 2. Connect socket
    const receivedEvents: any[] = [];
    const socket = ioClient(SERVER_URL, {
        auth: { token: studentToken },
        transports: ['websocket', 'polling'],
    });

    await new Promise<void>((r) => socket.on('connect', () => r()));
    console.log(`[Connect] Socket connected (id: ${socket.id}) in room "${student.id}"`);

    socket.on('order:status', (data) => {
        console.log(
            `  >>> Client Event Received: status = "${data.status}", orderId = "${data.orderId}"`
        );
        receivedEvents.push(data);
    });

    // 3. Immediately place order
    console.log('[Action] Immediately placing order...');
    const res = await fetch(`${SERVER_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: menuItem.id, quantity: 1 }],
        }),
    });

    const data = await res.json();
    const orderId = data?.data?.id;
    console.log(`[Action] Order placed -> ID: ${orderId}, Status: ${data?.data?.status}`);

    // Wait 2.5s to capture event
    await sleep(2500);

    console.log('\n--- VERIFICATION RESULTS ---');
    console.log(`Total events received: ${receivedEvents.length}`);
    const firstEventReceived = receivedEvents.some(
        (e) => e.orderId === orderId && e.status === 'PLACED'
    );

    console.log(
        `First event delivered successfully (NOT dropped): ${
            firstEventReceived ? 'PASS' : 'FAIL'
        }`
    );

    socket.close();
    await prisma.$disconnect();
    process.exit(0);
}

runM6c().catch((e) => {
    console.error('M6c error:', e);
    process.exit(1);
});
