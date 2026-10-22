import { describe, it, expect } from 'vitest';
import { calendarMailboxes, prunableSourceIds, type StoredAppointment } from '../calendar-sync';

const WINDOW = { from: new Date('2026-09-07T00:00:00Z'), to: new Date('2026-10-21T00:00:00Z') };

const row = (sourceId: string, calendarSource: string | null, start: string | null): StoredAppointment =>
  ({ sourceId, calendarSource, start: start === null ? null : new Date(start) });

describe('calendarMailboxes', () => {
  it('takes the active roster on the company domain, and nothing without one', () => {
    expect(calendarMailboxes([
      { email: 'Toni@Acme.test', active: true },
      { email: 'gone@acme.test', active: false },
      { email: 'bo@acme.test', active: true },
    ], 'acme.test')).toEqual(['bo@acme.test', 'toni@acme.test']);

    expect(calendarMailboxes([{ email: 'bo@acme.test', active: true }], '')).toEqual([]);
  });
});

describe('prunableSourceIds', () => {
  const swept = ['bo@acme.test', 'pat@acme.test'];

  it('prunes a row whose event Google no longer returns', () => {
    const stored = [
      row('bo@acme.test:kept', 'bo@acme.test', '2026-09-22T14:00:00Z'),
      row('bo@acme.test:cancelled', 'bo@acme.test', '2026-09-22T16:00:00Z'),
    ];
    const seen = new Set(['bo@acme.test:kept']);
    expect(prunableSourceIds(stored, seen, swept, WINDOW)).toEqual(['bo@acme.test:cancelled']);
  });

  it('leaves a mailbox alone when its listing failed', () => {
    // toni@ threw, so it is absent from `swept`. Its silence is not evidence
    // that every appointment on it was cancelled.
    const stored = [row('toni@acme.test:a', 'toni@acme.test', '2026-09-22T14:00:00Z')];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW)).toEqual([]);
  });

  it('never prunes outside the window Google was asked about', () => {
    const stored = [
      row('pat@acme.test:old', 'pat@acme.test', '2026-06-01T14:00:00Z'),
      row('pat@acme.test:future', 'pat@acme.test', '2027-01-01T14:00:00Z'),
    ];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW)).toEqual([]);
  });

  it('keeps the window boundaries themselves', () => {
    const stored = [
      row('pat@acme.test:from', 'pat@acme.test', WINDOW.from.toISOString()),
      row('pat@acme.test:to', 'pat@acme.test', WINDOW.to.toISOString()),
    ];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW).sort())
      .toEqual(['pat@acme.test:from', 'pat@acme.test:to']);
  });

  it('never prunes a row that cannot be placed in the window', () => {
    const stored = [
      row('pat@acme.test:nostart', 'pat@acme.test', null),
      row('orphan', null, '2026-09-22T14:00:00Z'),
    ];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW)).toEqual([]);
  });

  it('prunes nothing when every stored row was seen', () => {
    const stored = [
      row('bo@acme.test:a', 'bo@acme.test', '2026-09-22T14:00:00Z'),
      row('pat@acme.test:b', 'pat@acme.test', '2026-09-23T14:00:00Z'),
    ];
    const seen = new Set(stored.map((r) => r.sourceId));
    expect(prunableSourceIds(stored, seen, swept, WINDOW)).toEqual([]);
  });

  it('prunes every row of a swept mailbox that genuinely emptied', () => {
    const stored = [row('bo@acme.test:a', 'bo@acme.test', '2026-09-22T14:00:00Z')];
    expect(prunableSourceIds(stored, new Set(), swept, WINDOW)).toEqual(['bo@acme.test:a']);
  });
});
