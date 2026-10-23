import { describe, it, expect } from 'vitest';
import { addDays, boardTz, conflictsFor, dayLabel, etInstant, etOffset, etParts, setTimeZoneProvider, DEFAULT_TZ, label12, layoutDay, mergeDuplicates, openDays, openSlots, timeLabel } from '../schedule-board';

const ev = (id: string, person: string, start: string, end: string, source: 'google' | 'ghl' = 'google', allDay = false) => ({ id, person, start, end, allDay, source, title: id });

describe('the company\'s own time zone', () => {
  it('works in any zone, including half-hour offsets and daylight saving changes', () => {
    expect(etOffset('2026-07-01', '12:00', 'America/Denver')).toBe('-06:00');
    expect(etOffset('2026-01-15', '12:00', 'America/Denver')).toBe('-07:00');
    expect(etOffset('2026-07-01', '12:00', 'America/Phoenix')).toBe('-07:00');
    expect(etOffset('2026-07-01', '12:00', 'Asia/Kolkata')).toBe('+05:30');
    expect(etInstant('2026-11-01', '09:00', 'America/Chicago').toISOString()).toBe('2026-11-01T15:00:00.000Z');
    expect(etInstant('2026-03-08', '09:00', 'America/Los_Angeles').toISOString()).toBe('2026-03-08T16:00:00.000Z');
  });
  it('follows the provider, and falls back on a missing or bad zone', () => {
    try {
      setTimeZoneProvider(() => 'America/Denver');
      expect(boardTz()).toBe('America/Denver');
      expect(etParts('2026-07-01T18:00:00Z')).toEqual({ date: '2026-07-01', minutes: 12 * 60 });
      setTimeZoneProvider(() => 'Not/AZone');
      expect(boardTz()).toBe(DEFAULT_TZ);
      setTimeZoneProvider(() => { throw new Error('no company'); });
      expect(boardTz()).toBe(DEFAULT_TZ);
    } finally {
      setTimeZoneProvider(() => DEFAULT_TZ);
    }
  });
});

