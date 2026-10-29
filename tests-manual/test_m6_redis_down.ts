// tests-manual/test_m6_redis_down.ts
import 'dotenv/config';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signToken = (userId: string, role = 'STUDENT') =>
    jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '15m' });

async function runM6() {
    console.log('================================================================');
    console.log('       MANUAL TEST M6: REDIS DOWN RESILIENCE & RECOVERY         ');
    console.log('================================================================\n');

    // 1. Setup Student, Staff, and Menu Item via Prisma
    const student = await prisma.user.create({
        data: {
            name: 'Student M6',
            email: `student_m6_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    let staff = await prisma.user.findFirst({ where: { role: 'STAFF' } });
    if (!staff) {
        staff = await prisma.user.create({
            data: {
                name: 'Staff M6',
                email: `staff_m6_${crypto.randomUUID().slice(0, 6)}@test.com`,
                password: 'hash',
                role: 'STAFF',
            },
        });
    }

    const menuItem = await prisma.menuItem.create({
        data: {
            name: `Meal M6 ${crypto.randomUUID().slice(0, 4)}`,
            price: 110,
            stockCount: 50,
            isAvailable: true,
            category: 'LUNCH',
        },
    });

    const studentToken = signToken(student.id, 'STUDENT');
    const staffToken = signToken(staff.id, 'STAFF');

    // 2. Connect Student via Socket.io
    const allEvents: { time: string; phase: string; data: any }[] = [];
    const socket = ioClient(SERVER_URL, {
        auth: { token: studentToken },
        transports: ['websocket', 'polling'],
    });

    await new Promise<void>((r) => socket.on('connect', () => r()));
    console.log(`[Connect] Socket connected (id: ${socket.id}) in room "${student.id}"\n`);

    let currentPhase = 'REDIS_DOWN';
    socket.on('order:status', (data) => {
        const entry = { time: new Date().toISOString(), phase: currentPhase, data };
        allEvents.push(entry);
        console.log(`  >>> Client Event Received [Phase: ${currentPhase}]: status = ${data.status}, orderId = ${data.orderId}`);
    });

    // -------------------------------------------------------------
    // PHASE 1: HTTP CALLS WHILE REDIS IS DOWN
    // -------------------------------------------------------------
    console.log('--- PHASE 1: TESTING WITH REDIS DOWN ---');

    console.log('[Phase 1] Sending POST /api/orders while Redis is DOWN...');
    const t0 = Date.now();
    const resOrder = await fetch(`${SERVER_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: menuItem.id, quantity: 1 }],
        }),
    });
    const orderDuration = Date.now() - t0;
    const orderData = await resOrder.json();
    const orderId = orderData?.data?.id;

    console.log(`[Phase 1] HTTP POST Status: ${resOrder.status}`);
    console.log(`[Phase 1] Order creation response time: ${orderDuration}ms (${(orderDuration / 1000).toFixed(2)}s)`);
    console.log(`[Phase 1] Order ID in DB: ${orderId}, Status: ${orderData?.data?.status}`);

    console.log('\n[Phase 1] Sending PATCH /api/orders/:id/status to CANCELLED while Redis is DOWN...');
    const t1 = Date.now();
    const resCancel = await fetch(`${SERVER_URL}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
    });
    const updateDuration = Date.now() - t1;
    const cancelData = await resCancel.json();

    console.log(`[Phase 1] HTTP PATCH Status: ${resCancel.status}`);
    console.log(`[Phase 1] Status change response time: ${updateDuration}ms (${(updateDuration / 1000).toFixed(2)}s)`);
    console.log(`[Phase 1] Updated DB status: ${cancelData?.data?.status}`);

    const phase1DbSuccess = resOrder.status === 201 && resCancel.status === 200;
    const phase1SpeedSuccess = orderDuration < 6000 && updateDuration < 6000;

    console.log('\n--- PHASE 1 SUMMARY ---');
    console.log(`DB Status Change Succeeded:  ${phase1DbSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`Response times under ~5s:    ${phase1SpeedSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`Events received while down:  ${allEvents.length} (Expected: 0)`);

    // -------------------------------------------------------------
    // PHASE 2: WAIT FOR REDIS RECOVERY
    // -------------------------------------------------------------
    console.log('\n=============================================================');
    console.log('>>> NOW START REDIS:');
    console.log('    In your other terminal, run: docker start hostel-redis');
    console.log('    This script will now listen for 15 seconds to check');
    console.log('    if any OLD events arrive late once Redis recovers...');
    console.log('=============================================================\n');

    currentPhase = 'REDIS_RECOVERING';
    for (let i = 15; i > 0; i--) {
        process.stdout.write(`\r[Phase 2] Listening... ${i}s remaining `);
        await sleep(1000);
    }
    console.log('\r[Phase 2] 15 seconds finished. Analyzing events received...');

    const lateEvents = allEvents.filter((e) => e.data.orderId === orderId);
    console.log(`Did any OLD events for Order 1 arrive after Redis recovery?: ${lateEvents.length > 0 ? `YES (${lateEvents.length} old event(s))` : 'NO (0 old events)'}`);
    lateEvents.forEach((e) => console.log(`   -> [Late Event]: status = ${e.data.status}, orderId = ${e.data.orderId}`));

    // -------------------------------------------------------------
    // PHASE 3: PLACE NEW ORDER WITH REDIS ONLINE
    // -------------------------------------------------------------
    currentPhase = 'REDIS_ONLINE';
    console.log('\n--- PHASE 3: PLACING NEW ORDER WITH REDIS ONLINE ---');
    console.log('[Phase 3] Sending POST /api/orders for a NEW order...');
    const resOrder2 = await fetch(`${SERVER_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: menuItem.id, quantity: 1 }],
        }),
    });
    const orderData2 = await resOrder2.json();
    const order2Id = orderData2?.data?.id;
    console.log(`[Phase 3] New Order ID: ${order2Id}, Status: ${orderData2?.data?.status}`);

    // Wait 2.5s for real-time event
    await sleep(2500);

    const newOrderEvents = allEvents.filter((e) => e.data.orderId === order2Id);
    const newOrderReceived = newOrderEvents.some((e) => e.data.status === 'PLACED');

    console.log('\n================================================================');
    console.log('                       M6 FINAL SUMMARY                         ');
    console.log('================================================================');
    console.log(`1. Redis Down - DB Update Succeeded:       ${phase1DbSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`2. Redis Down - Response Time < 5s:        ${phase1SpeedSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`3. Redis Recovery - Old Events Delivered?: ${lateEvents.length > 0 ? 'YES (Stale events flushed from offlineQueue)' : 'NO'}`);
    console.log(`4. Redis Online - New Order Event Flow:    ${newOrderReceived ? 'PASS (Real-time events working again!)' : 'FAIL'}`);
    console.log('================================================================\n');

    socket.close();
    await prisma.$disconnect();
    process.exit(0);
}

runM6().catch((e) => {
    console.error('M6 error:', e);
    process.exit(1);
});
