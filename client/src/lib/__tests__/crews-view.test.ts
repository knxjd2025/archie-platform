import { describe, expect, it } from 'vitest';
import { addressLine, CREW_WORDS, directionsUrl, groupCrewJobs, installsOn, nextCrewStep, whenLine, type CrewJob } from '../crews-view';

const job = (over: Partial<CrewJob>): CrewJob => ({
  jobKey: 'archie-x', customer: 'Pat Hollis', jobName: null, jobType: null, address: '12 Main St', city: 'Cedar Falls', state: 'IA', zip: '50613',
  crewName: 'Red crew', installDate: '2026-11-24', endDate: null, startTime: null, status: 'scheduled', statusLabel: 'Scheduled',
  notes: null, trades: [], currentTrade: null, ...over,
});

describe('the crew screens', () => {
  it('puts a job on today while it is on, still going, or late', () => {
    const g = groupCrewJobs([
      job({ jobKey: 'a', installDate: '2026-11-24' }),
      job({ jobKey: 'b', installDate: '2026-11-23', endDate: '2026-11-25' }),
      job({ jobKey: 'c', installDate: '2026-11-20' }),
      job({ jobKey: 'd', installDate: '2026-11-26', status: 'in_progress' }),
      job({ jobKey: 'e', installDate: '2026-11-27' }),
      job({ jobKey: 'f', installDate: '2026-11-22', status: 'done' }),
    ], '2026-11-24');
    expect(g.today.map((j) => j.jobKey)).toEqual(['c', 'b', 'a', 'd']);
    expect(g.comingUp.map((j) => j.jobKey)).toEqual(['e']);
    expect(g.done.map((j) => j.jobKey)).toEqual(['f']);
  });

  it('says the address, the day and the start plainly, and builds a map search from it', () => {
    expect(addressLine(job({}))).toBe('12 Main St, Cedar Falls, IA 50613');
    expect(directionsUrl(job({}))).toBe('https://www.google.com/maps/search/?api=1&query=12%20Main%20St%2C%20Cedar%20Falls%2C%20IA%2050613');
    expect(directionsUrl(job({ address: null, city: null, state: null, zip: null }))).toBeNull();
    expect(whenLine(job({ startTime: '07:30' }))).toBe('Tue, Nov 24 · starts 7:30 AM');
    expect(whenLine(job({ endDate: '2026-11-25' }))).toBe('Tue, Nov 24 to Wed, Nov 25');
  });

  it('places a multi-day install on each of its days in its crew\'s row only', () => {
    const installs = [{ id: '1', crewId: 'red', jobKey: 'a', customer: null, jobName: null, city: null, installDate: '2026-11-24', endDate: '2026-11-25', startTime: null, status: 'scheduled' as const }];
    expect(installsOn(installs, 'red', '2026-11-25')).toHaveLength(1);
    expect(installsOn(installs, 'red', '2026-11-26')).toHaveLength(0);
    expect(installsOn(installs, 'blue', '2026-11-24')).toHaveLength(0);
  });

  it('offers the crew one step forward at a time', () => {
    expect(nextCrewStep('scheduled')).toBe('in_progress');
    expect(nextCrewStep('in_progress')).toBe('done');
    expect(nextCrewStep('done')).toBeNull();
  });

  it('has no em dash and no money word in anything a crew reads', () => {
    const text = Object.values(CREW_WORDS).map((w) => (typeof w === 'function' ? w('Roofing') : w)).join(' ');
    expect(text).not.toMatch(/—/);
    expect(text).not.toMatch(/\$|price|invoice|payment|commission/i);
  });
});
