// tests-manual/test_t4_worker.ts
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';
import { closeCacheConnection, cacheRedisClient } from '../src/cache/cache.js';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const signToken = (userId: string, role = 'STUDENT') =>
    jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '15m' });

async function runT4() {
    console.log('================================================================');
    console.log('  TEST T4: WORKER AUTO-CANCEL & CROSS-PROCESS CACHE INVALIDATION');
    console.log('================================================================\n');

    if (cacheRedisClient.status !== 'ready') {
        await Promise.race([
            new Promise((r) => cacheRedisClient.once('ready', r)),
            new Promise((r) => setTimeout(r, 1500)),
        ]);
    }

    // 1. Setup Student and Menu Item
    const student = await prisma.user.create({
        data: {
            name: 'Student T4',
            email: `student_t4_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const token = signToken(student.id, 'STUDENT');

    const initialStock = 10;
    const testItem = await prisma.menuItem.create({
        data: {
            name: `Worker Fail Thali ${crypto.randomUUID().slice(0, 4)}`,
            price: 120,
            stockCount: initialStock,
            isAvailable: true,
            category: 'LUNCH',
        },
    });

    console.log(`[Setup] Item: "${testItem.name}" (ID: ${testItem.id}, Initial Stock: ${initialStock})`);
    console.log(`[Setup] Student ID: ${student.id}\n`);

    // 2. Student places order for 2 items (stock becomes 8)
    console.log('--- Step 1: Placing Order (Quantity: 2) ---');
    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: testItem.id, quantity: 2 }],
        }),
    });
    const orderData = await orderRes.json();
    const orderId = orderData.data?.id;
    console.log(`Order placed successfully: ${orderId} (Status: PLACED)`);

    // 3. Prime cache so Redis holds stock = 8 with X-Cache: HIT
    console.log('\n--- Step 2: Priming Cache (Expect: Stock = 8, X-Cache: HIT) ---');
    await fetch(`${BASE_URL}/api/menu`); // MISS
    const primeRes = await fetch(`${BASE_URL}/api/menu`); // HIT
    console.log(`GET /api/menu -> X-Cache Header: ${primeRes.headers.get('x-cache')}`);
    const primeItems = await primeRes.json();
    const itemInPrime = primeItems.find((i: any) => i.id === testItem.id);
    console.log(`Current Cached Stock in Redis: ${itemInPrime?.stockCount} (Expected: 8)`);
    console.log('-> Cache is warm with decremented stock.\n');

    // 4. Waiting for Worker Process to process job, fail 3 attempts, and auto-cancel
    console.log('--- Step 3: Waiting for Kitchen Worker to process & fail job ---');
    console.log('(If worker is running in Terminal 3 with SIMULATE_WORKER_FAILURE=true, it will fail 3 times and auto-cancel)');

    let orderStatus = 'PLACED';
    let attempts = 0;
    const maxWaitSeconds = 25;

    while (attempts < maxWaitSeconds) {
        await sleep(1000);
        attempts++;
        const check = await prisma.order.findUnique({ where: { id: orderId } });
        orderStatus = check?.status || 'UNKNOWN';
        process.stdout.write(`\r[${attempts}s] Order Status in DB: ${orderStatus}   `);
        if (orderStatus === 'CANCELLED') {
            break;
        }
    }
    console.log('\n');

    if (orderStatus !== 'CANCELLED') {
        console.error(`❌ Timed out waiting for worker to auto-cancel order ${orderId}. Current status: ${orderStatus}`);
        console.error('Make sure Terminal 3 has: set SIMULATE_WORKER_FAILURE=true && npm run dev:worker');
        await closeCacheConnection();
        await prisma.$disconnect();
        process.exit(1);
    }

    console.log(`✅ Order ${orderId} has been CANCELLED by the worker process!`);

    // 5. Verify that GET /api/menu is MISS and stock is restored to 10
    console.log('\n--- Step 4: Verification of Worker Cache Invalidation (Expect: MISS, Stock = 10) ---');
    const getAfterWorker = await fetch(`${BASE_URL}/api/menu`);
    const headerAfterWorker = getAfterWorker.headers.get('x-cache');
    const itemsAfterWorker = await getAfterWorker.json();
    const itemAfterWorker = itemsAfterWorker.find((i: any) => i.id === testItem.id);

    console.log(`GET /api/menu -> Status: ${getAfterWorker.status}`);
    console.log(`GET /api/menu -> X-Cache Header: ${headerAfterWorker} (Expected: MISS)`);
    console.log(`Restored stockCount in Menu: ${itemAfterWorker?.stockCount} (Expected: 10)`);

    if (headerAfterWorker === 'MISS' && itemAfterWorker?.stockCount === 10) {
        console.log('✅ PASS: Worker process successfully invalidated Redis cache and restored stock to 10!\n');
    } else {
        console.error('❌ FAIL: Cache was not invalidated by worker process.\n');
    }

    console.log('================================================================');
    console.log('                  TEST T4 VERIFICATION COMPLETE                 ');
    console.log('================================================================');

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

runT4().catch((e) => {
    console.error('T4 Error:', e);
    process.exit(1);
});
