/**
 * Billing: one Stripe customer and one subscription per company, with the
 * subscription's items kept in line with shared/billing/pricing.ts.
 *
 * Data: company_billing (a company table, migrations/0012), always read and
 * written as the company itself (runAsCompany), so row level security keeps
 * every other company's billing out of reach. Only two things are system
 * work, each with its own reason: the webhook's event-id ledger
 * (stripe_events, global) and moving a company from 'trial' to 'active'
 * (a company cannot change its own companies row, migrations/0008).
 *
 * Which company a Stripe object belongs to comes ONLY from the
 * `archie_company_id` metadata Archie set on the customer and the
 * subscription when it created them, read back from Stripe's API, and the
 * two must agree. Nothing else in a webhook payload (client_reference_id,
 * emails, the event's own copy of metadata) is ever used to pick a company.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { companies, companyBilling, stripeEvents, teamMembers, type Company, type CompanyBilling } from '../../shared/schema';
import { isCompanyId, runAsCompany, runAsSystem } from '../tenant/context';
import { quoteForSeats, seatsFromQuantities, type PriceKey, type Quote } from '../../shared/billing/pricing';
import { adminBanner, isGoodSubscription, lockReason, type Banner, type LockReason } from '../../shared/billing/status';
import { appBaseUrl, billingEnabled, priceIds, priceKeyOf } from './config';
import { customerIdOf, periodEndOf, stripe, type ItemChange, type StripeSubscription } from './stripe';

export const COMPANY_METADATA_KEY = 'archie_company_id';
/** Checkout can only start a trial that ends at least 48 hours from now (Stripe's rule); an hour of margin. */
const MIN_CHECKOUT_TRIAL_MS = 49 * 60 * 60 * 1000;
/** Subscription statuses Stripe will not let us change. */
const FINISHED_STATUSES = ['canceled', 'incomplete_expired'];

// ============================================================
// Reading
// ============================================================

/** Team members who can sign in: the billable seats. As the current company. */
export async function countSeats(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(teamMembers)
    .where(and(eq(teamMembers.active, true), eq(teamMembers.canLogin, true)));
  return Number(row?.n) || 0;
}

/** The current company's billing row, or null. */
export async function getBillingRow(): Promise<CompanyBilling | null> {
  const [row] = await db.select().from(companyBilling);
  return row ?? null;
}

/** Create or change the company's billing row. As the company. */
async function saveBilling(companyId: string, set: Partial<typeof companyBilling.$inferInsert>): Promise<void> {
  await runAsCompany(companyId, () => db.insert(companyBilling)
    .values({ ...set, companyId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: companyBilling.companyId, set: { ...set, updatedAt: new Date() } }), { loadProfile: false });
}

export interface BillingState {
  enabled: boolean;
  locked: boolean;
  reason: LockReason | null;
  banner: Banner | null;
}

/**
 * Whether the current company is locked, and the banner its admins see.
 * Reads the company and its billing row as the current company.
 */
export async function currentBillingState(now = new Date()): Promise<BillingState & { company: Company | null; billing: CompanyBilling | null }> {
  if (!billingEnabled()) return { enabled: false, locked: false, reason: null, banner: null, company: null, billing: null };
  const [company] = await db.select().from(companies);
  const billing = await getBillingRow();
  if (!company) return { enabled: true, locked: false, reason: null, banner: null, company: null, billing };
  const facts = { trialEndsAt: company.trialEndsAt, subscriptionStatus: billing?.subscriptionStatus ?? null };
  const reason = lockReason(facts, now);
  return { enabled: true, locked: reason !== null, reason, banner: reason ? null : adminBanner(facts, now), company, billing };
}

// ============================================================
// Seat sync: Stripe's items follow the team
// ============================================================

/** What the subscription's items should be for this quote, as price id -> quantity. */
export function desiredItems(quote: Quote): Map<string, number> {
  const ids = priceIds();
  return new Map(quote.lineItems.map((l) => [ids[l.key], l.quantity]));
}

/**
 * The item changes that turn `current` into `desired`, or [] when they match.
 * Items on prices Archie does not know (something added by hand at Stripe)
 * are left alone.
 */
export function itemChanges(sub: StripeSubscription, desired: Map<string, number>): ItemChange[] {
  const changes: ItemChange[] = [];
  const seen = new Set<string>();
  for (const item of sub.items?.data ?? []) {
    const price = item.price?.id;
    if (!price || !priceKeyOf(price)) continue;
    seen.add(price);
    const want = desired.get(price) ?? 0;
    if (want <= 0) changes.push({ id: item.id, deleted: true });
    else if ((item.quantity ?? 1) !== want) changes.push({ id: item.id, quantity: want });
  }
  for (const [price, qty] of desired) {
    if (!seen.has(price) && qty > 0) changes.push({ price, quantity: qty });
  }
  return changes;
}

