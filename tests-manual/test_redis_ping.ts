// tests-manual/test_redis_ping.ts
import { redisConnection } from '../src/config/redis.js';

async function testConnection() {
    try {
        console.log('Connecting to Redis...');
        const res = await redisConnection.ping();
        console.log('Redis Ping Response:', res);
    } catch (err: any) {
        console.error('Redis Ping Error:', err.message);
    } finally {
        await redisConnection.quit();
        process.exit(0);
    }
}

testConnection();
