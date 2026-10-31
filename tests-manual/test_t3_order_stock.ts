// tests-manual/test_t3_order_stock.ts
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';
import { closeCacheConnection, cacheRedisClient } from '../src/cache/cache.js';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const signToken = (userId: string, role = 'STUDENT') =>
    jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '15m' });

async function runT3() {
    console.log('================================================================');
    console.log('  TEST T3: ORDER CREATION (STOCK DECREMENT) & CANCEL (RESTORE)  ');
    console.log('================================================================\n');

    if (cacheRedisClient.status !== 'ready') {
        await Promise.race([
            new Promise((r) => cacheRedisClient.once('ready', r)),
            new Promise((r) => setTimeout(r, 1500)),
        ]);
    }

    // 1. Setup Student, Staff, and Menu Item
    const student = await prisma.user.create({
        data: {
            name: 'Student T3',
            email: `student_t3_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const studentToken = signToken(student.id, 'STUDENT');

    let staff = await prisma.user.findFirst({ where: { role: 'STAFF' } });
    if (!staff) {
        staff = await prisma.user.create({
            data: {
                name: 'Staff T3',
                email: `staff_t3_${crypto.randomUUID().slice(0, 6)}@test.com`,
                password: 'hash',
                role: 'STAFF',
            },
        });
    }
    const staffToken = signToken(staff.id, 'STAFF');

    const testItem = await prisma.menuItem.create({
        data: {
            name: `Thali T3 ${crypto.randomUUID().slice(0, 4)}`,
            price: 90,
            stockCount: 20,
            isAvailable: true,
            category: 'LUNCH',
        },
    });

    console.log(`[Setup] Created Item: "${testItem.name}" (ID: ${testItem.id}, Initial Stock: 20)`);
    console.log(`[Setup] Student ID: ${student.id} | Staff ID: ${staff.id}\n`);

    // 2. Prime cache to HIT state
    console.log('--- Step 1: Prime Cache to HIT state ---');
    await fetch(`${BASE_URL}/api/menu`);
    const primeRes = await fetch(`${BASE_URL}/api/menu`);
    console.log(`GET /api/menu -> X-Cache: ${primeRes.headers.get('x-cache')}`);
    console.log('-> Cache is warm.\n');

    // 3. Student places order for 3 items
    console.log('--- Step 2: Student Places Order for 3 qty (POST /api/orders) ---');
    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: testItem.id, quantity: 3 }],
        }),
    });
    const orderData = await orderRes.json();
    console.log(`POST /api/orders -> Status: ${orderRes.status}`);
    console.log(`Created Order ID: ${orderData.data?.id}\n`);

    // 4. Next GET /api/menu MUST be MISS and show stockCount = 17
    console.log('--- Step 3: Next GET /api/menu after Order (Expect: MISS, Stock = 17) ---');
    const getAfterOrder = await fetch(`${BASE_URL}/api/menu`);
    const headerAfterOrder = getAfterOrder.headers.get('x-cache');
    const itemsAfterOrder = await getAfterOrder.json();
    const itemAfterOrder = itemsAfterOrder.find((i: any) => i.id === testItem.id);

    console.log(`GET /api/menu -> Status: ${getAfterOrder.status}`);
    console.log(`GET /api/menu -> X-Cache Header: ${headerAfterOrder} (Expected: MISS)`);
    console.log(`Remaining stockCount in Menu: ${itemAfterOrder?.stockCount} (Expected: 17)`);

    if (headerAfterOrder === 'MISS' && itemAfterOrder?.stockCount === 17) {
        console.log('✅ PASS: Order placement invalidated cache; stock decremented to 17.\n');
    } else {
        console.error('❌ FAIL: Cache invalidation or stock decrement failed.\n');
    }

    // 5. Staff cancels the order (PATCH /api/orders/:id/status -> CANCELLED)
    console.log('--- Step 4: Staff Cancels Order (PATCH /api/orders/:id/status) ---');
    const cancelRes = await fetch(`${BASE_URL}/api/orders/${orderData.data.id}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
    });
    const cancelData = await cancelRes.json();
    console.log(`PATCH /api/orders/${orderData.data.id}/status -> Status: ${cancelRes.status}`);
    console.log(`Order status updated to: ${cancelData.data?.status || 'CANCELLED'}\n`);

    // 6. Next GET /api/menu MUST be MISS and show restored stockCount = 20
    console.log('--- Step 5: Next GET /api/menu after Cancel (Expect: MISS, Stock Restored = 20) ---');
    const getAfterCancel = await fetch(`${BASE_URL}/api/menu`);
    const headerAfterCancel = getAfterCancel.headers.get('x-cache');
    const itemsAfterCancel = await getAfterCancel.json();
    const itemAfterCancel = itemsAfterCancel.find((i: any) => i.id === testItem.id);

    console.log(`GET /api/menu -> Status: ${getAfterCancel.status}`);
    console.log(`GET /api/menu -> X-Cache Header: ${headerAfterCancel} (Expected: MISS)`);
    console.log(`Restored stockCount in Menu: ${itemAfterCancel?.stockCount} (Expected: 20)`);

    if (headerAfterCancel === 'MISS' && itemAfterCancel?.stockCount === 20) {
        console.log('✅ PASS: Order cancellation invalidated cache; stock restored to 20.\n');
    } else {
        console.error('❌ FAIL: Cache invalidation or stock restoration failed.\n');
    }

    console.log('================================================================');
    console.log('                  TEST T3 VERIFICATION COMPLETE                 ');
    console.log('================================================================');

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

runT3().catch((e) => {
    console.error('T3 Error:', e);
    process.exit(1);
});
