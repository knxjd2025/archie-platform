import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../shared/schema';
import { registerUtcTimestampParser } from './lib/pg-timestamps';

// Before any pool is created: naive timestamps must read back as the instant
// they were written, not as local time. See lib/pg-timestamps.ts.
registerUtcTimestampParser();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const databaseUrl = process.env.DATABASE_URL;
const isSupabase = databaseUrl.includes('supabase.com') || databaseUrl.includes('pooler.supabase');

/** Integer env var with a fallback when unset or not a positive number. */
function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const pool = new Pool({
  connectionString: databaseUrl,
  // Every Vercel instance holds its own pool, so the old default of 20 per
  // instance multiplied across concurrent instances and ran the Supabase
  // pooler out of client slots. Not as low as a request needs, though: one
  // instance serves several requests at once, and each now reads the roster
  // to re-check the session, so 10 leaves room before requests queue.
  max: envInt('DB_POOL_MAX', 10),
  // Let idle clients go before the pooler or a frozen instance drops them.
  idleTimeoutMillis: envInt('DB_IDLE_TIMEOUT_MS', 10_000),
  // Without this a saturated pooler made a query wait forever for a client,
  // and the request hung until Vercel killed the function at 300s.
  connectionTimeoutMillis: envInt('DB_CONNECT_TIMEOUT_MS', 10_000),
  // Supabase's pooler presents a cert that Node won't verify against its default
  // CA bundle. Do NOT rely on `sslmode=require` in the URL — recent `pg` treats
  // `require` as `verify-full`, which rejects the self-signed chain. Instead force
  // TLS-on / verify-off here for Supabase (or any other Postgres host that needs it).
  ssl: isSupabase || databaseUrl.includes('sslmode') ? { rejectUnauthorized: false } : undefined,
});

// An idle client that the pooler disconnects emits 'error' on the pool; with
// no listener, Node treats that as an unhandled error and the whole process
// exits. The pool discards the broken client by itself, so log and carry on.
pool.on('error', (err) => {
  console.error('[DB] idle client error (client discarded):', err.message);
});

export const db = drizzle(pool, { schema });

console.log(`[DB] Connected to ${isSupabase ? 'Supabase' : 'PostgreSQL'}`);

export type DB = typeof db;
