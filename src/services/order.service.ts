import prisma from '../config/prisma.js';
import { CreateOrderInput } from '../validators/order.validator.js';

export const createOrder = async (userId: string, data: CreateOrderInput) => {
    return await prisma.$transaction(async (tx) => {
        let totalPrice = 0;
        const orderItemsToCreate = [];

        for (const item of data.items) {
            const menuItem = await tx.menuItem.findUnique({
                where: { id: item.menuItemId },
            });

            if (!menuItem || !menuItem.isAvailable) {
                throw new Error(`Item ${item.menuItemId} is currently unavailable`);
            }

            if (menuItem.stockCount < item.quantity) {
                throw new Error(
                    `Insufficient stock for "${menuItem.name}". Available: ${menuItem.stockCount}, Requested: ${item.quantity}`
                );
            }

            await tx.menuItem.update({
                where: { id: item.menuItemId },
                data: {
                    stockCount: {
                        decrement: item.quantity,
                    },
                },
            });

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