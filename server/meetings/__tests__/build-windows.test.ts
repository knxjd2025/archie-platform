import { describe, it, expect } from 'vitest';
import { windows, weekAhead } from '../build';
import { measureWindows } from '../measures';

describe("the agenda's week windows", () => {
  it('runs Eastern midnight to Eastern midnight, not UTC (8pm Eastern)', () => {
    // `new Date('…T00:00:00')` is UTC midnight on Vercel, which started the
    // agenda's week at 8pm Sunday company time.
    const w = windows('2026-09-21');
    expect(w.last.iso).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    expect(w.last.from.toISOString()).toBe('2026-09-14T04:00:00.000Z');
    expect(w.last.to.toISOString()).toBe('2026-09-21T03:59:59.999Z');
    expect(w.prior.from.toISOString()).toBe('2026-09-07T04:00:00.000Z');
    expect(w.prior.to.toISOString()).toBe('2026-09-14T03:59:59.999Z');
  });

  it('keeps a lead from 8pm Sunday Eastern in the week it happened', () => {
    // 8:30pm Sunday 20 September in the company's time zone is already Monday in UTC.
    const sundayEvening = new Date('2026-09-21T00:30:00Z');
    const w = windows('2026-09-21');
    expect(sundayEvening.getTime()).toBeGreaterThanOrEqual(w.last.from.getTime());
    expect(sundayEvening.getTime()).toBeLessThanOrEqual(w.last.to.getTime());
    // ...and the Sunday evening before last week belongs to the prior week.
    const priorSunday = new Date('2026-09-14T00:30:00Z');
    expect(priorSunday.getTime()).toBeLessThan(w.last.from.getTime());
    expect(priorSunday.getTime()).toBeLessThanOrEqual(w.prior.to.getTime());
  });

  it('agrees with the scorecard to the millisecond', () => {
    for (const monday of ['2026-09-21', '2026-11-02', '2026-03-09']) {
      const w = windows(monday);
      const m = measureWindows(monday);
      expect(w.last.from.getTime()).toBe(m.last.from.getTime());
      expect(w.last.to.getTime()).toBe(m.last.to.getTime());
      expect(w.prior.from.getTime()).toBe(m.prior.from.getTime());
      expect(w.prior.to.getTime()).toBe(m.prior.to.getTime());
    }
  });

  it('keeps a whole company week across the end of daylight saving', () => {
    // DST ends Sunday 1 November 2026: the week starts on EDT and ends on EST.
    const w = windows('2026-11-02');
    expect(w.last.from.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(w.last.to.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });

  it('keeps a whole company week across the start of daylight saving', () => {
    // DST starts Sunday 8 March 2026: the week starts on EST and ends on EDT.
    const w = windows('2026-03-09');
    expect(w.last.from.toISOString()).toBe('2026-03-02T05:00:00.000Z');
    expect(w.last.to.toISOString()).toBe('2026-03-09T03:59:59.999Z');
  });
});

describe('the week ahead', () => {
  it("is Monday to Sunday in the company's time zone, not into the following Monday", () => {
    // It ran from UTC midnight Monday to the end of the next Monday, so it
    // began at 8pm Sunday Eastern and counted eight days of bookings.
    const w = weekAhead('2026-09-21');
    expect(w.from.toISOString()).toBe('2026-09-21T04:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-09-28T03:59:59.999Z');
  });

  it('leaves out an appointment at 8pm Sunday Eastern the night before', () => {
    const w = weekAhead('2026-09-21');
    expect(new Date('2026-09-21T00:30:00Z').getTime()).toBeLessThan(w.from.getTime());
  });

  it('spans the end of daylight saving inside the week', () => {
    const w = weekAhead('2026-10-26');
    expect(w.from.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });
});
