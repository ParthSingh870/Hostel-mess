// tests-manual/test_complete_endpoint.ts
import express from 'express';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import prisma from '../src/config/prisma.js';
import orderRoutes from '../src/routes/order.routes.js';
import { createOrder } from '../src/services/order.service.js';
import { kitchenQueue } from '../src/queues/kitchen.queue.js';
import { redisConnection } from '../src/config/redis.js';
import { Role, OrderStatus } from '@prisma/client';
import crypto from 'crypto';

const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Helper to generate test JWT token
const signToken = (userId: string, role: Role) => {
    return jwt.sign(
        { userId, role, email: `${role.toLowerCase()}@test.com` },
        process.env.JWT_SECRET || 'testsecret',
        { expiresIn: '1h' }
    );
};

async function testCompleteEndpoint() {
    console.log('--- SLICE S6 MANUAL TEST: PATCH /api/orders/:id/complete Endpoint ---');

    // Start a dedicated lightweight test server
    const app = express();
    app.use(express.json());
    app.use('/api/orders', orderRoutes);

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(TEST_PORT, () => resolve()));
    console.log(`Test server temporarily listening on port ${TEST_PORT}`);

    try {
        // 1. Setup Student, Staff, and Menu Item
        let student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
        if (!student) {
            student = await prisma.user.create({
                data: {
                    name: 'Test Student',
                    email: `student-${crypto.randomUUID().slice(0, 6)}@test.com`,
                    password: 'Password123!',
                    role: 'STUDENT',
                },
            });
        }

        let staff = await prisma.user.findFirst({ where: { role: 'STAFF' } });
        if (!staff) {
            staff = await prisma.user.create({
                data: {
                    name: 'Test Staff',
                    email: `staff-${crypto.randomUUID().slice(0, 6)}@test.com`,
                    password: 'Password123!',
                    role: 'STAFF',
                },
            });
        }

        let menuItem = await prisma.menuItem.findFirst({
            where: { isAvailable: true, stockCount: { gte: 5 } },
        });
        if (!menuItem) {
            menuItem = await prisma.menuItem.create({
                data: {
                    name: `Complete Test Item ${crypto.randomUUID().slice(0, 4)}`,
                    description: 'Testing complete endpoint',
                    price: 110,
                    stockCount: 20,
                    isAvailable: true,
                    category: 'LUNCH',
                },
            });
        }

        const studentToken = signToken(student.id, Role.STUDENT);
        const staffToken = signToken(staff.id, Role.STAFF);

        // Create an order for testing
        const order = await createOrder(student.id, {
            items: [{ menuItemId: menuItem.id, quantity: 1 }],
        });
        console.log(`\nCreated test order ${order.id} with status "${order.status}"`);

        // TEST 1: Unauthenticated request should fail (401)
        console.log('\n--- TEST 1: Unauthenticated request ---');
        const res1 = await fetch(`${BASE_URL}/api/orders/${order.id}/complete`, { method: 'PATCH' });
        console.log(`Status: ${res1.status} (Expected: 401)`);
        if (res1.status === 401) console.log('✅ PASS: Unauthorized request rejected.');

        // TEST 2: Student role should fail RBAC check (403)
        console.log('\n--- TEST 2: Student tries to mark order as COMPLETED ---');
        const res2 = await fetch(`${BASE_URL}/api/orders/${order.id}/complete`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${studentToken}` },
        });
        console.log(`Status: ${res2.status} (Expected: 403)`);
        if (res2.status === 403) console.log('✅ PASS: Student forbidden from completing orders.');

        // TEST 3: Staff tries to complete order when status is PLACED (Should fail 400)
        console.log('\n--- TEST 3: Staff tries to complete order while still PLACED ---');
        const res3 = await fetch(`${BASE_URL}/api/orders/${order.id}/complete`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${staffToken}` },
        });
        const data3: any = await res3.json();
        console.log(`Status: ${res3.status} (Expected: 400) | Message: ${data3.message}`);
        if (res3.status === 400 && data3.message?.includes('Invalid status transition')) {
            console.log('✅ PASS: Cannot transition PLACED directly to COMPLETED!');
        }

        // Advance status to READY (representing worker finishing preparation)
        await prisma.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.READY },
        });
        console.log(`\nOrder ${order.id} status updated to "READY" in DB.`);

        // TEST 4: Staff completes order when status is READY (Should pass 200)
        console.log('\n--- TEST 4: Staff completes order when status is READY ---');
        const res4 = await fetch(`${BASE_URL}/api/orders/${order.id}/complete`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${staffToken}` },
        });
        const data4: any = await res4.json();
        console.log(`Status: ${res4.status} (Expected: 200) | Status in DB: ${data4.data?.status}`);
        if (res4.status === 200 && data4.data?.status === OrderStatus.COMPLETED) {
            console.log('✅ PASS: Order successfully completed!');
        }

        // TEST 5: Staff tries to complete already COMPLETED order (Should fail 400)
        console.log('\n--- TEST 5: Staff tries to complete already COMPLETED order ---');
        const res5 = await fetch(`${BASE_URL}/api/orders/${order.id}/complete`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${staffToken}` },
        });
        const data5: any = await res5.json();
        console.log(`Status: ${res5.status} (Expected: 400) | Message: ${data5.message}`);
        if (res5.status === 400 && data5.message?.includes('Invalid status transition')) {
            console.log('✅ PASS: Cannot complete an already completed order.');
        }

    } catch (err: any) {
        console.error('Test Error:', err.message);
    } finally {
        server.close();
        await kitchenQueue.close();
        await redisConnection.quit();
        await prisma.$disconnect();
        console.log('\n--- SLICE S6 TEST FINISHED ---');
        process.exit(0);
    }
}

testCompleteEndpoint();

