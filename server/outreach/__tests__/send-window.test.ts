import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db', () => ({ db: {} }));

import { easternHour, inSendWindow, easternClock, getNextAvailableSendTime } from '../outreach-scheduler';

// Vercel runs in UTC; the window is 8 AM-5 PM in Charlotte.
describe('the outreach send window is Eastern, not the server clock', () => {
  it('reads the hour in Charlotte', () => {
    expect(easternHour(new Date('2026-07-15T12:00:00Z'))).toBe(8);  // EDT
    expect(easternHour(new Date('2026-01-14T12:00:00Z'))).toBe(7);  // EST
    expect(easternHour(new Date('2026-07-16T03:30:00Z'))).toBe(23);
  });

  it('is closed at 9 AM UTC (5 AM Eastern) and open at 4 PM UTC (noon Eastern)', () => {
    expect(inSendWindow(new Date('2026-07-15T09:00:00Z'))).toBe(false);
    expect(inSendWindow(new Date('2026-07-15T16:00:00Z'))).toBe(true);
    expect(inSendWindow(new Date('2026-07-15T21:00:00Z'))).toBe(false); // 5 PM EDT
  });

  it('places window times on the Eastern clock', () => {
    expect(easternClock(new Date('2026-07-15T16:00:00Z'), 8).toISOString()).toBe('2026-07-15T12:00:00.000Z');
    expect(easternClock(new Date('2026-01-14T16:00:00Z'), 17).toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });

  it('the next send time is 8 AM Eastern today, now, or 8 AM Eastern tomorrow', () => {
    expect(getNextAvailableSendTime(new Date('2026-07-15T09:00:00Z')).toISOString()).toBe('2026-07-15T12:00:00.000Z');
    const midday = new Date('2026-07-15T16:00:00Z');
    expect(getNextAvailableSendTime(midday)).toBe(midday);
    // 7 PM EDT on the 15th is 23:00 UTC; tomorrow's window opens 12:00 UTC on the 16th.
    expect(getNextAvailableSendTime(new Date('2026-07-15T23:00:00Z')).toISOString()).toBe('2026-07-16T12:00:00.000Z');
  });
});
