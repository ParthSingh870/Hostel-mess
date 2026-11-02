import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../../src/config/prisma.js';

/**
 * Generates a unique test email to avoid cross-test and cross-run collision
 */
export const generateUniqueEmail = (prefix: string = 'test'): string => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${timestamp}-${random}@test.com`;
};

/**
 * Creates a user directly in the test database for test preparation
 */
export const createTestUser = async (
    role: Role = Role.STUDENT,
    customPassword = 'Password123!',
    email?: string
) => {
    const userEmail = email || generateUniqueEmail(role.toLowerCase());
    const hashedPassword = await bcrypt.hash(customPassword, 10);

    const user = await prisma.user.create({
        data: {
            name: `Test ${role}`,
            email: userEmail,
            password: hashedPassword,
            role,
        },
    });

    const token = jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET as string,
        { expiresIn: '15m' }
    );

    return { user, password: customPassword, token };
};

/**
 * Creates a menu item directly in the test database
 */
export const createTestMenuItem = async (overrides: Partial<{
    name: string;
    description: string;
    price: number;
    category: string;
    stockCount: number;
    isAvailable: boolean;
}> = {}) => {
    return await prisma.menuItem.create({
        data: {
            name: overrides.name || `Item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            description: overrides.description || 'Test food item description',
            price: overrides.price ?? 100,
            category: overrides.category || 'Lunch',
            stockCount: overrides.stockCount ?? 10,
            isAvailable: overrides.isAvailable ?? true,
        },
    });
};

/**
 * Generates an instantly expired JWT access token
 */
export const generateExpiredToken = (userId: string, role: string = 'STUDENT'): string => {
    return jwt.sign(
        { userId, role },
        process.env.JWT_SECRET as string,
        { expiresIn: '1ms' }
    );
};