/** Plan and seats Stripe bills for now, from the subscription's items. */
export function billedSeats(sub: StripeSubscription): { plan: 'solo' | 'team'; seats: number } | null {
  const q: Partial<Record<PriceKey, number>> = {};
  for (const item of sub.items?.data ?? []) {
    const key = item.price?.id ? priceKeyOf(item.price.id) : null;
    if (key) q[key] = (q[key] ?? 0) + (item.quantity ?? 1);
  }
  return seatsFromQuantities(q);
}

/** The same change asked twice gets the same key, so Stripe applies it once. */
function seatIdempotencyKey(sub: StripeSubscription, changes: ItemChange[]): string {
  const state = JSON.stringify({
    current: (sub.items?.data ?? []).map((i) => [i.id, i.price?.id, i.quantity ?? 1]).sort(),
    changes,
  });
  return `archie-seats-${sub.id}-${createHash('sha256').update(state).digest('hex').slice(0, 32)}`;
}

export type SeatSyncStatus = 'off' | 'no_subscription' | 'finished' | 'in_sync' | 'updated' | 'failed';
export interface SeatSyncResult { status: SeatSyncStatus; seats?: number; error?: string }

/**
 * Make the company's subscription bill for the seats it has now, with
 * proration. Compares first and does nothing when Stripe already matches.
 * Never throws: a failure is recorded on company_billing (seat_sync_error)
 * and returned, and the hourly job (/api/cron/billing-seats) retries it.
 */
export async function syncSeats(companyId: string, why: string): Promise<SeatSyncResult> {
  if (!billingEnabled()) return { status: 'off' };
  const billing = await runAsCompany(companyId, getBillingRow, { loadProfile: false });
  if (!billing?.stripeSubscriptionId) return { status: 'no_subscription' };
  const subId = billing.stripeSubscriptionId;
  try {
    let result: SeatSyncResult = { status: 'in_sync' };
    // Twice at most: if the team changed again while Stripe was being
    // updated, the second pass catches it.
    for (let pass = 0; pass < 2; pass++) {
      const seats = await runAsCompany(companyId, countSeats, { loadProfile: false });
      const quote = quoteForSeats(seats);
      const sub = await stripe().retrieveSubscription(subId);
      if (FINISHED_STATUSES.includes(sub.status)) {
        await saveBilling(companyId, { subscriptionStatus: sub.status, seatSyncError: null, seatSyncFailedAt: null });
        return { status: 'finished' };
      }
      const changes = itemChanges(sub, desiredItems(quote));
      if (!changes.length) {
        if (pass === 0) result = { status: 'in_sync', seats: quote.seats };
        await saveBilling(companyId, { plan: quote.plan, seats: quote.seats, seatSyncError: null, seatSyncFailedAt: null });
        break;
      }
      const updated = await stripe().updateSubscriptionItems(sub.id, changes, seatIdempotencyKey(sub, changes));
      const billed = billedSeats(updated);
      await saveBilling(companyId, {
        plan: billed?.plan ?? quote.plan, seats: billed?.seats ?? quote.seats,
        subscriptionStatus: updated.status, seatSyncError: null, seatSyncFailedAt: null,
      });
      console.log(`[billing] ${companyId}: seats set to ${quote.seats} (${quote.plan}) after ${why}`);
      result = { status: 'updated', seats: quote.seats };
    }
    return result;
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error(`[billing] seat sync failed for ${companyId} after ${why}: ${error}`);
    await saveBilling(companyId, { seatSyncError: error, seatSyncFailedAt: new Date() }).catch(() => {});
    return { status: 'failed', error };
  }
}

/**
 * After a change to who can sign in has been saved: update Stripe, without
 * ever failing the change. Waits at most a few seconds; anything left over
 * (or failed) is fixed by the hourly job.
 */
export async function afterSeatChange(companyId: string, why: string): Promise<void> {
  if (!billingEnabled()) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    syncSeats(companyId, why),
    new Promise((resolve) => { timer = setTimeout(resolve, 8_000); }),
  ]).catch((err) => console.error(`[billing] seat sync after ${why} failed`, err)).finally(() => clearTimeout(timer));
}

/** Companies with a subscription, for the hourly seat check. System work: it lists across companies. */
export function companiesWithSubscription(): Promise<string[]> {
  return runAsSystem('billing: list companies with a subscription for the seat check', async () => {
    const rows = await db.select({ id: companyBilling.companyId }).from(companyBilling)
      .where(sql`${companyBilling.stripeSubscriptionId} is not null`);
    return rows.map((r) => r.id);
  });
}

