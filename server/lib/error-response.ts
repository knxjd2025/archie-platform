/**
 * What the last-resort Express error handlers (server/index.ts, api/index.ts)
 * tell the browser.
 *
 * They used to send `err.message` for every status, so a query that threw in
 * production answered the client with Drizzle's "Failed query: select ... params:
 * ..." — table names, columns and the parameter values themselves. A 4xx is a
 * route saying no on purpose and its message is meant to be read; a 5xx is a
 * failure nobody wrote copy for, so in production it gets a generic line and the
 * detail stays in the server log.
 */
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

/** Same wording as server/lib/failure.ts, so a failure reads the same either way. */
export const GENERIC_SERVER_ERROR =
  "Something went wrong on our end. Try again — if it keeps happening, report it with the bug button.";

/** The status an error asks for; anything missing or out of range is a 500. */
export function errorStatus(err: unknown): number {
  const e = (err && typeof err === 'object' ? err : {}) as { status?: unknown; statusCode?: unknown };
  const raw = Number(e.status ?? e.statusCode);
  return Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
}

/** The message safe to send for this error at this status. */
export function clientErrorMessage(err: unknown, status: number, production: boolean): string {
  const carried = err && typeof err === 'object' ? (err as { message?: unknown }).message : err;
  const message = typeof carried === 'string' ? carried : '';
  if (status >= 500) return production ? GENERIC_SERVER_ERROR : message || 'Internal server error';
  return message || 'Request failed';
}

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

type ServerErrorRecorder = (what: string, err: unknown, req: Request) => void;

/**
 * The last-resort handler both entrypoints mount. `record` is the bug log
 * (recordServerError), passed in so this file stays free of the database.
 */
export function createErrorHandler(record: ServerErrorRecorder): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err);
    const status = errorStatus(err);
    if (status >= 500) record(`${req.method} ${req.route?.path ?? req.path}`, err, req);
    const stack = err instanceof Error ? err.stack : undefined;
    res.status(status).json({
      message: clientErrorMessage(err, status, isProduction()),
      ...(!isProduction() && { stack }),
    });
  };
}
