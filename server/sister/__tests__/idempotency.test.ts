/**
 * A write from Roof Lee is done once per company and key, however many copies
 * arrive and however they overlap. Against the real test database.
 */
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { localDb } from './helpers';
import { isIdempotencyKey } from '../idempotency';
import { BUSY_RETRY_AFTER_SECONDS, DatabaseBusyError } from '../../lib/db-busy';

describe('idempotency keys', () => {
  it('are visible characters, 1 to 200 of them', () => {
    expect(isIdempotencyKey(randomUUID())).toBe(true);
    expect(isIdempotencyKey('lee:turn-42:office_create_lead')).toBe(true);
    for (const bad of ['', ' ', 'a b', 'a\nb', 'x'.repeat(201), undefined, 7]) expect(isIdempotencyKey(bad), String(bad)).toBe(false);
  });
});

describe.skipIf(!localDb)('doing a write once', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { and, eq, sql } = await import('drizzle-orm');
  const { runAsCompany } = await import('../../tenant/context');
  const { makeTestCompany } = await import('../../__tests__/helpers/tenant');
  const { once } = await import('../idempotency');

  const a = await makeTestCompany('idem-a');
  const b = await makeTestCompany('idem-b');
  const counter = () => { let n = 0; return { work: async () => ({ status: 200, body: { n: ++n } }), get n() { return n; } }; };

  it('answers a repeat as the first time, without doing the work again', async () => {
    const key = randomUUID();
    const c = counter();
    expect(await once(a, key, c.work)).toEqual({ status: 200, body: { n: 1 } });
    expect(await once(a, key, c.work)).toEqual({ status: 200, body: { n: 1 } });
    expect(c.n).toBe(1);
  });

  it('does the work once when copies arrive together', async () => {
    const key = randomUUID();
    let n = 0;
    const slow = async () => { n++; await new Promise((r) => setTimeout(r, 50)); return { status: 201, body: { made: true } }; };
    const answers = await Promise.all([once(a, key, slow), once(a, key, slow), once(a, key, slow)]);
    expect(n).toBe(1);
    expect(answers.filter((x) => x.status === 201).length).toBe(1);
    // The others are told to come back, never given a half answer and never
    // a plain "no": Roof Lee gives up on a 4xx, and the first copy may succeed.
    const waiting = answers.filter((x) => x.status !== 201);
    expect(waiting).toHaveLength(2);
    for (const w of waiting) expect(w).toMatchObject({ status: 503, retryAfter: BUSY_RETRY_AFTER_SECONDS });
    expect(await once(a, key, slow)).toEqual({ status: 201, body: { made: true } });
    expect(n).toBe(1);
  });

  it('keeps each company\'s keys to itself', async () => {
    const key = randomUUID();
    const c = counter();
    expect((await once(a, key, c.work)).body).toEqual({ n: 1 });
    expect((await once(b, key, c.work)).body).toEqual({ n: 2 });
    expect((await once(a, key, c.work)).body).toEqual({ n: 1 });
  });

  it('remembers a refusal, and forgets work that did not finish', async () => {
    const refused = randomUUID();
    const c = counter();
    expect(await once(a, refused, async () => ({ status: 403, body: { error: 'no' } }))).toEqual({ status: 403, body: { error: 'no' } });
    expect(await once(a, refused, c.work)).toEqual({ status: 403, body: { error: 'no' } });
    expect(c.n).toBe(0);

    const broke = randomUUID();
    await expect(once(a, broke, async () => { throw new Error('database went away'); })).rejects.toThrow('database went away');
    expect((await once(a, broke, async () => ({ status: 503, body: null }))).status).toBe(503);
    expect(await once(a, broke, c.work)).toEqual({ status: 200, body: { n: 1 } });
  });

  it('takes over a claim whose owner has plainly gone, and no sooner', async () => {
    const key = randomUUID();
    const mine = and(eq(schema.sisterIdempotency.companyId, a), eq(schema.sisterIdempotency.key, key));
    const c = counter();
    // A process claimed the key and died before answering.
    await runAsCompany(a, () => db.insert(schema.sisterIdempotency).values({ key, response: { status: 0, body: null } }));
    expect((await once(a, key, c.work)).status).toBe(503);
    expect(c.n).toBe(0);
    await runAsCompany(a, () => db.update(schema.sisterIdempotency).set({ createdAt: sql`now() - interval '2 minutes'` }).where(mine));
    expect(await once(a, key, c.work)).toEqual({ status: 200, body: { n: 1 } });
    expect(await once(a, key, c.work)).toEqual({ status: 200, body: { n: 1 } });
  });

  it('tells a repeat to come back when a full database kept the key from being let go', async () => {
    const key = randomUUID();
    const c = counter();
    const busy = new DatabaseBusyError('no connection became free', new Error('timeout exceeded when trying to connect'));
    // The work fails on a full database, and so does letting go of the key.
    const stuck = vi.spyOn(db, 'delete').mockImplementationOnce(() => { throw busy; });
    await expect(once(a, key, async () => { throw busy; })).rejects.toBe(busy);
    stuck.mockRestore();
    // The repeat is "not yet" with when to come back, and does no work...
    const again = await once(a, key, c.work);
    expect(again).toMatchObject({ status: 503, retryAfter: BUSY_RETRY_AFTER_SECONDS });
    expect(c.n).toBe(0);
    // ...and once the claim counts as abandoned, the same key does the work.
    const mine = and(eq(schema.sisterIdempotency.companyId, a), eq(schema.sisterIdempotency.key, key));
    await runAsCompany(a, () => db.update(schema.sisterIdempotency).set({ createdAt: sql`now() - interval '2 minutes'` }).where(mine));
    expect(await once(a, key, c.work)).toEqual({ status: 200, body: { n: 1 } });
    // When to come back is never stored with an answer.
    const [row] = await runAsCompany(a, () => db.select().from(schema.sisterIdempotency).where(mine));
    expect(row.response).toEqual({ status: 200, body: { n: 1 } });
  });

  it('simply runs the work when there is no key', async () => {
    const c = counter();
    await once(a, undefined, c.work);
    await once(a, undefined, c.work);
    expect(c.n).toBe(2);
  });
});
