import { Request, Response } from 'express';
import {
    createMenuItem,
    getAvailableMenuItems,
    updateMenuItem,
    deleteMenuItem,
} from '../services/menu.service.js';

import {
    createMenuItemSchema,
    updateMenuItemSchema,
} from '../validators/menu.validator.js';

export const createItem = async (req: Request, res: Response) => {
    try {
        const validatedData = createMenuItemSchema.parse(req.body);
        const item = await createMenuItem(validatedData);
        res.status(201).json(item);
    } catch (error: any) {
        res.status(400).json({ error: error.errors || error.message });
    }
};

export const getItems = async (_req: Request, res: Response) => {
    try {
        const items = await getAvailableMenuItems();
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
        res.status(200).json(item);
    } catch (error: any) {
        res.status(400).json({ error: error.errors || error.message });
    }
};

export const deleteItem = async (req: Request<{ id: string }>, res: Response) => {
    try {
        const { id } = req.params;
        const item = await deleteMenuItem(id);
        res.status(200).json({ message: 'Menu item deactivated successfully', item });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
};