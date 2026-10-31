import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
    createMenuItem,
    getAvailableMenuItems,
    updateMenuItem,
    deleteMenuItem,
} from '../services/menu.service.js';
import { getJson, setJson, del, MENU_CACHE_KEY } from '../cache/cache.js';

import {
    createMenuItemSchema,
    updateMenuItemSchema,
} from '../validators/menu.validator.js';

// Read TTL from environment variable with 60 seconds fallback safety net
const MENU_CACHE_TTL_SECONDS = Number(process.env.MENU_CACHE_TTL_SECONDS) || 60;

export const createItem = async (req: Request, res: Response) => {
    try {
        const validatedData = createMenuItemSchema.parse(req.body);
        const item = await createMenuItem(validatedData);

        // Invalidate cache strictly AFTER database insert succeeds
        await del(MENU_CACHE_KEY);

        res.status(201).json(item);
    } catch (error: any) {
        res.status(400).json({ error: error.errors || error.message });
    }
};

export const getItems = async (_req: Request, res: Response) => {
    try {
        // Step 1: Check Redis cache first (Cache-Aside pattern)
        const cachedItems = await getJson<any[]>(MENU_CACHE_KEY);
        if (cachedItems !== null) {
            res.setHeader('X-Cache', 'HIT');
            return res.status(200).json(cachedItems);
        }

        // Step 2: Cache Miss -> Query Postgres database
        const items = await getAvailableMenuItems();
        res.setHeader('X-Cache', 'MISS');

        // Step 3: Populate Redis cache with configured TTL (fail-open safety)
        await setJson(MENU_CACHE_KEY, items, MENU_CACHE_TTL_SECONDS);

        res.status(200).json(items);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const updateItem = async (req: Request<{ id: string }>, res: Response) => {
    try {
        const { id } = req.params;
        const validatedData = updateMenuItemSchema.parse(req.body);
        const item = await updateMenuItem(id, validatedData);

        // Invalidate cache strictly AFTER database update succeeds
        await del(MENU_CACHE_KEY);

        res.status(200).json(item);
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            return res.status(404).json({ message: 'Menu item not found' });
        }
        res.status(400).json({ error: error.errors || error.message });
    }
};

export const deleteItem = async (req: Request<{ id: string }>, res: Response) => {
    try {
        const { id } = req.params;
        const item = await deleteMenuItem(id);

        // Invalidate cache strictly AFTER database soft-delete succeeds
        await del(MENU_CACHE_KEY);

        res.status(200).json({ message: 'Menu item deactivated successfully', item });
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            return res.status(404).json({ message: 'Menu item not found' });
        }
        res.status(400).json({ error: error.message });
    }
};
