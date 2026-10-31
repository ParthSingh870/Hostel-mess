// tests-manual/test_t2_staff.ts
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../src/config/prisma.js';
import { closeCacheConnection, cacheRedisClient } from '../src/cache/cache.js';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const signStaffToken = (userId: string) =>
    jwt.sign({ userId, role: 'STAFF' }, JWT_SECRET, { expiresIn: '15m' });

async function runT2() {
    console.log('================================================================');
    console.log('  TEST T2: STAFF MENU UPDATE, SOFT-DELETE & CACHE INVALIDATION  ');
    console.log('================================================================\n');

    if (cacheRedisClient.status !== 'ready') {
        await Promise.race([
            new Promise((r) => cacheRedisClient.once('ready', r)),
            new Promise((r) => setTimeout(r, 1500)),
        ]);
    }

    // 1. Setup Staff User and Menu Item
    let staff = await prisma.user.findFirst({ where: { role: 'STAFF' } });
    if (!staff) {
        staff = await prisma.user.create({
            data: {
                name: 'Staff T2',
                email: `staff_t2_${crypto.randomUUID().slice(0, 6)}@test.com`,
                password: 'hash',
                role: 'STAFF',
            },
        });
    }
    const staffToken = signStaffToken(staff.id);

    const testItem = await prisma.menuItem.create({
        data: {
            name: `Paneer T2 ${crypto.randomUUID().slice(0, 4)}`,
            price: 110,
            stockCount: 30,
            isAvailable: true,
            category: 'DINNER',
        },
    });

    console.log(`[Setup] Created item: "${testItem.name}" (ID: ${testItem.id}, Price: 110, Stock: 30)`);
    console.log(`[Setup] Staff User ID: ${staff.id}\n`);

    // 2. Prime cache to warm HIT state
    console.log('--- Step 1: Prime Cache to HIT state ---');
    await fetch(`${BASE_URL}/api/menu`); // MISS (populates cache)
    const primeRes = await fetch(`${BASE_URL}/api/menu`);
    console.log(`GET /api/menu -> X-Cache Header: ${primeRes.headers.get('x-cache')}`);
    console.log('-> Cache is warm.\n');

    // 3. Staff updates item price from 110 to 145
    console.log('--- Step 2: Staff Updates Item Price (PATCH /api/menu/:id) ---');
    const updateRes = await fetch(`${BASE_URL}/api/menu/${testItem.id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ price: 145 }),
    });
    const updateData = await updateRes.json();
    console.log(`PATCH /api/menu/${testItem.id} -> Status: ${updateRes.status}`);
    console.log(`Updated price in DB response: ${updateData.price}\n`);

    // 4. Next GET /api/menu MUST be MISS with fresh price (145)
    console.log('--- Step 3: Immediate GET /api/menu after Update (Expect: MISS) ---');
    const getAfterUpdate = await fetch(`${BASE_URL}/api/menu`);
    const headerAfterUpdate = getAfterUpdate.headers.get('x-cache');
    const itemsAfterUpdate = await getAfterUpdate.json();
    const updatedFound = itemsAfterUpdate.find((i: any) => i.id === testItem.id);

    console.log(`GET /api/menu -> Status: ${getAfterUpdate.status}`);
    console.log(`GET /api/menu -> X-Cache Header: ${headerAfterUpdate} (Expected: MISS)`);
    console.log(`Fetched price of updated item: ${updatedFound?.price} (Expected: 145)`);

    if (headerAfterUpdate === 'MISS' && updatedFound?.price === 145) {
        console.log('✅ PASS: Next request is a cache MISS with fresh price.\n');
    } else {
        console.error('❌ FAIL: Expected MISS with price 145.\n');
    }

    // 5. Subsequent GET /api/menu MUST be HIT
    console.log('--- Step 4: Subsequent GET /api/menu (Expect: HIT) ---');
    const getSubsequent = await fetch(`${BASE_URL}/api/menu`);
    const headerSubsequent = getSubsequent.headers.get('x-cache');
    console.log(`GET /api/menu -> Status: ${getSubsequent.status}`);
    console.log(`GET /api/menu -> X-Cache Header: ${headerSubsequent} (Expected: HIT)`);

    if (headerSubsequent === 'HIT') {
        console.log('✅ PASS: Subsequent request is a cache HIT.\n');
    } else {
        console.error('❌ FAIL: Expected HIT.\n');
    }

    // 6. Soft-delete the item (DELETE /api/menu/:id)
    console.log('--- Step 5: Staff Soft-Deletes Item (DELETE /api/menu/:id) ---');
    const deleteRes = await fetch(`${BASE_URL}/api/menu/${testItem.id}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${staffToken}`,
        },
    });
    const deleteData = await deleteRes.json();
    console.log(`DELETE /api/menu/${testItem.id} -> Status: ${deleteRes.status}`);
    console.log(`Deactivated status in DB: isAvailable = ${deleteData.item?.isAvailable}\n`);

    // 7. Next GET /api/menu MUST be MISS and item must NOT exist
    console.log('--- Step 6: Next GET /api/menu after Soft-Delete (Expect: MISS & Item Vanished) ---');
    const getAfterDelete = await fetch(`${BASE_URL}/api/menu`);
    const headerAfterDelete = getAfterDelete.headers.get('x-cache');
    const itemsAfterDelete = await getAfterDelete.json();
    const deletedFound = itemsAfterDelete.find((i: any) => i.id === testItem.id);

    console.log(`GET /api/menu -> Status: ${getAfterDelete.status}`);
    console.log(`GET /api/menu -> X-Cache Header: ${headerAfterDelete} (Expected: MISS)`);
    console.log(`Item found in active menu: ${deletedFound ? 'YES (Error)' : 'NO (Correct, Vanished)'}`);

    if (headerAfterDelete === 'MISS' && !deletedFound) {
        console.log('✅ PASS: Cache was invalidated on soft-delete; item vanished from active menu.\n');
    } else {
        console.error('❌ FAIL: Soft-delete cache invalidation failed.\n');
    }

    console.log('================================================================');
    console.log('                  TEST T2 VERIFICATION COMPLETE                 ');
    console.log('================================================================');

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

runT2().catch((e) => {
    console.error('T2 Error:', e);
    process.exit(1);
});
