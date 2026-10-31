// tests-manual/test_m7_offline_truth.ts
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

async function runM7() {
    console.log('================================================================');
    console.log('    MANUAL TEST M7: CLIENT DISCONNECT & DB AS SOURCE OF TRUTH   ');
    console.log('================================================================\n');

    // 1. Setup Student, Staff, and Menu Item
    const student = await prisma.user.create({
        data: {
            name: 'Student M7',
            email: `student_m7_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });

    let staff = await prisma.user.findFirst({ where: { role: 'STAFF' } });
    if (!staff) {
        staff = await prisma.user.create({
            data: {
                name: 'Staff M7',
                email: `staff_m7_${crypto.randomUUID().slice(0, 6)}@test.com`,
                password: 'hash',
                role: 'STAFF',
            },
        });
    }

    const menuItem = await prisma.menuItem.create({
        data: {
            name: `Meal M7 ${crypto.randomUUID().slice(0, 4)}`,
            price: 130,
            stockCount: 50,
            isAvailable: true,
            category: 'DINNER',
        },
    });

    const studentToken = signToken(student.id, 'STUDENT');
    const staffToken = signToken(staff.id, 'STAFF');

    // 2. Connect Student socket
    const receivedWhileConnected: any[] = [];
    const receivedAfterReconnect: any[] = [];

    console.log('[Step 1] Connecting Student Socket...');
    let socket = ioClient(SERVER_URL, {
        auth: { token: studentToken },
        transports: ['websocket', 'polling'],
    });

    await new Promise<void>((r) => socket.on('connect', () => r()));
    console.log(`[Step 1] Student socket connected (id: ${socket.id}) in room "${student.id}"`);

    socket.on('order:status', (data) => {
        console.log(`  >>> Client Event Received (Session 1): status = ${data.status}`);
        receivedWhileConnected.push(data);
    });

    // 3. Place order while connected
    console.log('\n[Step 2] Placing order while connected...');
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
    const orderData = await resOrder.json();
    const orderId = orderData.data.id;
    console.log(`[Step 2] Order created -> ID: ${orderId}, Status: ${orderData.data.status}`);
    await sleep(1000);

    // 4. Client disconnects (simulating closing app / network loss)
    console.log('\n[Step 3] Client disconnecting (simulating app close / lost internet)...');
    socket.disconnect();
    console.log('[Step 3] Client socket is now DISCONNECTED.');
    await sleep(1000);

    // 5. Staff updates status to PREPARING while client is offline
    console.log('\n[Step 4] Staff updates order to "PREPARING" via PATCH while client is OFFLINE...');
    const resPrep = await fetch(`${SERVER_URL}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ status: 'PREPARING' }),
    });
    const prepData = await resPrep.json();
    console.log(`[Step 4] Staff PATCH Status: ${resPrep.status}, Message: ${prepData.message}`);
    await sleep(1000);

    // 6. Client reconnects
    console.log('\n[Step 5] Client re-opens app and RECONNECTS socket...');
    const reconnectedSocket = ioClient(SERVER_URL, {
        auth: { token: studentToken },
        transports: ['websocket', 'polling'],
    });

    await new Promise<void>((r) => reconnectedSocket.on('connect', () => r()));
    console.log(`[Step 5] Socket reconnected (id: ${reconnectedSocket.id}) in room "${student.id}"`);

    reconnectedSocket.on('order:status', (data) => {
        console.log(`  >>> Client Event Received (Session 2): status = ${data.status}`);
        receivedAfterReconnect.push(data);
    });

    // Wait 3 seconds to verify NO missed events are replayed over WebSocket
    console.log('[Step 5] Waiting 3 seconds to verify whether WebSocket replays missed event...');
    await sleep(3000);

    const missedEventReplayed = receivedAfterReconnect.some((e) => e.status === 'PREPARING');
    console.log(
        `Was the missed PREPARING event replayed on WebSocket?: ${
            missedEventReplayed ? 'YES' : 'NO (Expected - WebSocket has no history/replay)'
        }`
    );

    // 7. Client falls back to REST API: GET /api/orders/my
    console.log('\n[Step 6] Client fetches order history from REST API: GET /api/orders/my...');
    const resMyOrders = await fetch(`${SERVER_URL}/api/orders/my`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${studentToken}`,
        },
    });
    const myOrdersData = await resMyOrders.json();
    const foundOrder = myOrdersData.data?.find((o: any) => o.id === orderId);

    console.log(`[Step 6] HTTP Status: ${resMyOrders.status}`);
    console.log(`[Step 6] Current status from Database: "${foundOrder?.status}" (Expected: "PREPARING")`);

    const dbIsAccurate = foundOrder?.status === 'PREPARING';

    console.log('\n================================================================');
    console.log('                       M7 FINAL SUMMARY                         ');
    console.log('================================================================');
    console.log(`1. Event Sent While Offline:               "PREPARING"`);
    console.log(
        `2. WebSocket Replayed Missed Event?:       ${
            missedEventReplayed ? 'YES' : 'NO (Confirmed: fire-and-forget, no replay)'
        }`
    );
    console.log(`3. REST API GET /orders/my Status in DB:   "${foundOrder?.status}"`);
    console.log(`4. Database Confirmed Single Truth Source: ${dbIsAccurate ? 'PASS' : 'FAIL'}`);
    console.log('================================================================\n');

    reconnectedSocket.close();
    await prisma.$disconnect();
    process.exit(0);
}

runM7().catch((e) => {
    console.error('M7 error:', e);
    process.exit(1);
});
