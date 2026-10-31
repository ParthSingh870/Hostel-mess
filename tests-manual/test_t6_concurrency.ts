// tests-manual/test_t6_concurrency.ts
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

async function runT6() {
    console.log('================================================================');
    console.log('  TEST T6: RATE LIMIT CONCURRENCY (10 SIMULTANEOUS POST /orders)');
    console.log('================================================================\n');

    if (cacheRedisClient.status !== 'ready') {
        await Promise.race([
            new Promise((r) => cacheRedisClient.once('ready', r)),
            new Promise((r) => setTimeout(r, 1500)),
        ]);
    }

    // 1. Setup Student and Menu Item with ample stock
    const student = await prisma.user.create({
        data: {
            name: 'Student T6 Concurrency',
            email: `student_t6_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const token = signToken(student.id, 'STUDENT');

    const testItem = await prisma.menuItem.create({
        data: {
            name: `Thali T6 Concurrent ${crypto.randomUUID().slice(0, 4)}`,
            price: 50,
            stockCount: 100,
            isAvailable: true,
            category: 'LUNCH',
        },
    });

    console.log(`[Setup] Student ID: ${student.id}`);
    console.log(`[Setup] Rate Limit Key: ratelimit:orders:${student.id}`);
    console.log(`[Setup] Menu Item: "${testItem.name}" (Stock: 100)`);
    console.log(`[Setup] Target: Fire 10 simultaneous orders concurrently via Promise.all\n`);

    // 2. Fire 10 simultaneous POST /orders requests concurrently
    console.log('--- Firing 10 Simultaneous POST /api/orders Requests ---');
    const start = performance.now();

    const requestPromises = Array.from({ length: 10 }).map((_, index) => {
        const reqStart = performance.now();
        return fetch(`${BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                items: [{ menuItemId: testItem.id, quantity: 1 }],
            }),
        }).then(async (res) => {
            const reqElapsed = (performance.now() - reqStart).toFixed(2);
            const body = await res.json().catch(() => ({}));
            return {
                requestNum: index + 1,
                status: res.status,
                elapsedMs: reqElapsed,
                remaining: res.headers.get('x-ratelimit-remaining'),
                retryAfter: res.headers.get('retry-after'),
                body,
            };
        });
    });

    const responses = await Promise.all(requestPromises);
    const duration = (performance.now() - start).toFixed(2);

    console.log(`All 10 requests completed in ${duration}ms\n`);

    // 3. Tabulate all 10 responses with individual timing and error bodies
    console.log('================================================================');
    console.log('REQ # | STATUS | ELAPSED MS | REMAINING | OUTCOME');
    console.log('------|--------|------------|-----------|-----------------------');

    let passed201Count = 0;
    let blocked429Count = 0;

    for (const r of responses) {
        const is201 = r.status === 201;
        const is429 = r.status === 429;
        if (is201) passed201Count++;
        if (is429) blocked429Count++;

        const outcome = is201
            ? '✅ ALLOWED (201)'
            : is429
            ? `🛑 BLOCKED (429, Retry-After: ${r.retryAfter}s)`
            : `❌ UNEXPECTED (${r.status})`;

        console.log(
            `#${String(r.requestNum).padEnd(4)} | ${String(r.status).padEnd(6)} | ${String(r.elapsedMs + 'ms').padEnd(10)} | ${String(r.remaining || '-').padEnd(9)} | ${outcome}`
        );

        if (!is201) {
            console.log(`       └─ Full JSON Body: ${JSON.stringify(r.body)}`);
        }
    }

    console.log('================================================================');
    console.log(`SUMMARY: Exactly 5 Passed (${passed201Count}/5) | Exactly 5 Blocked (${blocked429Count}/5)`);
    console.log('================================================================\n');

    if (passed201Count === 5 && blocked429Count === 5) {
        console.log('✅ PASS: Atomic Lua script rate limiter has ZERO race conditions!');
        console.log('   Under concurrent load, exactly 5 requests succeeded and exactly 5 were blocked.\n');
    } else {
        console.error(`❌ FAIL: Expected 5 allowed and 5 blocked, but got ${passed201Count} allowed and ${blocked429Count} blocked.\n`);
    }

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

runT6().catch((e) => {
    console.error('T6 Error:', e);
    process.exit(1);
});
