import prisma from '../config/prisma.js';
import { CreateMenuItemInput, UpdateMenuItemInput } from '../validators/menu.validator.js';

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
    return await prisma.menuItem.update({
        where: { id },
        data,
    });
};

export const deleteMenuItem = async (id: string) => {
    // Soft delete: Old orders reference na tutein, isliye record delete na karke isAvailable false karte hain
    return await prisma.menuItem.update({
        where: { id },
        data: {
            isAvailable: false,
        },
    });
};