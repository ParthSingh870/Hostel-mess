import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { UnauthorizedError } from '../errors/AppError.js';

export interface AuthRequest extends Request {
    user?: {
        userId: string;
        role: Role | string;
    };
}

export const authenticate = (req: AuthRequest, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedError('Unauthorized: Token missing');
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
            userId: string;
            role: string;
        };
        req.user = decoded;
        next();
    } catch (error) {
        throw new UnauthorizedError('Unauthorized: Invalid or expired token');
    }
};
