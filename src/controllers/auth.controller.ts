import { Request, Response } from 'express';
import {
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    logoutSchema,
} from '../validators/auth.validator.js';
import * as authService from '../services/auth.service.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { catchAsync } from '../utils/catchAsync.js';
import { UnauthorizedError, NotFoundError } from '../errors/AppError.js';

export const register = catchAsync(async (req: Request, res: Response) => {
    const validatedData = registerSchema.parse(req.body);
    const user = await authService.registerUser(validatedData);

    return res.status(201).json({
        message: 'User registered successfully',
        data: user,
    });
});

export const login = catchAsync(async (req: Request, res: Response) => {
    const validatedData = loginSchema.parse(req.body);
    const result = await authService.loginUser(validatedData);

    return res.status(200).json({
        message: 'Login successful',
        data: result,
    });
});

export const refreshToken = catchAsync(async (req: Request, res: Response) => {
    const validatedData = refreshTokenSchema.parse(req.body);
    const result = await authService.refreshAccessToken(validatedData.refreshToken);

    return res.status(200).json({
        message: 'Access token refreshed successfully',
        data: result,
    });
});

export const getProfile = catchAsync(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
        throw new UnauthorizedError('Unauthorized: User ID missing');
    }

    const user = await authService.getUserProfile(userId);

    if (!user) {
        throw new NotFoundError('User not found');
    }

    return res.status(200).json({
        message: 'Profile fetched successfully',
        data: user,
    });
});

export const logout = catchAsync(async (req: Request, res: Response) => {
    const validatedData = logoutSchema.parse(req.body);
    await authService.revokeRefreshToken(validatedData.refreshToken);

    return res.status(200).json({
        message: 'Logged out successfully',
    });
});
