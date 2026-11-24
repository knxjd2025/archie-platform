/**
 * CORS for the vendored motion files (client/public/roof-reports/motion).
 *
 * A report page runs in a sandbox with no origin of its own and loads these two
 * scripts from the app with an `integrity` hash, which makes the load a CORS
 * request: the response must allow it. The host's static files already do. When
 * the app serves the files itself (production, server/index.ts), this handler
 * adds the same answer for that one folder and nothing else: any origin may
 * read a public library file, never with credentials.
 */
import type { RequestHandler } from 'express';

export function motionFilesCors(): RequestHandler {
  return (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, HEAD');
      res.status(204).end();
      return;
    }
    next();
  };
}
