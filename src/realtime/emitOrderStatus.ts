import { Emitter } from '@socket.io/redis-emitter';
import { redisConnection } from '../config/redis.js';
import { OrderStatus } from '@prisma/client';

// Dedicated duplicate Redis connection for the Emitter (NOT the BullMQ connection)
// Set enableOfflineQueue: true so in-flight emits queue cleanly during transient reconnection
const emitterRedisClient = redisConnection.duplicate({ enableOfflineQueue: true });

emitterRedisClient.on('error', (err) => {
    console.error('[Redis Emitter Error]:', err.message);
});

export const emitter = new Emitter(emitterRedisClient);

const EMIT_TIMEOUT_MS = 2000;

/**
 * Shared helper to emit order status changes to the specific user's private room.
 * Safely wraps the emit in a short timeout and try/catch so failures NEVER crash or hang the caller.
 *
 * @param userId - Target user ID (private room name)
 * @param orderId - ID of the order
 * @param status - Updated OrderStatus ('PLACED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED')
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

    try {
        const emitPromise = new Promise<void>((resolve, reject) => {
            try {
                // S4: Emit strictly to target userId room with payload { orderId, status }
                emitter.to(userId).emit('order:status', { orderId, status });
                resolve();
            } catch (err) {
                reject(err);
            }
        });

        // Short timeout guarantee: Redis lag must NEVER hang a business transaction
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error(`Emit timed out after ${EMIT_TIMEOUT_MS}ms`)),
                EMIT_TIMEOUT_MS
            )
        );

        await Promise.race([emitPromise, timeoutPromise]);
        console.log(
            `[Realtime] Emitted status "${status}" for order "${orderId}" to user "${userId}"`
        );
    } catch (error: any) {
        // Catch and log clearly; NEVER throw so caller status change always succeeds
        console.error(
            `[Realtime Emit Error]: Failed to emit status "${status}" for order "${orderId}" to user "${userId}":`,
            error.message
        );
    }
};
