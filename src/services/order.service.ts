import prisma from '../config/prisma.js';
import { CreateOrderInput } from '../validators/order.validator.js';
import { OrderStatus } from '@prisma/client';
import { enqueueOrder } from '../queues/kitchen.queue.js';
import { emitOrderStatus } from '../realtime/emitOrderStatus.js';
import { del, MENU_CACHE_KEY } from '../cache/cache.js';

export const createOrder = async (userId: string, data: CreateOrderInput) => {
    // 1. Commit order and atomic stock decrement to PostgreSQL database
    const order = await prisma.$transaction(async (tx) => {
        let totalPrice = 0;
        const orderItemsToCreate = [];

        for (const item of data.items) {
            const menuItem = await tx.menuItem.findUnique({
                where: { id: item.menuItemId },
            });

            if (!menuItem) {
                throw new Error('Menu item not found');
            }

            if (!menuItem.isAvailable) {
                throw new Error(`Item "${menuItem.name}" is currently unavailable`);
            }

            // Atomic conditional decrement: prevents race conditions and negative stock
            const updated = await tx.menuItem.updateMany({
                where: {
                    id: item.menuItemId,
                    isAvailable: true,
                    stockCount: {
                        gte: item.quantity,
                    },
                },
                data: {
                    stockCount: {
                        decrement: item.quantity,
                    },
                },
            });

            if (updated.count === 0) {
                throw new Error(
                    `Insufficient stock for "${menuItem.name}". Available: ${menuItem.stockCount}, Requested: ${item.quantity}`
                );
            }

            totalPrice += menuItem.price * item.quantity;

            orderItemsToCreate.push({
                menuItemId: item.menuItemId,
                quantity: item.quantity,
                priceAtOrder: menuItem.price,
            });
        }

        const order = await tx.order.create({
            data: {
                userId,
                totalPrice,
                status: 'PLACED',
                items: {
                    create: orderItemsToCreate,
                },
            },
            include: {
                items: {
                    include: {
                        menuItem: {
                            select: {
                                name: true,
                                price: true,
                            },
                        },
                    },
                },
            },
        });

        return order;
    });

    // 2. Enqueue order to kitchen queue strictly AFTER DB transaction commits.
    // Wrap enqueueOrder with a 2.5s timeout so order creation can NEVER hang on the queue.
    try {
        const enqueueWithTimeout = Promise.race([
            enqueueOrder(order.id),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Queue enqueue timed out after 2.5s')), 2500)
            ),
        ]);
        await enqueueWithTimeout;
    } catch (queueError: any) {
        console.error(
            `[Queue Error]: Failed to enqueue order ${order.id} to kitchen queue:`,
            queueError?.message || queueError
        );
    }

    // 3. S5: Emit real-time PLACED status strictly after DB transaction commits
    await emitOrderStatus(order.userId, order.id, OrderStatus.PLACED);

    // 4. Invalidate menu cache strictly AFTER DB commit because stockCount changed
    await del(MENU_CACHE_KEY);

    return order;
};

// Logged-in user ke saare orders fetch karne ke liye function
export const getMyOrders = async (userId: string) => {
    return await prisma.order.findMany({
        where: { userId },
        include: {
            items: {
                include: {
                    menuItem: {
                        select: {
                            id: true,
                            name: true,
                            price: true,
                            category: true,
                        },
                    },
                },
            },
        },
        orderBy: {
            createdAt: 'desc', // Latest order sabse pehle dikhega
        },
    });
};

// Staff / Admin: Sabhi orders fetch karne ke liye service (paginated)
export const getAllOrders = async (
    status?: OrderStatus,
    page: number = 1,
    limit: number = 20
) => {
    const whereClause: any = {};
    if (status) {
        whereClause.status = status;
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
        prisma.order.findMany({
            where: whereClause,
            skip,
            take: limit,
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
                items: {
                    include: {
                        menuItem: {
                            select: { id: true, name: true, price: true, category: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.order.count({ where: whereClause }),
    ]);

    return { orders, total };
};

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.PLACED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
    [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
    [OrderStatus.READY]: [OrderStatus.COMPLETED],
    [OrderStatus.COMPLETED]: [],
    [OrderStatus.CANCELLED]: [],
};

// Staff / Admin: Order status update karne ke liye service (strict transitions + atomic stock restoration)
export const updateOrderStatus = async (id: string, status: OrderStatus) => {
    const existingOrder = await prisma.order.findUnique({
        where: { id },
        include: { items: true },
    });

    if (!existingOrder) {
        throw new Error('Order not found');
    }

    const allowed = ALLOWED_TRANSITIONS[existingOrder.status];
    if (!allowed || !allowed.includes(status)) {
        throw new Error(
            `Invalid status transition from "${existingOrder.status}" to "${status}"`
        );
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
        // Atomic status update: only updates if the current status matches what was read
        const updateResult = await tx.order.updateMany({
            where: {
                id,
                status: existingOrder.status,
            },
            data: {
                status,
            },
        });

        if (updateResult.count === 0) {
            throw new Error('Order status was modified concurrently');
        }

        // Stock is restored only on a valid cancellation that successfully updated the order
        if (status === OrderStatus.CANCELLED) {
            for (const item of existingOrder.items) {
                await tx.menuItem.update({
                    where: { id: item.menuItemId },
                    data: {
                        stockCount: {
                            increment: item.quantity,
                        },
                    },
                });
            }
        }

        return await tx.order.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        menuItem: {
                            select: {
                                id: true,
                                name: true,
                                price: true,
                            },
                        },
                    },
                },
            },
        });
    });

    // S5: Emit real-time status strictly after DB transaction commits and update succeeded
    await emitOrderStatus(existingOrder.userId, id, status);

    // Invalidate menu cache strictly AFTER DB commit if order cancellation restored stock
    if (status === OrderStatus.CANCELLED) {
        await del(MENU_CACHE_KEY);
    }

    return updatedOrder;
};
