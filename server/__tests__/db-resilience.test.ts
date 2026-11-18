/**
 * The pool under real failure, against the local test database:
 * - a connection killed while checked out (an operator, the pooler, or the
 *   idle-in-transaction timeout) must not crash the process, and the next
 *   query must work;
 * - a full pool must answer 503 with Retry-After through a real route, even
 *   though drizzle wraps the error, and must not be recorded as a bug.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { Client, type PoolClient } from 'pg';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';

const url = process.env.DATABASE_URL || '';
const ownerUrl = process.env.ARCHIE_TEST_OWNER_URL || '';
const isLocal = (u: string) => /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(u);

describe('connection capacity errors', async () => {
  const { isConnectionCapacityError, findDatabaseBusy, DatabaseBusyError } = await import('../lib/db-busy');
  it('treats a full server or pooler as busy, and nothing else', () => {
    const full = [
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
      new Error('remaining connection slots are reserved for non-replication superuser connections'),
      new Error('Max client connections reached'),
      new Error('no more connections allowed (max_client_conn)'),
      new Error('timeout exceeded when trying to connect'),
    ];
    for (const e of full) expect(isConnectionCapacityError(e), e.message).toBe(true);
    expect(isConnectionCapacityError(new Error('password authentication failed for user "archie_app"'))).toBe(false);
  });
  it('finds a busy error however deeply it is wrapped', () => {
    const busy = new DatabaseBusyError('x', null);
    const wrapped = new Error('Failed query: select 1', { cause: new Error('middle', { cause: busy }) });
    expect(findDatabaseBusy(wrapped)).toBe(busy);
    expect(findDatabaseBusy(new Error('other'))).toBeNull();
  });
});

describe.skipIf(!isLocal(url) || !isLocal(ownerUrl))('pool resilience', async () => {
  const { db, pool } = await import('../db');
  const { runAsCompany, runAsSystem } = await import('../tenant/context');
  const { createCompany } = await import('../tenant/companies');
  const schema = await import('../../shared/schema');
  const { createErrorHandler } = await import('../lib/error-response');
  const { sendFailure, onServerFailure } = await import('../lib/failure');
  const { tenantFromSession } = await import('../tenant/middleware');
  const { registerTeamRoutes } = await import('../auth/team-routes');
  const { clearSessionRevalidationCache } = await import('../auth/middleware');

  const owner = new Client({ connectionString: ownerUrl });
  const uncaught: unknown[] = [];
  const onUncaught = (e: unknown) => { uncaught.push(e); };
  const tag = `resil-${process.pid}-${Date.now()}`;
  let company = '';
  let server: Server;
  let base = '';
  const recorded = vi.fn();
  const observed = vi.fn();
  let capturedBusy: unknown = null;

  beforeAll(async () => {
    await owner.connect();
    process.on('uncaughtException', onUncaught);
    company = (await createCompany({ slug: tag, name: 'Resilience Co', status: 'active' })).id;
    await runAsCompany(company, () => db.insert(schema.teamMembers).values({ name: 'Admin', email: `${tag}@example.test`, role: 'admin', canLogin: true }), { loadProfile: false });

    const app = express();
    app.use((req: any, _res, next) => {
      req.session = { user: { email: `${tag}@example.test`, name: 'Admin', role: 'admin', companyId: company }, destroy: (cb: () => void) => cb() };
      next();
    });
    app.use(tenantFromSession);
    registerTeamRoutes(app);
    app.get('/test/send-failure', (_req, res) => { sendFailure(res, capturedBusy, 'GET /test/send-failure'); });
    app.use(createErrorHandler(recorded));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    onServerFailure(observed);
  });

  afterAll(async () => {
    process.off('uncaughtException', onUncaught);
    onServerFailure(null);
    server?.close();
    await runAsSystem('test cleanup', () => db.delete(schema.teamMembers).where(sql`${schema.teamMembers.companyId} = ${company}`));
    await owner.end();
  });

  const terminate = (pid: number) => owner.query('select pg_terminate_backend($1)', [pid]);
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('survives a connection terminated in the middle of a transaction', async () => {
    const outcome = await runAsCompany(company, () => db.transaction(async (tx) => {
      const r = await tx.execute(sql`select pg_backend_pid() as pid`);
      await terminate((r.rows[0] as { pid: number }).pid);
      await pause(200); // the 'error' event arrives while the client is checked out
      return tx.execute(sql`select 1`).then(() => 'ran', () => 'rejected');
    }), { loadProfile: false }).catch(() => 'transaction rejected');
    expect(['rejected', 'transaction rejected']).toContain(outcome);
    await pause(50);
    expect(uncaught).toEqual([]);
    const { rows } = await pool.query('select 1 as one');
    expect(rows[0].one).toBe(1);
  });

  it('survives the idle-in-transaction timeout ending a checked-out connection', async () => {
    const outcome = await runAsSystem('test', () => db.transaction(async (tx) => {
      await tx.execute(sql`set local idle_in_transaction_session_timeout = '200ms'`);
      await pause(700);
      return tx.execute(sql`select 1`).then(() => 'ran', () => 'rejected');
    })).catch(() => 'transaction rejected');
    expect(['rejected', 'transaction rejected']).toContain(outcome);
    await pause(50);
    expect(uncaught).toEqual([]);
    const after = await runAsCompany(company, () => pool.query('select current_user as role, count(*)::int as n from team_members'), { loadProfile: false });
    expect(after.rows[0]).toEqual({ role: 'archie_app', n: 1 });
  });

  it('survives a raw checked-out client being terminated', async () => {
    const client: PoolClient = await pool.connect();
    const { rows } = await client.query('select pg_backend_pid() as pid');
    await terminate(rows[0].pid);
    await pause(200);
    expect(await client.query('select 1').then(() => 'ran', () => 'rejected')).toBe('rejected');
    client.release();
    expect(uncaught).toEqual([]);
    expect((await pool.query('select 2 as two')).rows[0].two).toBe(2);
  });

  it('answers 503 with Retry-After through a real route when the pool is full, and records no bug', async () => {
    clearSessionRevalidationCache();
    // Warm the roster check so the middleware does not need the database.
    expect((await fetch(`${base}/api/team`)).status).toBe(200);
    const held: PoolClient[] = [];
    try {
      for (let i = 0; i < (pool.options.max ?? 0); i++) held.push(await pool.connect());
      const r = await fetch(`${base}/api/team`);
      expect(r.status).toBe(503);
      expect(r.headers.get('retry-after')).toBe('5');
      expect((await r.json()).message).toMatch(/busy/i);
      // The same error as drizzle hands it to a route's own catch.
      capturedBusy = await db.execute(sql`select 1`).then(() => null, (e) => e);
    } finally {
      for (const c of held) c.release();
    }
    expect((capturedBusy as Error).name).not.toBe('DatabaseBusyError'); // wrapped by drizzle
    const viaCatch = await fetch(`${base}/test/send-failure`);
    expect(viaCatch.status).toBe(503);
    expect(viaCatch.headers.get('retry-after')).toBe('5');
    expect(recorded).not.toHaveBeenCalled();
    expect(observed).not.toHaveBeenCalled();
  }, 30_000);
});
