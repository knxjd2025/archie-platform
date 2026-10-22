import { describe, it, expect } from 'vitest';
import { classifyAction, resolveCustomerSendPlan, shouldWakeFromSnooze, startOfEasternDay, failedSlotKey, MAX_CUSTOMER_SEND_ATTEMPTS } from '../actor';

describe('classifyAction (autonomy matrix)', () => {
  it('routine customer chases are auto', () => {
    expect(classifyAction({ kind: 'estimate_stale', urgency: 'normal', contact: { phone: '+1704' } })).toBe('auto_customer');
    expect(classifyAction({ kind: 'callback_requested', urgency: 'urgent', contact: { phone: '+1704' } })).toBe('auto_customer');
  });
  it('claims and money are draft-only', () => {
    expect(classifyAction({ kind: 'claim_milestone', urgency: 'urgent' })).toBe('draft_only');
    expect(classifyAction({ kind: 'invoice_unpaid', urgency: 'normal' })).toBe('draft_only');
  });
  it('everything else nudges the team', () => {
    expect(classifyAction({ kind: 'unanswered_inbound', urgency: 'urgent', contact: { phone: '+1704' } })).toBe('team_nudge');
    expect(classifyAction({ kind: 'estimate_stale', urgency: 'normal' })).toBe('team_nudge'); // no contact info → can't message customer
  });
});

describe('resolveCustomerSendPlan (fix 1: contactId gate, fix 3: quiet-hours SMS skip)', () => {
  it('gmail-sourced loop (no GHL contactId to resolve) falls back to a team nudge, even though classifyAction says auto_customer', () => {
    // A gmail/jobtread/calendar-sourced estimate_stale loop with a contact email is
    // classified auto_customer by classifyAction, but it has no GHL contactId — the
    // actor must NEVER attempt a GHL send with an empty contactId for it.
    expect(classifyAction({ kind: 'estimate_stale', urgency: 'normal', contact: { email: 'jane@example.com' } })).toBe('auto_customer');
    const plan = resolveCustomerSendPlan(
      { kind: 'estimate_stale', contact: { email: 'jane@example.com' } },
      /* contactId */ null,
      /* quiet */ false,
    );
    expect(plan.type).toBe('fallback_team_nudge');
    if (plan.type === 'fallback_team_nudge') {
      expect(plan.note).toMatch(/couldn't resolve GHL contact/i);
    }
  });

  it('GHL-sourced loop with a failed contactId lookup also falls back (not just non-GHL sources)', () => {
    const plan = resolveCustomerSendPlan({ kind: 'callback_requested', contact: { phone: '+17045551234' } }, null, false);
    expect(plan.type).toBe('fallback_team_nudge');
  });

  it('resolved contactId + phone contact + quiet hours → skip entirely (no email downgrade)', () => {
    const plan = resolveCustomerSendPlan({ kind: 'estimate_stale', contact: { phone: '+17045551234' } }, 'contact_123', true);
    expect(plan.type).toBe('skip_quiet_hours');
  });

  it('resolved contactId + phone contact + not quiet → send via sms with the contactId threaded through', () => {
    const plan = resolveCustomerSendPlan({ kind: 'estimate_stale', contact: { phone: '+17045551234' } }, 'contact_123', false);
    expect(plan).toEqual({ type: 'send', channel: 'sms', contactId: 'contact_123' });
  });

  it('resolved contactId + email-only contact + quiet hours → still sends (email is fine at night)', () => {
    const plan = resolveCustomerSendPlan({ kind: 'estimate_stale', contact: { email: 'jane@example.com' } }, 'contact_123', true);
    expect(plan).toEqual({ type: 'send', channel: 'email', contactId: 'contact_123' });
  });
});

describe('shouldWakeFromSnooze (fix 3: snoozed loops must wake up)', () => {
  const now = new Date('2026-07-18T12:00:00Z');

  it('wakes a snoozed loop once snoozeUntil has passed', () => {
    expect(shouldWakeFromSnooze({ state: 'snoozed', snoozeUntil: new Date('2026-07-18T11:59:59Z') }, now)).toBe(true);
  });

  it('does not wake a snoozed loop whose snoozeUntil is still in the future', () => {
    expect(shouldWakeFromSnooze({ state: 'snoozed', snoozeUntil: new Date('2026-07-19T00:00:00Z') }, now)).toBe(false);
  });

  it('a snoozeUntil exactly equal to now wakes (boundary is inclusive)', () => {
    expect(shouldWakeFromSnooze({ state: 'snoozed', snoozeUntil: now }, now)).toBe(true);
  });

  it('non-snoozed states never "wake" (nothing to do)', () => {
    expect(shouldWakeFromSnooze({ state: 'open', snoozeUntil: null }, now)).toBe(false);
    expect(shouldWakeFromSnooze({ state: 'escalated', snoozeUntil: null }, now)).toBe(false);
  });

  it('a snoozed loop with no snoozeUntil never auto-wakes', () => {
    expect(shouldWakeFromSnooze({ state: 'snoozed', snoozeUntil: null }, now)).toBe(false);
  });
});

describe('a failed customer send stays retryable, then goes to the team', () => {
  const loop = { kind: 'callback_requested', contact: { phone: '+17045551234' } };
  it('keeps sending while under the attempt cap', () => {
    expect(resolveCustomerSendPlan(loop, 'contact1', false, MAX_CUSTOMER_SEND_ATTEMPTS - 1).type).toBe('send');
  });
  it('falls back to a team nudge once the cap is reached', () => {
    const plan = resolveCustomerSendPlan(loop, 'contact1', false, MAX_CUSTOMER_SEND_ATTEMPTS);
    expect(plan.type).toBe('fallback_team_nudge');
    if (plan.type === 'fallback_team_nudge') expect(plan.note).toMatch(/after 3 tries/);
  });
  it('a released slot gets a key that no longer blocks the real one', () => {
    expect(failedSlotKey(12, 0, 99)).toBe('12:0:failed:99');
    expect(failedSlotKey(12, 0, 99)).not.toBe('12:0');
  });
});

describe('startOfEasternDay (the daily SMS cap resets at Charlotte midnight)', () => {
  it('is 04:00 UTC in summer and 05:00 UTC in winter', () => {
    expect(startOfEasternDay(new Date('2026-07-15T15:00:00Z')).toISOString()).toBe('2026-07-15T04:00:00.000Z');
    expect(startOfEasternDay(new Date('2026-01-14T15:00:00Z')).toISOString()).toBe('2026-01-14T05:00:00.000Z');
  });
  it('late evening Eastern is still the same Eastern day, not the next UTC one', () => {
    // 9:30 PM EDT on the 15th is 01:30 UTC on the 16th.
    expect(startOfEasternDay(new Date('2026-07-16T01:30:00Z')).toISOString()).toBe('2026-07-15T04:00:00.000Z');
  });
});
