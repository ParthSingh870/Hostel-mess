import 'dotenv/config';
import { Redis, RedisOptions } from 'ioredis';

// Fail fast at startup if REDIS_URL is missing
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
    console.error('FATAL: REDIS_URL must be defined in environment variables.');
    process.exit(1);
}

// 1. Queue / Producer config:
// - maxRetriesPerRequest: null (required by BullMQ)
// - enableOfflineQueue: false (rejects commands immediately when Redis is down instead of hanging in memory queue)
export const queueRedisConfig: RedisOptions = {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
};

// 2. Worker config:
// - maxRetriesPerRequest: null (required for blocking commands like BLMOVE)
// - enableOfflineQueue: not explicitly set, uses ioredis default (true) so workers wait for Redis to reconnect
export const workerRedisConfig: RedisOptions = {
    maxRetriesPerRequest: null,
};

// Export redisConfig as alias to maintain compatibility
export const redisConfig = queueRedisConfig;

// Shared ioredis client instance for BullMQ queues and general Redis operations
export const redisConnection = new Redis(redisUrl, queueRedisConfig);

// Helper function to create isolated connection instances (used by BullMQ Workers)
export const createRedisConnection = (): Redis => new Redis(redisUrl, workerRedisConfig);

// Log any unexpected Redis connection errors
redisConnection.on('error', (err) => {
    console.error('[Redis Connection Error]:', err.message);
});
