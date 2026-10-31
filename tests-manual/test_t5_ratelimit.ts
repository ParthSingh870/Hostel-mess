// tests-manual/test_t5_ratelimit.ts
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

async function runT5() {
    console.log('================================================================');
    console.log('  TEST T5: RATE LIMIT 6TH ORDER (429 + RETRY-AFTER) & ISOLATION ');
    console.log('================================================================\n');

    if (cacheRedisClient.status !== 'ready') {
        await Promise.race([
            new Promise((r) => cacheRedisClient.once('ready', r)),
            new Promise((r) => setTimeout(r, 1500)),
        ]);
    }

    // 1. Setup Student 1 and Menu Item
    const student1 = await prisma.user.create({
        data: {
            name: 'Student 1 T5',
            email: `student1_t5_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const token1 = signToken(student1.id, 'STUDENT');

    const testItem = await prisma.menuItem.create({
        data: {
            name: `Thali T5 ${crypto.randomUUID().slice(0, 4)}`,
            price: 70,
            stockCount: 100,
            isAvailable: true,
            category: 'LUNCH',
        },
    });

    console.log(`[Setup] Student 1 ID: ${student1.id}`);
    console.log(`[Setup] Rate Limit Key: ratelimit:orders:${student1.id}`);
    console.log(`[Setup] Menu Item: "${testItem.name}" (Stock: 100)\n`);

    // 2. Fire 5 consecutive orders for Student 1
    console.log('--- Step 1: Student 1 Sends Orders 1 to 5 (Expect: 201 Created) ---');
    for (let i = 1; i <= 5; i++) {
        const res = await fetch(`${BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token1}`,
            },
            body: JSON.stringify({
                items: [{ menuItemId: testItem.id, quantity: 1 }],
            }),
        });
        const remaining = res.headers.get('x-ratelimit-remaining');
        console.log(`Order #${i} -> Status: ${res.status} | Remaining Quota: ${remaining}`);
    }
    console.log('-> 5 allowed orders completed within window.\n');

    // 3. Fire 6th order for Student 1
    console.log('--- Step 2: Student 1 Sends 6th Order (Expect: 429 Too Many Requests) ---');
    const res6 = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token1}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: testItem.id, quantity: 1 }],
        }),
    });

    const body6 = await res6.json();
    console.log(`Order #6 Status: ${res6.status} (Expected: 429)`);
    console.log(`Order #6 Headers:`);
    console.log(`  Retry-After: ${res6.headers.get('retry-after')} seconds`);
    console.log(`  X-RateLimit-Limit: ${res6.headers.get('x-ratelimit-limit')}`);
    console.log(`  X-RateLimit-Remaining: ${res6.headers.get('x-ratelimit-remaining')}`);
    console.log(`Order #6 Body:\n`, JSON.stringify(body6, null, 2), '\n');

    const retryAfterVal = Number(res6.headers.get('retry-after'));
    if (res6.status === 429 && retryAfterVal > 0) {
        console.log('✅ PASS: 6th order blocked with 429 and valid Retry-After header.\n');
    } else {
        console.error('❌ FAIL: Rate limiter did not block 6th order properly.\n');
    }

    // 4. Check Redis TTL directly on the ratelimit key
    const ttlInRedis = await cacheRedisClient.ttl(`ratelimit:orders:${student1.id}`);
    console.log('--- Step 3: Redis Key TTL Check ---');
    console.log(`Redis TTL for "ratelimit:orders:${student1.id}": ${ttlInRedis}s`);
    if (ttlInRedis > 0) {
        console.log(`✅ PASS: Key has valid TTL (${ttlInRedis}s) and is NOT immortal (-1).\n`);
    } else {
        console.error(`❌ FAIL: Invalid TTL: ${ttlInRedis}\n`);
    }

    // 5. Verify Student 2 is NOT blocked
    console.log('--- Step 4: Verify Different Student (Student 2) Is NOT Blocked ---');
    const student2 = await prisma.user.create({
        data: {
            name: 'Student 2 T5',
            email: `student2_t5_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const token2 = signToken(student2.id, 'STUDENT');

    const resStudent2 = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token2}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: testItem.id, quantity: 1 }],
        }),
    });
    const remaining2 = resStudent2.headers.get('x-ratelimit-remaining');

    console.log(`Student 2 (Order #1) -> Status: ${resStudent2.status} (Expected: 201) | Remaining Quota: ${remaining2}`);
    if (resStudent2.status === 201) {
        console.log('✅ PASS: Student 2 placed order successfully; rate limit is strictly isolated per userId.\n');
    } else {
        console.error('❌ FAIL: Student 2 was unexpectedly blocked.\n');
    }

    console.log('================================================================');
    console.log('                  TEST T5 VERIFICATION COMPLETE                 ');
    console.log('================================================================\n');

    console.log('CMD Command to manually verify TTL via redis-cli:');
    console.log(`docker exec hostel-redis redis-cli TTL ratelimit:orders:${student1.id}\n`);

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

runT5().catch((e) => {
    console.error('T5 Error:', e);
    process.exit(1);
});
