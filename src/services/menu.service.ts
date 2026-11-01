import prisma from '../config/prisma.js';
import { Prisma } from '@prisma/client';
import { CreateMenuItemInput, UpdateMenuItemInput } from '../validators/menu.validator.js';
import { NotFoundError } from '../errors/AppError.js';

export const createMenuItem = async (data: CreateMenuItemInput) => {
    return await prisma.menuItem.create({
        data,
    });
};

export const getAvailableMenuItems = async () => {
    return await prisma.menuItem.findMany({
        where: {
            isAvailable: true,
        },
    });
};

export const updateMenuItem = async (id: string, data: UpdateMenuItemInput) => {
    try {
        return await prisma.menuItem.update({
            where: { id },
            data,
        });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            throw new NotFoundError('Menu item not found');
        }
        throw err;
    }
};

export const deleteMenuItem = async (id: string) => {
    try {
        // Soft delete: Old orders reference na tutein, isliye record delete na karke isAvailable false karte hain
        return await prisma.menuItem.update({
            where: { id },
            data: {
                isAvailable: false,
            },
        });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
            throw new NotFoundError('Menu item not found');
        }
        throw err;
    }
};