describe('company time', () => {
  it('knows daylight and standard time', () => {
    expect(etOffset('2026-09-17')).toBe('-04:00');
    expect(etOffset('2026-12-17')).toBe('-05:00');
  });
  it('turns a local date and time into the right instant and back', () => {
    const d = etInstant('2026-09-17', '10:30');
    expect(d.toISOString()).toBe('2026-09-17T14:30:00.000Z');
    expect(etParts(d)).toEqual({ date: '2026-09-17', minutes: 630 });
    expect(etParts('2026-12-01T15:00:00.000Z')).toEqual({ date: '2026-12-01', minutes: 600 });
  });
  it('formats and steps dates', () => {
    expect(label12(630)).toBe('10:30 AM');
    expect(label12(12 * 60)).toBe('12 PM');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});

describe('mergeDuplicates', () => {
  it('shows a GHL appointment synced to Google once, marked both', () => {
    const out = mergeDuplicates([
      ev('g1', 'a@x', '2026-09-17T14:00:00Z', '2026-09-17T15:30:00Z', 'google'),
      ev('h1', 'a@x', '2026-09-17T10:00:00-04:00', '2026-09-17T11:30:00-04:00', 'ghl'),
      ev('h2', 'b@x', '2026-09-17T10:00:00-04:00', '2026-09-17T11:30:00-04:00', 'ghl'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].source).toBe('both');
    expect(out[1].person).toBe('b@x');
  });
  it('keeps two different appointments at the same time', () => {
    expect(mergeDuplicates([ev('a', 'a@x', '2026-09-17T14:00:00Z', '2026-09-17T15:00:00Z'), ev('b', 'a@x', '2026-09-17T14:00:00Z', '2026-09-17T15:00:00Z')])).toHaveLength(2);
  });
});

describe('layoutDay', () => {
  it('places events by minutes from 7 AM and splits overlaps side by side', () => {
    const p = layoutDay([
      ev('a', 'a@x', etInstant('2026-09-17', '09:00').toISOString(), etInstant('2026-09-17', '10:00').toISOString()),
      ev('b', 'a@x', etInstant('2026-09-17', '09:30').toISOString(), etInstant('2026-09-17', '11:00').toISOString()),
      ev('c', 'a@x', etInstant('2026-09-17', '13:00').toISOString(), etInstant('2026-09-17', '14:00').toISOString()),
    ], '2026-09-17');
    expect(p.map((x) => [x.event.id, x.top, x.height, x.col, x.cols])).toEqual([
      ['a', 120, 60, 0, 2], ['b', 150, 90, 1, 2], ['c', 360, 60, 0, 1],
    ]);
  });
  it('clips to the grid and skips all-day and other-day events', () => {
    const p = layoutDay([
      ev('early', 'a@x', etInstant('2026-09-17', '06:00').toISOString(), etInstant('2026-09-17', '08:00').toISOString()),
      ev('allday', 'a@x', '2026-09-17T04:00:00Z', '2026-09-18T04:00:00Z', 'google', true),
      ev('tomorrow', 'a@x', etInstant('2026-09-18', '09:00').toISOString(), etInstant('2026-09-18', '10:00').toISOString()),
    ], '2026-09-17');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ top: 0, height: 60, clippedBefore: true });
  });
});

describe('conflicts and open slots', () => {
  const events = [ev('busy', 'a@x', etInstant('2026-09-17', '10:00').toISOString(), etInstant('2026-09-17', '11:00').toISOString())];
  it('finds what a booking would overlap, for that person only', () => {
    expect(conflictsFor(events, 'a@x', '2026-09-17', '10:30', 60).map((e) => e.id)).toEqual(['busy']);
    expect(conflictsFor(events, 'a@x', '2026-09-17', '11:00', 60)).toEqual([]);
    expect(conflictsFor(events, 'b@x', '2026-09-17', '10:30', 60)).toEqual([]);
  });
  it('lists open slots that fit the duration and are not in the past', () => {
    const now = etInstant('2026-09-17', '08:10');
    const slots = openSlots(events, 'a@x', '2026-09-17', 60, now);
    expect(slots.slice(0, 4)).toEqual(['08:30', '09:00', '11:00', '11:30']);
    expect(slots).not.toContain('09:30');
    expect(slots[slots.length - 1]).toBe('19:00');
  });
});

describe('the next few days of open time', () => {
  const events = [
    ev('all morning', 'a@x', etInstant('2026-09-17', '07:00').toISOString(), etInstant('2026-09-17', '12:00').toISOString()),
    ev('solid', 'a@x', etInstant('2026-09-18', '07:00').toISOString(), etInstant('2026-09-18', '20:00').toISOString()),
    ev('someone else', 'b@x', etInstant('2026-09-19', '07:00').toISOString(), etInstant('2026-09-19', '20:00').toISOString()),
  ];
  const now = etInstant('2026-09-17', '08:10');

  it('gives every day asked for, booked-solid ones included, with only that person\'s calendar counted', () => {
    const days = openDays(events, 'a@x', '2026-09-17', 3, 60, now);
    expect(days.map((d) => d.date)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19']);
    expect(days[0].times[0]).toBe('12:00');
    expect(days[1].times).toEqual([]);
    expect(days[2].times[0]).toBe('07:00');
  });

  it('labels the days the way someone on the phone would say them', () => {
    expect(dayLabel('2026-09-17', '2026-09-17')).toBe('Today');
    expect(dayLabel('2026-09-18', '2026-09-17')).toBe('Tomorrow');
    expect(dayLabel('2026-09-19', '2026-09-17')).toBe('Sat, Sep 19');
    expect(timeLabel('14:30')).toBe('2:30 PM');
  });
});
