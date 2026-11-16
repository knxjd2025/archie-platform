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

/** The context last applied to a pooled client, so an unchanged checkout skips the round trip. */
const APPLIED = Symbol('archieTenantApplied');
/** Set once a physical connection has had its session timeouts applied. */
const INITIALISED = Symbol('archieSessionInitialised');
/** The connection's transaction status from its last ReadyForQuery: 'I' idle, 'T' in a transaction, 'E' failed transaction. */
const TX_STATUS = Symbol('archieTxStatus');
type TaggedClient = PoolClient & { [APPLIED]?: string; [INITIALISED]?: boolean; [TX_STATUS]?: string };

/**
 * The database role for deliberate cross-company work (runAsSystem). Row level
 * security gives it every company's rows (migrations/0008). The app's own
 * role, archie_app, may switch to it but does not inherit it. A constant: the
 * role a connection takes comes only from TenantContext.system, never from
 * anything a request supplies.
 */
export const SYSTEM_ROLE = 'archie_system';
/** set_config('role', 'none') is RESET ROLE: back to the role the connection logged in as. */
const NO_ROLE = 'none';

/** The context key of a client with nothing applied: no company, no system access. */
const NONE_KEY = '|';

// One round trip: the company, the role, and (until migration 0008 has run
// everywhere) the old system setting. The role is looked up so that this code
// can be deployed before the migration: without the archie_system role it
// falls back to no role, which under 0008's policies sees nothing (fails
// closed) and under the old policies still sees everything via app.system.
// One statement, so a refused role switch undoes the settings with it, and
// the checkout fails and the connection is thrown away.
const TENANT_SQL = `select set_config($1, $2, false), set_config($3, $4, false),
  set_config('role', coalesce((select rolname::text from pg_roles where rolname = $5), 'none'), false) as role`;
// On a connection's first checkout the timeouts ride along in the same round
// trip. Set per session rather than as startup options, which the Supabase
// pooler may refuse.
const FIRST_CHECKOUT_SQL = `${TENANT_SQL}, set_config($6, $7, false), set_config($8, $9, false)`;

function tenantParams(company: string, system: boolean): unknown[] {
  return ['app.company_id', company, 'app.system', system ? 'on' : '', system ? SYSTEM_ROLE : NO_ROLE];
}

/**
 * A pg Pool that tells every connection it hands out which company the current
 * work is for (server/tenant/context.ts). Row level security in the database
 * reads the company setting; a connection with none set sees no company's rows.
 * System work (runAsSystem) also switches the connection to the archie_system
 * role; everything else switches it back to the login role (archie_app).
 *
 * The company and the role are set on every checkout (or confirmed unchanged),
 * so neither can carry over from one request to the next on a reused
 * connection. Two more guards keep system access from outliving its work:
 * a connection is reset to no company and no role as it is released from
 * system work (and thrown away if that reset fails), and a connection released
 * in the middle of a transaction is thrown away, since a later rollback could
 * otherwise restore settings made inside it.
 * pool.query() goes through connect() too, as do drizzle's transactions.
 */
class TenantPool extends Pool {
  connect(): Promise<PoolClient>;
  connect(cb: (err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => void): void;
  connect(cb?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => void): Promise<PoolClient> | void {
    const ctx = currentTenant();
    const company = ctx?.companyId ?? '';
    const system = ctx?.system === true;
    const key = `${company}|${system ? 'on' : ''}`;
    const acquired = (super.connect() as Promise<PoolClient>).catch((err) => {
      throw isAcquireTimeout(err) ? new DatabaseBusyError(err) : err;
    });
    const ready = acquired.then(async (raw) => {
      const client = raw as TaggedClient;
      watchTxStatus(client);
      if (client[APPLIED] !== key) {
        try {
          const params = tenantParams(company, system);
          if (client[INITIALISED]) await client.query(TENANT_SQL, params);
          else {
            await client.query(FIRST_CHECKOUT_SQL, [
              ...params,
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
      guardRelease(client);
      return client;
    });
    if (!cb) return ready;
    ready.then((client) => cb(undefined, client, client.release.bind(client)), (err) => cb(err, undefined, () => {}));
  }
}

/** Track the transaction status the server reports after every statement. */
function watchTxStatus(client: TaggedClient): void {
  if (client[TX_STATUS] !== undefined) return;
  client[TX_STATUS] = 'I';
  const connection = (client as unknown as { connection?: { prependListener?: Function } }).connection;
  // Prepended, so the status is current before pg runs the query's callback
  // (which may release the client) for the same message.
  connection?.prependListener?.('readyForQuery', (msg: { status?: string }) => { client[TX_STATUS] = msg?.status; });
}

/**
 * Wrap this checkout's release. pg-pool gives each checkout a fresh release
 * function, so the wrapper never stacks.
 */
function guardRelease(client: TaggedClient): void {
  const release = client.release.bind(client) as (err?: Error | boolean) => void;
  let called = false;
  client.release = ((err?: Error | boolean) => {
    // A second release goes straight to pg-pool, which refuses it as before.
    if (called) return release(err);
    called = true;
    if (err) {
      client[APPLIED] = undefined;
      return release(err);
    }
    if (client[TX_STATUS] !== 'I') {
      // Released inside a transaction (or we cannot tell): never hand it on.
      client[APPLIED] = undefined;
      return release(new Error(`connection released with transaction status ${client[TX_STATUS] ?? 'unknown'}`));
    }
    if (!client[APPLIED]?.endsWith('|on')) return release();
    // Leaving system work: drop the role and settings before anyone else can
    // check this connection out. The next checkout sets them again anyway;
    // this makes an idle connection never hold system access.
    client.query(TENANT_SQL, tenantParams('', false)).then(
      () => { client[APPLIED] = NONE_KEY; release(); },
      (e) => { client[APPLIED] = undefined; release(e instanceof Error ? e : new Error(String(e))); },
    );
  }) as PoolClient['release'];
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
