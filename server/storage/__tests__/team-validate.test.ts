import { describe, it, expect } from 'vitest';
import { validateTeamMemberInput } from '../team-validate';

describe('validateTeamMemberInput', () => {
  it('accepts a valid member', () => {
    const r = validateTeamMemberInput({ name: 'Banning', email: 'banning@bestroofingnow.com', role: 'sales' });
    expect(r.ok).toBe(true);
  });
  it('rejects missing name', () => {
    const r = validateTeamMemberInput({ email: 'x@y.com', role: 'sales' });
    expect(r.ok).toBe(false);
  });
  it('rejects a bad role', () => {
    const r = validateTeamMemberInput({ name: 'X', email: 'x@y.com', role: 'ceo' });
    expect(r.ok).toBe(false);
  });
  it('rejects a malformed email', () => {
    const r = validateTeamMemberInput({ name: 'X', email: 'not-an-email', role: 'sales' });
    expect(r.ok).toBe(false);
  });
  it('normalizes email to lowercase', () => {
    const r = validateTeamMemberInput({ name: 'X', email: 'X@Y.com', role: 'admin' });
    expect(r.ok && r.value.email).toBe('x@y.com');
  });
});

import { validateTeamMemberPatch } from '../team-validate';

describe('validateTeamMemberPatch', () => {
  it('accepts every app role, not just the original four', () => {
    for (const role of ['sales_director', 'customer_service']) {
      const r = validateTeamMemberPatch({ role });
      expect(r.ok, role).toBe(true);
    }
  });
  it('accepts active, a JobTread Sales Rep mapping, and a reporting line', () => {
    const r = validateTeamMemberPatch({ active: false, jobtreadSalesRep: '  Mac Jacinto ', reportsTo: 1 });
    expect(r.ok && r.value).toEqual({ active: false, jobtreadSalesRep: 'Mac Jacinto', reportsTo: 1 });
  });
  it('lets a mapping or reporting line be cleared with null', () => {
    const r = validateTeamMemberPatch({ jobtreadSalesRep: null, reportsTo: null });
    expect(r.ok && r.value).toEqual({ jobtreadSalesRep: null, reportsTo: null });
  });
  it('rejects a non-boolean active, a non-string mapping, and a bad reportsTo', () => {
    expect(validateTeamMemberPatch({ active: 'yes' }).ok).toBe(false);
    expect(validateTeamMemberPatch({ jobtreadSalesRep: 5 }).ok).toBe(false);
    expect(validateTeamMemberPatch({ reportsTo: 'james' }).ok).toBe(false);
    expect(validateTeamMemberPatch({ reportsTo: 0 }).ok).toBe(false);
  });
  it('never copies fields outside the whitelist', () => {
    const r = validateTeamMemberPatch({ googleSub: 'x', createdBy: 'y', jobtreadMembershipId: 'z', name: 'A' });
    expect(r.ok && r.value).toEqual({ name: 'A' });
  });
});

describe('validateTeamMemberInput with a JobTread mapping', () => {
  it('stores the trimmed mapping when given', () => {
    const r = validateTeamMemberInput({ name: 'Mac Jacinto', email: 'mac@x.com', role: 'sales', jobtreadSalesRep: 'Mac Jacinto ' });
    expect(r.ok && r.value.jobtreadSalesRep).toBe('Mac Jacinto');
  });
  it('leaves it undefined when not given', () => {
    const r = validateTeamMemberInput({ name: 'X', email: 'x@y.com', role: 'sales' });
    expect(r.ok && 'jobtreadSalesRep' in r.value).toBe(false);
  });
});

describe('blocked addresses', () => {
  it('cannot be added to or set on the roster', async () => {
    const { validateTeamMemberInput, validateTeamMemberPatch } = await import('../team-validate');
    const r = validateTeamMemberInput({ name: 'Fred', email: 'Fred@BestRoofingNow.com', role: 'sales' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not allowed on the team/);
    const p = validateTeamMemberPatch({ email: 'fred@bestroofingnow.com' });
    expect(p.ok).toBe(false);
  });
});
