import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { createOrderSchema, updateOrderStatusSchema } from '../validators/order.validator.js';
import {
    createOrder,
    getMyOrders as getMyOrdersService,
    getAllOrders as getAllOrdersService,
    updateOrderStatus as updateOrderStatusService,
} from '../services/order.service.js';
import { OrderStatus, Prisma } from '@prisma/client';

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

        if (
            error.message === 'Menu item not found' ||
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        ) {
            return res.status(404).json({ message: 'Menu item not found' });
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

// Staff / Admin: Sabhi orders dekhne ke liye (optional status filter aur pagination ke sath)
export const getAllOrders = async (req: AuthRequest, res: Response) => {
    try {
        const { status, page, limit } = req.query;

        if (status && typeof status === 'string') {
            if (!Object.values(OrderStatus).includes(status as OrderStatus)) {
                return res.status(400).json({
                    message: `Invalid status. Allowed values: ${Object.values(OrderStatus).join(', ')}`,
                });
            }
        }

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
        const parsedLimit = parseInt(limit as string, 10) || 20;
        const limitNum = Math.min(100, Math.max(1, parsedLimit));

        const { orders, total } = await getAllOrdersService(
            status as OrderStatus | undefined,
            pageNum,
            limitNum
        );

        return res.status(200).json({
            data: orders,
            meta: {
                page: pageNum,
                limit: limitNum,
                total,
            },
        });
    } catch (error: any) {
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message,
        });
    }
};

// Staff / Admin: Order ka status update karne ke liye
export const updateOrderStatus = async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;

        if (!id) {
            return res.status(400).json({ message: 'Order ID is required' });
        }

        const validatedData = updateOrderStatusSchema.parse(req.body);
        const updatedOrder = await updateOrderStatusService(id, validatedData.status);

        return res.status(200).json({
            message: `Order status updated to ${validatedData.status}`,
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

        if (
            error.message === 'Order not found' ||
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        ) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (error.message && error.message.startsWith('Invalid status transition')) {
            return res.status(400).json({ message: error.message });
        }

        if (error.message === 'Order status was modified concurrently') {
            return res.status(409).json({ message: error.message });
        }

        return res.status(500).json({
            message: 'Internal server error',
            error: error.message,
        });
    }
};


// Staff / Admin: Dedicated endpoint to mark an order as COMPLETED (only when status is READY)
export const completeOrder = async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;

        if (!id) {
            return res.status(400).json({ message: 'Order ID is required' });
        }

        const updatedOrder = await updateOrderStatusService(id, OrderStatus.COMPLETED);

        return res.status(200).json({
            message: 'Order completed successfully',
            data: updatedOrder,
        });
    } catch (error: any) {
        if (
            error.message === 'Order not found' ||
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        ) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (error.message && error.message.startsWith('Invalid status transition')) {
            return res.status(400).json({ message: error.message });
        }

        if (error.message === 'Order status was modified concurrently') {
            return res.status(409).json({ message: error.message });
        }

        return res.status(500).json({
            message: 'Internal server error',
            error: error.message,
        });
    }
};
