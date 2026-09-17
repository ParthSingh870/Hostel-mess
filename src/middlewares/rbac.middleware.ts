import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware.js';

export const authorize = (...allowedRoles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Unauthorized: User not authenticated' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: 'Forbidden: You do not have permission to access this resource',
            });
        }

        next();
    };
};