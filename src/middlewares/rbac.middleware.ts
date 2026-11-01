import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthRequest } from './auth.middleware.js';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError.js';

export const authorize = (...roles: (Role | string | (Role | string)[])[]) => {
    // Array ko flatten karega chahe [Role.STUDENT] bhejo ya Role.STUDENT, Role.STAFF
    const allowedRoles = roles.flat();

    return (req: AuthRequest, _res: Response, next: NextFunction) => {
        if (!req.user) {
            throw new UnauthorizedError('Unauthorized: User not authenticated');
        }

        if (!allowedRoles.includes(req.user.role as Role)) {
            throw new ForbiddenError(
                'Forbidden: You do not have permission to access this resource'
            );
        }

        next();
    };
};
