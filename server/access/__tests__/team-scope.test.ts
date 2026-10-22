import { describe, it, expect } from 'vitest';
import { visibleMemberIds, canSeeMember, type Member } from '../team-scope';
import { dataScope, atLeast, canSeeMoney, ROLE_LABEL, ALL_ROLES, type TeamRole } from '../../../shared/rbac';

const m = (id: number, role: TeamRole, reportsTo: number | null = null): Member =>
  ({ id, email: `u${id}@bestroofingnow.com`, role, reportsTo, active: true });

// James is admin AND acting sales leader; Banning and Thomas report to him.
const JAMES = m(1, 'admin');
const LEADER = m(2, 'manager');
const BANNING = m(3, 'sales', 2);
const THOMAS = m(4, 'sales', 2);
const OTHER_LEADER = m(5, 'manager');
const OTHER_REP = m(6, 'sales', 5);
const CS = m(7, 'customer_service');
const DIRECTOR = m(8, 'sales_director');
const ROSTER = [JAMES, LEADER, BANNING, THOMAS, OTHER_LEADER, OTHER_REP, CS, DIRECTOR];

describe('visibleMemberIds', () => {
  it('gives admin and director everyone', () => {
    // null means unrestricted — NOT an empty list. A caller that treats [] as
    // "everyone" leaks; one that treats null as "nobody" shows a blank screen.
    expect(visibleMemberIds(JAMES, ROSTER)).toBeNull();
    expect(visibleMemberIds(DIRECTOR, ROSTER)).toBeNull();
  });

  it('gives a sales leader themselves plus their direct reports', () => {
    expect(visibleMemberIds(LEADER, ROSTER)).toEqual([2, 3, 4]);
  });

  it("does not give a leader another leader's reps", () => {
    // The whole point of the reporting line: rank alone cannot tell these two
    // leaders apart, and both are 'manager'.
    const ids = visibleMemberIds(LEADER, ROSTER)!;
    expect(ids).not.toContain(OTHER_REP.id);
    expect(ids).not.toContain(OTHER_LEADER.id);
    expect(visibleMemberIds(OTHER_LEADER, ROSTER)).toEqual([5, 6]);
  });

  it('gives a rep only themselves', () => {
    expect(visibleMemberIds(BANNING, ROSTER)).toEqual([3]);
    expect(visibleMemberIds(THOMAS, ROSTER)).toEqual([4]);
  });

  it('does not let one rep see their teammate under the same leader', () => {
    expect(visibleMemberIds(BANNING, ROSTER)).not.toContain(THOMAS.id);
  });

  it('gives customer service everyone (money is blocked by rank, not scope)', () => {
    expect(visibleMemberIds(CS, ROSTER)).toBeNull();
  });

  it('gives production only themselves', () => {
    expect(visibleMemberIds(m(9, 'production'), ROSTER)).toEqual([9]);
  });

  it('shows an unknown user nothing rather than everything', () => {
    // Fail closed: null here would hand a signed-out or deleted user the
    // whole company.
    expect(visibleMemberIds(null, ROSTER)).toEqual([]);
  });

  it('handles a leader with no reports yet', () => {
    expect(visibleMemberIds(m(10, 'manager'), ROSTER)).toEqual([10]);
  });

  it('ignores a stale reports_to pointing at a deleted leader', () => {
    const orphan = m(11, 'sales', 999);
    expect(visibleMemberIds(orphan, [...ROSTER, orphan])).toEqual([11]);
  });

  it('does not walk the chain transitively', () => {
    // A leader reporting to another leader does NOT hand the upper one the
    // lower one's reps — that is the sales_director role, which scopes to all.
    const sub = m(12, 'manager', 2);
    const subRep = m(13, 'sales', 12);
    expect(visibleMemberIds(LEADER, [...ROSTER, sub, subRep])).toEqual([2, 3, 4, 12]);
  });

  it('cannot be cycled into infinite recursion', () => {
    const a = m(20, 'manager', 21);
    const b = m(21, 'manager', 20);
    expect(visibleMemberIds(a, [a, b])).toEqual([20, 21]);
  });
});

describe('canSeeMember', () => {
  it('lets a leader open their own rep and refuses another team', () => {
    expect(canSeeMember(LEADER, BANNING.id, ROSTER)).toBe(true);
    expect(canSeeMember(LEADER, OTHER_REP.id, ROSTER)).toBe(false);
  });

  it('lets admin open anyone', () => {
    expect(canSeeMember(JAMES, OTHER_REP.id, ROSTER)).toBe(true);
  });

  it('refuses a rep opening a teammate', () => {
    expect(canSeeMember(BANNING, THOMAS.id, ROSTER)).toBe(false);
    expect(canSeeMember(BANNING, BANNING.id, ROSTER)).toBe(true);
  });
});

describe('role model invariants', () => {
  it('labels manager as Sales Leader for humans', () => {
    // The stored value stays 'manager' (load-bearing in the enum and in every
    // atLeast('manager') call); only the label changes.
    expect(ROLE_LABEL.manager).toBe('Sales Leader');
    expect(ROLE_LABEL.sales).toBe('Sales Rep');
  });

  it('ranks the org chart top-down', () => {
    expect(atLeast('admin', 'sales_director')).toBe(true);
    expect(atLeast('sales_director', 'manager')).toBe(true);
    expect(atLeast('manager', 'sales')).toBe(true);
    expect(atLeast('sales', 'manager')).toBe(false);
    expect(atLeast('customer_service', 'sales')).toBe(true);
  });

  it('keeps customer service away from money despite outranking sales', () => {
    // The one place rank alone gives the wrong answer: customer_service sits
    // above sales so it can reach customer screens, but must never see AR,
    // payables, payroll or commissions.
    for (const s of ['ar', 'ap', 'payroll', 'commissions'] as const) {
      expect(canSeeMoney('customer_service', s), s).toBe(false);
    }
    expect(canSeeMoney('manager', 'ar')).toBe(true);
    expect(canSeeMoney('admin', 'ap')).toBe(true);
  });

  it('every role has a rank, label and scope', () => {
    for (const r of ALL_ROLES) {
      expect(ROLE_LABEL[r], r).toBeTruthy();
      expect(['self', 'team', 'all'], r).toContain(dataScope(r));
    }
  });

  it('only sales_director and above see the whole company', () => {
    expect(dataScope('admin')).toBe('all');
    expect(dataScope('sales_director')).toBe('all');
    expect(dataScope('manager')).toBe('team');
    expect(dataScope('sales')).toBe('self');
    expect(dataScope('production')).toBe('self');
  });
});
