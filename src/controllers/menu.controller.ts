import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
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

export const updateItem = async (req: Request<{ id: string }>, res: Response) => {//here req: Request<{ id: string }> indicates that the request object is expected to have a parameter id of type string. This is useful for TypeScript to provide type checking and autocompletion for the request parameters, ensuring that the id parameter is treated as a string throughout the function. It helps prevent potential runtime errors by catching type mismatches during development.
    try {
        const { id } = req.params;
        const validatedData = updateMenuItemSchema.parse(req.body);
        const item = await updateMenuItem(id, validatedData);
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
        res.status(200).json({ message: 'Menu item deactivated successfully', item });
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {// P2025 error code indicates that the record to be updated was not found and instanceof Prisma.PrismaClientKnownRequestError is used to check if the error is a known request error from Prisma. If both conditions are true, it means that the menu item with the given ID was not found in the database, and a 404 Not Found response is returned with an appropriate message.This is used to prevent from leaking sensitive information about the database structure or the existence of certain records to the client. Instead, it provides a clear and user-friendly message indicating that the requested menu item could not be found.
            return res.status(404).json({ message: 'Menu item not found' });
        }
        res.status(400).json({ error: error.message });
    }
};