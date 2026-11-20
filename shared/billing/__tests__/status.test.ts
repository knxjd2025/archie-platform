import { describe, it, expect } from 'vitest';
import { MANAGED_IN_ROOF_LEE_MESSAGE, adminBanner, billedByRoofLee, lockReason, trialDaysLeft } from '../status';

const now = new Date('2026-11-18T12:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe('billing lock', () => {
  it('locks a company whose trial ended with no working subscription', () => {
    expect(lockReason({ trialEndsAt: days(-1), subscriptionStatus: null }, now)).toBe('trial_ended');
    expect(lockReason({ trialEndsAt: days(-1), subscriptionStatus: 'incomplete' }, now)).toBe('payment_problem');
  });

  it('does not lock inside the trial, or with an active, trialing or past due subscription', () => {
    expect(lockReason({ trialEndsAt: days(3), subscriptionStatus: null }, now)).toBeNull();
    for (const s of ['active', 'trialing', 'past_due']) {
      expect(lockReason({ trialEndsAt: days(-30), subscriptionStatus: s }, now)).toBeNull();
    }
  });

  it('locks unpaid, canceled and incomplete_expired subscriptions, trial or not', () => {
    for (const s of ['unpaid', 'canceled', 'incomplete_expired']) {
      expect(lockReason({ trialEndsAt: null, subscriptionStatus: s }, now)).toBe('payment_problem');
      expect(lockReason({ trialEndsAt: days(10), subscriptionStatus: s }, now)).toBe('payment_problem');
    }
  });

  it('grandfathers a company with no trial end and no subscription', () => {
    expect(lockReason({ trialEndsAt: null, subscriptionStatus: null }, now)).toBeNull();
  });
});

describe('admin banner', () => {
  it('starts 5 days before the trial ends', () => {
    expect(adminBanner({ trialEndsAt: days(6), subscriptionStatus: null }, now)).toBeNull();
    expect(adminBanner({ trialEndsAt: days(5), subscriptionStatus: null }, now)?.text).toBe('Your free trial ends in 5 days.');
    expect(adminBanner({ trialEndsAt: days(0.5), subscriptionStatus: null }, now)?.text).toBe('Your free trial ends in 1 day.');
    expect(adminBanner({ trialEndsAt: days(2), subscriptionStatus: null }, now)?.action).toBe('Add a card');
  });

  it('says nothing once a card is on file, and warns while a payment is past due', () => {
    expect(adminBanner({ trialEndsAt: days(2), subscriptionStatus: 'trialing' }, now)).toBeNull();
    expect(adminBanner({ trialEndsAt: null, subscriptionStatus: 'past_due' }, now)?.kind).toBe('past_due');
  });

  it('counts days left', () => {
    expect(trialDaysLeft(days(-1), now)).toBeNull();
    expect(trialDaysLeft(null, now)).toBeNull();
    expect(trialDaysLeft(days(13.2), now)).toBe(14);
  });
});

describe('who bills a company', () => {
  it('is Roof Lee for a company Roof Lee made, and Archie for every other', () => {
    expect(billedByRoofLee({ roofliCompanyId: '0b8f6a52-5a0e-4b7e-9d0a-1c2d3e4f5a6b' })).toBe(true);
    expect(billedByRoofLee({ roofliCompanyId: null })).toBe(false);
    expect(billedByRoofLee({})).toBe(false);
    expect(billedByRoofLee(null)).toBe(false);
  });

  it('says so in one plain sentence', () => {
    expect(MANAGED_IN_ROOF_LEE_MESSAGE).toBe('Your plan is managed in Roof Lee.');
  });
});
