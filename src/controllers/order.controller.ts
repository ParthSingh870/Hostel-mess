import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { createOrderSchema, updateOrderStatusSchema } from '../validators/order.validator.js';
import {
    createOrder,
    getMyOrders as getMyOrdersService,
    getAllOrders as getAllOrdersService,
    updateOrderStatus as updateOrderStatusService,
} from '../services/order.service.js';
import { OrderStatus } from '@prisma/client';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError, UnauthorizedError } from '../errors/AppError.js';

export const placeOrder = catchAsync(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
        throw new UnauthorizedError('Unauthorized: User ID missing');
    }

    const validatedData = createOrderSchema.parse(req.body);
    const order = await createOrder(userId, validatedData);

    return res.status(201).json({
        message: 'Order placed successfully',
        data: order,
    });
});

export const getMyOrders = catchAsync(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
        throw new UnauthorizedError('Unauthorized: User ID missing');
    }

    const orders = await getMyOrdersService(userId);

    return res.status(200).json({
        message: 'Orders fetched successfully',
        data: orders,
    });
});

// Staff / Admin: Sabhi orders dekhne ke liye (optional status filter aur pagination ke sath)
export const getAllOrders = catchAsync(async (req: AuthRequest, res: Response) => {
    const { status, page, limit } = req.query;

    if (status && typeof status === 'string') {
        if (!Object.values(OrderStatus).includes(status as OrderStatus)) {
            throw new AppError(
                `Invalid status. Allowed values: ${Object.values(OrderStatus).join(', ')}`,
                400
            );
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
});

// Staff / Admin: Order ka status update karne ke liye
export const updateOrderStatus = catchAsync(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    if (!id) {
        throw new AppError('Order ID is required', 400);
    }

    const validatedData = updateOrderStatusSchema.parse(req.body);
    const updatedOrder = await updateOrderStatusService(id, validatedData.status);

    return res.status(200).json({
        message: `Order status updated to ${validatedData.status}`,
        data: updatedOrder,
    });
});

// Staff / Admin: Dedicated endpoint to mark an order as COMPLETED (only when status is READY)
export const completeOrder = catchAsync(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    if (!id) {
        throw new AppError('Order ID is required', 400);
    }

    const updatedOrder = await updateOrderStatusService(id, OrderStatus.COMPLETED);

    return res.status(200).json({
        message: 'Order completed successfully',
        data: updatedOrder,
    });
});
