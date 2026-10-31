import { Emitter } from '@socket.io/redis-emitter';
import { redisConnection } from '../config/redis.js';
import { OrderStatus } from '@prisma/client';

// 1. Dedicated duplicate Redis connection with offline queue DISABLED for Emitter:
// Drops publish commands immediately when Redis is down instead of buffering them in memory,
// preventing memory leaks and avoiding late delivery of stale events on reconnection.
const emitterRedisClient = redisConnection.duplicate({ enableOfflineQueue: false });

emitterRedisClient.on('error', (err) => {
    console.error('[Redis Emitter Connection Error]:', err.message);
});

// Track the current emit context so dropped publish rejections include order metadata
let currentEmitContext: { userId: string; orderId: string; status: OrderStatus } | null = null;

// 3. Wrap publish to safely catch unhandled rejections from @socket.io/redis-emitter
const rawPublish = emitterRedisClient.publish.bind(emitterRedisClient);
(emitterRedisClient as any).publish = (channel: any, message: any, ...rest: any[]) => {
    const ctx = currentEmitContext;
    return Promise.resolve(rawPublish(channel, message, ...rest)).catch((err: any) => {
        if (ctx) {
            console.error(
                `[Redis Emitter Publish Dropped]: Failed to deliver status "${ctx.status}" for order "${ctx.orderId}" to user "${ctx.userId}" (${err.message})`
            );
        } else {
            console.error(`[Redis Emitter Publish Dropped]: ${err.message}`);
        }
        return 0;
    });
};

export const emitter = new Emitter(emitterRedisClient);

/**
 * Shared helper to emit order status changes to the specific user's private room.
 * Safely drops events without hanging or buffering when Redis is unavailable.
 */
export const emitOrderStatus = async (
    userId: string,
    orderId: string,
    status: OrderStatus
): Promise<void> => {
    if (!userId || !orderId || !status) {
        console.error(
            `[Realtime Emit Error]: Missing required arguments (userId: ${userId}, orderId: ${orderId}, status: ${status})`
        );
        return;
    }

    // 4. Ensure emitter is connected if in initial 'connecting' startup state (takes ~5-10ms)
    // so the very first event placed immediately after server startup is not dropped.
    if (emitterRedisClient.status === 'connecting') {
        await new Promise<void>((resolve) => {
            emitterRedisClient.once('ready', () => resolve());
            emitterRedisClient.once('error', () => resolve());
            setTimeout(resolve, 1000);
        });
    }

    try {
        currentEmitContext = { userId, orderId, status };
        emitter.to(userId).emit('order:status', { orderId, status });
        console.log(
            `[Realtime] Emitted status "${status}" for order "${orderId}" to user "${userId}"`
        );
    } catch (error: any) {
        console.error(
            `[Realtime Emit Error]: Failed to emit status "${status}" for order "${orderId}" to user "${userId}":`,
            error.message
        );
    } finally {
        currentEmitContext = null;
    }
};
