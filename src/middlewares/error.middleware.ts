import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { AppError, NotFoundError } from '../errors/AppError.js';

/**
 * 404 Handler for undefined routes.
 * Registered after all valid route handlers and delegates to next() with NotFoundError.
 */
export const notFoundHandler = (
    _req: Request,
    _res: Response,
    next: NextFunction
): void => {
    next(new NotFoundError('Route not found'));
};

/**
 * Centralized global error middleware.
 * Must declare exactly 4 arguments (err, req, res, next) so Express detects it as error middleware.
 */
export const errorHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
): void => {
    // If response headers were already sent, delegate to default Express handler
    if (res.headersSent) {
        return _next(err);
    }

    // 1. AppError (operational domain errors) -> use its statusCode and message
    if (err instanceof AppError && err.isOperational) {
        const body: Record<string, unknown> = { message: err.message };
        if (err.details !== undefined) {
            body.details = err.details;
        }
        res.status(err.statusCode).json(body);
        return;
    }

    // 2. ZodError -> 400 with { message, errors: [{ field, message }] }
    if (err instanceof ZodError) {
        res.status(400).json({
            message: 'Validation failed',
            errors: err.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            })),
        });
        return;
    }

    // 3. JWT errors (TokenExpiredError, JsonWebTokenError) -> 401
    if (
        err instanceof jwt.JsonWebTokenError ||
        err instanceof jwt.TokenExpiredError ||
        (typeof err === 'object' &&
            err !== null &&
            'name' in err &&
            ((err as { name: unknown }).name === 'JsonWebTokenError' ||
                (err as { name: unknown }).name === 'TokenExpiredError'))
    ) {
        res.status(401).json({ message: 'Unauthorized: Invalid or expired token' });
        return;
    }

    // 4. body-parser errors: entity.parse.failed -> 400 "Invalid JSON", entity.too.large -> 413
    if (typeof err === 'object' && err !== null && 'type' in err) {
        const errorType = (err as { type: unknown }).type;
        if (errorType === 'entity.parse.failed') {
            res.status(400).json({ message: 'Invalid JSON' });
            return;
        }
        if (errorType === 'entity.too.large') {
            res.status(413).json({ message: 'Payload too large' });
            return;
        }
    }
    if (err instanceof SyntaxError && typeof err === 'object' && err !== null && 'body' in err) {
        res.status(400).json({ message: 'Invalid JSON' });
        return;
    }

    // 5. Prisma errors: P2002 -> 409, P2025 -> 404, P2028 & P2024 -> 503
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
            res.status(409).json({ message: 'Resource already exists' });
            return;
        }
        if (err.code === 'P2025') {
            res.status(404).json({ message: 'Resource not found' });
            return;
        }
        if (err.code === 'P2028' || err.code === 'P2024') {
            res.status(503).json({ message: 'Server is busy, please retry' });
            return;
        }
    }

    // 6. Unknown server errors: log full error on server, never leak message/paths/stack to client
    console.error('[Unhandled Server Error]:', err);
    res.status(500).json({ message: 'Internal server error' });
};
