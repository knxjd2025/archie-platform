import { describe, expect, it } from 'vitest';
import { CREW_JOB_KEYS, crewJobView } from '../view';

const lead = {
  firstName: 'Pat Hollis', lastName: null, jobName: 'Pat Hollis', jobType: 'replacement', serviceType: 'replacement',
  address: '12 Main St', city: 'Cedar Falls', state: 'IA', zip: '50613',
  // Everything below is on a lead and must never reach a crew.
  projectedValue: '18450.00', phone: '(319) 555-0142', email: 'pat@example.test', notes: 'Quoted $18,450', jtSalesRep: 'Rep',
} as any;
const assignment = { jobKey: 'archie-0123456789abcdef0123456789abcdef', installDate: '2026-11-23', endDate: '2026-11-24', startTime: '07:30', status: 'scheduled', notes: 'Tear off and dry in.' };

describe('what a crew is shown about a job', () => {
  it('carries exactly the allowed fields, and no money, phone, email or office notes', () => {
    const v = crewJobView(lead, assignment as any, 'Red crew', [{ key: 'gutters', done: false }, { key: 'roofing', done: true }]);
    expect(Object.keys(v).sort()).toEqual([...CREW_JOB_KEYS].sort());
    const text = JSON.stringify(v);
    for (const leak of ['18450', '18,450', '555-0142', 'pat@example.test', 'Quoted']) expect(text).not.toContain(leak);
    expect(v).toMatchObject({ customer: 'Pat Hollis', address: '12 Main St', city: 'Cedar Falls', crewName: 'Red crew', status: 'scheduled', statusLabel: 'Scheduled', notes: 'Tear off and dry in.' });
  });

  it('lists the trades in site order, with the one to tick next', () => {
    const v = crewJobView(lead, assignment as any, null, [{ key: 'gutters', done: false }, { key: 'roofing', done: true }]);
    expect(v.trades).toEqual([{ key: 'roofing', label: 'Roofing', done: true }, { key: 'gutters', label: 'Gutters', done: false }]);
    expect(v.currentTrade).toBe('gutters');
    expect(crewJobView(lead, assignment as any, null, null).trades).toEqual([{ key: 'roofing', label: 'Roofing', done: false }]);
  });
});
