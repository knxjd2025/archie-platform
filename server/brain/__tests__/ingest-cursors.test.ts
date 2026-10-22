import { describe, it, expect, vi, beforeEach } from 'vitest';

// runIngest must not save any Gmail/GHL cursor itself: a sweep killed by the
// 300s limit after ingest used to lose every event it had read, because the
// cursors had already moved past them. Mock the db and every fetcher so the
// writes can be counted.
const { writes } = vi.hoisted(() => ({ writes: [] as Array<{ op: string; v: unknown }> }));

vi.mock('../../db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }),
    insert: () => ({ values: async (v: unknown) => { writes.push({ op: 'insert', v }); } }),
    update: () => ({ set: (v: unknown) => ({ where: async () => { writes.push({ op: 'update', v }); } }) }),
  },
}));
vi.mock('../gmail-delegated', () => ({
  fetchMailboxDelta: vi.fn(async (mailbox: string) => ({
    events: [{ source: 'gmail', sourceRef: `t-${mailbox}`, mailbox, occurredAt: '2026-10-15T12:00:00Z', text: 'hi' }],
    newCursor: `h-${mailbox}`,
  })),
}));
vi.mock('../ghl-brain', () => ({
  fetchGhlDelta: vi.fn(async () => ({ events: [], newCursor: '1792000000000' })),
}));
vi.mock('../jobtread-brain', () => ({
  fetchJobtreadFindings: vi.fn(async () => [
    { kind: 'estimate_stale', source: 'jobtread', sourceRef: 'd1', summary: 'Estimate stale', owner: 'james', urgency: 'normal' },
  ]),
}));

import { runIngest, commitCursors } from '../ingest';

describe('runIngest leaves the cursors for the caller to commit', () => {
  beforeEach(() => { writes.length = 0; });

  it('reads every source without writing a cursor', async () => {
    const res = await runIngest(new Date('2026-10-15T13:00:00Z'));
    expect(writes).toEqual([]);
    expect(res.events).toHaveLength(4); // one per mailbox
    expect(res.cursors.map((c) => c.source)).toEqual(['gmail', 'gmail', 'gmail', 'gmail', 'ghl']);
    expect(res.cursors.find((c) => c.source === 'ghl')?.cursor).toBe('1792000000000');
  });

  it('keeps jobtread findings out of the events sent to triage', async () => {
    const res = await runIngest(new Date('2026-10-15T13:00:00Z'));
    expect(res.events.some((e) => e.source === 'jobtread')).toBe(false);
    expect(res.jobtreadLoops).toHaveLength(1);
    expect(res.jobtreadLoops[0].kind).toBe('estimate_stale');
  });

  it('commitCursors saves them once triage is done', async () => {
    const res = await runIngest(new Date('2026-10-15T13:00:00Z'));
    await commitCursors(res.cursors);
    expect(writes.filter((w) => w.op === 'insert')).toHaveLength(5);
  });
});
