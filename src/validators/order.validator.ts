import { z } from 'zod';
import { OrderStatus } from '@prisma/client';

export const createOrderSchema = z.object({
    items: z
        .array(
            z.object({
                menuItemId: z.string().min(1, 'Menu item ID is required'),
                quantity: z.number().int().positive('Quantity must be greater than 0'),
            })
        )
        .min(1, 'Order must contain at least one item'),
});

export const updateOrderStatusSchema = z.object({
    status: z.nativeEnum(OrderStatus, {
        message: 'Invalid order status',
    }),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;