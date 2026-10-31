// tests-manual/test_s2_menu_cache.ts
import 'dotenv/config';
import { del, MENU_CACHE_KEY, closeCacheConnection, cacheRedisClient } from '../src/cache/cache.js';
import prisma from '../src/config/prisma.js';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runS2Test() {
    console.log('================================================================');
    console.log('         MANUAL TEST S2: MENU CACHE HIT/MISS VERIFICATION       ');
    console.log('================================================================\n');

    // Wait up to 1.5s for Redis client readiness if needed
    if (cacheRedisClient.status !== 'ready') {
        console.log('Waiting for Redis client to be ready (status: ' + cacheRedisClient.status + ')...');
        await Promise.race([
            new Promise((resolve) => cacheRedisClient.once('ready', resolve)),
            new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
        console.log('Redis client status:', cacheRedisClient.status, '\n');
    }

    // Step 0: Ensure server is running and healthy
    try {
        const healthRes = await fetch(`${BASE_URL}/health`);
        const healthData = await healthRes.json().catch(() => ({}));
        if (!healthRes.ok) {
            console.error(`[ERROR] Health check failed with HTTP ${healthRes.status}:`, healthData);
            process.exit(1);
        }
        console.log('[Step 0] Backend server is reachable and healthy on port', PORT, '\n');
    } catch (err: any) {
        console.error(`[ERROR] Cannot connect to backend server on ${BASE_URL}: ${err.message}`);
        console.error('Please make sure "npm run dev" is running in a separate terminal.\n');
        process.exit(1);
    }

    // Step 1: Ensure at least one menu item exists in Postgres
    const existingCount = await prisma.menuItem.count({ where: { isAvailable: true } });
    if (existingCount === 0) {
        console.log('Creating a sample menu item for test...');
        await prisma.menuItem.create({
            data: {
                name: 'Paneer Butter Masala',
                description: 'Rich cottage cheese gravy',
                price: 150,
                category: 'DINNER',
                isAvailable: true,
                stockCount: 25,
            },
        });
    }

    // Step 2: Invalidate cache explicitly before test to guarantee a MISS
    console.log('[Step 1] Invalidation: Deleting Redis key "' + MENU_CACHE_KEY + '"...');
    await del(MENU_CACHE_KEY);
    console.log('-> Cache key deleted.\n');

    // Step 3: First Request - Expect Cache MISS
    console.log('[Step 2] Sending 1st GET /api/menu (Expect: X-Cache: MISS)...');
    const start1 = performance.now();
    const res1 = await fetch(`${BASE_URL}/api/menu`);
    const duration1 = (performance.now() - start1).toFixed(2);
    const cacheHeader1 = res1.headers.get('x-cache');
    const data1 = await res1.json();

    console.log(`-> Status: ${res1.status}`);
    console.log(`-> X-Cache Header: ${cacheHeader1}`);
    console.log(`-> Response Time: ${duration1}ms`);
    console.log(`-> Items Received: ${Array.isArray(data1) ? data1.length : 0}`);

    if (cacheHeader1 !== 'MISS') {
        console.error('❌ Expected X-Cache: MISS, but got:', cacheHeader1);
    } else {
        console.log('✅ Correct: 1st request resulted in a cache MISS.\n');
    }

    // Step 4: Second Request - Expect Cache HIT
    console.log('[Step 3] Sending 2nd GET /api/menu (Expect: X-Cache: HIT)...');
    const start2 = performance.now();
    const res2 = await fetch(`${BASE_URL}/api/menu`);
    const duration2 = (performance.now() - start2).toFixed(2);
    const cacheHeader2 = res2.headers.get('x-cache');
    const data2 = await res2.json();

    console.log(`-> Status: ${res2.status}`);
    console.log(`-> X-Cache Header: ${cacheHeader2}`);
    console.log(`-> Response Time: ${duration2}ms`);
    console.log(`-> Items Received: ${Array.isArray(data2) ? data2.length : 0}`);

    if (cacheHeader2 !== 'HIT') {
        console.error('❌ Expected X-Cache: HIT, but got:', cacheHeader2);
    } else {
        console.log('✅ Correct: 2nd request resulted in a cache HIT.\n');
    }

    // Step 5: Verify JSON Data Shape and Type Identity
    console.log('[Step 4] Comparing Response 1 (DB Miss) vs Response 2 (Redis Hit)...');
    const shape1 = JSON.stringify(data1);
    const shape2 = JSON.stringify(data2);

    const isIdentical = shape1 === shape2;
    console.log('-> Raw JSON Deep Equality:', isIdentical ? 'IDENTICAL' : 'DIFFERENT');

    if (Array.isArray(data2) && data2.length > 0) {
        const sample = data2[0];
        console.log('-> Sample Item Type Inspection:');
        console.log('   id:', typeof sample.id);
        console.log('   name:', typeof sample.name);
        console.log('   price:', typeof sample.price, `(${sample.price})`);
        console.log('   stockCount:', typeof sample.stockCount, `(${sample.stockCount})`);
        console.log('   isAvailable:', typeof sample.isAvailable);
        console.log('   description:', typeof sample.description);
    }

    if (isIdentical && cacheHeader1 === 'MISS' && cacheHeader2 === 'HIT') {
        console.log('\n================================================================');
        console.log('             ALL S2 CHECKS VERIFIED SUCCESSFULLY                ');
        console.log('================================================================');
    } else {
        console.error('\n❌ Verification failed.');
    }

    await closeCacheConnection();
    await prisma.$disconnect();
    process.exit(0);
}

runS2Test().catch((err) => {
    console.error('S2 Test Error:', err);
    process.exit(1);
});
