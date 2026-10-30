// tests-manual/test_s1_cache.ts
import 'dotenv/config';
import { getJson, setJson, del, closeCacheConnection, cacheRedisClient } from '../src/cache/cache.js';
import { redisConnection } from '../src/config/redis.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runS1Test() {
    console.log('================================================================');
    console.log('       MANUAL TEST S1: REDIS CACHE HELPER VERIFICATION          ');
    console.log('================================================================\n');

    // If client is still completing initial handshake, wait briefly for 'ready'
    if (cacheRedisClient.status !== 'ready') {
        console.log('Waiting for Redis client to be ready (status: ' + cacheRedisClient.status + ')...');
        await Promise.race([
            new Promise((resolve) => cacheRedisClient.once('ready', resolve)),
            new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
        console.log('Redis client status:', cacheRedisClient.status, '\n');
    }

    const testKey = 'test:s1:student_profile';
    const testData = {
        name: 'Rahul Sharma',
        rollNo: '2026-CS-101',
        messSubscribed: true,
        diet: 'VEG',
    };

    // Step 1: Initial state - Cache Miss
    console.log('[Step 1] Checking non-existent key (Expect Cache Miss -> null)...');
    await del(testKey); // Clean slate
    const initialGet = await getJson(testKey);
    console.log('Result for initial getJson:', initialGet);
    if (initialGet === null) {
        console.log('-> Cache Miss properly returned null.\n');
    } else {
        console.error('-> Unexpected value found!\n');
    }

    // Step 2: Store JSON into Redis with TTL (setJson)
    console.log('[Step 2] Storing JSON data with 3s TTL using setJson...');
    await setJson(testKey, testData, 3);
    console.log('-> Stored successfully.\n');

    // Step 3: Immediate retrieval - Cache Hit
    console.log('[Step 3] Immediate getJson (Expect Cache Hit -> exact object)...');
    const cachedHit = await getJson<typeof testData>(testKey);
    console.log('Retrieved cached data:', cachedHit);
    if (cachedHit && cachedHit.rollNo === testData.rollNo && cachedHit.name === testData.name) {
        console.log('-> Cache Hit verified! Stored and retrieved objects match.\n');
    } else {
        console.error('-> Cache Hit verification failed!\n');
    }

    // Step 4: Explicit Cache Invalidation (del)
    console.log('[Step 4] Testing explicit deletion (del)...');
    await del(testKey);
    const postDelGet = await getJson(testKey);
    console.log('Result after del:', postDelGet);
    if (postDelGet === null) {
        console.log('-> Explicit deletion verified! Key returned null.\n');
    } else {
        console.error('-> Deletion failed!\n');
    }

    // Step 5: Automatic TTL Expiration
    const ttlKey = 'test:s1:ttl_expiring';
    console.log('[Step 5] Testing automatic TTL expiration (2 seconds TTL)...');
    await setJson(ttlKey, { active: true }, 2);
    const beforeTtl = await getJson(ttlKey);
    console.log('Immediate read before TTL expires:', beforeTtl);

    console.log('Waiting 2.3 seconds for Redis TTL expiry...');
    await sleep(2300);

    const afterTtl = await getJson(ttlKey);
    console.log('Read after TTL expiry:', afterTtl);
    if (beforeTtl !== null && afterTtl === null) {
        console.log('-> TTL expiration verified! Key automatically evicted by Redis.\n');
    } else {
        console.error('-> TTL expiration test failed!\n');
    }

    console.log('================================================================');
    console.log('           ALL S1 CACHE HELPER CHECKS COMPLETED                 ');
    console.log('================================================================');

    // Clean up connections
    await closeCacheConnection();
    try {
        await redisConnection.quit();
    } catch {
        redisConnection.disconnect();
    }
    process.exit(0);
}

runS1Test().catch((err) => {
    console.error('S1 Test Error:', err);
    process.exit(1);
});
