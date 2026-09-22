import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthRequest } from './auth.middleware.js';

export const authorize = (...roles: (Role | string | (Role | string)[])[]) => {
    // Array ko flatten karega chahe [Role.STUDENT] bhejo ya Role.STUDENT, Role.STAFF
    const allowedRoles = roles.flat();

    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Unauthorized: User not authenticated' });
        }

        if (!allowedRoles.includes(req.user.role as Role)) {
            return res.status(403).json({
                message: 'Forbidden: You do not have permission to access this resource',
            });
        }

        next();
    };
};