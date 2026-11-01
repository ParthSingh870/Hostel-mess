import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncController<P = any, ResBody = any, ReqBody = any, ReqQuery = any> = (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction
) => Promise<unknown>;

/**
 * Wraps an async route handler or middleware to catch any rejected promises
 * and pass the error to Express's next() function for centralized handling.
 */
export const catchAsync = <P = any, ResBody = any, ReqBody = any, ReqQuery = any>(
    fn: AsyncController<P, ResBody, ReqBody, ReqQuery>
): RequestHandler<P, ResBody, ReqBody, ReqQuery> => {
    return (req, res, next): void => {
        fn(req, res, next).catch(next);
    };
};
