import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

export interface AuthRequest extends Request {
    user?: {
        userId: string;
        role: Role | string;
    };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized: Token missing' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key') as {
            userId: string;
            role: string;
        };
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
    }
};

export const authorize = (...allowedRoles: any[]) => {
    // Array ko flatten karega taaki [['STUDENT']] seedha ['STUDENT'] ban jaye
    const roles = allowedRoles.flat();

    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Unauthorized: User not authenticated' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                message: 'Forbidden: You do not have permission to perform this action',
            });
        }

        next();
    };
};