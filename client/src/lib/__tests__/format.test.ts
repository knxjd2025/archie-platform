import { describe, it, expect } from 'vitest';
import { fmtDate, fmtDay } from '../format';

/**
 * Due dates and issue dates are stored date-only ("2026-08-13"). `new Date()`
 * reads that as UTC midnight, which is the PREVIOUS day everywhere in the US —
 * an invoice issued the 13th displayed as "Aug 12", and a follow-up due today
 * displayed as due yesterday.
 */
describe('fmtDate', () => {
  it('keeps a date-only string on its own day', () => {
    expect(fmtDate('2026-08-13')).toBe('Aug 13, 2026');
  });

  it('does not shift across a month boundary', () => {
    expect(fmtDate('2026-09-01')).toBe('Sep 1, 2026');
  });

  it('does not shift across a year boundary', () => {
    expect(fmtDate('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('still handles a full timestamp', () => {
    expect(fmtDate('2026-08-13T18:30:00Z')).toBe('Aug 13, 2026');
  });

  it('returns null for nothing, rather than "Invalid Date"', () => {
    expect(fmtDate(null)).toBeNull();
    expect(fmtDate('')).toBeNull();
    expect(fmtDate('not a date')).toBeNull();
  });
});

describe('fmtDay', () => {
  it('formats without the year and stays on the right day', () => {
    expect(fmtDay('2026-08-13')).toBe('Aug 13');
  });

  it('returns null for nothing', () => {
    expect(fmtDay(null)).toBeNull();
    expect(fmtDay('nope')).toBeNull();
  });
});
