import { describe, it, expect } from 'vitest';
import { dueFlags, foldKpis } from '../sales-tools';

describe('dueFlags', () => {
  it('flags overdue and due-today by date-only comparison', () => {
    expect(dueFlags('2026-09-13', '2026-09-14')).toEqual({ overdue: true, dueToday: false });
    expect(dueFlags('2026-09-14', '2026-09-14')).toEqual({ overdue: false, dueToday: true });
    expect(dueFlags('2026-09-15', '2026-09-14')).toEqual({ overdue: false, dueToday: false });
    expect(dueFlags(null, '2026-09-14')).toEqual({ overdue: false, dueToday: false });
  });
});

describe('foldKpis', () => {
  it('folds per-type counts into one row per rep, named from the roster', () => {
    const rows = foldKpis([
      { teamMemberId: 2, repName: null, type: 'door_knock', count: 12 },
      { teamMemberId: 2, repName: null, type: 'report_presented', count: 3 },
      { teamMemberId: null, repName: 'Old Rep', type: 'lead_contacted', count: 1 },
    ], new Map([[2, 'Banning Rumsey']]));
    expect(rows).toEqual([
      { rep: 'Banning Rumsey', doorKnocks: 12, leadsContacted: 0, reportsCreated: 0, reportsPresented: 3, referralsReceived: 0, leadsGiven: 0 },
      { rep: 'Old Rep', doorKnocks: 0, leadsContacted: 1, reportsCreated: 0, reportsPresented: 0, referralsReceived: 0, leadsGiven: 0 },
    ]);
  });
});
