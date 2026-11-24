import 'dotenv/config';
import express, { type Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { tenantFromSession } from './tenant/middleware';
import { registerRoutes } from './routes';
import { recordServerError } from './bugs/routes';
import { seedAll } from './seed';
import { SISTER_PREFIX, sisterRawBody } from './sister/door';
import { corsOptions, sessionOptions, JSON_BODY_LIMIT } from './security-config';
import { createErrorHandler } from './lib/error-response';
import { requestLogger } from './lib/request-log';
import path from 'path';

const app = express();

// Trust proxy for production deployments
app.set('trust proxy', 1);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
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

// Session middleware — Postgres-backed store so sessions survive restarts
app.use(session(sessionOptions()));
// Every request from a signed-in person runs as their company (row level security).
app.use(tenantFromSession);

// Request logging (a photo link's token is never written down: server/lib/request-log.ts)
app.use(requestLogger());

// API routes
registerRoutes(app);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const publicPath = path.join(process.cwd(), 'dist', 'public');
  app.use(express.static(publicPath));

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// Error handling
// A 5xx in production gets generic copy: err.message there is often Drizzle's
// "Failed query: ... params: ..." — SQL and customer values. See
// server/lib/error-response.ts.
app.use(createErrorHandler(recordServerError));

// Start server
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Local development only: one long-lived process, so seeding every company
    // once at start is fine here. The Vercel entry (api/index.ts) never seeds on
    // the request path; see scripts/seed-companies.ts. Failures are logged.
    await seedAll();

    // In development, use Vite middleware (dynamic import to avoid bundling)
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
        root: path.join(process.cwd(), 'client'),
      });

      // Use Vite's connect instance as middleware
      app.use(vite.middlewares);
    }

    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   Archie                                                      ║
║                                                               ║
║   Server running on http://localhost:${PORT}                     ║
║                                                               ║
║   Agents ready:                                               ║
║   • CEO - Chief Executive Officer                             ║
║   • CFO - Chief Financial Officer                             ║
║   • CMO - Chief Marketing Officer                             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
