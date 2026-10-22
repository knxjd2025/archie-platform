import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Runs only against the local throwaway database — never whatever .env points at.
const url = process.env.DATABASE_URL || '';
const LOCAL = /localhost|127\.0\.0\.1/.test(url) && url.includes('bra_e2e');

describe.skipIf(!LOCAL)('production pipeline writes (database)', async () => {
  const { db } = await import('../../db');
  const { productionPipeline } = await import('../../../shared/schema');
  const { like, eq } = await import('drizzle-orm');
  const { setCheck, completeTrade } = await import('../pipeline');
  const PREFIX = `test-pipeline-${process.pid}-`;
  let n = 0;

  const seed = async (trades = [{ key: 'roofing', done: false }, { key: 'gutters', done: false }]) => {
    const id = `${PREFIX}${n++}`;
    // 'approved' keeps completeTrade from mirroring to JobTread (only install does).
    await db.insert(productionPipeline).values({ jobExternalId: id, stage: 'approved', trades, history: [] });
    return id;
  };
  const read = async (id: string) => (await db.select().from(productionPipeline).where(eq(productionPipeline.jobExternalId, id)))[0];

  beforeAll(async () => { await db.delete(productionPipeline).where(like(productionPipeline.jobExternalId, `${PREFIX}%`)); });
  afterAll(async () => { await db.delete(productionPipeline).where(like(productionPipeline.jobExternalId, `${PREFIX}%`)); });

  it('keeps both ticks when two boxes are saved at the same moment', async () => {
    const id = await seed();
    await Promise.all([
      setCheck(id, 'invoice_sent_with_photos', true, 'a@test'),
      setCheck(id, 'review_requested', true, 'b@test'),
      setCheck(id, 'final_payment_received', true, 'c@test'),
    ]);
    expect((await read(id)).checks).toEqual({ invoice_sent_with_photos: true, review_requested: true, final_payment_received: true });
    await setCheck(id, 'review_requested', false, 'b@test');
    expect((await read(id)).checks).toMatchObject({ invoice_sent_with_photos: true, review_requested: false });
  });

  it('refuses a check key it does not know', async () => {
    const id = await seed();
    expect(await setCheck(id, 'not_a_check', true, 'a@test')).toBeNull();
  });

  it('a second tap for the same trade does not finish the next one', async () => {
    const id = await seed();
    const first = await completeTrade(id, 'roofing', 'a@test');
    const again = await completeTrade(id, 'roofing', 'a@test');
    expect(first.ok && first.completed).toBe(true);
    expect(again.ok && again.completed).toBe(false);
    expect((await read(id)).trades).toEqual([{ key: 'roofing', done: true }, { key: 'gutters', done: false }]);
  });

  it('two taps racing complete the trade once', async () => {
    const id = await seed();
    const results = await Promise.all([completeTrade(id, 'roofing', 'a@test'), completeTrade(id, 'roofing', 'b@test')]);
    expect(results.filter((r) => r.ok && r.completed)).toHaveLength(1);
    expect((await read(id)).trades).toEqual([{ key: 'roofing', done: true }, { key: 'gutters', done: false }]);
  });

  it('needs to be told which trade is finished', async () => {
    const id = await seed();
    const r = await completeTrade(id, undefined, 'a@test');
    expect(r.ok).toBe(false);
    expect((await read(id)).trades[0].done).toBe(false);
  });
});
