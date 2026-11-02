import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { Role } from '@prisma/client';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import * as authService from '../src/services/auth.service.js';
import { ConflictError } from '../src/errors/AppError.js';
import { del } from '../src/cache/cache.js';
import { createTestUser, createTestMenuItem } from './helpers/factories.js';

// Mock BullMQ enqueueOrder so background worker is not needed
vi.mock('../src/queues/kitchen.queue.js', () => ({
    enqueueOrder: vi.fn().mockResolvedValue({ id: 'mock-kitchen-job-id' }),
}));

// Mock Socket.io status emit
vi.mock('../src/realtime/emitOrderStatus.js', () => ({
    emitOrderStatus: vi.fn().mockResolvedValue(undefined),
}));

describe('Error Handler & Rate Limiter Suite', () => {
    let studentToken: string;
    let studentUserId: string;
    let menuItemId: string;
    const createdUserIds: string[] = [];
    const createdMenuItemIds: string[] = [];
    const createdOrderIds: string[] = [];

    beforeAll(async () => {
        const student = await createTestUser(Role.STUDENT);
        studentToken = student.token;
        studentUserId = student.user.id;
        createdUserIds.push(student.user.id);

        const item = await createTestMenuItem({ stockCount: 100 });
        menuItemId = item.id;
        createdMenuItemIds.push(item.id);
    });

    afterAll(async () => {
        // Reset rate limit environment variable back to generous default
        process.env.ORDER_RATE_LIMIT_MAX = '1000';

        // Clean up Redis rate limit key for this test student
        if (studentUserId) {
            await del(`ratelimit:orders:${studentUserId}`);
        }

        // Clean up database records
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

    it('Malformed JSON payload returns 400 with "Invalid JSON"', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .set('Content-Type', 'application/json')
            .send('{ "email": "test@test.com", "password": '); // Broken unclosed JSON string

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
            message: 'Invalid JSON',
        });
    });

    it('Zod validation failure returns 400 with formatted issues list', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                name: '',               // Empty name (min 2 chars required)
                email: 'not-an-email',   // Invalid email format
                password: '123',         // Short password (min 6 chars required)
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Validation failed');
        expect(Array.isArray(res.body.errors)).toBe(true);
        expect(res.body.errors.length).toBeGreaterThanOrEqual(3);

        const fields = res.body.errors.map((e: { field: string }) => e.field);
        expect(fields).toContain('name');
        expect(fields).toContain('email');
        expect(fields).toContain('password');
    });

    it('Thrown AppError subclass produces expected status code and structured body', async () => {
        // Spy on authService.loginUser to throw an AppError subclass without adding test routes in src
        const spy = vi.spyOn(authService, 'loginUser').mockImplementationOnce(async () => {
            throw new ConflictError('Simulated resource conflict', { conflictField: 'customId' });
        });

        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: 'test@example.com',
                password: 'password123',
            });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
            message: 'Simulated resource conflict',
            details: { conflictField: 'customId' },
        });

        spy.mockRestore();
    });

    it('Unknown server error returns generic 500 without leaking stack trace or file paths', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const spy = vi.spyOn(authService, 'loginUser').mockImplementationOnce(async () => {
            throw new Error('FATAL: Internal DB failure at /home/user/app/src/secret.ts:123');
        });

        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: 'test@example.com',
                password: 'password123',
            });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({
            message: 'Internal server error',
        });

        // Verify no sensitive file paths or internal error details leaked to client
        const rawBody = JSON.stringify(res.body);
        expect(rawBody).not.toMatch(/secret\.ts/);
        expect(rawBody).not.toMatch(/FATAL/);
        expect(rawBody).not.toMatch(/stack/);

        spy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it('Rate limiter: 6th order in the window returns 429 with Retry-After header', async () => {
        // Lower rate limit to exactly 5 orders per 60 seconds for this test
        process.env.ORDER_RATE_LIMIT_MAX = '5';
        process.env.ORDER_RATE_LIMIT_WINDOW_SECONDS = '60';

        // Clear any previous rate limit key for this user
        await del(`ratelimit:orders:${studentUserId}`);

        // Place 5 successful orders within the rate limit window
        for (let i = 1; i <= 5; i++) {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${studentToken}`)
                .send({
                    items: [{ menuItemId, quantity: 1 }],
                });

            expect(res.status).toBe(201);
            createdOrderIds.push(res.body.data.id);
            expect(res.headers['x-ratelimit-limit']).toBe('5');
            expect(res.headers['x-ratelimit-remaining']).toBe(String(5 - i));
        }

        // 6th order exceeds the rate limit threshold -> must return 429
        const blockedRes = await request(app)
            .post('/api/orders')
            .set('Authorization', `Bearer ${studentToken}`)
            .send({
                items: [{ menuItemId, quantity: 1 }],
            });

        expect(blockedRes.status).toBe(429);
        expect(blockedRes.body.error).toBe('Too Many Requests');
        expect(blockedRes.body.message).toMatch(/Order rate limit exceeded/);
        expect(blockedRes.headers['retry-after']).toBeDefined();
        expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
        expect(blockedRes.headers['x-ratelimit-remaining']).toBe('0');
    });
});
