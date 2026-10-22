import { describe, it, expect } from 'vitest';
import { calendarMailboxes, prunableSourceIds, type StoredAppointment } from '../calendar-sync';

const WINDOW = { from: new Date('2026-09-07T00:00:00Z'), to: new Date('2026-10-21T00:00:00Z') };

const row = (sourceId: string, calendarSource: string | null, start: string | null): StoredAppointment =>
  ({ sourceId, calendarSource, start: start === null ? null : new Date(start) });

describe('calendarMailboxes', () => {
  it('takes the active roster, and falls back rather than syncing nothing', () => {
    expect(calendarMailboxes([
      { email: 'Thomas@BestRoofingNow.com', active: true },
      { email: 'gone@bestroofingnow.com', active: false },
      { email: 'banning@bestroofingnow.com', active: true },
    ])).toEqual(['banning@bestroofingnow.com', 'thomas@bestroofingnow.com']);

    expect(calendarMailboxes([]).length).toBeGreaterThan(0);
    expect(calendarMailboxes([{ email: 'gone@x.com', active: false }]).length).toBeGreaterThan(0);
  });
});

describe('prunableSourceIds', () => {
  const swept = ['banning@bestroofingnow.com', 'james@bestroofingnow.com'];

  it('prunes a row whose event Google no longer returns', () => {
    const stored = [
      row('banning@bestroofingnow.com:kept', 'banning@bestroofingnow.com', '2026-09-22T14:00:00Z'),
      row('banning@bestroofingnow.com:cancelled', 'banning@bestroofingnow.com', '2026-09-22T16:00:00Z'),
    ];
    const seen = new Set(['banning@bestroofingnow.com:kept']);
    expect(prunableSourceIds(stored, seen, swept, WINDOW)).toEqual(['banning@bestroofingnow.com:cancelled']);
  });

  it('leaves a mailbox alone when its listing failed', () => {
    // thomas@ threw, so it is absent from `swept`. Its silence is not evidence
    // that every appointment on it was cancelled.
    const stored = [row('thomas@bestroofingnow.com:a', 'thomas@bestroofingnow.com', '2026-09-22T14:00:00Z')];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW)).toEqual([]);
  });

  it('never prunes outside the window Google was asked about', () => {
    const stored = [
      row('james@bestroofingnow.com:old', 'james@bestroofingnow.com', '2026-06-01T14:00:00Z'),
      row('james@bestroofingnow.com:future', 'james@bestroofingnow.com', '2027-01-01T14:00:00Z'),
    ];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW)).toEqual([]);
  });

  it('keeps the window boundaries themselves', () => {
    const stored = [
      row('james@bestroofingnow.com:from', 'james@bestroofingnow.com', WINDOW.from.toISOString()),
      row('james@bestroofingnow.com:to', 'james@bestroofingnow.com', WINDOW.to.toISOString()),
    ];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW).sort())
      .toEqual(['james@bestroofingnow.com:from', 'james@bestroofingnow.com:to']);
  });

  it('never prunes a row that cannot be placed in the window', () => {
    const stored = [
      row('james@bestroofingnow.com:nostart', 'james@bestroofingnow.com', null),
      row('orphan', null, '2026-09-22T14:00:00Z'),
    ];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW)).toEqual([]);
  });

  it('prunes nothing when every stored row was seen', () => {
    const stored = [
      row('banning@bestroofingnow.com:a', 'banning@bestroofingnow.com', '2026-09-22T14:00:00Z'),
      row('james@bestroofingnow.com:b', 'james@bestroofingnow.com', '2026-09-23T14:00:00Z'),
    ];
    const seen = new Set(stored.map((r) => r.sourceId));
    expect(prunableSourceIds(stored, seen, swept, WINDOW)).toEqual([]);
  });

  it('prunes every row of a swept mailbox that genuinely emptied', () => {
    const stored = [row('banning@bestroofingnow.com:a', 'banning@bestroofingnow.com', '2026-09-22T14:00:00Z')];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW)).toEqual(['banning@bestroofingnow.com:a']);
  });
});
