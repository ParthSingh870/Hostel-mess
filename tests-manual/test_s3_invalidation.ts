// tests-manual/test_s3_invalidation.ts
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

async function runS3Test() {
    console.log('================================================================');
    console.log('     MANUAL TEST S3: CACHE INVALIDATION LIFECYCLE VERIFICATION  ');
    console.log('================================================================\n');

    // 0. Ensure Redis and Server are healthy
    if (cacheRedisClient.status !== 'ready') {
        console.log('Waiting for Redis client to be ready...');
        await Promise.race([
            new Promise((resolve) => cacheRedisClient.once('ready', resolve)),
            new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
    }

    try {
        const health = await fetch(`${BASE_URL}/health`);
        if (!health.ok) {
            console.error('[ERROR] Server health check failed on port', PORT);
            process.exit(1);
        }
    } catch (e: any) {
        console.error(`[ERROR] Server not reachable on ${BASE_URL}: ${e.message}`);
        console.error('Please make sure "npm run dev" is running in your terminal.');
        process.exit(1);
    }

    // 1. Setup Test Users and Menu Item
    const student = await prisma.user.create({
        data: {
            name: 'Student S3',
            email: `student_s3_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const studentToken = signToken(student.id, 'STUDENT');

    let staff = await prisma.user.findFirst({ where: { role: 'STAFF' } });
    if (!staff) {
        staff = await prisma.user.create({
            data: {
                name: 'Staff S3',
                email: `staff_s3_${crypto.randomUUID().slice(0, 6)}@test.com`,
                password: 'hash',
                role: 'STAFF',
            },
        });
    }
    const staffToken = signToken(staff.id, 'STAFF');

    const testItem = await prisma.menuItem.create({
        data: {
            name: `Thali S3 ${crypto.randomUUID().slice(0, 4)}`,
            price: 80,
            stockCount: 20,
            isAvailable: true,
            category: 'LUNCH',
        },
    });

    console.log(`[Setup] Created test item: "${testItem.name}" (ID: ${testItem.id}, Stock: 20)\n`);

    // --- PHASE 1: Populate Cache ---
    console.log('--- PHASE 1: Prime Cache to HIT state ---');
    await fetch(`${BASE_URL}/api/menu`); // MISS (populates cache)
    const primeRes = await fetch(`${BASE_URL}/api/menu`);
    console.log(`Prime GET /api/menu -> X-Cache: ${primeRes.headers.get('x-cache')}`);
    if (primeRes.headers.get('x-cache') !== 'HIT') {
        console.error('❌ Cache did not prime into HIT state.');
        process.exit(1);
    }
    console.log('✅ Cache is warm and responding with HIT.\n');

    // --- PHASE 2: Menu Mutation Invalidation (PATCH /api/menu/:id) ---
    console.log('--- PHASE 2: Invalidation on Menu Update (PATCH /api/menu/:id) ---');
    const updateRes = await fetch(`${BASE_URL}/api/menu/${testItem.id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ price: 95 }),
    });
    console.log(`Staff updated item price to 95 -> Status: ${updateRes.status}`);

    const verifyMenuRes = await fetch(`${BASE_URL}/api/menu`);
    const headerAfterMenuUpdate = verifyMenuRes.headers.get('x-cache');
    const menuItems = await verifyMenuRes.json();
    const updatedFound = menuItems.find((i: any) => i.id === testItem.id);

    console.log(`GET /api/menu after update -> X-Cache: ${headerAfterMenuUpdate}`);
    console.log(`Fetched price of updated item: ${updatedFound?.price}`);

    if (headerAfterMenuUpdate === 'MISS' && updatedFound?.price === 95) {
        console.log('✅ Invalidation on Menu Update verified! (X-Cache: MISS with fresh price 95).\n');
    } else {
        console.error('❌ Invalidation on Menu Update failed.');
    }

    // --- PHASE 3: Order Creation Invalidation (Stock Decrement) ---
    console.log('--- PHASE 3: Invalidation on Order Creation (POST /api/orders) ---');
    // Prime cache again
    await fetch(`${BASE_URL}/api/menu`); // Now cache is warm (HIT)

    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: testItem.id, quantity: 2 }],
        }),
    });
    const orderData = await orderRes.json();
    console.log(`Student placed order for 2 qty -> Status: ${orderRes.status}, Order ID: ${orderData.data?.id}`);

    const verifyOrderRes = await fetch(`${BASE_URL}/api/menu`);
    const headerAfterOrder = verifyOrderRes.headers.get('x-cache');
    const menuAfterOrder = await verifyOrderRes.json();
    const itemAfterOrder = menuAfterOrder.find((i: any) => i.id === testItem.id);

    console.log(`GET /api/menu after order -> X-Cache: ${headerAfterOrder}`);
    console.log(`Remaining stockCount: ${itemAfterOrder?.stockCount} (Expected: 18)`);

    if (headerAfterOrder === 'MISS' && itemAfterOrder?.stockCount === 18) {
        console.log('✅ Invalidation on Order Placement verified! (X-Cache: MISS with decremented stock 18).\n');
    } else {
        console.error('❌ Invalidation on Order Placement failed.');
    }

    // --- PHASE 4: Order Cancellation Invalidation (Stock Restoration) ---
    console.log('--- PHASE 4: Invalidation on Order Cancel (PATCH /api/orders/:id/status) ---');
    // Prime cache again
    await fetch(`${BASE_URL}/api/menu`); // Now cache is warm (HIT)

    const cancelRes = await fetch(`${BASE_URL}/api/orders/${orderData.data.id}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
    });
    console.log(`Staff cancelled order -> Status: ${cancelRes.status}`);

    const verifyCancelRes = await fetch(`${BASE_URL}/api/menu`);
    const headerAfterCancel = verifyCancelRes.headers.get('x-cache');
    const menuAfterCancel = await verifyCancelRes.json();
    const itemAfterCancel = menuAfterCancel.find((i: any) => i.id === testItem.id);

    console.log(`GET /api/menu after cancel -> X-Cache: ${headerAfterCancel}`);
    console.log(`Restored stockCount: ${itemAfterCancel?.stockCount} (Expected: 20)`);

    if (headerAfterCancel === 'MISS' && itemAfterCancel?.stockCount === 20) {
        console.log('✅ Invalidation on Order Cancellation verified! (X-Cache: MISS with restored stock 20).\n');
    } else {
        console.error('❌ Invalidation on Order Cancellation failed.');
    }

    console.log('================================================================');
    console.log('             ALL S3 CHECKS VERIFIED SUCCESSFULLY                ');
    console.log('================================================================');

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

runS3Test().catch((err) => {
    console.error('S3 Test Error:', err);
    process.exit(1);
});
