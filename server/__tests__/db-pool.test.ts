/**
 * The connection pool is safe with many serverless instances: a small cap per
 * instance, quick release of idle clients, a fast and clear failure when the
 * pool is saturated, server-side timeouts on every app connection, and one
 * pool shared with the session store.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)('database pool', async () => {
  const { pool, DB_LIMITS, DatabaseBusyError } = await import('../db');
  const { runAsSystem } = await import('../tenant/context');

  it('uses small serverless defaults', () => {
    // The env can override these; the test run sets none.
    expect(DB_LIMITS.max).toBe(5);
    expect(pool.options.max).toBe(5);
    expect(pool.options.idleTimeoutMillis).toBe(5_000);
    expect(pool.options.connectionTimeoutMillis).toBe(5_000);
  });

  it('sets statement and idle-in-transaction timeouts on app connections', async () => {
    const { rows } = await pool.query(
      "select current_setting('statement_timeout') as st, current_setting('idle_in_transaction_session_timeout') as itx",
    );
    expect(rows[0]).toEqual({ st: '30s', itx: '1min' });
  });

  it('keeps the timeouts when a connection is reused for another company', async () => {
    const seen = await runAsSystem('pool test', async () => {
      const { rows } = await pool.query("select current_setting('statement_timeout') as st, current_user as role");
      return rows[0];
    });
    expect(seen).toEqual({ st: '30s', role: 'archie_system' });
  });

  it('fails fast with a clear error when every client is busy', async () => {
    const held: PoolClient[] = [];
    try {
      for (let i = 0; i < (pool.options.max ?? 0); i++) held.push(await pool.connect());
      const started = Date.now();
      const err = await pool.query('select 1').then(() => null, (e) => e);
      expect(err).toBeInstanceOf(DatabaseBusyError);
      expect(err.status).toBe(503);
      expect(err.message).toMatch(/Database busy/);
      expect(Date.now() - started).toBeLessThan(DB_LIMITS.acquireTimeoutMs + 2_000);
    } finally {
      for (const c of held) c.release();
    }
    // And the pool recovers once clients are released.
    const { rows } = await pool.query('select 1 as one');
    expect(rows[0].one).toBe(1);
  }, 20_000);

  it('shares the app pool with the session store', async () => {
    const { createSessionStore } = await import('../session-store');
    const store = createSessionStore()!;
    const spy = vi.spyOn(pool, 'query');
    try {
      await new Promise<void>((resolve, reject) => store.get('no-such-session', (e) => (e ? reject(e) : resolve())));
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
