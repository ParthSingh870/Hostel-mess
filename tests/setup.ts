import dotenv from 'dotenv';
import { afterAll } from 'vitest';

// Load environment variables from .env
dotenv.config();

// Guard 1: TEST_DATABASE_URL must be defined
if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL.trim() === '') {
    throw new Error(
        'FATAL: TEST_DATABASE_URL is missing or empty in environment. Tests halted to protect development database.'
    );
}

// Guard 2: TEST_DATABASE_URL must NOT be equal to DATABASE_URL
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error(
        'FATAL: TEST_DATABASE_URL is identical to DATABASE_URL! Tests must NEVER run on the development database.'
    );
}

// Redirect DATABASE_URL to TEST_DATABASE_URL before any prisma or app code runs
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Guard 3: Redis isolation - configure tests to use Redis DB index 1 to avoid modifying dev data
if (process.env.REDIS_URL) {
    try {
        const redisUrlObj = new URL(process.env.REDIS_URL);
        if (!redisUrlObj.pathname || redisUrlObj.pathname === '/' || redisUrlObj.pathname === '/0') {
            redisUrlObj.pathname = '/1';
            process.env.REDIS_URL = redisUrlObj.toString();
        }
    } catch {
        if (!process.env.REDIS_URL.endsWith('/1')) {
            process.env.REDIS_URL = process.env.REDIS_URL.replace(/\/?\d*$/, '/1');
        }
    }
}

// Set rate limiter threshold high for standard test suites so orders are not prematurely throttled
process.env.ORDER_RATE_LIMIT_MAX = '1000';
process.env.ORDER_RATE_LIMIT_WINDOW_SECONDS = '60';

// Global teardown to cleanly close connections when all test suites finish
afterAll(async () => {
    try {
        const { default: prisma } = await import('../src/config/prisma.js');
        await prisma.$disconnect();
    } catch {
        // Ignore teardown disconnect errors
    }

    try {
        const { redisConnection } = await import('../src/config/redis.js');
        await redisConnection.quit();
    } catch {
        // Ignore teardown disconnect errors
    }

    try {
        const { closeCacheConnection } = await import('../src/cache/cache.js');
        await closeCacheConnection();
    } catch {
        // Ignore teardown disconnect errors
    }
});
