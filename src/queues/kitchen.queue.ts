import { Queue, JobsOptions } from 'bullmq';
import { redisConnection } from '../config/redis.js';

export const KITCHEN_QUEUE_NAME = 'kitchen-queue';

export interface KitchenJobData {
    orderId: string;
}

// Default options for all kitchen preparation jobs
export const defaultJobOptions: JobsOptions = {
    // Retry up to 3 times if processing fails
    attempts: 3,

    // Exponential backoff: waits 1s, then 2s, then 4s between retries
    backoff: {
        type: 'exponential',
        delay: 1000,
    },

    // Keep memory clean in Redis: keep only the last 100 completed jobs (or 1 hour)
    removeOnComplete: {
        count: 100,
        age: 3600,
    },

    // Keep the last 500 failed jobs for 24 hours so developers can inspect and debug errors
    removeOnFail: {
        count: 500,
        age: 86400,
    },
};

// Instantiate BullMQ Queue sharing the redisConnection from config
export const kitchenQueue = new Queue<KitchenJobData>(KITCHEN_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions,
});

/**
 * Enqueue an order for kitchen preparation.
 * Uses jobId = orderId to ensure strict idempotency:
 * BullMQ will reject duplicate enqueue calls for the same orderId.
 */
export const enqueueOrder = async (orderId: string) => {
    return await kitchenQueue.add(
        'prepare-order',
        { orderId },
        {
            // Idempotency key: prevents an order from ever being queued twice
            jobId: orderId,
        }
    );
};
