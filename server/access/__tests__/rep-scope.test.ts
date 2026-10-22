import { describe, it, expect } from 'vitest';
import { ownerOf, isScoped, type JobOwnershipInput } from '../rep-scope';

const THOMAS = 10;
const BANNING = 11;
const repNameToId = new Map<string, number>([
  ['Thomas Bramhill', THOMAS],
  ['Banning Rumsey', BANNING],
]);

describe('ownerOf', () => {
  it('attributes by JobTread Sales Rep name when there is no override', () => {
    const job: JobOwnershipInput = { externalId: 'j1', jtSalesRep: 'Thomas Bramhill' };
    expect(ownerOf(job, new Map(), repNameToId)).toBe(THOMAS);
  });

  it('override wins over the JobTread field', () => {
    const job: JobOwnershipInput = { externalId: 'j2', jtSalesRep: 'Thomas Bramhill' };
    const overrides = new Map<string, number>([['j2', BANNING]]);
    expect(ownerOf(job, overrides, repNameToId)).toBe(BANNING);
  });

  it('a blank Sales Rep with no override belongs to nobody', () => {
    expect(ownerOf({ externalId: 'j3', jtSalesRep: null }, new Map(), repNameToId)).toBeNull();
  });

  it('an unknown Sales Rep name (not a mapped rep) belongs to nobody', () => {
    expect(ownerOf({ externalId: 'j4', jtSalesRep: 'Mac Jacinto' }, new Map(), repNameToId)).toBeNull();
  });

  it('override to a different rep removes a name-matched job from the original rep', () => {
    // Thomas's job by name, but overridden to Banning → Thomas no longer owns it.
    const job: JobOwnershipInput = { externalId: 'j5', jtSalesRep: 'Thomas Bramhill' };
    const overrides = new Map<string, number>([['j5', BANNING]]);
    const owner = ownerOf(job, overrides, repNameToId);
    expect(owner).toBe(BANNING);
    expect(owner).not.toBe(THOMAS);
  });

  it('invariant: never attributes one rep\'s job to another', () => {
    const jobs: JobOwnershipInput[] = [
      { externalId: 'a', jtSalesRep: 'Thomas Bramhill' },
      { externalId: 'b', jtSalesRep: 'Banning Rumsey' },
    ];
    const owners = jobs.map((j) => ownerOf(j, new Map(), repNameToId));
    expect(owners).toEqual([THOMAS, BANNING]);
  });
});

describe('isScoped', () => {
  it('scopes every role that does not see the whole company', () => {
    const u = (role: any) => ({ email: 'x', name: 'x', role });
    // Own book only.
    expect(isScoped(u('sales'))).toBe(true);
    // Was NOT scoped, which let a production user read every lead in the
    // company — they see only their own records now.
    expect(isScoped(u('production'))).toBe(true);
    // A sales leader is scoped to their TEAM, so their queries must still be
    // filtered; previously they were treated as unrestricted like an admin.
    expect(isScoped(u('manager'))).toBe(true);
  });

  it('does not scope the roles that legitimately see everything', () => {
    const u = (role: any) => ({ email: 'x', name: 'x', role });
    expect(isScoped(u('admin'))).toBe(false);
    expect(isScoped(u('sales_director'))).toBe(false);
    // Customer service helps whoever calls, so it sees every customer — money
    // is withheld by capability rank instead (canSeeMoney).
    expect(isScoped(u('customer_service'))).toBe(false);
  });

  it('fails closed when there is no user', () => {
    // Previously false — i.e. a missing session was treated as UNRESTRICTED,
    // the most dangerous possible default.
    expect(isScoped(undefined)).toBe(true);
  });
});
