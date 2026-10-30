import { Redis } from 'ioredis';
import { redisConnection } from '../config/redis.js';

// Standard cache key for available menu catalog
export const MENU_CACHE_KEY = 'menu:all';

// Dedicated Redis connection for caching, isolated from BullMQ and Socket.io.
// enableOfflineQueue: false ensures commands fail immediately instead of hanging in memory when Redis is down.
export const cacheRedisClient: Redis = redisConnection.duplicate({
    enableOfflineQueue: false,
});

// Suppress unhandled connection errors to prevent crashing the Express process
cacheRedisClient.on('error', (err) => {
    console.error('[Cache Redis Client Error]:', err.message);
});

const DEFAULT_TIMEOUT_MS = 1000;

/**
 * Wraps any promise with a strict timeout to guarantee cache operations never hang the request pipeline.
 */
function withTimeout<T>(promise: Promise<T>, ms: number = DEFAULT_TIMEOUT_MS): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`Redis command timed out after ${ms}ms`));
        }, ms);
        timer.unref?.();
    });

    return Promise.race([
        promise.then((result) => {
            clearTimeout(timer);
            return result;
        }),
        timeoutPromise,
    ]);
}

/**
 * Retrieves and parses a JSON value from Redis.
 * Returns null on cache miss, parse error, timeout, or Redis outage (fail-open).
 */
export async function getJson<T>(key: string): Promise<T | null> {
    try {
        const raw = await withTimeout(cacheRedisClient.get(key));
        if (!raw) {
            return null;
        }
        return JSON.parse(raw) as T;
    } catch (err: any) {
        console.warn(`[Cache Warning] getJson failed for key "${key}": ${err.message}`);
        return null;
    }
}

/**
 * Serializes and stores a JSON value in Redis with an optional TTL in seconds.
 * Fails silently with a single warning line if Redis is unreachable (fail-open).
 */
export async function setJson(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds && ttlSeconds > 0) {
            await withTimeout(cacheRedisClient.set(key, serialized, 'EX', ttlSeconds));
        } else {
            await withTimeout(cacheRedisClient.set(key, serialized));
        }
    } catch (err: any) {
        console.warn(`[Cache Warning] setJson failed for key "${key}": ${err.message}`);
    }
}

/**
 * Deletes a key from Redis.
 * Fails silently with a single warning line if Redis is unreachable (fail-open).
 */
export async function del(key: string): Promise<void> {
    try {
        await withTimeout(cacheRedisClient.del(key));
    } catch (err: any) {
        console.warn(`[Cache Warning] del failed for key "${key}": ${err.message}`);
    }
}

/**
 * Helper to gracefully close the dedicated cache client during testing or application shutdown.
 */
export async function closeCacheConnection(): Promise<void> {
    try {
        await cacheRedisClient.quit();
    } catch {
        cacheRedisClient.disconnect();
    }
}