// ============================================================
// Checkout and the billing portal
// ============================================================

export class BillingError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** The company's Stripe customer id, creating the customer (tagged with the company) the first time. As the company. */
async function ensureCustomer(company: Company, billing: CompanyBilling | null, email: string): Promise<string> {
  if (billing?.stripeCustomerId) return billing.stripeCustomerId;
  const customer = await stripe().createCustomer(
    { name: company.name, email, metadata: { [COMPANY_METADATA_KEY]: company.id } },
    // Two admins clicking at once make one customer, not two.
    `archie-customer-${company.id}`,
  );
  await saveBilling(company.id, { stripeCustomerId: customer.id });
  return customer.id;
}

const returnUrl = (result: string): string => {
  const base = appBaseUrl();
  if (!base) throw new BillingError('APP_BASE_URL is not set, so Stripe has nowhere to send people back to.', 500);
  return `${base}/?billing=${result}`;
};

/**
 * A Stripe Checkout page (subscription mode) for the company's current
 * seats. Inside a trial, the subscription's own trial ends when Archie's
 * does, so nobody is charged early.
 */
export async function startCheckout(companyId: string, adminEmail: string, now = new Date()): Promise<{ url: string }> {
  return runAsCompany(companyId, async () => {
    const [company] = await db.select().from(companies);
    if (!company) throw new BillingError('No such company.', 404);
    const billing = await getBillingRow();
    if (billing?.stripeSubscriptionId && isGoodSubscription(billing.subscriptionStatus)) {
      throw new BillingError('You already have a subscription. Use Manage billing to change your card.', 409);
    }
    const quote = quoteForSeats(await countSeats());
    const ids = priceIds();
    const customer = await ensureCustomer(company, billing, adminEmail);
    const trialEnd = company.trialEndsAt && company.trialEndsAt.getTime() - now.getTime() >= MIN_CHECKOUT_TRIAL_MS
      ? Math.floor(company.trialEndsAt.getTime() / 1000) : undefined;
    const session = await stripe().createCheckoutSession({
      mode: 'subscription',
      customer,
      line_items: quote.lineItems.map((l) => ({ price: ids[l.key], quantity: l.quantity })),
      subscription_data: {
        metadata: { [COMPANY_METADATA_KEY]: company.id },
        ...(trialEnd ? { trial_end: trialEnd } : {}),
      },
      metadata: { [COMPANY_METADATA_KEY]: company.id },
      success_url: returnUrl('success'),
      cancel_url: returnUrl('cancelled'),
    });
    if (!session.url) throw new BillingError('Stripe did not return a checkout page. Try again.', 502);
    return { url: session.url };
  }, { loadProfile: false });
}

/** A Stripe Billing Portal page: update the card, see invoices, cancel. */
export async function startPortal(companyId: string): Promise<{ url: string }> {
  return runAsCompany(companyId, async () => {
    const billing = await getBillingRow();
    if (!billing?.stripeCustomerId) throw new BillingError('Add a card first.', 400);
    const session = await stripe().createPortalSession({ customer: billing.stripeCustomerId, return_url: returnUrl('portal') });
    if (!session.url) throw new BillingError('Stripe did not return a billing page. Try again.', 502);
    return { url: session.url };
  }, { loadProfile: false });
}

// ============================================================
// Webhooks
// ============================================================

export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

export interface StripeEvent { id: string; type: string; data: { object: any } }

/** Take an event id for processing. False when it was already handled (or is being handled). */
export function claimEvent(id: string, type: string): Promise<boolean> {
  return runAsSystem('billing webhook: record the event id', async () => {
    const rows = await db.insert(stripeEvents).values({ id, type }).onConflictDoNothing().returning({ id: stripeEvents.id });
    return rows.length > 0;
  });
}

/** Give an event id back after a failure, so Stripe's retry runs it again. */
export function releaseEvent(id: string): Promise<unknown> {
  return runAsSystem('billing webhook: release a failed event id', () => db.delete(stripeEvents).where(eq(stripeEvents.id, id)));
}

/** The subscription and customer an event is about, from the event's own object. */
function subjectOf(event: StripeEvent): { subscriptionId: string | null; customerId: string | null } {
  const o = event.data?.object ?? {};
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : v && typeof v === 'object' && typeof (v as any).id === 'string' ? (v as any).id : null);
  if (event.type === 'checkout.session.completed') {
    return { subscriptionId: o.mode === 'subscription' ? str(o.subscription) : null, customerId: str(o.customer) };
  }
  if (event.type.startsWith('customer.subscription.')) return { subscriptionId: str(o.id), customerId: str(o.customer) };
  // Invoices: the subscription is on the invoice (older API versions) or under parent (newer).
  return { subscriptionId: str(o.subscription) ?? str(o.parent?.subscription_details?.subscription), customerId: str(o.customer) };
}

