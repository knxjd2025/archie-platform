import { describe, it, expect } from 'vitest';
import { planRepLinks } from '../jobtread-reps';

const roster = [
  { id: 1, name: 'James Turner', email: 'james@x.com', active: true, jobtreadSalesRep: 'James Turner' },
  { id: 3, name: 'Thomas Bramhill', email: 'thomas@x.com', active: true, jobtreadSalesRep: 'Thomas Bramhill' },
  { id: 4, name: 'Banning Rumsey', email: 'banning@x.com', active: true, jobtreadSalesRep: null },
  { id: 5, name: 'Claims', email: 'claims@x.com', active: true, jobtreadSalesRep: null },
];
const options = ['Thomas Bramhill', 'Banning Rumsey', 'James Turner', 'Mac Jacinto', 'Other'];

describe('planRepLinks', () => {
  it('links an unmapped member whose name exactly matches a JobTread option', () => {
    const p = planRepLinks(options, roster);
    expect(p.link).toEqual([{ id: 4, name: 'Banning Rumsey', repName: 'Banning Rumsey' }]);
  });
  it('reports names JobTread has that nobody in the app is, skipping placeholders', () => {
    const p = planRepLinks(options, roster);
    expect(p.unmapped).toEqual(['Mac Jacinto']);
  });
  it('reports app mappings JobTread no longer offers', () => {
    const p = planRepLinks(['Thomas Bramhill', 'Other'], roster);
    expect(p.stale).toEqual([{ id: 1, name: 'James Turner', repName: 'James Turner' }]);
  });
  it('matches case-insensitively but never on a partial or ambiguous name', () => {
    const p = planRepLinks(['banning rumsey', 'Chris'], [
      ...roster,
      { id: 6, name: 'Chris', email: 'c1@x.com', active: true, jobtreadSalesRep: null },
      { id: 7, name: 'Chris', email: 'c2@x.com', active: true, jobtreadSalesRep: null },
    ]);
    expect(p.link.map((l) => l.id)).toEqual([4]);
    expect(p.unmapped).toEqual(['Chris']);
  });
  it('lists every mapped option with its person, including ones linked in this plan', () => {
    const p = planRepLinks(options, roster);
    expect(p.mapped.map((m) => `${m.repName}=${m.id}`).sort()).toEqual(['Banning Rumsey=4', 'James Turner=1', 'Thomas Bramhill=3']);
  });
});
