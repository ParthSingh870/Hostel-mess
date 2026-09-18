import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { createOrderSchema } from '../validators/order.validator.js';
import { createOrder } from '../services/order.service.js';

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
        // Clean formatted response for Zod validation errors
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                message: 'Validation failed',
                errors: error.issues.map((issue) => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                })),
            });
        }

        // Business logic errors (e.g. Insufficient stock)
        return res.status(400).json({
            message: error.message || 'Failed to place order',
        });
    }
};