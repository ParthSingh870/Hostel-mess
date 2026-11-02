import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Role } from '@prisma/client';
import app from '../src/app.js';
import prisma from '../src/config/prisma.js';
import { del, MENU_CACHE_KEY } from '../src/cache/cache.js';
import { createTestUser, createTestMenuItem } from './helpers/factories.js';

describe('RBAC & Menu Management Suite', () => {
    let studentToken: string;
    let staffToken: string;
    const createdUserIds: string[] = [];
    const createdMenuItemIds: string[] = [];

    beforeAll(async () => {
        // Clear cached menu before running tests
        await del(MENU_CACHE_KEY);

        // Seed 1 Student and 1 Staff user for authorization testing
        const student = await createTestUser(Role.STUDENT);
        const staff = await createTestUser(Role.STAFF);

        studentToken = student.token;
        staffToken = staff.token;

        createdUserIds.push(student.user.id, staff.user.id);
    });

    afterAll(async () => {
        // Clear cached menu after tests
        await del(MENU_CACHE_KEY);

        // Clean up created menu items
        if (createdMenuItemIds.length > 0) {
            await prisma.menuItem.deleteMany({
                where: { id: { in: createdMenuItemIds } },
            });
        }

        // Clean up created users
        if (createdUserIds.length > 0) {
            await prisma.refreshToken.deleteMany({
                where: { userId: { in: createdUserIds } },
            });
            await prisma.user.deleteMany({
                where: { id: { in: createdUserIds } },
            });
        }
    });

    it('STUDENT receives 403 Forbidden on staff/admin menu routes', async () => {
        const dummyItem = await createTestMenuItem();
        createdMenuItemIds.push(dummyItem.id);

        // 1. Student attempts POST /api/menu
        const postRes = await request(app)
            .post('/api/menu')
            .set('Authorization', `Bearer ${studentToken}`)
            .send({
                name: 'Unauthorized Item',
                price: 100,
                category: 'Snacks',
                stockCount: 10,
            });
        expect(postRes.status).toBe(403);
        expect(postRes.body.message).toBe(
            'Forbidden: You do not have permission to access this resource'
        );

        // 2. Student attempts PATCH /api/menu/:id
        const patchRes = await request(app)
            .patch(`/api/menu/${dummyItem.id}`)
            .set('Authorization', `Bearer ${studentToken}`)
            .send({ price: 150 });
        expect(patchRes.status).toBe(403);
        expect(patchRes.body.message).toBe(
            'Forbidden: You do not have permission to access this resource'
        );

        // 3. Student attempts DELETE /api/menu/:id
        const deleteRes = await request(app)
            .delete(`/api/menu/${dummyItem.id}`)
            .set('Authorization', `Bearer ${studentToken}`);
        expect(deleteRes.status).toBe(403);
        expect(deleteRes.body.message).toBe(
            'Forbidden: You do not have permission to access this resource'
        );
    });

    it('STAFF can create, update, and delete menu items', async () => {
        // 1. Staff creates a new menu item
        const createRes = await request(app)
            .post('/api/menu')
            .set('Authorization', `Bearer ${staffToken}`)
            .send({
                name: 'Chole Bhature',
                description: 'Authentic Punjabi Chole Bhature',
                price: 80,
                category: 'Breakfast',
                stockCount: 15,
            });
        expect(createRes.status).toBe(201);
        expect(createRes.body.name).toBe('Chole Bhature');
        expect(createRes.body.price).toBe(80);
        expect(createRes.body.stockCount).toBe(15);
        expect(createRes.body.isAvailable).toBe(true);

        const itemId = createRes.body.id;
        createdMenuItemIds.push(itemId);

        // 2. Staff updates the menu item
        const updateRes = await request(app)
            .patch(`/api/menu/${itemId}`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({
                name: 'Special Chole Bhature',
                price: 90,
            });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.name).toBe('Special Chole Bhature');
        expect(updateRes.body.price).toBe(90);

        // 3. Staff soft-deletes the menu item
        const deleteRes = await request(app)
            .delete(`/api/menu/${itemId}`)
            .set('Authorization', `Bearer ${staffToken}`);
        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body.message).toBe('Menu item deactivated successfully');
        expect(deleteRes.body.item.isAvailable).toBe(false);
    });

    it('PATCH with only price keeps stockCount unchanged', async () => {
        const item = await createTestMenuItem({
            name: 'Masala Dosa',
            price: 70,
            stockCount: 35,
        });
        createdMenuItemIds.push(item.id);

        const patchRes = await request(app)
            .patch(`/api/menu/${item.id}`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ price: 85 });

        expect(patchRes.status).toBe(200);
        expect(patchRes.body.price).toBe(85);
        expect(patchRes.body.stockCount).toBe(35);

        // Verify direct in database to ensure partial update did not reset stock
        const freshDbItem = await prisma.menuItem.findUnique({ where: { id: item.id } });
        expect(freshDbItem?.price).toBe(85);
        expect(freshDbItem?.stockCount).toBe(35);
    });

    it('Soft-delete hides item from GET /api/menu while keeping it in the database', async () => {
        const item = await createTestMenuItem({
            name: 'Seasonal Mango Lassi',
            price: 50,
            stockCount: 10,
            isAvailable: true,
        });
        createdMenuItemIds.push(item.id);

        // Deactivate via DELETE endpoint
        const delRes = await request(app)
            .delete(`/api/menu/${item.id}`)
            .set('Authorization', `Bearer ${staffToken}`);
        expect(delRes.status).toBe(200);

        // Query available menu items
        const getRes = await request(app).get('/api/menu');
        expect(getRes.status).toBe(200);

        const foundInGet = getRes.body.some((m: { id: string }) => m.id === item.id);
        expect(foundInGet).toBe(false);

        // Direct DB verification: record still exists with isAvailable = false
        const dbItem = await prisma.menuItem.findUnique({ where: { id: item.id } });
        expect(dbItem).not.toBeNull();
        expect(dbItem?.isAvailable).toBe(false);
    });

    it('PATCH and DELETE return 404 for nonexistent item id', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';

        const patchRes = await request(app)
            .patch(`/api/menu/${nonExistentId}`)
            .set('Authorization', `Bearer ${staffToken}`)
            .send({ price: 100 });
        expect(patchRes.status).toBe(404);
        expect(patchRes.body.message).toBe('Menu item not found');

        const deleteRes = await request(app)
            .delete(`/api/menu/${nonExistentId}`)
            .set('Authorization', `Bearer ${staffToken}`);
        expect(deleteRes.status).toBe(404);
        expect(deleteRes.body.message).toBe('Menu item not found');
    });
});
