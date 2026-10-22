import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Runs only against the local e2e database — the reopen rule lives in SQL
// (upsertLoop's CASE), so the pure shouldReopen test alone can't prove it.
//   DATABASE_URL=postgres://postgres@localhost:5432/bra_e2e npx vitest run server/brain
const onE2eDb = (process.env.DATABASE_URL ?? '').includes('bra_e2e');

describe.skipIf(!onE2eDb)('upsertLoop reopen rule (bra_e2e)', () => {
  const tag = `test-${Date.now()}`;
  let store: typeof import('../loop-store');
  let db: typeof import('../../db').db;
  let openLoops: typeof import('../../../shared/schema').openLoops;
  let like: typeof import('drizzle-orm').like;
  let eq: typeof import('drizzle-orm').eq;

  beforeAll(async () => {
    store = await import('../loop-store');
    ({ db } = await import('../../db'));
    ({ openLoops } = await import('../../../shared/schema'));
    ({ like, eq } = await import('drizzle-orm'));
  });

  afterAll(async () => {
    if (db) await db.delete(openLoops).where(like(openLoops.sourceRef, `${tag}%`));
  });

  const input = (ref: string, occurredAt?: Date) => ({
    kind: 'estimate_stale', source: 'jobtread' as const, sourceRef: `${tag}-${ref}`, summary: 'Estimate stale', owner: 'james' as const, occurredAt,
  });
  const stateOf = async (ref: string) => {
    const [row] = await db.select().from(openLoops).where(eq(openLoops.sourceRef, `${tag}-${ref}`));
    return row.state;
  };
  const closeAs = async (ref: string, state: 'done' | 'dismissed', closedBy: string, closedAt: Date) => {
    await db.update(openLoops).set({ state, closedBy, closedAt }).where(eq(openLoops.sourceRef, `${tag}-${ref}`));
  };

  it('a re-emitted finding does not reopen a loop a person closed', async () => {
    await store.upsertLoop(input('a', new Date('2026-07-16T00:00:00Z')));
    await closeAs('a', 'done', 'sms:james', new Date('2026-07-20T00:00:00Z'));
    await store.upsertLoop(input('a', new Date('2026-07-16T00:00:00Z')));
    expect(await stateOf('a')).toBe('done');
  });

  it('the condition starting over after the close does reopen it', async () => {
    await store.upsertLoop(input('b', new Date('2026-07-16T00:00:00Z')));
    await closeAs('b', 'done', 'sms:james', new Date('2026-07-20T00:00:00Z'));
    await store.upsertLoop(input('b', new Date('2026-07-25T00:00:00Z')));
    expect(await stateOf('b')).toBe('open');
  });

  it('dismissed stays dismissed whatever comes in', async () => {
    await store.upsertLoop(input('c'));
    await closeAs('c', 'dismissed', 'ui:james', new Date('2026-07-20T00:00:00Z'));
    await store.upsertLoop(input('c', new Date('2026-08-01T00:00:00Z')));
    expect(await stateOf('c')).toBe('dismissed');
  });

  it('a sweep self-close reopens when the signal returns', async () => {
    await store.upsertLoop(input('d'));
    await closeAs('d', 'done', 'calendar:self-close', new Date('2026-07-20T00:00:00Z'));
    await store.upsertLoop(input('d'));
    expect(await stateOf('d')).toBe('open');
  });

  it('closeLoopByKey leaves a person-closed loop as they left it', async () => {
    await store.upsertLoop(input('e'));
    await closeAs('e', 'dismissed', 'ui:james', new Date('2026-07-20T00:00:00Z'));
    const key = store.makeDedupeKey('estimate_stale', 'jobtread', `${tag}-e`);
    expect(await store.closeLoopByKey(key, 'triage:self-close')).toBe(false);
    expect(await stateOf('e')).toBe('dismissed');
  });
});
