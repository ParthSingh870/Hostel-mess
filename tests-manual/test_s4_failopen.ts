// tests-manual/test_s4_failopen.ts
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const signToken = (userId: string, role = 'STUDENT') =>
    jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '15m' });

async function runS4FailOpenTest() {
    console.log('================================================================');
    console.log('       MANUAL TEST S4 (e): REDIS DOWN FAIL-OPEN RESILIENCE      ');
    console.log('================================================================\n');

    // 1. Setup Student and Menu Item
    const student = await prisma.user.create({
        data: {
            name: 'Student S4 FailOpen',
            email: `student_failopen_${crypto.randomUUID().slice(0, 6)}@test.com`,
            password: 'hash',
            role: 'STUDENT',
        },
    });
    const token = signToken(student.id, 'STUDENT');

    const testItem = await prisma.menuItem.create({
        data: {
            name: `FailOpen Meal ${crypto.randomUUID().slice(0, 4)}`,
            price: 60,
            stockCount: 15,
            isAvailable: true,
            category: 'DINNER',
        },
    });

    console.log(`[Setup] Created student: ${student.email}`);
    console.log(`[Setup] Created item: "${testItem.name}" (ID: ${testItem.id})\n`);

    // 2. Test GET /api/menu when Redis is stopped
    console.log('--- Step 1: Testing GET /api/menu (Redis Down Fail-Open) ---');
    const menuStart = performance.now();
    const menuRes = await fetch(`${BASE_URL}/api/menu`);
    const menuDuration = (performance.now() - menuStart).toFixed(2);
    const menuData = await menuRes.json();

    console.log(`GET /api/menu -> Status: ${menuRes.status} (Expected: 200)`);
    console.log(`GET /api/menu -> X-Cache Header: ${menuRes.headers.get('x-cache')} (Expected: MISS)`);
    console.log(`GET /api/menu -> Response Time: ${menuDuration}ms`);
    console.log(`GET /api/menu -> Items count: ${Array.isArray(menuData) ? menuData.length : 0}`);

    if (menuRes.status === 200) {
        console.log('✅ GET /api/menu succeeded and served from Postgres.\n');
    } else {
        console.error('❌ GET /api/menu failed when Redis is down.');
    }

    // 3. Test POST /api/orders when Redis is stopped
    console.log('--- Step 2: Testing POST /api/orders (Rate Limiter Fail-Open) ---');
    const orderStart = performance.now();
    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            items: [{ menuItemId: testItem.id, quantity: 1 }],
        }),
    });
    const orderDuration = (performance.now() - orderStart).toFixed(2);
    const orderData = await orderRes.json();

    console.log(`POST /api/orders -> Status: ${orderRes.status} (Expected: 201)`);
    console.log(`POST /api/orders -> Response Time: ${orderDuration}ms`);
    console.log(`POST /api/orders -> Order ID: ${orderData.data?.id}`);

    if (orderRes.status === 201 && orderData.data?.id) {
        console.log('✅ POST /api/orders succeeded: Rate limiter failed open and allowed order.\n');
    } else {
        console.error('❌ POST /api/orders failed when Redis is down.');
    }

    console.log('================================================================');
    console.log('           ALL S4 (e) FAIL-OPEN CHECKS COMPLETED                ');
    console.log('================================================================');

    await prisma.$disconnect();
    process.exit(0);
}

runS4FailOpenTest().catch((err) => {
    console.error('S4 FailOpen Test Error:', err);
    process.exit(1);
});
