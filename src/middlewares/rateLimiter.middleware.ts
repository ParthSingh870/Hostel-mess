import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware.js';
import { cacheRedisClient } from '../cache/cache.js';

// Lua script to atomically increment the counter and set expiration on the first increment.
// This guarantees that a crash between INCR and EXPIRE can never leave an immortal key without TTL.
const RATE_LIMIT_LUA_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { current, ttl }
`;

const DEFAULT_TIMEOUT_MS = 1000;

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
 * Atomic Redis-backed rate limiter strictly for POST /orders.
 * Uses authenticated userId as the rate limit key.
 * Fail-open: if Redis is down or times out, allows the request and logs one clear line.
 */
export const orderRateLimiter = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const userId = req.user?.userId;

    // Safety fallback: if no userId, pass through to controller which handles 401
    if (!userId) {
        return next();
    }

    const maxRequests = Number(process.env.ORDER_RATE_LIMIT_MAX) || 5;
    const windowSeconds = Number(process.env.ORDER_RATE_LIMIT_WINDOW_SECONDS) || 60;
    const key = `ratelimit:orders:${userId}`;

    try {
        const result = (await withTimeout(
            cacheRedisClient.eval(RATE_LIMIT_LUA_SCRIPT, 1, key, windowSeconds) as Promise<[number, number]>,
            1000
        )) as [number, number];

        const [current, ttl] = result;

        if (current > maxRequests) {
            const retryAfter = ttl > 0 ? ttl : windowSeconds;
            res.setHeader('Retry-After', retryAfter.toString());
            res.setHeader('X-RateLimit-Limit', maxRequests.toString());
            res.setHeader('X-RateLimit-Remaining', '0');

            res.status(429).json({
                error: 'Too Many Requests',
                message: `Order rate limit exceeded. You can only place ${maxRequests} orders per ${windowSeconds} seconds.`,
                retryAfterSeconds: retryAfter,
            });
            return;
        }

        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current).toString());
        next();
    } catch (err: any) {
        // Fail-open: Redis is down, connection refused, or timed out.
        // Allow the request to proceed so students can still place orders.
        console.warn(`[RateLimit Warning] Redis unavailable for rate limiting, failing open: ${err.message}`);
        next();
    }
};
