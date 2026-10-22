import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../integrations/company-mail', () => ({ sendCompanyEmail: vi.fn() }));
vi.mock('../../integrations/ghl/messaging', () => ({ sendGhlSms: vi.fn(), upsertContactByPhone: vi.fn() }));

import {
  easternNow, isSendWindow, easternMidnight, addDaysIso, buildRepReminder, reminderNeedsRetry, type ReminderInput,
} from '../daily-reminder';

const empty: ReminderInput = {
  repName: 'Dana Whitfield',
  followUpsDue: [], staleHouses: [], appointmentsToday: [], appointmentsToLog: [], staleLeads: [],
  totals: { followUpsDue: 0, staleHouses: 0, staleLeads: 0 },
};

describe('8 AM Eastern, whichever side of daylight saving', () => {
  it('the 12:00 UTC run sends in summer, the 13:00 run in winter', () => {
    expect(isSendWindow(new Date('2026-07-15T12:00:00Z'))).toBe(true);  // 8 AM EDT, Wednesday
    expect(isSendWindow(new Date('2026-07-15T13:00:00Z'))).toBe(false); // 9 AM EDT
    expect(isSendWindow(new Date('2026-01-14T13:00:00Z'))).toBe(true);  // 8 AM EST, Wednesday
    expect(isSendWindow(new Date('2026-01-14T12:00:00Z'))).toBe(false); // 7 AM EST
  });
  it('Sunday is a day off; Saturday is not', () => {
    expect(isSendWindow(new Date('2026-07-19T12:00:00Z'))).toBe(false); // Sunday
    expect(isSendWindow(new Date('2026-07-18T12:00:00Z'))).toBe(true);  // Saturday
  });
  it('the date is Eastern, not UTC, late in the evening', () => {
    expect(easternNow(new Date('2026-07-16T02:30:00Z')).dateIso).toBe('2026-07-15');
  });
  it('Eastern midnight is 04:00 UTC in summer and 05:00 in winter', () => {
    expect(easternMidnight('2026-07-15').toISOString()).toBe('2026-07-15T04:00:00.000Z');
    expect(easternMidnight('2026-01-14').toISOString()).toBe('2026-01-14T05:00:00.000Z');
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('the message', () => {
  it('is not sent when there is nothing to update', () => {
    expect(buildRepReminder(empty, 'https://app.example.com')).toBeNull();
  });

  it('lists each kind of work and links to the app', () => {
    const msg = buildRepReminder({
      ...empty,
      appointmentsToday: [{ title: 'Inspection — Lopez', start: new Date('2026-07-15T14:00:00Z'), address: '12 Oak St' }],
      appointmentsToLog: [{ title: 'Adjuster — Kim', start: new Date('2026-07-14T18:00:00Z'), address: null }],
      followUpsDue: [{ address: '9 Elm St', status: 'interested' }],
      staleHouses: [{ address: '4 Pine Rd', status: 'appointment', daysSince: 5 }],
      staleLeads: [{ name: 'Lopez Roof', status: 'proposal_sent', daysSince: 6 }, { name: 'Kim', status: 'new', daysSince: null }],
      totals: { followUpsDue: 1, staleHouses: 1, staleLeads: 2 },
    }, 'https://app.example.com/')!;
    expect(msg.subject).toContain('Dana');
    expect(msg.html).toContain('10:00 AM');
    expect(msg.html).toContain('9 Elm St');
    expect(msg.html).toContain('5 days since an update');
    expect(msg.html).toContain('proposal sent, 6 days since last contact');
    expect(msg.html).toContain('never contacted');
    expect(msg.html).toContain('href="https://app.example.com/"');
    expect(msg.sms).toBe('Morning check-in, Dana: 1 appt today, 1 appt to log, 1 follow-up due, 1 hot door going cold, 2 leads to update. Update them here: https://app.example.com/');
    expect(msg.counts).toEqual({ followUpsDue: 1, staleHouses: 1, appointmentsToday: 1, appointmentsToLog: 1, staleLeads: 2 });
  });

  it('says how many more there are when the list is capped', () => {
    const msg = buildRepReminder({
      ...empty,
      followUpsDue: [{ address: '1 A St', status: 'no_answer' }],
      totals: { followUpsDue: 12, staleHouses: 0, staleLeads: 0 },
    }, 'https://x')!;
    expect(msg.html).toContain('…and 11 more in the app');
    expect(msg.sms).toContain('12 follow-ups due');
  });

  it('escapes what came from a calendar or a typed address', () => {
    const msg = buildRepReminder({
      ...empty,
      appointmentsToday: [{ title: '<script>x</script>', start: new Date('2026-07-15T14:00:00Z'), address: 'A & B' }],
    }, 'https://x')!;
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
    expect(msg.html).toContain('A &amp; B');
  });

  it('keeps the text under one GHL send', () => {
    const msg = buildRepReminder({ ...empty, totals: { followUpsDue: 999, staleHouses: 999, staleLeads: 999 } }, 'https://app.bestroofingnow.com')!;
    expect(msg.sms.length).toBeLessThan(300);
  });
});

describe('reminderNeedsRetry (a failed or interrupted send is not "already sent")', () => {
  const now = new Date('2026-07-15T12:30:00Z');
  const at = (iso: string) => new Date(iso);
  it('retries when either channel failed', () => {
    expect(reminderNeedsRetry({ emailStatus: 'failed', smsStatus: 'sent', sentAt: at('2026-07-15T12:00:00Z') }, now)).toBe(true);
    expect(reminderNeedsRetry({ emailStatus: 'skipped', smsStatus: 'failed', sentAt: at('2026-07-15T12:00:00Z') }, now)).toBe(true);
  });
  it('retries a claim with no outcome once it is old enough to be a killed run', () => {
    expect(reminderNeedsRetry({ emailStatus: null, smsStatus: null, sentAt: at('2026-07-15T12:00:00Z') }, now)).toBe(true);
  });
  it('leaves a claim alone while its own run may still be sending', () => {
    expect(reminderNeedsRetry({ emailStatus: null, smsStatus: null, sentAt: at('2026-07-15T12:25:00Z') }, now)).toBe(false);
  });
  it('never resends what went out, or a dry run', () => {
    expect(reminderNeedsRetry({ emailStatus: 'sent', smsStatus: 'skipped', sentAt: at('2026-07-15T12:00:00Z') }, now)).toBe(false);
    expect(reminderNeedsRetry({ emailStatus: 'dry_run', smsStatus: 'dry_run', sentAt: at('2026-07-15T12:00:00Z') }, now)).toBe(false);
  });
});
