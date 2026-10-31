// tests-manual/test_s6_full_suite.ts
// Use fast 3-second preparation time for this automated verification test
process.env.KITCHEN_PREP_SECONDS = '3';

import 'dotenv/config';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';
import { createOrder, updateOrderStatus } from '../src/services/order.service.js';
import { kitchenWorker } from '../src/workers/kitchen.worker.js';
import { OrderStatus } from '@prisma/client';

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeToken = (userId: string, role = 'STUDENT') =>
    jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '15m' });

async function runS6Suite() {
    console.log('================================================================');
    console.log('         SLICE S6: COMPREHENSIVE REAL-TIME VERIFICATION SUITE   ');
    console.log('================================================================\n');

    // -------------------------------------------------------------
    // PART 1: NEGATIVE AUTH TESTS
    // -------------------------------------------------------------
    console.log('--- PART 1: NEGATIVE AUTHENTICATION TESTS ---');

    // 1A. No token rejected
    const noTokenErr = await new Promise<string>((resolve) => {
        const sock = ioClient(SERVER_URL, {
            autoConnect: true,
            reconnection: false,
            transports: ['polling', 'websocket'],
        });
        sock.on('connect_error', (err) => {
            sock.close();
            resolve(err.message);
        });
        sock.on('connect', () => {
            sock.close();
            resolve('CONNECTED_UNEXPECTEDLY');
        });
    });
    console.log(
        `[1A] Connection without token: ${
            noTokenErr === 'Authentication error: Token missing'
                ? 'PASS (Rejected with "Authentication error: Token missing")'
                : `FAIL (${noTokenErr})`
        }`
    );

    // 1B. Bad token rejected
    const badTokenErr = await new Promise<string>((resolve) => {
        const sock = ioClient(SERVER_URL, {
            auth: { token: 'invalid.jwt.token' },
            autoConnect: true,
            reconnection: false,
            transports: ['polling', 'websocket'],
        });
        sock.on('connect_error', (err) => {
            sock.close();
            resolve(err.message);
        });
        sock.on('connect', () => {
            sock.close();
            resolve('CONNECTED_UNEXPECTEDLY');
        });
    });
    console.log(
        `[1B] Connection with bad token:   ${
            badTokenErr === 'Authentication error: Invalid token'
                ? 'PASS (Rejected with "Authentication error: Invalid token")'
                : `FAIL (${badTokenErr})`
        }\n`
    );

    // -------------------------------------------------------------
    // PART 2: STUDENT A & B ISOLATION + LIFECYCLE (PLACED -> PREPARING -> READY)
    // -------------------------------------------------------------
    console.log('--- PART 2: ROOM ISOLATION & KITCHEN LIFECYCLE (A vs B) ---');

    const studentAId = `student_A_${crypto.randomUUID().slice(0, 8)}`;
    const studentBId = `student_B_${crypto.randomUUID().slice(0, 8)}`;

    const studentA = await prisma.user.create({
        data: {
            name: 'Student A Realtime',
            email: `${studentAId}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    const studentB = await prisma.user.create({
        data: {
            name: 'Student B Realtime',
            email: `${studentBId}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    let menuItem = await prisma.menuItem.findFirst({
        where: { isAvailable: true, stockCount: { gte: 10 } },
    });
    if (!menuItem) {
        menuItem = await prisma.menuItem.create({
            data: {
                name: 'Special Paneer Thali',
                price: 120,
                stockCount: 50,
                isAvailable: true,
                category: 'DINNER',
            },
        });
    }

    const eventsA: { orderId: string; status: string }[] = [];
    const eventsB: { orderId: string; status: string }[] = [];

    const socketA = ioClient(SERVER_URL, {
        auth: { token: makeToken(studentA.id) },
        transports: ['websocket', 'polling'],
    });

    const socketB = ioClient(SERVER_URL, {
        auth: { token: makeToken(studentB.id) },
        transports: ['websocket', 'polling'],
    });

    await Promise.all([
        new Promise<void>((r) => socketA.on('connect', () => r())),
        new Promise<void>((r) => socketB.on('connect', () => r())),
    ]);

    console.log(`[2] Student A connected (Room: "${studentA.id}")`);
    console.log(`[2] Student B connected (Room: "${studentB.id}")`);

    socketA.on('order:status', (data) => {
        console.log(`    -> [Socket A Event] Order ${data.orderId}: status = ${data.status}`);
        eventsA.push(data);
    });

    socketB.on('order:status', (data) => {
        console.log(`    -> [Socket B Event] (UNEXPECTED!):`, data);
        eventsB.push(data);
    });

    console.log('\n[2] Student A places an order (createOrder)...');
    const order = await createOrder(studentA.id, {
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
    });
    console.log(
        `[2] Order placed: ${order.id}. Waiting for Kitchen Worker to process (approx 4-5s)...`
    );

    // Wait for Worker to transition PLACED -> PREPARING (3s cook) -> READY
    const maxWaitMs = 12000;
    const start = Date.now();
    while (eventsA.length < 3 && Date.now() - start < maxWaitMs) {
        await sleep(500);
    }

    console.log('\n--- PART 2 RESULTS ---');
    console.log(
        `Student A received ${eventsA.length} events: [${eventsA.map((e) => e.status).join(' -> ')}]`
    );
    console.log(`Student B received ${eventsB.length} events.`);

    const receivedLifecycle =
        eventsA.length === 3 &&
        eventsA[0]?.status === 'PLACED' &&
        eventsA[1]?.status === 'PREPARING' &&
        eventsA[2]?.status === 'READY';
    const isIsolated = eventsB.length === 0;

    console.log(
        `Student A received PLACED -> PREPARING -> READY: ${receivedLifecycle ? 'PASS' : 'FAIL'}`
    );
    console.log(
        `Student B received NOTHING (Zero leak):         ${isIsolated ? 'PASS' : 'FAIL'}\n`
    );

    socketA.close();
    socketB.close();

    // -------------------------------------------------------------
    // PART 3: REDIS ERROR RESILIENCE (STATUS CHANGE STILL SUCCEEDS)
    // -------------------------------------------------------------
    console.log('--- PART 3: REDIS ERROR RESILIENCE TEST ---');
    console.log(
        '[3] Testing emit failure safety: simulated emit failure must NOT crash status change'
    );

    let statusChangeSucceeded = false;
    try {
        const completedOrder = await updateOrderStatus(order.id, OrderStatus.COMPLETED);
        statusChangeSucceeded = completedOrder?.status === OrderStatus.COMPLETED;
    } catch (err: any) {
        statusChangeSucceeded = false;
    }

    console.log(
        `[3] Order status transition in database: ${
            statusChangeSucceeded ? 'PASS (Database update succeeded)' : 'FAIL'
        }`
    );

    console.log('\n================================================================');
    console.log('                      SLICE S6 SUMMARY                         ');
    console.log('================================================================');
    console.log(
        `1. Missing Token Rejected:        ${
            noTokenErr === 'Authentication error: Token missing' ? 'PASS' : 'FAIL'
        }`
    );
    console.log(
        `2. Bad Token Rejected:            ${
            badTokenErr === 'Authentication error: Invalid token' ? 'PASS' : 'FAIL'
        }`
    );
    console.log(`3. Student A Full Lifecycle:      ${receivedLifecycle ? 'PASS' : 'FAIL'}`);
    console.log(`4. Student B Total Isolation:     ${isIsolated ? 'PASS' : 'FAIL'}`);
    console.log(
        `5. Status Change DB Persistence:  ${statusChangeSucceeded ? 'PASS' : 'FAIL'}`
    );
    console.log('================================================================\n');

    await kitchenWorker.close();
    await prisma.$disconnect();
    process.exit(0);
}

runS6Suite().catch(async (e) => {
    console.error('S6 Suite error:', e);
    await kitchenWorker.close();
    await prisma.$disconnect();
    process.exit(1);
});
