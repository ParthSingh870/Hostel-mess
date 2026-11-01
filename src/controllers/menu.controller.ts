import { Request, Response } from 'express';
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
import { catchAsync } from '../utils/catchAsync.js';

// Read TTL from environment variable with 60 seconds fallback safety net
const MENU_CACHE_TTL_SECONDS = Number(process.env.MENU_CACHE_TTL_SECONDS) || 60;

export const createItem = catchAsync(async (req: Request, res: Response) => {
    const validatedData = createMenuItemSchema.parse(req.body);
    const item = await createMenuItem(validatedData);

    // Invalidate cache strictly AFTER database insert succeeds
    await del(MENU_CACHE_KEY);

    return res.status(201).json(item);
});

export const getItems = catchAsync(async (_req: Request, res: Response) => {
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

    return res.status(200).json(items);
});

export const updateItem = catchAsync(async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const validatedData = updateMenuItemSchema.parse(req.body);
    const item = await updateMenuItem(id, validatedData);

    // Invalidate cache strictly AFTER database update succeeds
    await del(MENU_CACHE_KEY);

    return res.status(200).json(item);
});

export const deleteItem = catchAsync(async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const item = await deleteMenuItem(id);

    // Invalidate cache strictly AFTER database soft-delete succeeds
    await del(MENU_CACHE_KEY);

    return res.status(200).json({ message: 'Menu item deactivated successfully', item });
});
