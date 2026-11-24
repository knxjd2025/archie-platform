import express, { type Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { tenantFromSession } from '../server/tenant/middleware';
import { registerRoutes } from '../server/routes';
import { recordServerError } from '../server/bugs/routes';
import { SISTER_PREFIX, sisterRawBody } from '../server/sister/door';
import { corsOptions, sessionOptions, JSON_BODY_LIMIT } from '../server/security-config';
import { createErrorHandler } from '../server/lib/error-response';
import { requestLogger } from '../server/lib/request-log';
import { trustedProxyHops } from '../server/lib/trusted-proxy';

const app = express();

// Trust proxy for production deployments
app.set('trust proxy', trustedProxyHops());

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
// Raw body for Roof Lee's signed requests too: the signature is over the bytes
// as they arrived, so this must stay ahead of express.json (server/sister/door.ts).
app.use(SISTER_PREFIX, sisterRawBody());

// JSON parsing for everything else
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// Session middleware — Postgres-backed store so sessions survive cold starts
app.use(session(sessionOptions()));
// Every request from a signed-in person runs as their company (row level security).
app.use(tenantFromSession);

// Request logging (a photo link's token is never written down: server/lib/request-log.ts)
app.use(requestLogger());

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

// No seeding here. This used to set up every company's advisors and
// knowledge base before a new instance answered its first request: about 17
// queries per company, one company after another, rerun every 60s while any
// company failed. A company is seeded when it is created (provisionCompany in
// server/seed.ts) and backfilled by explicit, idempotent jobs (the
// /api/cron/seed-companies cron and scripts/seed-companies.ts), never on the
// request path.

// Export for Vercel serverless
export default function handler(req: Request, res: Response) {
  return app(req, res);
}
