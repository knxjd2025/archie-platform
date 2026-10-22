import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// A customer text whose send timed out used to give its idempotency slot back
// and go again next sweep — but a timeout can come after GHL has queued the
// text, so the customer got it twice. Only a send that certainly did not go
// may be retried. Runs against the local e2e database (the slot is a row):
//   DATABASE_URL=postgres://postgres@localhost:5432/bra_e2e npx vitest run server/brain
const onE2eDb = (process.env.DATABASE_URL ?? '').includes('bra_e2e');
const tag = `actor-send-${Date.now()}`;

const { sendGhlSms } = vi.hoisted(() => ({ sendGhlSms: vi.fn() }));

vi.mock('../ghl-brain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ghl-brain')>()),
  sendGhlSms: (...a: unknown[]) => sendGhlSms(...a),
  sendGhlEmail: vi.fn(),
  getMessageStatus: vi.fn(async () => 'delivered'),
  getConversationContactId: vi.fn(async () => 'contact-1'),
  getConversationIdByContact: vi.fn(async () => null),
  upsertContactByPhone: vi.fn(async () => null),
}));
vi.mock('../voice', () => ({
  generateCustomerMessage: vi.fn(async () => ({ channel: 'sms', body: 'Hi, just following up on your estimate.' })),
}));
vi.mock('../gmail-delegated', () => ({ sendAsMailbox: vi.fn(async () => 'gmail-1'), createDraftInMailbox: vi.fn() }));
// Only this file's loops: the e2e database may hold others.
vi.mock('../loop-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../loop-store')>();
  return {
    ...real,
    getOpenLoops: async () => (await real.getOpenLoops()).filter((l) => l.sourceRef.startsWith(tag) || l.sourceRef.startsWith(`sweep-backlog:${tag}`)),
  };
});

import { classifySendFailure } from '../actor';
import { GhlSendError } from '../ghl-brain';

describe('classifySendFailure', () => {
  it('a 4xx or a connection never made is definitely not sent', () => {
    expect(classifySendFailure(new GhlSendError(400, 'bad number'))).toBe('not_sent');
    expect(classifySendFailure(new GhlSendError(429, 'slow down'))).toBe('not_sent');
    expect(classifySendFailure(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toBe('not_sent');
  });
  it('a timeout, a 5xx or a dropped connection may have gone out', () => {
    expect(classifySendFailure(new GhlSendError(502, 'bad gateway'))).toBe('unknown');
    expect(classifySendFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('unknown');
    expect(classifySendFailure(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe('unknown');
  });
});

describe.skipIf(!onE2eDb)('actOnLoops customer sends (bra_e2e)', () => {
  let db: typeof import('../../db').db;
  let schema: typeof import('../../../shared/schema');
  let orm: typeof import('drizzle-orm');
  let actOnLoops: typeof import('../actor').actOnLoops;
  let upsertLoop: typeof import('../loop-store').upsertLoop;
  // Noon Eastern: outside quiet hours.
  const now = new Date('2026-10-15T16:00:00Z');

  beforeAll(async () => {
    delete process.env.BRAIN_DRY_RUN;
    ({ db } = await import('../../db'));
    schema = await import('../../../shared/schema');
    orm = await import('drizzle-orm');
    ({ actOnLoops } = await import('../actor'));
    ({ upsertLoop } = await import('../loop-store'));
  });

  afterAll(async () => {
    if (!db) return;
    const loops = await db.select({ id: schema.openLoops.id }).from(schema.openLoops).where(orm.like(schema.openLoops.sourceRef, `%${tag}%`));
    if (loops.length) await db.delete(schema.nudges).where(orm.inArray(schema.nudges.loopId, loops.map((l) => l.id)));
    await db.delete(schema.openLoops).where(orm.like(schema.openLoops.sourceRef, `%${tag}%`));
  });

  beforeEach(() => { sendGhlSms.mockReset(); });

  const makeLoop = (ref: string) => upsertLoop({
    kind: 'estimate_stale', source: 'ghl', sourceRef: `${tag}-${ref}`, summary: 'Estimate stale', owner: 'thomas',
    contact: { name: 'Pat', phone: '+17045550101' },
  });
  const stateOf = async (id: number) => (await db.select().from(schema.openLoops).where(orm.eq(schema.openLoops.id, id)))[0].state;

  it('a timed-out send is not sent again', async () => {
    const { id } = await makeLoop('timeout');
    sendGhlSms.mockRejectedValue(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    await actOnLoops(now);
    // Counted as sent: the slot is kept and the loop moves on to the team.
    expect(await stateOf(id)).toBe('nudged');
    const rows = await db.select().from(schema.nudges).where(orm.eq(schema.nudges.loopId, id));
    expect(rows.map((r) => r.idempotencyKey)).toEqual([`${id}:0`]);
    await actOnLoops(now);
    expect(sendGhlSms).toHaveBeenCalledTimes(1);
  });

  it('a send GHL refused is retried next sweep', async () => {
    const { id } = await makeLoop('refused');
    sendGhlSms.mockRejectedValueOnce(new GhlSendError(400, 'invalid number')).mockResolvedValueOnce({ messageId: 'msg-2' });
    await actOnLoops(now);
    expect(await stateOf(id)).toBe('open');
    await actOnLoops(now);
    expect(sendGhlSms).toHaveBeenCalledTimes(2);
    expect(await stateOf(id)).toBe('nudged');
  });

  it('a sweep backlog summary is never nudged', async () => {
    const { id } = await upsertLoop({
      kind: 'custom', source: 'manual', sourceRef: `sweep-backlog:${tag}`, summary: '40 event(s) were not triaged', owner: 'james',
    });
    await actOnLoops(now);
    expect(await db.select().from(schema.nudges).where(orm.eq(schema.nudges.loopId, id))).toEqual([]);
    expect(await stateOf(id)).toBe('open');
  });
});
