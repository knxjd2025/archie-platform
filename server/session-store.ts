import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { pool } from './db';

// Postgres-backed session store shared by the local dev entrypoint (server/index.ts)
// and the Vercel serverless entrypoint (api/index.ts) so sessions survive restarts
// and cold starts instead of living in express-session's default in-memory store.
export function createSessionStore(): session.Store | undefined {
  if (!process.env.DATABASE_URL) return undefined;

  // The app's own pool (server/db.ts), not a second one. This store used to
  // build its own pg Pool with the default of 10 clients and no 'error'
  // listener, so every serverless instance held two pools against the
  // Supabase pooler's client limit, and an idle session connection dropped by
  // the pooler crashed the process. connect-pg-simple takes an existing pool
  // and, since it did not create it, never closes it.
  const PgSession = connectPgSimple(session);
  return new PgSession({
    pool,
    createTableIfMissing: true,
  });
}
