import express, { type Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { tenantFromSession } from '../server/tenant/middleware';
import { registerRoutes } from '../server/routes';
import { recordServerError } from '../server/bugs/routes';
import { createSeedOnce, seedAll } from '../server/seed';
import { corsOptions, sessionOptions, JSON_BODY_LIMIT } from '../server/security-config';
import { clientErrorMessage, createErrorHandler, isProduction } from '../server/lib/error-response';

const app = express();

// Trust proxy for production deployments
app.set('trust proxy', 1);

// Middleware
app.use(helmet({
  // API-only responses (no HTML served from here), so a restrictive default-src
  // CSP would just be noise — the headers that matter for a JSON API are
  // frameguard/noSniff/HSTS, which helmet enables by default.
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors(corsOptions()));

// Raw body for webhooks (before JSON parsing)
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

// JSON parsing for everything else
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// Session middleware — Postgres-backed store so sessions survive cold starts
app.use(session(sessionOptions()));
// Every request from a signed-in person runs as their company (row level security).
app.use(tenantFromSession);

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  const reqPath = req.path;
  let logged = false;

  _res.on('finish', () => {
    if (!logged) {
      const duration = Date.now() - start;
      if (reqPath.startsWith('/api')) {
        console.log(`${req.method} ${reqPath} ${_res.statusCode} - ${duration}ms`);
      }
      logged = true;
    }
  });

  next();
});

// Unauthenticated liveness check, deliberately minimal — no config/integration
// detail (a prior version leaked which API keys were configured to anyone).
app.get('/api/ping', (_req: Request, res: Response) => {
  res.json({ pong: true, timestamp: new Date().toISOString() });
});

// API routes
registerRoutes(app);

// Error handling
// A 5xx in production gets generic copy: err.message there is often Drizzle's
// "Failed query: ... params: ..." — SQL and customer values. See
// server/lib/error-response.ts.
app.use(createErrorHandler(recordServerError));

// Seed on cold start. One shared run per instance: requests that arrive while
// it is going wait on that run instead of each starting their own, and once it
// has succeeded no request waits at all. See createSeedOnce in server/seed.ts.
const ensureSeeded = createSeedOnce(seedAll);

// Export for Vercel serverless
export default async function handler(req: Request, res: Response) {
  try {
    await ensureSeeded();
    return app(req, res);
  } catch (error: any) {
    console.error('Handler error:', error);
    // A failed seed is a database error, and its message is the query that failed.
    res.status(500).json({
      error: 'Internal Server Error',
      message: clientErrorMessage(error, 500, isProduction()),
      stack: !isProduction() ? error?.stack : undefined
    });
  }
}
