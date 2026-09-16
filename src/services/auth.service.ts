import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { RegisterInput, LoginInput } from '../validators/auth.validator.js';

// Define the payload structure
interface TokenPayload {
    userId: string;
    role: string;
}

// Helper to generate access token (15 mins validity)
export const generateAccessToken = (userId: string, role: string): string => {
    return jwt.sign(
        { userId, role },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '15m' }
    );
};

// Helper to generate refresh token (7 days validity)
export const generateRefreshToken = (userId: string, role: string): string => {
    return jwt.sign(
        { userId, role },
        process.env.JWT_REFRESH_SECRET || 'default_refresh_secret',
        { expiresIn: '7d' }
    );
};

export const registerUser = async (data: RegisterInput) => { //registerUser ek function hai jo data naam ka input lega, aur us data ka structure RegisterInput (jo auth.validator.js mein define hai) jaisa hona chahiye.
    const existingUser = await prisma.user.findUnique({
        where: { email: data.email },
    });

    if (existingUser) {
        throw new Error('User already exists with this email');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
        data: {
            name: data.name,
            email: data.email,
            password: hashedPassword,
            role: data.role,
        },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
        },
    });

    return user;
};

export const loginUser = async (data: LoginInput) => {
    const user = await prisma.user.findUnique({
        where: { email: data.email },
    });

    if (!user) {
        throw new Error('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    if (!isPasswordValid) {
        throw new Error('Invalid email or password');
    }

    // Generate both short-lived access token and long-lived refresh token
    const accessToken = generateAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken(user.id, user.role);

    return {
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
        accessToken,
        refreshToken,
    };
};

export const getUserProfile = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
        },
    });

    return user;
};

export const refreshAccessToken = async (refreshToken: string) => {
    // 1. Verify refresh token signature & expiration
    let decoded: TokenPayload;
    try {
        decoded = jwt.verify(
            refreshToken,
            process.env.JWT_REFRESH_SECRET || 'default_refresh_secret'
        ) as TokenPayload;
    } catch (error) {
        throw new Error('Invalid or expired refresh token');
    }

    // 2. Ensure user still exists in database
    const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
    });

    if (!user) {
        throw new Error('User not found');
    }

    // 3. Issue new short-lived access token
    const newAccessToken = generateAccessToken(user.id, user.role);

    return { accessToken: newAccessToken };
};