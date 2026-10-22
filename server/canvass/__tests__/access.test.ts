import { describe, it, expect, vi } from 'vitest';

// The DB-backed half of access.ts is not exercised here; stub the pool so the
// module can load without a DATABASE_URL.
vi.mock('../../db', () => ({ db: {} }));

import { canvassOwner, canSeeOwner, resolveVisibleOwners, canReassign } from '../access';
import type { SessionUser } from '../../access/rep-scope';

const rep = (email: string, role: SessionUser['role'] = 'sales'): SessionUser => ({ email, name: email, role });

describe('who owns a canvassed house', () => {
  it('is whoever tagged it, unless a leader moved it', () => {
    expect(canvassOwner('Dana@BRN.com', null)).toBe('dana@brn.com');
    expect(canvassOwner('dana@brn.com', 'Sam@brn.com')).toBe('sam@brn.com');
  });
  it('is nobody when neither is set', () => {
    expect(canvassOwner(null, null)).toBeNull();
    expect(canvassOwner('  ', undefined)).toBeNull();
  });
});

describe('who can see it', () => {
  it('an unrestricted scope sees every house, even an unowned one', () => {
    expect(canSeeOwner(null, 'dana@brn.com')).toBe(true);
    expect(canSeeOwner(null, null)).toBe(true);
  });
  it('a rep sees their own houses and not another rep\'s', () => {
    const visible = resolveVisibleOwners(rep('dana@brn.com'), ['dana@brn.com']);
    expect(canSeeOwner(visible, 'dana@brn.com')).toBe(true);
    expect(canSeeOwner(visible, 'sam@brn.com')).toBe(false);
  });
  it('a house with no owner is hidden from a rep, never shown to everyone', () => {
    expect(canSeeOwner(['dana@brn.com'], null)).toBe(false);
  });
  it('an empty scope sees nothing', () => {
    expect(canSeeOwner([], 'dana@brn.com')).toBe(false);
  });
});

describe('the visible set for a session', () => {
  it('admins and directors see everything', () => {
    expect(resolveVisibleOwners(rep('boss@brn.com', 'admin'), ['boss@brn.com'])).toBeNull();
    expect(resolveVisibleOwners(rep('dir@brn.com', 'sales_director'), [])).toBeNull();
  });
  it('a rep with no team_members row still sees what they pinned', () => {
    expect(resolveVisibleOwners(rep('Dana@BRN.com'), [])).toEqual(['dana@brn.com']);
  });
  it('a leader sees their reps and themselves', () => {
    const visible = resolveVisibleOwners(rep('lead@brn.com', 'manager'), ['lead@brn.com', 'Dana@brn.com']);
    expect(visible).toEqual(['lead@brn.com', 'dana@brn.com']);
  });
});

describe('moving a house to another rep', () => {
  it('a rep cannot, even to themselves', () => {
    expect(canReassign(rep('dana@brn.com'), ['dana@brn.com'], 'dana@brn.com')).toBe(false);
  });
  it('a leader can, but only to someone on their team', () => {
    const lead = rep('lead@brn.com', 'manager');
    expect(canReassign(lead, ['lead@brn.com', 'dana@brn.com'], 'Dana@brn.com')).toBe(true);
    expect(canReassign(lead, ['lead@brn.com', 'dana@brn.com'], 'sam@brn.com')).toBe(false);
  });
  it('an admin can, to anyone', () => {
    expect(canReassign(rep('boss@brn.com', 'admin'), null, 'sam@brn.com')).toBe(true);
  });
});
