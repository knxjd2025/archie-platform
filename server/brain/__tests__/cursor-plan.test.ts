import { describe, it, expect, vi } from 'vitest';

// ingest.ts pulls in the db and the fetchers; the planning helpers are pure.
vi.mock('../../db', () => ({ db: {} }));
vi.mock('../gmail-delegated', () => ({ fetchMailboxDelta: vi.fn() }));
vi.mock('../ghl-brain', () => ({ fetchGhlDelta: vi.fn() }));
vi.mock('../jobtread-brain', () => ({ fetchJobtreadFindings: vi.fn() }));

import { orderForTriage, planCursorCommits, cursorPosition, type PendingCursor } from '../ingest';
import { backlogLoop, isDigestOnlyLoop } from '../backlog';
import type { BrainEvent } from '../types';

const mail = (ref: string, historyId: string | undefined, mailbox = 'james@bestroofingnow.com'): BrainEvent => ({
  source: 'gmail', sourceRef: ref, mailbox, occurredAt: '2026-10-15T12:00:00Z', text: `mail ${ref}`, raw: { historyId },
});
const ghl = (ref: string, iso: string): BrainEvent => ({ source: 'ghl', sourceRef: ref, occurredAt: iso, text: `sms ${ref}` });

const cursors: PendingCursor[] = [
  { source: 'gmail', channel: 'james@bestroofingnow.com', cursor: '500', previous: '100' },
  { source: 'gmail', channel: 'thomas@bestroofingnow.com', cursor: '900', previous: '800' },
  { source: 'ghl', channel: '', cursor: String(Date.parse('2026-10-15T13:00:00Z')), previous: String(Date.parse('2026-10-15T10:00:00Z')) },
];

describe('cursorPosition', () => {
  it('reads the Gmail history id and the GHL message time', () => {
    expect(cursorPosition(mail('t1', '123'))).toBe(BigInt(123));
    expect(cursorPosition(ghl('c1', '2026-10-15T12:00:00Z'))).toBe(BigInt(Date.parse('2026-10-15T12:00:00Z')));
  });
  it('is null when the event carries no position', () => {
    expect(cursorPosition(mail('t1', undefined))).toBeNull();
    expect(cursorPosition(ghl('c1', 'not a date'))).toBeNull();
  });
});

describe('orderForTriage', () => {
  it('puts each source oldest first and takes the sources in turn', () => {
    const events = [
      mail('a3', '300'), mail('a1', '150'), mail('a2', '200'),
      // GHL arrives newest first
      ghl('g2', '2026-10-15T12:30:00Z'), ghl('g1', '2026-10-15T11:00:00Z'),
    ];
    expect(orderForTriage(events).map((e) => e.sourceRef)).toEqual(['a1', 'g1', 'a2', 'g2', 'a3']);
  });
});

describe('planCursorCommits (events cut off by the time budget are read again, not parked)', () => {
  it('commits every cursor in full when everything was triaged', () => {
    const { commits, unheld } = planCursorCommits(cursors, []);
    expect(commits.map((c) => c.cursor)).toEqual(['500', '900', cursors[2].cursor]);
    expect(unheld).toEqual([]);
  });

  it('holds a mailbox cursor just before its oldest untriaged message', () => {
    const { commits, unheld } = planCursorCommits(cursors, [mail('a3', '300'), mail('a2', '200')]);
    expect(commits[0].cursor).toBe('199');
    expect(commits[1].cursor).toBe('900'); // the other mailbox is untouched
    expect(unheld).toEqual([]);
  });

  it('holds the GHL cursor just before its oldest untriaged conversation', () => {
    const { commits } = planCursorCommits(cursors, [ghl('g1', '2026-10-15T11:00:00Z')]);
    expect(commits[2].cursor).toBe(String(Date.parse('2026-10-15T11:00:00Z') - 1));
  });

  it('never moves a cursor behind where the fetch started', () => {
    const { commits } = planCursorCommits(cursors, [mail('a0', '50')]);
    expect(commits[0].cursor).toBe('100');
  });

  it('an untriaged event with no position cannot hold the cursor and is handed back to park', () => {
    const lost = mail('ax', undefined);
    const { commits, unheld } = planCursorCommits(cursors, [lost]);
    expect(commits[0].cursor).toBe('500');
    expect(unheld).toEqual([lost]);
  });

  it('an untriaged event whose fetch produced no cursor is handed back too', () => {
    const orphan = mail('b1', '10', 'banning@bestroofingnow.com');
    expect(planCursorCommits(cursors, [orphan]).unheld).toEqual([orphan]);
  });
});

describe('backlogLoop (one digest-only loop, not one nudge per event)', () => {
  const now = new Date('2026-10-15T14:00:00Z');
  it('is null with nothing to report', () => {
    expect(backlogLoop('not-triaged', [], now)).toBeNull();
  });
  it('rolls any number of events into one loop under a fixed key', () => {
    const events = Array.from({ length: 200 }, (_, i) => mail(`t${i}`, String(i)));
    const loop = backlogLoop('triage-failed', events, now)!;
    expect(loop.summary).toMatch(/^200 event\(s\) failed triage/);
    expect(loop.evidence!.quotes).toHaveLength(20);
    expect(backlogLoop('triage-failed', events.slice(0, 3), now)!.sourceRef).toBe(loop.sourceRef);
    expect(isDigestOnlyLoop(loop)).toBe(true);
    expect(loop.occurredAt).toEqual(now);
  });
  it('keeps failed and untriaged apart, and real loops are not digest-only', () => {
    expect(backlogLoop('not-triaged', [mail('t', '1')], now)!.sourceRef).not.toBe(backlogLoop('triage-failed', [mail('t', '1')], now)!.sourceRef);
    expect(isDigestOnlyLoop({ sourceRef: 'conv-123' })).toBe(false);
  });
});
