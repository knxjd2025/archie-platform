import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { agentChats } from '../../../shared/schema';
import { buildTranscript, getOrCreateChat, isOlderThan, TRANSCRIPT_CAP } from '../chat-store';
import { inCompany, makeTestCompany, TEST_COMPANY_ID } from '../../__tests__/helpers/tenant';

// Every test here runs as a real test company (row level security is on).
let __co = TEST_COMPANY_ID;
const as = inCompany(() => __co);
beforeAll(async () => { if (process.env.DATABASE_URL) __co = await makeTestCompany('chat'); });

// Against the real database (migration 0041 applied): the insert used to name
// a conflict target with no matching unique index, which Postgres rejects.
describe('getOrCreateChat (database)', () => {
  const email = `chat-store-test-${process.pid}@example.test`;
  afterAll(as(async () => {
    await db.delete(agentChats).where(eq(agentChats.userEmail, email));
  }));

  it('opens one thread for concurrent first messages of the day', as(async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => getOrCreateChat(email, 'advisor', '2026-01-02')));
    expect(new Set(ids).size).toBe(1);
    const rows = await db.select({ id: agentChats.id }).from(agentChats).where(eq(agentChats.userEmail, email));
    expect(rows).toHaveLength(1);
    expect(await getOrCreateChat(email, 'advisor', '2026-01-02')).toBe(ids[0]);
  }));
});

describe('buildTranscript', () => {
  it('labels each turn', as(() => {
    expect(buildTranscript([{ role: 'user', content: ' hi ' }, { role: 'assistant', content: 'hello' }]))
      .toBe('Team member: hi\nAssistant: hello');
  }));

  it('keeps the END of a long day, where the decisions are', as(() => {
    const msgs = Array.from({ length: 400 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} ${'x'.repeat(100)}` }));
    msgs.push({ role: 'user', content: 'FINAL: call Mrs. Lee Thursday' });
    const t = buildTranscript(msgs);
    expect(t.length).toBe(TRANSCRIPT_CAP);
    expect(t.startsWith('[…earlier part of the day trimmed…]')).toBe(true);
    expect(t.endsWith('FINAL: call Mrs. Lee Thursday')).toBe(true);
    expect(t).not.toContain('turn 0 ');
  }));

  it('leaves a transcript under the cap untouched', as(() => {
    const t = buildTranscript([{ role: 'user', content: 'short' }], 100);
    expect(t).toBe('Team member: short');
  }));
});

describe('isOlderThan', () => {
  it('compares whole days', as(() => {
    expect(isOlderThan('2026-10-08', 7, '2026-10-15')).toBe(true);
    expect(isOlderThan('2026-10-09', 7, '2026-10-15')).toBe(false);
    expect(isOlderThan('2026-09-30', 7, '2026-10-15')).toBe(true);
  }));

  it('is false for a malformed day rather than giving up on it', as(() => {
    expect(isOlderThan('not-a-day', 7, '2026-10-15')).toBe(false);
  }));
});
