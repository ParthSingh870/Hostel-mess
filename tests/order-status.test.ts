import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { Role, OrderStatus } from '@prisma/client';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { createTestUser, createTestMenuItem } from './helpers/factories.js';

// Mock BullMQ enqueueOrder
vi.mock('../src/queues/kitchen.queue.js', () => ({
    enqueueOrder: vi.fn().mockResolvedValue({ id: 'mock-kitchen-job-id' }),
}));

// Mock Socket.io status emit
vi.mock('../src/realtime/emitOrderStatus.js', () => ({
    emitOrderStatus: vi.fn().mockResolvedValue(undefined),
}));

describe('Order Status Transitions & Double-Cancel Race', () => {
    let studentToken: string;
    let studentUserId: string;
    let staffToken: string;
    const createdUserIds: string[] = [];
    const createdMenuItemIds: string[] = [];
    const createdOrderIds: string[] = [];

    beforeAll(async () => {
        const student = await createTestUser(Role.STUDENT);
        const staff = await createTestUser(Role.STAFF);

        studentToken = student.token;
        studentUserId = student.user.id;
        staffToken = staff.token;

        createdUserIds.push(student.user.id, staff.user.id);
    });

    afterAll(async () => {
        if (createdOrderIds.length > 0) {
            await prisma.orderItem.deleteMany({
                where: { orderId: { in: createdOrderIds } },
            });
            await prisma.order.deleteMany({
                where: { id: { in: createdOrderIds } },
            });
        }

        if (createdMenuItemIds.length > 0) {
            await prisma.menuItem.deleteMany({
                where: { id: { in: createdMenuItemIds } },
            });
        }

        if (createdUserIds.length > 0) {
            await prisma.refreshToken.deleteMany({
                where: { userId: { in: createdUserIds } },
            });
            await prisma.user.deleteMany({
                where: { id: { in: createdUserIds } },
            });
        }
    });

    // Helper to create an order via the API
    const placeOrderHelper = async (menuItemId: string, quantity: number = 1) => {
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${studentToken}`)
            .send({ items: [{ menuItemId, quantity }] });
        createdOrderIds.push(res.body.data.id);
        return res.body.data;
    };

    it('Valid lifecycle path: PLACED -> PREPARING -> READY -> COMPLETED', async () => {
        const item = await createTestMenuItem({ stockCount: 10 });
        createdMenuItemIds.push(item.id);

        const order = await placeOrderHelper(item.id, 1);
        expect(order.status).toBe(OrderStatus.PLACED);

        // 1. PLACED -> PREPARING
        const prepRes = await request(app)
            .patch(`/api/orders/${order.id}/status`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ status: OrderStatus.PREPARING });
        expect(prepRes.status).toBe(200);
        expect(prepRes.body.data.status).toBe(OrderStatus.PREPARING);

        // 2. PREPARING -> READY
        const readyRes = await request(app)
            .patch(`/api/orders/${order.id}/status`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ status: OrderStatus.READY });
        expect(readyRes.status).toBe(200);
        expect(readyRes.body.data.status).toBe(OrderStatus.READY);

        // 3. READY -> COMPLETED (via /complete endpoint)
        const completeRes = await request(app)
            .patch(`/api/orders/${order.id}/complete`)
            .set('Authorization', `Bearer ${staffToken}`);
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.message).toBe('Order completed successfully');
        expect(completeRes.body.data.status).toBe(OrderStatus.COMPLETED);

        // Verify direct in database
        const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
        expect(dbOrder?.status).toBe(OrderStatus.COMPLETED);
    });

    it('Illegal status transitions are rejected with 400', async () => {
        const item = await createTestMenuItem({ stockCount: 10 });
        createdMenuItemIds.push(item.id);

        const order = await placeOrderHelper(item.id, 1);
        expect(order.status).toBe(OrderStatus.PLACED);

        // Illegal: PLACED -> COMPLETED directly (skipping PREPARING and READY)
        const illegalJump = await request(app)
            .patch(`/api/orders/${order.id}/status`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ status: OrderStatus.COMPLETED });
        expect(illegalJump.status).toBe(400);
        expect(illegalJump.body.message).toMatch(/Invalid status transition/);

        // Cancel order (valid: PLACED -> CANCELLED)
        const cancelRes = await request(app)
            .patch(`/api/orders/${order.id}/status`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ status: OrderStatus.CANCELLED });
        expect(cancelRes.status).toBe(200);

        // Illegal: CANCELLED is a terminal state, cannot move to PREPARING
        const afterTerminal = await request(app)
            .patch(`/api/orders/${order.id}/status`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ status: OrderStatus.PREPARING });
        expect(afterTerminal.status).toBe(400);
        expect(afterTerminal.body.message).toMatch(/Invalid status transition/);
    });

    it('Double-cancel race: two simultaneous cancellations yield one 200, one 409, and restore stock exactly once', async () => {
        const initialStock = 10;
        const orderQty = 2;

        const item = await createTestMenuItem({ stockCount: initialStock });
        createdMenuItemIds.push(item.id);

        // Place order: stock becomes 10 - 2 = 8
        const order = await placeOrderHelper(item.id, orderQty);

        const stockAfterOrder = await prisma.menuItem.findUnique({ where: { id: item.id } });
        expect(stockAfterOrder?.stockCount).toBe(initialStock - orderQty);

        // Fire 2 simultaneous cancel requests at the exact same millisecond
        const [cancel1, cancel2] = await Promise.all([
            request(app)
                .patch(`/api/orders/${order.id}/status`)
                .set('Authorization', `Bearer ${staffToken}`)
                .send({ status: OrderStatus.CANCELLED }),
            request(app)
                .patch(`/api/orders/${order.id}/status`)
                .set('Authorization', `Bearer ${staffToken}`)
                .send({ status: OrderStatus.CANCELLED }),
        ]);

        const statuses = [cancel1.status, cancel2.status].sort();

        // Exactly one cancellation must succeed (200) and the concurrent duplicate must fail (409)
        expect(statuses).toEqual([200, 409]);

        const winningCancel = cancel1.status === 200 ? cancel1 : cancel2;
        const losingCancel = cancel1.status === 409 ? cancel1 : cancel2;

        expect(winningCancel.body.data.status).toBe(OrderStatus.CANCELLED);
        expect(losingCancel.body.message).toMatch(/Order status was modified concurrently/);

        // Verify stock in database was restored EXACTLY ONCE (+2, not +4)
        const finalStockItem = await prisma.menuItem.findUnique({ where: { id: item.id } });
        expect(finalStockItem?.stockCount).toBe(initialStock);
    });

    it('PATCH /api/orders/:id/complete negative cases (wrong status, student 403, nonexistent 404)', async () => {
        const item = await createTestMenuItem({ stockCount: 5 });
        createdMenuItemIds.push(item.id);

        const order = await placeOrderHelper(item.id, 1);

        // 1. Wrong status: order is in PLACED status, cannot be completed directly
        const wrongStatusRes = await request(app)
            .patch(`/api/orders/${order.id}/complete`)
            .set('Authorization', `Bearer ${staffToken}`);
        expect(wrongStatusRes.status).toBe(400);
        expect(wrongStatusRes.body.message).toMatch(/Invalid status transition/);

        // 2. Student token: student attempts to mark order as complete -> 403
        const studentRes = await request(app)
            .patch(`/api/orders/${order.id}/complete`)
            .set('Authorization', `Bearer ${studentToken}`);
        expect(studentRes.status).toBe(403);
        expect(studentRes.body.message).toBe(
            'Forbidden: You do not have permission to access this resource'
        );

        // 3. Nonexistent order ID -> 404
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const notFoundRes = await request(app)
            .patch(`/api/orders/${nonExistentId}/complete`)
            .set('Authorization', `Bearer ${staffToken}`);
        expect(notFoundRes.status).toBe(404);
        expect(notFoundRes.body.message).toBe('Order not found');
    });
});
