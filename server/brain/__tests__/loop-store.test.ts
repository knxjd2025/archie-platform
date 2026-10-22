import { describe, it, expect } from 'vitest';
import { makeDedupeKey, shouldReopen } from '../loop-store';

describe('makeDedupeKey', () => {
  it('is stable and collision-scoped', () => {
    expect(makeDedupeKey('unanswered_inbound', 'ghl', 'conv_123')).toBe('unanswered_inbound:ghl:conv_123');
    expect(makeDedupeKey('invoice_unpaid', 'jobtread', 'doc 9/2')).toBe('invoice_unpaid:jobtread:doc_9/2');
  });
});

describe('shouldReopen (re-emitted findings must not undo a person closing a loop)', () => {
  const closedAt = new Date('2026-10-01T15:00:00Z');

  it('never reopens a dismissed loop', () => {
    expect(shouldReopen({ state: 'dismissed', closedAt, closedBy: 'sms:james' }, new Date('2026-10-02T00:00:00Z'))).toBe(false);
  });

  it('leaves a person-closed loop closed when the finding is just re-emitted', () => {
    expect(shouldReopen({ state: 'done', closedAt, closedBy: 'sms:james' })).toBe(false);
    expect(shouldReopen({ state: 'done', closedAt, closedBy: 'sms:james' }, new Date('2026-09-30T00:00:00Z'))).toBe(false);
  });

  it('reopens a person-closed loop for something newer than the close', () => {
    expect(shouldReopen({ state: 'done', closedAt, closedBy: 'sms:james' }, new Date('2026-10-01T16:00:00Z'))).toBe(true);
  });

  it('reopens a loop a sweep closed itself when the signal comes back', () => {
    expect(shouldReopen({ state: 'done', closedAt, closedBy: 'calendar:self-close' })).toBe(true);
    expect(shouldReopen({ state: 'done', closedAt, closedBy: 'triage:self-close' })).toBe(true);
  });

  it('leaves live loops alone', () => {
    for (const state of ['open', 'nudged', 'escalated', 'snoozed']) {
      expect(shouldReopen({ state, closedAt: null, closedBy: null }, new Date())).toBe(false);
    }
  });
});
