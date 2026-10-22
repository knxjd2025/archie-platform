import { describe, it, expect } from 'vitest';
import { buildDigest, unfinishedRunErrors } from '../digest';

describe('buildDigest', () => {
  it('groups loops by owner and flags urgency in the subject', () => {
    const { subject, html } = buildDigest(
      [
        { id: 1, owner: 'thomas', urgency: 'urgent', summary: 'Call Jane back', state: 'open', kind: 'callback_requested', contact: { phone: '+1704' } },
        { id: 2, owner: 'james', urgency: 'normal', summary: 'Chase invoice', state: 'nudged', kind: 'invoice_unpaid', contact: null },
      ] as any,
      [],
    );
    expect(subject).toMatch(/2 open/i);
    expect(html).toContain('Call Jane back');
    expect(html).toContain('thomas');
  });
  it('says all clear when empty', () => {
    const { subject } = buildDigest([], []);
    expect(subject).toMatch(/all clear/i);
  });
});

describe('unfinishedRunErrors (a killed sweep must not read as all clear)', () => {
  const now = new Date('2026-10-15T13:10:00Z');
  it('reports a sweep that started over 6 minutes ago and never finished', () => {
    const errs = unfinishedRunErrors([{ id: 7, startedAt: new Date('2026-10-15T12:00:00Z'), finishedAt: null }], now);
    expect(errs).toHaveLength(1);
    expect(errs[0].source).toBe('sweep');
    expect(errs[0].message).toMatch(/#7 .*never finished/);
  });
  it('ignores finished sweeps and one still inside its time', () => {
    expect(unfinishedRunErrors([
      { id: 1, startedAt: new Date('2026-10-15T12:00:00Z'), finishedAt: new Date('2026-10-15T12:03:00Z') },
      { id: 2, startedAt: new Date('2026-10-15T13:08:00Z'), finishedAt: null },
    ], now)).toEqual([]);
  });
});
