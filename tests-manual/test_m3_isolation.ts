// tests-manual/test_m3_isolation.ts
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

async function runM3() {
    console.log(
        '--- MANUAL TEST M3: TWO STUDENTS CONNECTED (A gets PLACED->PREPARING->READY, B gets NOTHING) ---'
    );

    // 1. Setup Student A and Student B
    const userA = await prisma.user.create({
        data: {
            name: 'Student A',
            email: `student_a_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    const userB = await prisma.user.create({
        data: {
            name: 'Student B',
            email: `student_b_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    let menuItem = await prisma.menuItem.findFirst({
        where: { isAvailable: true, stockCount: { gte: 5 } },
    });
    if (!menuItem) {
        menuItem = await prisma.menuItem.create({
            data: {
                name: `M3 Meal ${crypto.randomUUID().slice(0, 4)}`,
                price: 100,
                stockCount: 20,
                isAvailable: true,
                category: 'LUNCH',
            },
        });
    }

    console.log(`[Setup] Student A ID: ${userA.id}`);
    console.log(`[Setup] Student B ID: ${userB.id}`);

    // 2. Connect both students simultaneously
    const logsA: string[] = [];
    const logsB: string[] = [];

    const socketA = ioClient(SERVER_URL, {
        auth: { token: signToken(userA.id) },
        transports: ['websocket', 'polling'],
    });

    const socketB = ioClient(SERVER_URL, {
        auth: { token: signToken(userB.id) },
        transports: ['websocket', 'polling'],
    });

    await Promise.all([
        new Promise<void>((r) => socketA.on('connect', () => r())),
        new Promise<void>((r) => socketB.on('connect', () => r())),
    ]);

    console.log(`[Connect] Socket A connected (id: ${socketA.id}) in room "${userA.id}"`);
    console.log(`[Connect] Socket B connected (id: ${socketB.id}) in room "${userB.id}"`);

    socketA.on('order:status', (data) => {
        const entry = `[${new Date().toISOString()}] Event received: orderId=${data.orderId}, status=${data.status}`;
        logsA.push(entry);
        console.log(`  >>> Client A RAW: ${entry}`);
    });

    socketB.on('order:status', (data) => {
        const entry = `[${new Date().toISOString()}] Event received: orderId=${data.orderId}, status=${data.status}`;
        logsB.push(entry);
        console.log(`  >>> Client B RAW (UNEXPECTED!): ${entry}`);
    });

    // 3. Student A places order
    console.log('\n[Action] Student A is placing an order...');
    const order = await createOrder(userA.id, {
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
    });
    console.log(`[Action] Order placed -> ID: ${order.id}`);
    console.log(
        '[Wait] Waiting for Kitchen Worker to process (PLACED -> PREPARING -> READY)...'
    );

    // Wait up to 25s for worker to finish
    const start = Date.now();
    while (logsA.length < 3 && Date.now() - start < 25000) {
        await sleep(500);
    }

    console.log('\n========================================');
    console.log('       CLIENT A RAW EVENT LOGS          ');
    console.log('========================================');
    if (logsA.length === 0) {
        console.log('(No events received by Client A)');
    } else {
        logsA.forEach((l) => console.log(l));
    }

    console.log('\n========================================');
    console.log('       CLIENT B RAW EVENT LOGS          ');
    console.log('========================================');
    if (logsB.length === 0) {
        console.log('(No events received by Client B - 100% Isolated)');
    } else {
        logsB.forEach((l) => console.log(l));
    }
    console.log('========================================\n');

    socketA.close();
    socketB.close();
    await prisma.$disconnect();
    process.exit(0);
}

runM3().catch((e) => {
    console.error('M3 error:', e);
    process.exit(1);
});
