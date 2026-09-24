import { Request, Response, NextFunction } from 'express';
import { registerSchema, loginSchema, refreshTokenSchema, logoutSchema } from '../validators/auth.validator.js';
import * as authService from '../services/auth.service.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const register = async (req: Request, res: Response) => {
    try {
        const validatedData = registerSchema.parse(req.body);

        const user = await authService.registerUser(validatedData);

        return res.status(201).json({
            message: 'User registered successfully',
            data: user,
        });
    } catch (error: any) {
        return res.status(400).json({
            error: error.errors || error.message || 'Registration failed',
        });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const validatedData = loginSchema.parse(req.body);
        const result = await authService.loginUser(validatedData);

        return res.status(200).json({
            message: 'Login successful',
            data: result,
        });
    } catch (error: any) {
        return res.status(400).json({
            error: error.errors || error.message || 'Login failed',
        });
    }
};

export const refreshToken = async (req: Request, res: Response) => {
    try {
        const validatedData = refreshTokenSchema.parse(req.body);
        const result = await authService.refreshAccessToken(validatedData.refreshToken);
        return res.status(200).json({
            message: 'Access token refreshed successfully',
            data: result,
        });
    } catch (error: any) {
        return res.status(401).json({
            error: error.errors || error.message || 'Token refresh failed',
        });
    }
};

export const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User ID missing' });
        }

        const user = await authService.getUserProfile(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json({
            message: 'Profile fetched successfully',
            data: user,
        });
    } catch (error: any) {
        return res.status(500).json({
            message: 'Error fetching profile',
            error: error.message,
        });
    }
};

export const logout = async (req: Request, res: Response) => {
    try {
        const validatedData = logoutSchema.parse(req.body);
        await authService.revokeRefreshToken(validatedData.refreshToken);
        return res.status(200).json({
            message: 'Logged out successfully',
        });
    } catch (error: any) {
        return res.status(400).json({
            error: error.errors || error.message || 'Logout failed',
        });
    }
};