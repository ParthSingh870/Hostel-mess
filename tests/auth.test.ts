import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { generateUniqueEmail, generateExpiredToken } from './helpers/factories.js';

describe('Auth Flow - Register, Login, Refresh, Logout, and Token Guard', () => {
    const createdUserIds: string[] = [];

    afterAll(async () => {
        if (createdUserIds.length > 0) {
            // Clean up test refresh tokens and users from the test database
            await prisma.refreshToken.deleteMany({
                where: { userId: { in: createdUserIds } },
            });
            await prisma.user.deleteMany({
                where: { id: { in: createdUserIds } },
            });
        }
    });

    it('POST /api/auth/register ignores role in body and creates a STUDENT account', async () => {
        const email = generateUniqueEmail('reg-role');
        const payload = {
            name: 'Role Exploit Attempt',
            email,
            password: 'password123',
            role: 'ADMIN', // Attacker attempts privilege escalation
        };

        const res = await request(app).post('/api/auth/register').send(payload);

        expect(res.status).toBe(201);
        expect(res.body.message).toBe('User registered successfully');
        expect(res.body.data.role).toBe('STUDENT');
        expect(res.body.data.email).toBe(email);

        createdUserIds.push(res.body.data.id);

        // Verify direct database record to guarantee role was not persisted as ADMIN
        const dbUser = await prisma.user.findUnique({ where: { id: res.body.data.id } });
        expect(dbUser?.role).toBe('STUDENT');
    });

    it('POST /api/auth/register returns 409 Conflict for duplicate email', async () => {
        const email = generateUniqueEmail('reg-dupe');
        const payload = {
            name: 'First User',
            email,
            password: 'password123',
        };

        // First registration succeeds
        const firstRes = await request(app).post('/api/auth/register').send(payload);
        expect(firstRes.status).toBe(201);
        createdUserIds.push(firstRes.body.data.id);

        // Second registration with identical email must be rejected with 409
        const secondRes = await request(app).post('/api/auth/register').send(payload);
        expect(secondRes.status).toBe(409);
        expect(secondRes.body.message).toBe('User already exists with this email');
    });

    it('POST /api/auth/login authenticates valid credentials and returns token pair', async () => {
        const email = generateUniqueEmail('login');
        const password = 'password123';

        const regRes = await request(app).post('/api/auth/register').send({
            name: 'Login Test User',
            email,
            password,
        });
        createdUserIds.push(regRes.body.data.id);

        const loginRes = await request(app).post('/api/auth/login').send({
            email,
            password,
        });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.message).toBe('Login successful');
        expect(loginRes.body.data.accessToken).toBeDefined();
        expect(loginRes.body.data.refreshToken).toBeDefined();
        expect(loginRes.body.data.user.email).toBe(email);
    });

    it('POST /api/auth/refresh exchanges a valid refresh token for a new access token', async () => {
        const email = generateUniqueEmail('refresh');
        const password = 'password123';

        const regRes = await request(app).post('/api/auth/register').send({
            name: 'Refresh Test User',
            email,
            password,
        });
        createdUserIds.push(regRes.body.data.id);

        const loginRes = await request(app).post('/api/auth/login').send({ email, password });
        const refreshToken = loginRes.body.data.refreshToken;

        const refreshRes = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken });

        expect(refreshRes.status).toBe(200);
        expect(refreshRes.body.message).toBe('Access token refreshed successfully');
        expect(refreshRes.body.data.accessToken).toBeDefined();
    });

    it('POST /api/auth/logout revokes refresh token, and subsequent refresh fails with 401', async () => {
        const email = generateUniqueEmail('logout');
        const password = 'password123';

        const regRes = await request(app).post('/api/auth/register').send({
            name: 'Logout Test User',
            email,
            password,
        });
        createdUserIds.push(regRes.body.data.id);

        const loginRes = await request(app).post('/api/auth/login').send({ email, password });
        const refreshToken = loginRes.body.data.refreshToken;

        // Logout and revoke token
        const logoutRes = await request(app)
            .post('/api/auth/logout')
            .send({ refreshToken });
        expect(logoutRes.status).toBe(200);
        expect(logoutRes.body.message).toBe('Logged out successfully');

        // Attempting to refresh with the revoked token must fail with 401
        const staleRefreshRes = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken });
        expect(staleRefreshRes.status).toBe(401);
        expect(staleRefreshRes.body.message).toBe('Invalid or revoked refresh token');
    });

    it('Protected route rejects missing and invalid tokens with 401', async () => {
        // 1. Missing Authorization header
        const missingRes = await request(app).get('/api/auth/profile');
        expect(missingRes.status).toBe(401);
        expect(missingRes.body.message).toBe('Unauthorized: Token missing');

        // 2. Invalid / garbage token
        const invalidRes = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', 'Bearer invalid.token.value');
        expect(invalidRes.status).toBe(401);
        expect(invalidRes.body.message).toBe('Unauthorized: Invalid or expired token');
    });

    it('Protected route rejects expired token with 401', async () => {
        const email = generateUniqueEmail('expired');
        const password = 'password123';

        const regRes = await request(app).post('/api/auth/register').send({
            name: 'Expired Test User',
            email,
            password,
        });
        const userId = regRes.body.data.id;
        createdUserIds.push(userId);

        // Sign a token with 1ms expiration and wait 50ms so it is reliably expired
        const expiredToken = generateExpiredToken(userId, 'STUDENT');
        await new Promise((resolve) => setTimeout(resolve, 50));

        const res = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', `Bearer ${expiredToken}`);

        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Unauthorized: Invalid or expired token');
    });
});
