import 'dotenv/config';
import { Redis, RedisOptions } from 'ioredis';

// Fail fast at startup if REDIS_URL is missing
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
    console.error('FATAL: REDIS_URL must be defined in environment variables.');
    process.exit(1);
}

// BullMQ requires maxRetriesPerRequest to be null.
// BullMQ handles its own job retries and uses blocking Redis commands (like BLMOVE)
// to wait for jobs. If this is not null, ioredis will abort waiting commands on network hiccups.
export const redisConfig: RedisOptions = {
    maxRetriesPerRequest: null,
};

// Shared ioredis client instance for BullMQ queues and general Redis operations
export const redisConnection = new Redis(redisUrl, redisConfig);

// Helper function to create isolated connection instances (needed by BullMQ Workers)
export const createRedisConnection = (): Redis => new Redis(redisUrl, redisConfig);

// Log any unexpected Redis connection errors
redisConnection.on('error', (err) => {
    console.error('[Redis Connection Error]:', err.message);
});
