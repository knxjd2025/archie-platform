import { describe, expect, it } from 'vitest';
import { CREW_JOB_KEYS, crewJobView, phoneWindowOpen } from '../view';

const lead = {
  firstName: 'Pat Hollis', lastName: null, jobName: 'Pat Hollis', jobType: 'replacement', serviceType: 'replacement',
  address: '12 Main St', city: 'Cedar Falls', state: 'IA', zip: '50613', phone: '(319) 555-0142',
  // Everything below is on a lead and must never reach a crew.
  projectedValue: '18450.00', email: 'pat@example.test', notes: 'Quoted $18,450', jtSalesRep: 'Rep',
} as any;
const assignment = { jobKey: 'archie-0123456789abcdef0123456789abcdef', installDate: '2026-11-23', endDate: '2026-11-24', startTime: '07:30', status: 'scheduled', notes: 'Tear off and dry in.' };
/** Well before the install: the phone is not yet shown. */
const EARLY = '2026-11-10';

describe('what a crew is shown about a job', () => {
  it('carries exactly the allowed fields, and no money, phone, email or office notes, away from the install days', () => {
    const v = crewJobView(lead, assignment as any, 'Red crew', [{ key: 'gutters', done: false }, { key: 'roofing', done: true }], EARLY);
    expect(Object.keys(v).sort()).toEqual(CREW_JOB_KEYS.filter((k) => k !== 'homeownerPhone').sort());
    const text = JSON.stringify(v);
    for (const leak of ['18450', '18,450', '555-0142', 'pat@example.test', 'Quoted']) expect(text).not.toContain(leak);
    expect(v).toMatchObject({ customer: 'Pat Hollis', address: '12 Main St', city: 'Cedar Falls', crewName: 'Red crew', status: 'scheduled', statusLabel: 'Scheduled', notes: 'Tear off and dry in.' });
  });

  it('adds the homeowner\'s phone around the install days, and still no money, email or office notes', () => {
    const v = crewJobView(lead, assignment as any, 'Red crew', null, '2026-11-23');
    expect(Object.keys(v).sort()).toEqual([...CREW_JOB_KEYS].sort());
    expect(v.homeownerPhone).toBe('(319) 555-0142');
    const text = JSON.stringify(v);
    for (const leak of ['18450', '18,450', 'pat@example.test', 'Quoted']) expect(text).not.toContain(leak);
  });

  it('shows the phone only on install days, in company dates', () => {
    const shown = (today: string, a: { installDate: string; endDate?: string | null } = assignment) =>
      'homeownerPhone' in crewJobView(lead, { ...assignment, ...a, endDate: a.endDate ?? null } as any, null, null, today);
    expect(shown('2026-11-20')).toBe(false);
    expect(shown('2026-11-21')).toBe(false);
    expect(shown('2026-11-22')).toBe(false);
    expect(shown('2026-11-23')).toBe(true);
    expect(shown('2026-11-24')).toBe(true);
    expect(shown('2026-11-25')).toBe(false);
    // No last day: the first day is the last.
    expect(shown('2026-11-23', { installDate: '2026-11-23', endDate: null })).toBe(true);
    expect(shown('2026-11-24', { installDate: '2026-11-23', endDate: null })).toBe(false);
    // Across a month's end.
    expect(shown('2026-11-30', { installDate: '2026-12-01', endDate: null })).toBe(false);
    expect(shown('2026-12-01', { installDate: '2026-12-01', endDate: null })).toBe(true);
    expect(shown('2026-11-28', { installDate: '2026-12-01', endDate: null })).toBe(false);
    expect(phoneWindowOpen({ installDate: '2026-11-23', endDate: '2026-11-24' }, '2026-11-21')).toBe(false);
    expect(phoneWindowOpen({ installDate: '2026-11-23', endDate: '2026-11-24' }, 'not-a-date')).toBe(false);
  });

  it('leaves the phone out when the job has none, even inside the window', () => {
    for (const phone of [null, '', '   ']) {
      expect('homeownerPhone' in crewJobView({ ...lead, phone }, assignment as any, null, null, '2026-11-23')).toBe(false);
    }
  });

  it('lists the trades in site order, with the one to tick next', () => {
    const v = crewJobView(lead, assignment as any, null, [{ key: 'gutters', done: false }, { key: 'roofing', done: true }], EARLY);
    expect(v.trades).toEqual([{ key: 'roofing', label: 'Roofing', done: true }, { key: 'gutters', label: 'Gutters', done: false }]);
    expect(v.currentTrade).toBe('gutters');
    expect(crewJobView(lead, assignment as any, null, null, EARLY).trades).toEqual([{ key: 'roofing', label: 'Roofing', done: false }]);
  });
});
