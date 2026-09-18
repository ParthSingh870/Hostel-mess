import { z } from 'zod';

export const createOrderSchema = z.object({
    items: z
        .array(
            z.object({
                menuItemId: z.string().uuid('Invalid menuItemId format'),
                quantity: z.number().int().positive('Quantity must be at least 1'),
            })
        )
        .min(1, 'Order must contain at least one item'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;