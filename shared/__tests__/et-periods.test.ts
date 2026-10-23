import { describe, it, expect } from 'vitest';
import { isIsoDate, mondayOf, etDayStart, etWeekStart, etWeekStartDate, etMonthStart, etDateRange, etPlusDays } from '../et-periods';

describe('company day boundaries', () => {
  it('keeps 8:30pm Eastern on the same day, though UTC has rolled over', () => {
    // 2026-10-15 20:30 EDT is 2026-10-16 00:30Z. The server's own midnight
    // (UTC on Vercel) put this evening's doors on tomorrow.
    const evening = new Date('2026-10-16T00:30:00Z');
    expect(etDayStart(evening).toISOString()).toBe('2026-10-15T04:00:00.000Z');
    expect(etPlusDays(0, evening)).toBe('2026-10-15');
    expect(etPlusDays(2, evening)).toBe('2026-10-17');
  });

  it('starts the day at Eastern midnight on both sides of a DST change', () => {
    // EST in winter (UTC-5), EDT in summer (UTC-4).
    expect(etDayStart(new Date('2026-12-01T15:00:00Z')).toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(etDayStart(new Date('2026-07-01T15:00:00Z')).toISOString()).toBe('2026-07-01T04:00:00.000Z');
    // The fall-back day itself (Sunday 1 November 2026) began on EDT.
    expect(etDayStart(new Date('2026-11-01T20:00:00Z')).toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});

describe('the Monday-to-Sunday week', () => {
  it('finds the Monday on or before a date', () => {
    expect(mondayOf('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(mondayOf('2026-10-15')).toBe('2026-10-12'); // Thursday
    expect(mondayOf('2026-10-18')).toBe('2026-10-12'); // Sunday is the end of the week, not the start
  });

  it('still counts Sunday 8:30pm Eastern in the week that is ending', () => {
    // Sunday 2026-10-18 20:30 EDT = Monday 00:30Z. A UTC week would already be the next one.
    const sundayNight = new Date('2026-10-19T00:30:00Z');
    expect(etWeekStartDate(sundayNight)).toBe('2026-10-12');
    expect(etWeekStart(sundayNight).toISOString()).toBe('2026-10-12T04:00:00.000Z');
  });

  it('starts a week spanning the fall-back change on EDT', () => {
    // Week of Monday 26 Oct 2026; DST ends Sunday 1 Nov.
    expect(etWeekStart(new Date('2026-11-01T22:00:00Z')).toISOString()).toBe('2026-10-26T04:00:00.000Z');
    // The following week begins on EST.
    expect(etWeekStart(new Date('2026-11-03T15:00:00Z')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('the calendar month', () => {
  it('starts at Eastern midnight on the 1st, even late on the last evening of the month', () => {
    // 31 Oct 2026 21:00 EDT = 1 Nov 01:00Z — still October in the company's time zone.
    expect(etMonthStart(new Date('2026-11-01T01:00:00Z')).toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(etMonthStart(new Date('2026-12-15T12:00:00Z')).toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });
});

describe('a range of company days', () => {
  it('runs from the first midnight to the last millisecond before the next one, across DST', () => {
    const r = etDateRange('2026-10-26', '2026-11-01');
    expect(r.from.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });
});

describe('isIsoDate', () => {
  it('accepts real YYYY-MM-DD dates only', () => {
    expect(isIsoDate('2026-10-15')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', 'next week', '2026-10-15T00:00', '', null, 20261015, undefined]) {
      expect(isIsoDate(bad), String(bad)).toBe(false);
    }
  });
});
