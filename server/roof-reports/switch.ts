/**
 * The switch for roof reports. Off unless ARCHIE_ROOF_REPORTS is exactly "on".
 * Read fresh on every call, so turning it on or off needs no restart. While it
 * is off every route behind it answers a bare 404 and nothing else changes.
 */
import type { Request, Response, NextFunction } from 'express';

export function roofReportsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.ARCHIE_ROOF_REPORTS === 'on';
}

/** A bare 404 with no body while the feature is off: the route looks like it is not there. */
export function requireRoofReportsOn(_req: Request, res: Response, next: NextFunction): void {
  if (!roofReportsOn()) {
    res.status(404).end();
    return;
  }
  next();
}
