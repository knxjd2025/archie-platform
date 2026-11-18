/**
 * Whether a company may use Archie, from its trial and its Stripe
 * subscription. Pure, shared by the server gate (server/billing/gate.ts) and
 * the Billing page, so both say the same thing.
 *
 * A company is billing-locked when
 *   - its subscription is unpaid, canceled or incomplete_expired; or
 *   - its trial has ended (trial_ends_at in the past) and it has no
 *     subscription that is active, trialing or past_due.
 * A company with no trial end recorded (made before trials existed) and no
 * subscription is NOT locked: it is grandfathered, and the operator decides.
 * past_due keeps access; admins see a banner.
 */

/** Stripe subscription statuses that keep a company running. */
export const GOOD_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;
/** Stripe subscription statuses that lock a company until the card is fixed. */
export const LOCKING_SUBSCRIPTION_STATUSES = ['unpaid', 'canceled', 'incomplete_expired'] as const;

export const isGoodSubscription = (status: string | null | undefined): boolean =>
  !!status && (GOOD_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
export const isLockingSubscription = (status: string | null | undefined): boolean =>
  !!status && (LOCKING_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

export type LockReason = 'trial_ended' | 'payment_problem';

export const LOCK_MESSAGE: Record<LockReason, string> = {
  trial_ended: 'Your free trial has ended. Add a card to keep using Archie.',
  payment_problem: 'There is a problem with your payment. Update your card to keep using Archie.',
};
/** What everyone but an admin sees on a locked company. */
export const LOCKED_MEMBER_MESSAGE = "Your company's Archie account needs attention. Ask your admin.";
/** The `code` on a 402 answer, so the app knows to show the Billing page. */
export const BILLING_LOCKED_CODE = 'billing_locked';
/** Days before the trial ends that admins start seeing the reminder. */
export const TRIAL_BANNER_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillingFacts {
  trialEndsAt: Date | string | null;
  subscriptionStatus: string | null;
}

const toDate = (d: Date | string | null): Date | null => {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
};

/** Why the company is locked, or null when it is not. */
export function lockReason(f: BillingFacts, now: Date = new Date()): LockReason | null {
  if (isLockingSubscription(f.subscriptionStatus)) return 'payment_problem';
  if (isGoodSubscription(f.subscriptionStatus)) return null;
  const end = toDate(f.trialEndsAt);
  if (!end || end.getTime() > now.getTime()) return null;
  // Trial over and no working subscription. One that was started but never
  // paid (incomplete) is a payment problem, not a missing card.
  return f.subscriptionStatus === 'incomplete' ? 'payment_problem' : 'trial_ended';
}

/** Whole days left in the trial, rounded up (so at least 1 while it runs), or null when it has ended or has no end. */
export function trialDaysLeft(trialEndsAt: Date | string | null, now: Date = new Date()): number | null {
  const end = toDate(trialEndsAt);
  if (!end) return null;
  const ms = end.getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / DAY_MS) : null;
}

export type BannerKind = 'trial_ending' | 'past_due';
export interface Banner { kind: BannerKind; text: string; action: string }

/**
 * The reminder admins see at the top of the app, or null. From 5 days before
 * the trial ends (when they have not added a card yet), and while a payment
 * is past due.
 */
export function adminBanner(f: BillingFacts, now: Date = new Date()): Banner | null {
  if (f.subscriptionStatus === 'past_due') {
    return { kind: 'past_due', text: 'There is a problem with your payment. Update your card to keep using Archie.', action: 'Update card' };
  }
  if (isGoodSubscription(f.subscriptionStatus)) return null;
  const days = trialDaysLeft(f.trialEndsAt, now);
  if (days === null || days > TRIAL_BANNER_DAYS) return null;
  return { kind: 'trial_ending', text: `Your free trial ends in ${days} ${days === 1 ? 'day' : 'days'}.`, action: 'Add a card' };
}