export interface WebhookOutcome { handled: boolean; companyId?: string; note?: string }

/**
 * Apply one verified event. Reads the subscription fresh from Stripe (so
 * events arriving out of order still leave the latest state), works out the
 * company from the subscription's and the customer's metadata, checks they
 * agree with each other and with what Archie stored, then updates
 * company_billing. The only change to the company itself is trial -> active
 * once the subscription is active; a company the operator paused or
 * cancelled is never touched (its status is not 'trial').
 */
export async function handleStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  const { subscriptionId, customerId } = subjectOf(event);
  if (!subscriptionId) return { handled: false, note: 'no subscription on this event' };
  const sub = await stripe().retrieveSubscription(subscriptionId);
  const subCustomer = customerIdOf(sub.customer);
  const companyId = String(sub.metadata?.[COMPANY_METADATA_KEY] ?? '').toLowerCase();
  const refuse = (note: string): WebhookOutcome => {
    console.error(`[billing] webhook ${event.id} (${event.type}) refused: ${note}`);
    return { handled: false, note };
  };
  if (!isCompanyId(companyId)) return refuse('the subscription has no Archie company in its metadata');
  if (!subCustomer || (customerId && customerId !== subCustomer)) return refuse('the event and the subscription name different customers');
  const customer = await stripe().retrieveCustomer(subCustomer);
  if (customer.deleted || String(customer.metadata?.[COMPANY_METADATA_KEY] ?? '').toLowerCase() !== companyId) {
    return refuse('the customer and the subscription name different companies');
  }

  return runAsCompany(companyId, async () => {
    const [company] = await db.select().from(companies);
    if (!company) return refuse(`no company ${companyId}`);
    const billing = await getBillingRow();
    if (billing?.stripeCustomerId && billing.stripeCustomerId !== subCustomer) {
      return refuse('the company is billed to another Stripe customer');
    }
    // An old subscription finishing must not overwrite a newer one that works.
    if (billing?.stripeSubscriptionId && billing.stripeSubscriptionId !== sub.id
      && isGoodSubscription(billing.subscriptionStatus) && !isGoodSubscription(sub.status)) {
      return { handled: false, companyId, note: 'an older subscription; the company has a newer one' };
    }
    const billed = billedSeats(sub);
    await saveBilling(companyId, {
      stripeCustomerId: subCustomer,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEndOf(sub),
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      ...(billed ? { plan: billed.plan, seats: billed.seats } : {}),
    });
    if (sub.status === 'active' && company.status === 'trial') {
      await runAsSystem('billing webhook: a paid subscription moves the company from trial to active', () =>
        db.update(companies).set({ status: 'active', updatedAt: new Date() })
          .where(and(eq(companies.id, companyId), eq(companies.status, 'trial'))));
    }
    return { handled: true, companyId };
  }, { loadProfile: false });
}

// ============================================================
// What the Billing page and the operator page show
// ============================================================

export interface BillingPage {
  enabled: true;
  locked: boolean;
  reason: LockReason | null;
  banner: Banner | null;
  /** Who can sign in now, and what that costs (shared/billing/pricing.ts). */
  seats: number;
  quote: Quote;
  /** What Stripe bills for now, when there is a subscription. */
  billedPlan: 'solo' | 'team' | null;
  billedSeats: number | null;
  status: string | null;
  trialEndsAt: string | null;
  nextBillDate: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  seatSyncError: boolean;
}

/** The admin's Billing page. As the current company. */
export async function billingPage(now = new Date()): Promise<BillingPage | { enabled: false }> {
  const state = await currentBillingState(now);
  if (!state.enabled) return { enabled: false };
  const seats = await countSeats();
  const b = state.billing;
  return {
    enabled: true,
    locked: state.locked,
    reason: state.reason,
    banner: state.banner,
    seats,
    quote: quoteForSeats(seats),
    billedPlan: b?.plan ?? null,
    billedSeats: b?.seats ?? null,
    status: b?.subscriptionStatus ?? null,
    trialEndsAt: state.company?.trialEndsAt?.toISOString() ?? null,
    nextBillDate: b?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: !!b?.cancelAtPeriodEnd,
    hasCustomer: !!b?.stripeCustomerId,
    hasSubscription: !!b?.stripeSubscriptionId && isGoodSubscription(b?.subscriptionStatus),
    seatSyncError: !!b?.seatSyncError,
  };
}
