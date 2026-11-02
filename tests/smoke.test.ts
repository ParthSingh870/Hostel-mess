import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Smoke Tests - Health & Undefined Routes', () => {
    it('GET /health returns 200 and healthy status for server and Neon DB', async () => {
        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            status: 'ok',
            message: 'Server and Neon DB are healthy',
        });
    });

    it('GET /api/undefined-endpoint returns 404 with NotFoundError shape', async () => {
        const response = await request(app).get('/api/undefined-endpoint');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({
            message: 'Route not found',
        });
    });
});
