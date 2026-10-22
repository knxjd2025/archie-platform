import { describe, it, expect } from 'vitest';
import { canSeeMoney, isNarrowed, dataScope, ALL_ROLES, type TeamRole } from '../rbac';

/**
 * Who may open Payouts, and whether their query must be filtered.
 *
 * The page stopped being admin-only so a rep can see what they are owed. These
 * pin the two halves of that: the gate on the page, and the flag that decides
 * whether the server scopes the rows. A change to either silently hands one
 * person another person's pay.
 */
describe('who can see payouts', () => {
  it('lets a rep in, and scopes them to themselves', () => {
    expect(canSeeMoney('sales', 'commissions')).toBe(true);
    expect(isNarrowed('sales')).toBe(true);
    expect(dataScope('sales')).toBe('self');
  });

  it('keeps money away from customer service, who outrank sales', () => {
    // The one case rank alone gets wrong: customer_service sees every customer
    // but must never see money. If this flips, the denylist has been lost.
    expect(dataScope('customer_service')).toBe('all');
    expect(canSeeMoney('customer_service', 'commissions')).toBe(false);
  });

  it('keeps production out entirely', () => {
    expect(canSeeMoney('production', 'commissions')).toBe(false);
  });

  it('gives admin and the sales director the whole company unfiltered', () => {
    for (const role of ['admin', 'sales_director'] as TeamRole[]) {
      expect(canSeeMoney(role, 'commissions'), role).toBe(true);
      expect(isNarrowed(role), role).toBe(false);
    }
  });

  it('scopes a manager rather than opening the company to them', () => {
    // A manager's scope is 'team', but the payout filter matches on the viewer
    // themselves — so today a manager sees their own and no one else's. That is
    // narrower than their scope implies and deliberately the safe direction;
    // widening it to their reps is a decision, not an accident.
    expect(canSeeMoney('manager', 'commissions')).toBe(true);
    expect(isNarrowed('manager')).toBe(true);
    expect(dataScope('manager')).toBe('team');
  });

  it('never leaves a role unscoped unless it is meant to see everything', () => {
    for (const role of ALL_ROLES) {
      if (!canSeeMoney(role, 'commissions')) continue;
      if (isNarrowed(role)) continue;
      expect(['admin', 'sales_director'], `${role} would see every payout unfiltered`).toContain(role);
    }
  });
});
