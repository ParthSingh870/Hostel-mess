// tests-manual/test_insufficient_stock_400.ts
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';
import { closeCacheConnection } from '../src/cache/cache.js';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const signToken = (userId: string) =>
    jwt.sign({ userId, role: 'STUDENT' }, JWT_SECRET, { expiresIn: '15m' });

async function run() {
    console.log('================================================================');
    console.log(' TEST 4: INSUFFICIENT STOCK RETURNS 400 (NOT 503) ON CONCURRENCY');
    console.log('================================================================\n');

    // 1. Setup 2 different students
    const student1 = await prisma.user.create({
        data: {
            name: 'Student Stock 1',
            email: `student_stock1_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const token1 = signToken(student1.id);

    const student2 = await prisma.user.create({
        data: {
            name: 'Student Stock 2',
            email: `student_stock2_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const token2 = signToken(student2.id);

    // 2. Setup MenuItem with stockCount = 1
    const testItem = await prisma.menuItem.create({
        data: {
            name: `Limited Meal ${crypto.randomUUID().slice(0, 4)}`,
            price: 70,
            stockCount: 1, // Only 1 available!
            isAvailable: true,
            category: 'LUNCH',
        },
    });

    console.log(`[Setup] Item Created: "${testItem.name}" with stockCount = 1`);
    console.log(`[Setup] Student 1 ID: ${student1.id}`);
    console.log(`[Setup] Student 2 ID: ${student2.id}\n`);

    console.log('--- Firing 2 Concurrent Orders for Qty 1 Each ---');

    const p1 = fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token1}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: testItem.id, quantity: 1 }],
        }),
    }).then(async (r) => ({
        student: 'Student 1',
        status: r.status,
        body: await r.json().catch(() => ({})),
    }));

    const p2 = fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token2}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: testItem.id, quantity: 1 }],
        }),
    }).then(async (r) => ({
        student: 'Student 2',
        status: r.status,
        body: await r.json().catch(() => ({})),
    }));

    const [res1, res2] = await Promise.all([p1, p2]);

    console.log('\n--- RESULTS ---');
    console.log(`${res1.student} -> Status: ${res1.status} | Body:`, JSON.stringify(res1.body));
    console.log(`${res2.student} -> Status: ${res2.status} | Body:`, JSON.stringify(res2.body));

    const statuses = [res1.status, res2.status].sort();
    const has201 = statuses.includes(201);
    const has400 = statuses.includes(400);

    const errorRes = res1.status === 400 ? res1 : res2;
    const isInsufficientStock = errorRes.body?.message?.includes('Insufficient stock');

    console.log('\n================================================================');
    if (has201 && has400 && isInsufficientStock) {
        console.log('✅ PASS: Exactly one order got 201 Created and one got 400 Bad Request!');
        console.log(`   400 Error Message: "${errorRes.body?.message}"`);
        console.log('   Confirmed: Business error returned 400 (NOT 503, NOT 500).\n');
    } else {
        console.error('❌ FAIL: Expected one 201 and one 400 with "Insufficient stock", but got:', statuses);
    }
    console.log('================================================================');

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

run().catch((e) => {
    console.error('Error:', e);
    process.exit(1);
});
