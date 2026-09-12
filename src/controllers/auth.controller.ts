import { Request, Response } from 'express';
import { registerSchema, loginSchema } from '../validators/auth.validator.js';
import * as authService from '../services/auth.service.js';

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