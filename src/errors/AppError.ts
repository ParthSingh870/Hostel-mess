export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly details?: unknown;

    constructor(message: string, statusCode: number = 500, details?: unknown) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        this.details = details;
        this.name = this.constructor.name;

        // Restore prototype chain for instanceof checks when extending built-in Error
        Object.setPrototypeOf(this, new.target.prototype);

        // Capture stack trace excluding constructor call from trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export class NotFoundError extends AppError {
    constructor(message: string = 'Resource not found', details?: unknown) {
        super(message, 404, details);
    }
}

export class ConflictError extends AppError {
    constructor(message: string = 'Conflict detected', details?: unknown) {
        super(message, 409, details);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = 'Unauthorized', details?: unknown) {
        super(message, 401, details);
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string = 'Forbidden', details?: unknown) {
        super(message, 403, details);
    }
}

// --- Domain-Specific Subclasses ---

/**
 * Thrown when an item is deactivated or has insufficient stock.
 * Single source of truth for the status code (STATUS_CODE = 400).
 * Can be changed in a single line if needed in the future.
 */
export class ItemUnavailableError extends AppError {
    public static readonly STATUS_CODE = 400;

    constructor(message: string = 'Item is unavailable', details?: unknown) {
        super(message, ItemUnavailableError.STATUS_CODE, details);
    }
}

/**
 * Thrown when an order is not found by ID.
 * Inherits HTTP 404 from NotFoundError.
 */
export class OrderNotFoundError extends NotFoundError {
    constructor(message: string = 'Order not found', details?: unknown) {
        super(message, details);
    }
}

/**
 * Thrown when an invalid order status transition is attempted (e.g. PLACED -> COMPLETED).
 * Single source of truth for the status code (STATUS_CODE = 400).
 */
export class InvalidStatusTransitionError extends AppError {
    public static readonly STATUS_CODE = 400;

    constructor(message: string = 'Invalid status transition', details?: unknown) {
        super(message, InvalidStatusTransitionError.STATUS_CODE, details);
    }
}

/**
 * Legacy compatibility alias: BusinessError is directly mapped to ItemUnavailableError.
 * Preserves existing `instanceof BusinessError` checks throughout the codebase.
 */
export const BusinessError = ItemUnavailableError;
export type BusinessError = ItemUnavailableError;
