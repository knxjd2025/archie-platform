import { describe, it, expect } from 'vitest';
import { normalizeLabels, parseFollowUp, labelMeta, MAX_LABELS, MAX_LABEL_LENGTH } from '../../../shared/canvass-labels';

describe('door labels', () => {
  it('are trimmed, lower-cased and de-duplicated', () => {
    expect(normalizeLabels(['  Hail Damage ', 'hail damage', 'Dog'])).toEqual(['hail damage', 'dog']);
  });
  it('drop what is not a label instead of losing the rest', () => {
    expect(normalizeLabels(['dog', 7, null, '', '   ', { x: 1 }])).toEqual(['dog']);
    expect(normalizeLabels('dog')).toEqual([]);
    expect(normalizeLabels(undefined)).toEqual([]);
  });
  it('are bounded in count and length', () => {
    const many = Array.from({ length: 40 }, (_, i) => `label ${i}`);
    expect(normalizeLabels(many)).toHaveLength(MAX_LABELS);
    expect(normalizeLabels(['x'.repeat(200)])[0]).toHaveLength(MAX_LABEL_LENGTH);
  });
  it('read as their suggested wording, or their own typed words', () => {
    expect(labelMeta('do not knock')).toMatchObject({ label: 'Do not knock', tone: 'warn' });
    expect(labelMeta('blue door')).toMatchObject({ label: 'Blue door', tone: 'info' });
  });
});

describe('follow-up dates', () => {
  it('null or empty clears it', () => {
    expect(parseFollowUp(null)).toBeNull();
    expect(parseFollowUp('')).toBeNull();
  });
  it('a bare date lands on that same day in Eastern time, summer and winter', () => {
    const summer = parseFollowUp('2026-07-12')!;
    const winter = parseFollowUp('2026-01-12')!;
    const eastern = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
    expect(eastern(summer)).toBe('2026-07-12');
    expect(eastern(winter)).toBe('2026-01-12');
  });
  it('rejects nonsense as undefined, so the route can say so', () => {
    expect(parseFollowUp('next tuesday')).toBeUndefined();
    expect(parseFollowUp(20260712)).toBeUndefined();
    expect(parseFollowUp('1999-01-01')).toBeUndefined();
  });
});
