import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 does not catch a rejected promise thrown inside an async route
 * handler — without this, an unexpected error (a DB hiccup, a null a `!`
 * assertion didn't actually guarantee) hangs the request forever instead of
 * reaching the global error middleware or returning a 500.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
