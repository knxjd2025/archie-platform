/**
 * The request log, and the one rule about what it may write down.
 *
 * A report page shows its photos from short signed links whose token is part of
 * the address: the page is sandboxed (no cookie, no header, and no script that
 * may connect anywhere), so an address is all an image has. The token works for
 * ten minutes and is a credential for one photo copy while it does. Nothing the
 * app writes may hold it: the request log below, and the address a recorded
 * server failure keeps (server/bugs/routes.ts) both go through `loggablePath`.
 * (The host's own access logs are not the app's to change; the token is short
 * lived and for one photo for that reason.)
 */
import type { NextFunction, Request, Response } from 'express';

/** The photo link's address: its token is the rest of the path segment. */
const PHOTO_LINK = /(\/api\/roof-reports\/linked-photo\/)[^/?#\s]+/g;

/** An address, or a line holding one, with the token of a photo link hidden. Anything else comes back as it was. */
export function loggablePath(value: string): string {
  return typeof value === 'string' ? value.replace(PHOTO_LINK, '$1[token]') : '';
}

/** One line for every API request when it finishes: the method, the address, the status and the time. */
export function requestLogger(write: (line: string) => void = (line) => console.log(line)) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    const path = req.path;
    let logged = false;
    res.on('finish', () => {
      if (logged) return;
      logged = true;
      if (path.startsWith('/api')) write(`${req.method} ${loggablePath(path)} ${res.statusCode} - ${Date.now() - start}ms`);
    });
    next();
  };
}
