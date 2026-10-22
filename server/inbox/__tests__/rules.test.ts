import { describe, it, expect } from 'vitest';
import { scanWindow, scanReachedTo, readWindowOldestFirst, gmailQuery, parseFrom, heuristicClassify, needsModel, parseClassifications, isActionable, type InboxMessage } from '../rules';

const H = 3600 * 1000;
const now = new Date('2026-09-16T15:00:00Z');

describe('the scan window', () => {
  it('looks back 72 hours the first time', () => {
    const w = scanWindow(now, null);
    expect(w.firstScan).toBe(true);
    expect(w.from.toISOString()).toBe('2026-09-13T15:00:00.000Z');
    expect(w.to).toBe(now);
  });
  it('the next day starts where the last scan stopped, never re-reading checked hours', () => {
    const w = scanWindow(now, new Date(now.getTime() - 24 * H));
    expect(w.firstScan).toBe(false);
    expect(w.from.toISOString()).toBe('2026-09-15T15:00:00.000Z');
  });
  it('a long gap is still capped at 72 hours', () => {
    const w = scanWindow(now, new Date(now.getTime() - 10 * 24 * H));
    expect(w.from.toISOString()).toBe('2026-09-13T15:00:00.000Z');
  });
  it('a scan a minute after the last one covers one minute', () => {
    const w = scanWindow(now, new Date(now.getTime() - 60 * 1000));
    expect(w.to.getTime() - w.from.getTime()).toBe(60 * 1000);
  });
  it('asks Gmail only for inbox mail after the window start', () => {
    const start = new Date('2026-09-13T15:00:00Z');
    expect(gmailQuery(start)).toBe(`in:inbox -category:promotions -category:social -category:forums after:${Math.floor(start.getTime() / 1000)}`);
  });
});

const msg = (over: Partial<InboxMessage>): InboxMessage => ({
  messageId: 'm1', threadId: 't1', fromName: 'Pat Jones', fromEmail: 'pat@example.com', subject: '', snippet: '', receivedAt: now, labelIds: ['UNREAD'], ...over,
});
const known = new Map([['sam@client.com', { email: 'sam@client.com', name: 'Sam Client', externalId: 'jt-1' }]]);
const me = 'joven@bestroofingnow.com';

describe('sorting the inbox', () => {
  it('reads a From header', () => {
    expect(parseFrom('"Pat Jones" <Pat@Example.com>')).toEqual({ name: 'Pat Jones', email: 'pat@example.com' });
    expect(parseFrom('pat@example.com')).toEqual({ name: '', email: 'pat@example.com' });
  });
  it('a homeowner asking for a roof estimate is a lead', () => {
    const c = heuristicClassify(msg({ subject: 'Roof estimate?', snippet: 'We have a leak after the storm, can you come out and give us a quote' }), known, me);
    expect(c.category).toBe('lead');
    expect(c.score).toBeGreaterThanOrEqual(80);
    expect(needsModel(c)).toBe(false);
  });
  it('mail from a client on file is a customer email, linked to their job', () => {
    const c = heuristicClassify(msg({ fromEmail: 'sam@client.com', subject: 'When is the crew coming?' }), known, me);
    expect(c.category).toBe('customer');
    expect(c.matched?.externalId).toBe('jt-1');
    expect(needsModel(c)).toBe(false);
  });
  it('an adjuster or a contract is important even without roofing words', () => {
    expect(heuristicClassify(msg({ subject: 'Claim #4471 — adjuster visit Thursday' }), known, me).category).toBe('important');
    expect(heuristicClassify(msg({ subject: 'Signed contract attached' }), known, me).category).toBe('important');
  });
  it('internal mail, newsletters and notifications are not worth a row', () => {
    expect(heuristicClassify(msg({ fromEmail: 'james@bestroofingnow.com', subject: 'roof leak estimate' }), known, me).score).toBe(0);
    expect(heuristicClassify(msg({ fromEmail: 'noreply@shopify.com', subject: 'Your receipt' }), known, me).category).toBe('other');
    expect(heuristicClassify(msg({ fromEmail: 'news@vendor.com', subject: 'Unsubscribe or save 20% off' }), known, me).score).toBeLessThan(25);
  });
  it('a plain human email with no signal is unsure and goes to the model', () => {
    const c = heuristicClassify(msg({ subject: 'Hi', snippet: 'Following up on our conversation last week' }), known, me);
    expect(c.category).toBe('other');
    expect(needsModel(c)).toBe(true);
  });
  it('takes the model\'s answer only when it is well-formed', () => {
    const m = parseClassifications({ results: [{ id: 'a', category: 'lead', score: 91.4, reason: 'asks for a quote' }, { id: 'b', category: 'spam', score: 3 }, { id: '', category: 'lead', score: 50 }, { id: 'c', category: 'other', score: 'x' }] });
    expect(m.size).toBe(1);
    expect(m.get('a')).toEqual({ category: 'lead', score: 91, reason: 'asks for a quote' });
    expect(parseClassifications('nope').size).toBe(0);
  });
  it('the dashboard counts leads, customers and important mail scoring 50+', () => {
    expect(isActionable({ category: 'lead', score: 60 })).toBe(true);
    expect(isActionable({ category: 'other', score: 90 })).toBe(false);
    expect(isActionable({ category: 'important', score: 40 })).toBe(false);
  });
});

