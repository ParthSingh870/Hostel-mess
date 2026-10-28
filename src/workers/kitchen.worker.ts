import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { OrderStatus } from '@prisma/client';
import prisma from '../config/prisma.js';
import { createRedisConnection } from '../config/redis.js';
import { KITCHEN_QUEUE_NAME, KitchenJobData } from '../queues/kitchen.queue.js';
import { updateOrderStatus } from '../services/order.service.js';

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
 * Supports stalled-job recovery (resumes cooking if order was already PREPARING when worker crashed).
 */
export const processKitchenJob = async (job: Job<KitchenJobData>) => {
    const { orderId } = job.data;
    const prepSeconds = getPrepSeconds();

    console.log(`[Worker] Received job ${job.id} for Order ID: ${orderId}`);

    // Simulation hook for manual/integration failure tests
    if (process.env.SIMULATE_WORKER_FAILURE === 'true') {
        throw new Error('Simulated kitchen cooking failure for testing');
    }

    // Check existing order status in database
    const existingOrder = await prisma.order.findUnique({
        where: { id: orderId },
    });

    if (!existingOrder) {
        console.log(`[Worker] Order ${orderId} not found in database. Skipping.`);
        return { orderId, skipped: true, reason: 'ORDER_NOT_FOUND' };
    }

    // If order was cancelled by staff or already completed/ready, skip gracefully
    if (
        existingOrder.status === OrderStatus.CANCELLED ||
        existingOrder.status === OrderStatus.READY ||
        existingOrder.status === OrderStatus.COMPLETED
    ) {
        console.log(
            `[Worker] Order ${orderId} is already in "${existingOrder.status}" status. Skipping preparation.`
        );
        return { orderId, skipped: true, reason: `ALREADY_${existingOrder.status}` };
    }

    // 1. Transition PLACED -> PREPARING (if fresh order)
    if (existingOrder.status === OrderStatus.PLACED) {
        const placedUpdate = await prisma.order.updateMany({
            where: {
                id: orderId,
                status: OrderStatus.PLACED,
            },
            data: {
                status: OrderStatus.PREPARING,
            },
        });

        if (placedUpdate.count === 0) {
            console.log(
                `[Worker] Order ${orderId} status modified concurrently from PLACED. Skipping.`
            );
            return { orderId, skipped: true, reason: 'CONCURRENT_STATUS_CHANGE' };
        }

        console.log(`[Worker] Order ${orderId}: PLACED -> PREPARING. Cooking for ${prepSeconds}s...`);
    } else if (existingOrder.status === OrderStatus.PREPARING) {
        // Stalled job recovery: previous worker crashed mid-prep!
        console.log(
            `[Worker] Order ${orderId} was already PREPARING (stalled-job recovery). Resuming cooking for ${prepSeconds}s...`
        );
    }

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
export const workerConnection = createRedisConnection();

workerConnection.on('error', (err) => {
    console.error('[Worker Redis Error]:', err.message);
});

/**
 * Handle job failure.
 * When attempts are exhausted, marks the order CANCELLED and restores stock atomically.
 */
export const handleJobFailure = async (job: Job<KitchenJobData> | undefined, err: Error) => {
    if (!job) return;

    const maxAttempts = job.opts.attempts || 3;
    console.error(
        `[Worker] Job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${err.message}`
    );

    // Only auto-cancel when all retry attempts have been exhausted
    if (job.attemptsMade >= maxAttempts) {
        const { orderId } = job.data;
        console.error(
            `[Worker] Order ${orderId} exhausted all ${maxAttempts} attempts. Cancelling and restoring stock...`
        );

        try {
            const order = await prisma.order.findUnique({
                where: { id: orderId },
            });

            // Only cancel if order is in a cancellable state (PLACED or PREPARING)
            if (order && (order.status === OrderStatus.PLACED || order.status === OrderStatus.PREPARING)) {
                await updateOrderStatus(orderId, OrderStatus.CANCELLED);
                console.log(
                    `[Worker] Order ${orderId} auto-cancelled and stock restored atomically.`
                );
            } else {
                console.log(
                    `[Worker] Order ${orderId} current status is "${order?.status}". No stock restoration needed.`
                );
            }
        } catch (cancelErr: any) {
            console.error(
                `[Worker] Failed to auto-cancel order ${orderId}:`,
                cancelErr.message
            );
        }
    }
};

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

kitchenWorker.on('failed', handleJobFailure);

/**
 * Graceful shutdown handler.
 * BullMQ waits for active in-flight jobs to finish before disconnecting.
 */
export const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Worker] Received ${signal}. Shutting down kitchen worker gracefully...`);
    try {
        await kitchenWorker.close();
        await workerConnection.quit();
        await prisma.$disconnect();
        console.log('[Worker] Kitchen worker shut down cleanly. Exiting.');
        process.exit(0);
    } catch (shutdownErr: any) {
        console.error('[Worker] Error during graceful shutdown:', shutdownErr.message);
        process.exit(1);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
