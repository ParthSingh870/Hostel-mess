import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { OrderStatus } from '@prisma/client';
import prisma from '../config/prisma.js';
import { createRedisConnection } from '../config/redis.js';
import { KITCHEN_QUEUE_NAME, KitchenJobData } from '../queues/kitchen.queue.js';

// Read simulated preparation time from environment (default: 10 seconds)
const getPrepSeconds = (): number => {
    const envVal = process.env.KITCHEN_PREP_SECONDS;
    if (envVal) {
        const parsed = parseInt(envVal, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 10;
};

/**
 * Core job processor for preparing kitchen orders.
 * Uses atomic conditional updates to guarantee correct state transitions.
 */
export const processKitchenJob = async (job: Job<KitchenJobData>) => {
    const { orderId } = job.data;
    const prepSeconds = getPrepSeconds();

    console.log(`[Worker] Received job ${job.id} for Order ID: ${orderId}`);

    // 1. Atomic conditional update: PLACED -> PREPARING
    // Only transitions if the order is currently in 'PLACED' status
    const placedUpdate = await prisma.order.updateMany({
        where: {
            id: orderId,
            status: OrderStatus.PLACED,
        },
        data: {
            status: OrderStatus.PREPARING,
        },
    });

    // If count === 0, the order was already cancelled or processed
    if (placedUpdate.count === 0) {
        console.log(
            `[Worker] Order ${orderId} is not in PLACED status (count: 0). Skipping preparation.`
        );
        return { orderId, skipped: true, reason: 'NOT_IN_PLACED_STATUS' };
    }

    console.log(`[Worker] Order ${orderId}: PLACED -> PREPARING. Cooking for ${prepSeconds}s...`);

    // 2. Simulate food cooking / preparation time
    await new Promise((resolve) => setTimeout(resolve, prepSeconds * 1000));

    // 3. Atomic conditional update: PREPARING -> READY
    // Only transitions if the order is still in 'PREPARING' status (e.g. not cancelled during prep)
    const readyUpdate = await prisma.order.updateMany({
        where: {
            id: orderId,
            status: OrderStatus.PREPARING,
        },
        data: {
            status: OrderStatus.READY,
        },
    });

    if (readyUpdate.count === 0) {
        console.log(
            `[Worker] Order ${orderId} is no longer in PREPARING status (count: 0). Skipping mark as READY.`
        );
        return { orderId, skipped: true, reason: 'CANCELLED_WHILE_PREPARING' };
    }

    console.log(`[Worker] Order ${orderId}: PREPARING -> READY. Order is ready for pickup!`);
    return { orderId, status: OrderStatus.READY };
};

// Dedicated Redis connection instance for Worker (to avoid blocking queue operations)
const workerConnection = createRedisConnection();

workerConnection.on('error', (err) => {
    console.error('[Worker Redis Error]:', err.message);
});

// Create and export the BullMQ Worker
export const kitchenWorker = new Worker<KitchenJobData>(
    KITCHEN_QUEUE_NAME,
    processKitchenJob,
    {
        connection: workerConnection,
        concurrency: 3, // Concurrently process up to 3 orders at a time
    }
);

kitchenWorker.on('ready', () => {
    console.log(
        `[Worker] Kitchen worker is active and listening for jobs on "${KITCHEN_QUEUE_NAME}" (concurrency: 3).`
    );
});

kitchenWorker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully.`);
});

kitchenWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed with error:`, err.message);
});