describe('scanReachedTo (a capped scan must not skip older mail for good)', () => {
  const w = { from: new Date('2026-09-16T00:00:00Z'), to: new Date('2026-09-16T15:00:00Z'), firstScan: false };
  it('an uncapped scan covered the whole window', () => {
    expect(scanReachedTo(w, [new Date('2026-09-16T10:00:00Z')], false)).toEqual(w.to);
  });
  it('a capped scan reached only as far as the newest message it read, less a second', () => {
    const read = [new Date('2026-09-16T02:00:00Z'), new Date('2026-09-16T05:00:00Z')];
    expect(scanReachedTo(w, read, true).toISOString()).toBe('2026-09-16T04:59:59.000Z');
  });
  it('never moves backwards past the window start', () => {
    expect(scanReachedTo(w, [new Date('2026-09-16T00:00:00.500Z')], true)).toEqual(w.from);
  });
});

describe('gmailQuery with an upper bound', () => {
  it('adds before: in whole seconds, rounded up', () => {
    const q = gmailQuery(new Date('2026-09-16T00:00:00Z'), new Date('2026-09-16T06:00:00.200Z'));
    expect(q).toMatch(/after:1789516800 before:1789538401$/);
  });
});

describe('readWindowOldestFirst (a busy window is not cut off at the oldest end)', () => {
  const HOUR = 3600_000;
  const w = { from: new Date('2026-09-16T00:00:00Z'), to: new Date('2026-09-16T12:00:00Z'), firstScan: false };
  /** One message every `everyMs` across the window; ids are their times. */
  const mailbox = (everyMs: number, listCap: number) => {
    const all: number[] = [];
    for (let t = w.from.getTime(); t < w.to.getTime(); t += everyMs) all.push(t);
    const lists: Array<[number, number]> = [];
    return {
      lists,
      io: {
        async list(from: Date, before: Date) {
          lists.push([from.getTime(), before.getTime()]);
          const inRange = all.filter((t) => t >= from.getTime() && t < before.getTime()).reverse(); // newest first
          return { ids: inRange.slice(0, listCap).map(String), truncated: inRange.length > listCap };
        },
        async read(id: string) { return { id, receivedAt: new Date(Number(id)) }; },
      },
    };
  };

  it('reads a quiet window whole, slice by slice, and reaches its end', async () => {
    const { io, lists } = mailbox(HOUR, 2000);
    const { items, reachedTo } = await readWindowOldestFirst(w, io, { maxRead: 150, chunkMs: 6 * HOUR });
    expect(items).toHaveLength(12);
    expect(reachedTo).toEqual(w.to);
    expect(lists).toEqual([[w.from.getTime(), w.from.getTime() + 6 * HOUR], [w.from.getTime() + 6 * HOUR, w.to.getTime()]]);
  });

  it('starts from the oldest mail even when a slice holds more than one listing returns', async () => {
    // 720 messages in the first 6h slice, a listing returns at most 100.
    const { io } = mailbox(30_000, 100);
    const { items, reachedTo } = await readWindowOldestFirst(w, io, { maxRead: 50, chunkMs: 6 * HOUR });
    expect(items[0].receivedAt).toEqual(w.from);
    expect(items.map((m) => m.receivedAt.getTime())).toEqual([...items.map((m) => m.receivedAt.getTime())].sort((a, b) => a - b));
    // Capped part-way: it reached the newest message read, less a second.
    expect(reachedTo.getTime()).toBe(items[items.length - 1].receivedAt.getTime() - 1000);
  });

  it('stops at a slice end when the read cap lands on it', async () => {
    const { io } = mailbox(HOUR, 2000);
    const { items, reachedTo } = await readWindowOldestFirst(w, io, { maxRead: 6, chunkMs: 6 * HOUR });
    expect(items).toHaveLength(6);
    expect(reachedTo).toEqual(new Date(w.from.getTime() + 6 * HOUR));
  });
});
