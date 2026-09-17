import { z } from 'zod';

export const createOrderSchema = z.object({
    items: z
        .array(
            z.object({
                menuItemId: z.string().uuid('Invalid menu item ID'),
                quantity: z.number().int().positive('Quantity must be greater than 0'),
            })
        )
        .min(1, 'Order must contain at least one item'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;