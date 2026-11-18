/**
 * A full database is an answer, not a fault (server/lib/db-busy.ts). Roof
 * Lee's endpoints say so the way every other route does: 503 and when to come
 * back, never the plain 500 of a real failure. Needs no database: the lookup
 * of the company is made to fail the way the pool fails when it is full.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseBusyError, BUSY_MESSAGE, BUSY_RETRY_AFTER_SECONDS } from '../../lib/db-busy';
import { dropSecret, startSisterApp, TEST_SECRET, useSecret } from './helpers';
import { signRequest } from '../verify';

let failure: unknown = null;
vi.mock('../companies', async (original) => ({
  ...(await original<typeof import('../companies')>()),
  findRoofLeeCompany: async () => { throw failure; },
}));
vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));

describe('Roof Lee asks while the database is full', () => {
  let server: Server;
  let base = '';
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeAll(async () => { ({ server, base } = await startSisterApp()); });
  afterAll(() => { server?.close(); errors.mockRestore(); warnings.mockRestore(); });
  beforeEach(() => { useSecret(); errors.mockClear(); warnings.mockClear(); });
  afterEach(() => { dropSecret(); });

  async function health() {
    const path = `/api/sister/v1/companies/${randomUUID()}`;
    const at = Date.now();
    return fetch(`${base}${path}`, { headers: { 'x-roofli-timestamp': String(at), 'x-roofli-signature': signRequest('GET', path, '', at, TEST_SECRET) } });
  }

  it('answers 503 with Retry-After, even when drizzle has wrapped the error', async () => {
    const busy = new DatabaseBusyError('no connection became free', new Error('timeout exceeded when trying to connect'));
    for (const thrown of [busy, new Error('Failed query: select ...', { cause: busy })]) {
      failure = thrown;
      const res = await health();
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe(String(BUSY_RETRY_AFTER_SECONDS));
      expect(await res.json()).toEqual({ error: BUSY_MESSAGE });
    }
    // Saturated, not broken: a warning, and nothing logged as a failure.
    expect(warnings).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
  });

  it('still answers a real failure with 500 and no detail', async () => {
    failure = Object.assign(new Error('relation "companies" does not exist'), { code: '42P01' });
    const res = await health();
    expect(res.status).toBe(500);
    expect(res.headers.get('retry-after')).toBeNull();
    const body = await res.json();
    expect(body).toEqual({ error: 'Archie could not finish this request. Send it again.' });
    expect(JSON.stringify(errors.mock.calls)).not.toContain('companies');
  });
});
