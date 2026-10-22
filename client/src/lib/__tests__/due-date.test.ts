import { describe, it, expect } from 'vitest';
import { dueDay, isDueDayPast } from '../due-date';

describe('dueDay', () => {
  it('reads a legacy UTC-midnight row as the day that was picked, not the evening before', () => {
    expect(dueDay('2026-10-16T00:00:00.000Z')).toBe('2026-10-16');
    expect(dueDay('2026-10-16T00:00:00Z')).toBe('2026-10-16');
  });
  it('reads a noon-Charlotte row (how the server now stores a picked day) as that day', () => {
    expect(dueDay('2026-10-16T16:00:00.000Z')).toBe('2026-10-16');   // EDT
    expect(dueDay('2026-12-16T17:00:00.000Z')).toBe('2026-12-16');   // EST
  });
  it('reads a computed timestamp as its Charlotte day, even after 8pm', () => {
    // 11pm Oct 15 in Charlotte is already the 16th in UTC.
    expect(dueDay('2026-10-16T03:00:00.000Z')).toBe('2026-10-15');
  });
  it('passes a bare date through and gives up on junk', () => {
    expect(dueDay('2026-10-16')).toBe('2026-10-16');
    expect(dueDay('')).toBeNull();
    expect(dueDay(null)).toBeNull();
    expect(dueDay('not a date')).toBeNull();
  });
});

describe('isDueDayPast', () => {
  const due = '2026-10-16T00:00:00.000Z';
  it('is not overdue at 8pm the night before — the bug this fixes', () => {
    expect(isDueDayPast(due, new Date('2026-10-16T00:30:00Z'))).toBe(false);   // 8:30pm Oct 15 ET
  });
  it('is not overdue on the due day itself, late into the evening', () => {
    expect(isDueDayPast(due, new Date('2026-10-17T03:30:00Z'))).toBe(false);   // 11:30pm Oct 16 ET
  });
  it('is overdue once the due day has passed in Charlotte', () => {
    expect(isDueDayPast(due, new Date('2026-10-17T04:30:00Z'))).toBe(true);    // 12:30am Oct 17 ET
  });
  it('never calls an unreadable date overdue', () => {
    expect(isDueDayPast('garbage', new Date())).toBe(false);
  });
});
