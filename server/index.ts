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
import { initOutreachScheduler } from './outreach/outreach-scheduler';
import { corsOptions, sessionOptions, JSON_BODY_LIMIT } from './security-config';
import { createErrorHandler } from './lib/error-response';
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

// JSON parsing for everything else
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// Session middleware — Postgres-backed store so sessions survive restarts
app.use(session(sessionOptions()));
// Every request from a signed-in person runs as their company (row level security).
app.use(tenantFromSession);

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  const path = req.path;
  let logged = false;

  _res.on('finish', () => {
    if (!logged) {
      const duration = Date.now() - start;
      if (path.startsWith('/api')) {
        console.log(`${req.method} ${path} ${_res.statusCode} - ${duration}ms`);
      }
      logged = true;
    }
  });

  next();
});

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
    // Seed default agents and knowledge base on startup
    await seedAll();

    // Initialize outreach scheduler
    initOutreachScheduler({
      brightDataApiKey: process.env.BRIGHTDATA_API_KEY,
      hunterApiKey: process.env.HUNTER_IO_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
    });

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
      const outreachEnabled = process.env.ENABLE_OUTREACH === 'true';
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🏠 Best Roofing Now AI Executive Team                       ║
║                                                               ║
║   Server running on http://localhost:${PORT}                     ║
║                                                               ║
║   Agents ready:                                               ║
║   • CEO - Chief Executive Officer                             ║
║   • CFO - Chief Financial Officer                             ║
║   • CMO - Chief Marketing Officer                             ║
║                                                               ║
║   Outreach Automation: ${outreachEnabled ? '✅ ENABLED' : '❌ DISABLED'}                        ║
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
