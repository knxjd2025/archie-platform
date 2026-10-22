import { describe, it, expect } from 'vitest';
import { matchMember, JT_ROLE_TO_APP, APP_ROLE_TO_JT, type JtMembership } from '../jobtread-roles';
import { ALL_ROLES, type TeamRole } from '../../../shared/rbac';

const jm = (over: Partial<JtMembership> = {}): JtMembership => ({
  id: 'jt1', name: 'Banning Rumsey', roleName: 'Sales Partner',
  parentMembershipId: null, isInternal: true, ...over,
});

const MEMBERS = [
  { id: 1, name: 'James Turner', email: 'james@bestroofingnow.com', jobtreadSalesRep: 'James Turner', jobtreadMembershipId: null },
  { id: 3, name: 'Banning Rumsey', email: 'banning@bestroofingnow.com', jobtreadSalesRep: 'Banning Rumsey', jobtreadMembershipId: null },
  { id: 4, name: 'Thomas Bramhill', email: 'thomas@bestroofingnow.com', jobtreadSalesRep: 'Thomas Bramhill', jobtreadMembershipId: null },
];

describe('matchMember', () => {
  it('prefers a previously recorded membership id over any name', () => {
    // Names change; a recorded id is the deliberate link and must win, or a
    // rename would silently re-point one person's roles onto another.
    const linked = [{ ...MEMBERS[0], jobtreadMembershipId: 'jt1' }, ...MEMBERS.slice(1)];
    expect(matchMember(jm({ name: 'Banning Rumsey' }), linked)).toBe(1);
  });

  it('falls back to the Sales Rep mapping', () => {
    expect(matchMember(jm(), MEMBERS)).toBe(3);
  });

  it('matches on name when no rep mapping exists', () => {
    const noRep = MEMBERS.map((m) => ({ ...m, jobtreadSalesRep: null }));
    expect(matchMember(jm({ name: 'Thomas Bramhill' }), noRep)).toBe(4);
  });

  it('ignores case and padding', () => {
    expect(matchMember(jm({ name: '  banning RUMSEY ' }), MEMBERS)).toBe(3);
  });

  it('returns null rather than guessing', () => {
    // Mac Jacinto is a real case: a JobTread admin with no app login. Guessing
    // a match would hand someone else's role to the wrong account.
    expect(matchMember(jm({ name: 'Mac Jacinto' }), MEMBERS)).toBeNull();
    expect(matchMember(jm({ name: '' }), MEMBERS)).toBeNull();
  });
});

describe('role mapping', () => {
  it('maps JobTread staff roles onto app roles', () => {
    expect(JT_ROLE_TO_APP['Admin']).toBe('admin');
    expect(JT_ROLE_TO_APP['Sales Leader']).toBe('manager');
    expect(JT_ROLE_TO_APP['Sales Partner']).toBe('sales');
    expect(JT_ROLE_TO_APP['Production Manager']).toBe('production');
  });

  it('refuses to map external-party roles to a login', () => {
    // These are customers and third parties in JobTread. Mapping any of them
    // would create an app login for someone outside the company.
    for (const r of ['Customer', 'Renter', 'Realtor', 'Spouse', 'Property Manager', 'Sub-Contractor']) {
      expect(JT_ROLE_TO_APP[r], r).toBeUndefined();
    }
  });

  it('maps every app role back to a real JobTread role', () => {
    // A push must never target a role name JobTread does not have.
    const JT_ROLES = new Set([
      'Admin', 'Customer', 'Distribution', 'Sales Partner', 'Estimator', 'Quality Control',
      'Production Manager', 'Supplementor', 'Property Manager', 'Renter', 'Sub-Contractor',
      'Realtor', 'Sales Leader', 'Spouse',
    ]);
    for (const r of ALL_ROLES) {
      expect(APP_ROLE_TO_JT[r], r).toBeTruthy();
      expect(JT_ROLES.has(APP_ROLE_TO_JT[r]), `${r} -> ${APP_ROLE_TO_JT[r]}`).toBe(true);
    }
  });

  it('round-trips the roles that have a true counterpart', () => {
    for (const r of ['admin', 'manager', 'sales', 'production'] as TeamRole[]) {
      expect(JT_ROLE_TO_APP[APP_ROLE_TO_JT[r]], r).toBe(r);
    }
  });

  it('documents the two app roles JobTread cannot express', () => {
    // sales_director and customer_service have no JobTread equivalent. They
    // map to a nearest role so a push never silently no-ops, but they do NOT
    // round-trip — a pull would downgrade them, which is why the caller must
    // treat these as app-owned.
    expect(JT_ROLE_TO_APP[APP_ROLE_TO_JT.sales_director]).toBe('admin');
    expect(JT_ROLE_TO_APP[APP_ROLE_TO_JT.customer_service]).toBe('sales');
  });
});
