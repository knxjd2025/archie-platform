import { describe, it, expect, vi } from 'vitest';
// Pure helpers only; no database is needed.
vi.mock('../../db', () => ({ db: {} }));
import { addEventCounts, sinceFor, type RepKpis } from '../routes';

const blank = (id: number, name: string): RepKpis => ({
  teamMemberId: id, name, doorKnocks: 0, leadsContacted: 0, reportsCreated: 0, reportsPresented: 0,
  referralsReceived: 0, leadsGiven: 0, leadsEntered: 0,
});

describe('folding event counts into rows', () => {
  it('adds every row for the same person and type, rather than keeping the last', () => {
    // The query groups by member AND the rep name on the event, so one person
    // with two spellings of their name comes back as two door_knock rows.
    const byMember = new Map<number | string, RepKpis>([[7, blank(7, 'Dana')]]);
    addEventCounts(byMember, [
      { teamMemberId: 7, repName: 'Dana', type: 'door_knock', count: 12 },
      { teamMemberId: 7, repName: 'Dana Smith', type: 'door_knock', count: 5 },
      { teamMemberId: 7, repName: null, type: 'report_created', count: 2 },
    ]);
    expect(byMember.get(7)).toMatchObject({ doorKnocks: 17, reportsCreated: 2 });
  });

  it('puts events with no member under the name they carry, and ignores unknown types', () => {
    const byMember = new Map<number | string, RepKpis>();
    addEventCounts(byMember, [
      { teamMemberId: null, repName: 'Old Rep', type: 'door_knock', count: 3 },
      { teamMemberId: null, repName: 'Old Rep', type: 'door_knock', count: 4 },
      { teamMemberId: null, repName: 'Old Rep', type: 'not_a_metric', count: 99 },
    ]);
    expect(byMember.get('unattributed:Old Rep')).toMatchObject({ name: 'Old Rep', doorKnocks: 7 });
  });

  it('copes with counts that arrive as strings from the driver', () => {
    const byMember = new Map<number | string, RepKpis>();
    addEventCounts(byMember, [{ teamMemberId: 1, repName: 'A', type: 'lead_given', count: '4' as unknown as number }]);
    expect(byMember.get(1)?.leadsGiven).toBe(4);
  });
});

describe('where each tab starts', () => {
  // Thursday 15 Oct 2026, 8:30pm EDT — already Friday in UTC.
  const evening = new Date('2026-10-16T00:30:00Z');
  it('"Today" is Charlotte\'s day, not the server\'s', () => {
    expect(sinceFor('today', evening).toISOString()).toBe('2026-10-15T04:00:00.000Z');
  });
  it('"This week" starts Monday, the same week the playbook tracker uses', () => {
    expect(sinceFor('week', evening).toISOString()).toBe('2026-10-12T04:00:00.000Z');
  });
  it('"This month" starts on the 1st', () => {
    expect(sinceFor('month', evening).toISOString()).toBe('2026-10-01T04:00:00.000Z');
  });
});
