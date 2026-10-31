// tests-manual/test_s4_ratelimit.ts
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

async function runS4Test() {
    console.log('================================================================');
    console.log('       MANUAL TEST S4: ATOMIC ORDER RATE LIMITER (POST /orders) ');
    console.log('================================================================\n');

    // 0. Ensure Redis client readiness
    if (cacheRedisClient.status !== 'ready') {
        console.log('Waiting for Redis client to be ready...');
        await Promise.race([
            new Promise((resolve) => cacheRedisClient.once('ready', resolve)),
            new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
    }

    // Health check
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

    // 1. Setup Student 1 and Menu Item
    const student1 = await prisma.user.create({
        data: {
            name: 'Student 1 RateLimit',
            email: `student1_rl_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const token1 = signToken(student1.id, 'STUDENT');

    const testItem = await prisma.menuItem.create({
        data: {
            name: `Rice Plate RL ${crypto.randomUUID().slice(0, 4)}`,
            price: 50,
            stockCount: 100,
            isAvailable: true,
            category: 'LUNCH',
        },
    });

    console.log(`[Setup] Student 1 ID: ${student1.id}`);
    console.log(`[Setup] Menu Item: "${testItem.name}" (Stock: 100)`);
    console.log(`[Config] ORDER_RATE_LIMIT_MAX = 5 orders / 60 seconds\n`);

    // 2. Fire 5 consecutive orders for Student 1 (all should succeed: 201)
    console.log('--- Step 1: Sending orders 1 through 5 (Expect: 201 Created) ---');
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
        const limit = res.headers.get('x-ratelimit-limit');
        console.log(
            `Order #${i} -> Status: ${res.status} | X-RateLimit-Limit: ${limit} | X-RateLimit-Remaining: ${remaining}`
        );

        if (res.status !== 201) {
            console.error(`❌ Unexpected status on order #${i}: ${res.status}`);
        }
    }
    console.log('-> 5 allowed orders successfully placed within the window.\n');

    // 3. Fire 6th order for Student 1 (MUST return 429 Too Many Requests with Retry-After)
    console.log('--- Step 2: Sending 6th order for Student 1 (Expect: 429 Too Many Requests) ---');
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
    const retryAfter = res6.headers.get('retry-after');

    console.log(`Order #6 -> Status: ${res6.status} (Expected: 429)`);
    console.log(`Order #6 -> Retry-After Header: ${retryAfter} seconds`);
    console.log(`Order #6 -> Response Body:`, JSON.stringify(body6, null, 2));

    if (res6.status === 429 && retryAfter && Number(retryAfter) > 0) {
        console.log('✅ Rate limit correctly blocked 6th request with 429 and Retry-After header.\n');
    } else {
        console.error('❌ 429 rate limit check failed!');
    }

    // 4. Verify User Isolation: Student 2 should still be able to place an order
    console.log('--- Step 3: Verifying User Isolation with Student 2 ---');
    const student2 = await prisma.user.create({
        data: {
            name: 'Student 2 RateLimit',
            email: `student2_rl_${crypto.randomUUID().slice(0, 6)}@test.com`,
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

    console.log(`Student 2 (Order #1) -> Status: ${resStudent2.status} (Expected: 201)`);
    if (resStudent2.status === 201) {
        console.log('✅ Correct: Rate limit is strictly isolated per userId, not global or IP.\n');
    } else {
        console.error('❌ User isolation failed for Student 2.');
    }

    console.log('================================================================');
    console.log('            ALL S4 (d) RATE LIMIT CHECKS COMPLETED              ');
    console.log('================================================================');

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

runS4Test().catch((err) => {
    console.error('S4 Test Error:', err);
    process.exit(1);
});
