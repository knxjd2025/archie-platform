import { describe, it, expect } from 'vitest';
import { isQuietHours, nextEscalationLevel, underRateCap } from '../escalate';

describe('isQuietHours (America/New_York)', () => {
  it('9 PM ET is quiet, 9 AM ET is not', () => {
    expect(isQuietHours(new Date('2026-07-18T01:00:00Z'))).toBe(true);  // 9 PM EDT prev day
    expect(isQuietHours(new Date('2026-07-18T13:00:00Z'))).toBe(false); // 9 AM EDT
  });
});

describe('nextEscalationLevel', () => {
  it('fresh open loop → level 0', () => {
    expect(nextEscalationLevel({ urgency: 'normal', state: 'open' }, Infinity)).toBe(0);
  });
  it('urgent nudged 3h ago → level 1; 1h ago → null', () => {
    expect(nextEscalationLevel({ urgency: 'urgent', state: 'nudged' }, 3)).toBe(1);
    expect(nextEscalationLevel({ urgency: 'urgent', state: 'nudged' }, 1)).toBe(null);
  });
  it('escalated loop overdue again → level 2', () => {
    expect(nextEscalationLevel({ urgency: 'urgent', state: 'escalated' }, 5)).toBe(2);
  });
  it('done/snoozed → null', () => {
    expect(nextEscalationLevel({ urgency: 'urgent', state: 'done' }, 99)).toBe(null);
  });
});

describe('underRateCap', () => {
  it('caps at 5/day', () => {
    expect(underRateCap(4)).toBe(true);
    expect(underRateCap(5)).toBe(false);
  });
});
