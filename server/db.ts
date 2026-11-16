import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
// The subpath, so tests that mock '@vercel/functions' (waitUntil) do not need to stub this too.
import { attachDatabasePool } from '@vercel/functions/db-connections';
import * as schema from '../shared/schema';
import { registerUtcTimestampParser } from './lib/pg-timestamps';
import { currentTenant } from './tenant/context';

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

/**
 * Pool and session limits. Each is an env var so the operator can tune it
 * without a deploy; the defaults suit many small serverless instances.
 *
 * Capacity, as company count grows: every concurrent Vercel instance can hold
 * up to DB_POOL_MAX clients, and on the Supabase session pooler each client
 * holds one Postgres backend. So (busy instances x DB_POOL_MAX) must stay
 * under the pooler's pool size, which in turn sits under Postgres
 * max_connections for the compute size. Check, in Supabase: Database >
 * Settings > Connection pooling (pool size) and the compute add-on's
 * max_connections; in Vercel: the function's peak concurrent instances.
 * See docs/archie/01-multi-company.md, "Capacity".
 */
export const DB_LIMITS = {
  /** Clients per instance. Low on purpose: instances multiply. */
  max: envInt('DB_POOL_MAX', 5),
  /** Let idle clients go quickly, so an instance about to be frozen holds none. */
  idleTimeoutMs: envInt('DB_IDLE_TIMEOUT_MS', 5_000),
  /** How long a query waits for a free client before failing with a clear error. */
  acquireTimeoutMs: envInt('DB_CONNECT_TIMEOUT_MS', 5_000),
  /** Postgres cancels any one statement that runs longer. */
  statementTimeoutMs: envInt('DB_STATEMENT_TIMEOUT_MS', 30_000),
  /** Postgres ends a session left idle inside an open transaction this long. */
  idleInTransactionTimeoutMs: envInt('DB_IDLE_IN_TXN_TIMEOUT_MS', 60_000),
};

/** Thrown when no pooled client frees up in time: the database is saturated, not broken. */
export class DatabaseBusyError extends Error {
  readonly status = 503;
  constructor(cause: unknown) {
    super(`Database busy: no connection became free within ${DB_LIMITS.acquireTimeoutMs}ms `
      + `(this instance holds at most ${DB_LIMITS.max}). Try again shortly.`, { cause });
    this.name = 'DatabaseBusyError';
  }
}

const isAcquireTimeout = (err: unknown): boolean =>
  err instanceof Error && /timeout exceeded when trying to connect|terminated due to connection timeout/i.test(err.message);

// Supabase's transaction pooler (port 6543) hands each statement to whichever
// server connection is free, so the per-connection company setting below would
// not stick. Archie needs the session pooler (5432) or a direct connection.
if (/pooler\.supabase\.com:6543/.test(databaseUrl) && process.env.ARCHIE_ALLOW_TXN_POOLER !== '1') {
  throw new Error('DATABASE_URL points at the Supabase transaction pooler (6543). Use the session pooler (5432): company isolation depends on per-connection settings.');
}

/** The settings last applied to a pooled client, so an unchanged checkout skips the round trip. */
const APPLIED = Symbol('archieTenantApplied');
/** Set once a physical connection has had its session timeouts applied. */
const INITIALISED = Symbol('archieSessionInitialised');
type TaggedClient = PoolClient & { [APPLIED]?: string; [INITIALISED]?: boolean };

const TENANT_SQL = 'select set_config($1, $2, false), set_config($3, $4, false)';
// On a connection's first checkout the timeouts ride along in the same round
// trip. Set per session rather than as startup options, which the Supabase
// pooler may refuse.
const FIRST_CHECKOUT_SQL = `${TENANT_SQL}, set_config($5, $6, false), set_config($7, $8, false)`;

/**
 * A pg Pool that tells every connection it hands out which company the current
 * work is for (server/tenant/context.ts). Row level security in the database
 * reads these settings; a connection with none set sees no company's rows.
 *
 * Both are set on every checkout (or confirmed unchanged), so a setting can
 * never carry over from one request to the next on a reused connection.
 * pool.query() goes through connect() too, as do drizzle's transactions.
 */
class TenantPool extends Pool {
  connect(): Promise<PoolClient>;
  connect(cb: (err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => void): void;
  connect(cb?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => void): Promise<PoolClient> | void {
    const ctx = currentTenant();
    const company = ctx?.companyId ?? '';
    const system = ctx?.system ? 'on' : '';
    const key = `${company}|${system}`;
    const acquired = (super.connect() as Promise<PoolClient>).catch((err) => {
      throw isAcquireTimeout(err) ? new DatabaseBusyError(err) : err;
    });
    const ready = acquired.then(async (raw) => {
      const client = raw as TaggedClient;
      if (client[APPLIED] !== key) {
        try {
          const tenant = ['app.company_id', company, 'app.system', system];
          if (client[INITIALISED]) await client.query(TENANT_SQL, tenant);
          else {
            await client.query(FIRST_CHECKOUT_SQL, [
              ...tenant,
              'statement_timeout', `${DB_LIMITS.statementTimeoutMs}ms`,
              'idle_in_transaction_session_timeout', `${DB_LIMITS.idleInTransactionTimeoutMs}ms`,
            ]);
            client[INITIALISED] = true;
          }
          client[APPLIED] = key;
        } catch (err) {
          // Unknown state: throw this connection away rather than reuse it.
          client[APPLIED] = undefined;
          client.release(err as Error);
          throw err;
        }
      }
      return client;
    });
    if (!cb) return ready;
    ready.then((client) => cb(undefined, client, client.release.bind(client)), (err) => cb(err, undefined, () => {}));
  }
}

export const pool = new TenantPool({
  connectionString: databaseUrl,
  // Every Vercel instance holds its own pool and instances multiply under
  // load, so the per-instance cap is small (see DB_LIMITS). At least 2: the
  // knowledge seed holds a transaction while its inserts use another client.
  max: Math.max(2, DB_LIMITS.max),
  // Let idle clients go before the pooler or a frozen instance drops them.
  idleTimeoutMillis: DB_LIMITS.idleTimeoutMs,
  // A saturated pool fails fast (DatabaseBusyError, 503) instead of hanging
  // the request until Vercel kills the function at 300s.
  connectionTimeoutMillis: DB_LIMITS.acquireTimeoutMs,
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

// On Vercel Fluid compute, keep the instance alive just long enough after the
// last release for idle clients to close (idleTimeoutMillis), so a suspended
// instance does not hold pooler slots. A no-op outside Vercel.
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });

console.log(`[DB] Connected to ${isSupabase ? 'Supabase' : 'PostgreSQL'}`);

export type DB = typeof db;
