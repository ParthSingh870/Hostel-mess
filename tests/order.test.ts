import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { Role } from '@prisma/client';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { createTestUser, createTestMenuItem } from './helpers/factories.js';

// Mock BullMQ enqueueOrder so background workers are not needed during test execution
vi.mock('../src/queues/kitchen.queue.js', () => ({
    enqueueOrder: vi.fn().mockResolvedValue({ id: 'mock-kitchen-job-id' }),
}));

// Mock Socket.io status emit so tests do not depend on active socket client subscribers
vi.mock('../src/realtime/emitOrderStatus.js', () => ({
    emitOrderStatus: vi.fn().mockResolvedValue(undefined),
}));

describe('Orders Suite - Stock Decrement & Concurrency Control', () => {
    const createdUserIds: string[] = [];
    const createdMenuItemIds: string[] = [];

    afterAll(async () => {
        // Clean up database records created during orders testing
        if (createdUserIds.length > 0) {
            await prisma.orderItem.deleteMany({
                where: { order: { userId: { in: createdUserIds } } },
            });
            await prisma.order.deleteMany({
                where: { userId: { in: createdUserIds } },
            });
            await prisma.refreshToken.deleteMany({
                where: { userId: { in: createdUserIds } },
            });
            await prisma.user.deleteMany({
                where: { id: { in: createdUserIds } },
            });
        }

        if (createdMenuItemIds.length > 0) {
            await prisma.menuItem.deleteMany({
                where: { id: { in: createdMenuItemIds } },
            });
        }
    });

    it('A successful order decrements inventory stock accurately', async () => {
        const student = await createTestUser(Role.STUDENT);
        createdUserIds.push(student.user.id);

        const item = await createTestMenuItem({
            name: 'Thali Special',
            price: 150,
            stockCount: 10,
        });
        createdMenuItemIds.push(item.id);

        // Student places order for 2 units
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${student.token}`)
            .send({
                items: [{ menuItemId: item.id, quantity: 2 }],
            });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe('Order placed successfully');
        expect(res.body.data.totalPrice).toBe(300);
        expect(res.body.data.status).toBe('PLACED');
        expect(res.body.data.items).toHaveLength(1);

        // Verify stock in database was decremented by 2
        const updatedItem = await prisma.menuItem.findUnique({ where: { id: item.id } });
        expect(updatedItem?.stockCount).toBe(8);
    });

    it('Order with insufficient stock returns 400 and keeps stock completely unchanged', async () => {
        const student = await createTestUser(Role.STUDENT);
        createdUserIds.push(student.user.id);

        const item = await createTestMenuItem({
            name: 'Limited Sweet Dish',
            price: 50,
            stockCount: 3,
        });
        createdMenuItemIds.push(item.id);

        // Attempt to order 5 units when only 3 are in stock
        const res = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${student.token}`)
            .send({
                items: [{ menuItemId: item.id, quantity: 5 }],
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Insufficient stock/);

        // Verify stock in database remains exactly 3
        const unchangedItem = await prisma.menuItem.findUnique({ where: { id: item.id } });
        expect(unchangedItem?.stockCount).toBe(3);
    });

    it('Concurrency race: 2 simultaneous orders against stockCount = 1 yield exactly one 201 and one 400', async () => {
        // Seed two independent student accounts
        const studentA = await createTestUser(Role.STUDENT);
        const studentB = await createTestUser(Role.STUDENT);
        createdUserIds.push(studentA.user.id, studentB.user.id);

        // Seed an item with exactly 1 unit of stock
        const scarceItem = await createTestMenuItem({
            name: 'Last Available Plate',
            price: 120,
            stockCount: 1,
        });
        createdMenuItemIds.push(scarceItem.id);

        // Fire both HTTP requests simultaneously at the same instant
        const [resA, resB] = await Promise.all([
            request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${studentA.token}`)
                .send({
                    items: [{ menuItemId: scarceItem.id, quantity: 1 }],
                }),
            request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${studentB.token}`)
                .send({
                    items: [{ menuItemId: scarceItem.id, quantity: 1 }],
                }),
        ]);

        const statuses = [resA.status, resB.status].sort();

        // Exactly one order must succeed (201) and exactly one must fail (400)
        expect(statuses).toEqual([201, 400]);

        const winningResponse = resA.status === 201 ? resA : resB;
        const losingResponse = resA.status === 400 ? resA : resB;

        expect(winningResponse.body.message).toBe('Order placed successfully');
        expect(losingResponse.body.message).toMatch(/Insufficient stock/);

        // Verify final inventory stock in Neon database is exactly 0 (never negative)
        const finalItem = await prisma.menuItem.findUnique({ where: { id: scarceItem.id } });
        expect(finalItem?.stockCount).toBe(0);

        // Verify exactly one order record was created in the database for this item
        const orderCount = await prisma.orderItem.count({
            where: { menuItemId: scarceItem.id },
        });
        expect(orderCount).toBe(1);
    });
});
