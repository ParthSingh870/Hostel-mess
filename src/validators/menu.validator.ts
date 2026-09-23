import { z } from 'zod';

export const createMenuItemSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    price: z.number().int().positive('Price must be a positive integer'),
    category: z.string().min(1, 'Category is required'),
    isAvailable: z.boolean().optional().default(true),
    stockCount: z.number().int().nonnegative('Stock count cannot be negative').default(0),
});


export const updateMenuItemSchema = z.object({
    name: z.string().min(1, 'Name cannot be empty').optional(),
    description: z.string().optional(),
    price: z.number().int().positive('Price must be a positive integer').optional(),
    category: z.string().min(1, 'Category cannot be empty').optional(),
    isAvailable: z.boolean().optional(),
    stockCount: z.number().int().nonnegative('Stock count cannot be negative').optional(),
});

export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;