import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { createOrderSchema, updateOrderStatusSchema } from '../validators/order.validator.js';
import { createOrder, getMyOrders as getMyOrdersService } from '../services/order.service.js';
import prisma from '../config/prisma.js';
import { OrderStatus } from '@prisma/client';

export const placeOrder = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User ID missing' });
        }

        const validatedData = createOrderSchema.parse(req.body);
        const order = await createOrder(userId, validatedData);

        return res.status(201).json({
            message: 'Order placed successfully',
            data: order,
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                message: 'Validation failed',
                errors: error.issues.map((issue) => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                })),
            });
        }

        return res.status(400).json({
            message: error.message || 'Failed to place order',
        });
    }
};

export const getMyOrders = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User ID missing' });
        }

        const orders = await getMyOrdersService(userId);

        return res.status(200).json({
            message: 'Orders fetched successfully',
            data: orders,
        });
    } catch (error: any) {
        return res.status(500).json({
            message: 'Failed to fetch orders',
            error: error.message,
        });
    }
};

// Staff / Admin: Sabhi orders dekhne ke liye (optional status filter ke sath)
export const getAllOrders = async (req: AuthRequest, res: Response) => {
    try {
        const { status } = req.query;
        const whereClause: any = {};

        if (status && typeof status === 'string') {
            if (Object.values(OrderStatus).includes(status as OrderStatus)) {
                whereClause.status = status as OrderStatus;
            } else {
                return res.status(400).json({
                    message: `Invalid status. Allowed values: ${Object.values(OrderStatus).join(', ')}`,
                });
            }
        }

        const orders = await prisma.order.findMany({
            where: whereClause,
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
        });

        return res.status(200).json({
            message: 'Orders retrieved successfully',
            count: orders.length,
            data: orders,
        });
    } catch (error: any) {
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message,
        });
    }
};

// Staff / Admin: Order ka status update karne ke liye (CANCELLED hone par stock restore karta hai)
export const updateOrderStatus = async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;

        if (!id) {
            return res.status(400).json({ message: 'Order ID is required' });
        }

        const validatedData = updateOrderStatusSchema.parse(req.body);
        const { status } = validatedData;

        const existingOrder = await prisma.order.findUnique({
            where: { id },
            include: { items: true },
        });

        if (!existingOrder) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const updatedOrder = await prisma.$transaction(async (tx) => {
            if (status === OrderStatus.CANCELLED && existingOrder.status !== OrderStatus.CANCELLED) {
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

            return await tx.order.update({
                where: { id },
                data: { status },
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

        return res.status(200).json({
            message: `Order status updated to ${status}`,
            data: updatedOrder,
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                message: 'Validation failed',
                errors: error.issues.map((issue) => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                })),
            });
        }

        return res.status(500).json({
            message: 'Internal server error',
            error: error.message,
        });
    }
};