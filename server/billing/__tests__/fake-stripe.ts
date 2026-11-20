/**
 * An in-memory Stripe for tests: the StripeApi interface (server/billing/stripe.ts)
 * over a few maps, recording every call. Nothing here talks to Stripe.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { ItemChange, StripeApi, StripeCustomer, StripeSubscription } from '../stripe';

export interface FakeStripe extends StripeApi {
  customers: Map<string, StripeCustomer>;
  subscriptions: Map<string, StripeSubscription>;
  sessions: Array<Record<string, any>>;
  portals: Array<{ customer: string; return_url: string }>;
  updates: Array<{ id: string; items: ItemChange[]; key: string }>;
  calls: string[];
  /** Make the next N item updates fail, as if Stripe were down. */
  failUpdates: number;
  /** A subscription as Checkout would make it from a recorded session. */
  completeCheckout(session: Record<string, any>, status?: string): StripeSubscription;
  addSubscription(p: { customer: string; companyId: string; items: Array<[string, number]>; status: string }): StripeSubscription;
  reset(): void;
}

export function makeFakeStripe(): FakeStripe {
  let n = 0;
  // Ids differ from run to run, so a second run against the same test
  // database does not trip company_billing's unique customer and subscription ids.
  const run = randomBytes(4).toString('hex');
  const next = (p: string) => `${p}_${run}_${++n}`;
  const customerKeys = new Map<string, string>();
  const fake: FakeStripe = {
    customers: new Map(),
    subscriptions: new Map(),
    sessions: [],
    portals: [],
    updates: [],
    calls: [],
    failUpdates: 0,
    reset() {
      this.customers.clear(); this.subscriptions.clear(); customerKeys.clear();
      this.sessions.length = 0; this.portals.length = 0; this.updates.length = 0; this.calls.length = 0; this.failUpdates = 0;
    },
    async createCustomer(p, key) {
      fake.calls.push('createCustomer');
      const seen = customerKeys.get(key);
      if (seen) return fake.customers.get(seen)!;
      const c: StripeCustomer = { id: next('cus'), metadata: { ...p.metadata } };
      fake.customers.set(c.id, c);
      customerKeys.set(key, c.id);
      return c;
    },
    async retrieveCustomer(id) {
      fake.calls.push('retrieveCustomer');
      const c = fake.customers.get(id);
      if (!c) throw new Error(`no customer ${id}`);
      return c;
    },
    async createCheckoutSession(p) {
      fake.calls.push('createCheckoutSession');
      const s = { id: next('cs'), ...p };
      fake.sessions.push(s);
      return { id: s.id, url: `https://checkout.stripe.test/${s.id}` };
    },
    async createPortalSession(p) {
      fake.calls.push('createPortalSession');
      fake.portals.push(p);
      return { id: next('bps'), url: `https://billing.stripe.test/${p.customer}` };
    },
    async retrieveSubscription(id) {
      fake.calls.push('retrieveSubscription');
      const s = fake.subscriptions.get(id);
      if (!s) throw new Error(`no subscription ${id}`);
      return JSON.parse(JSON.stringify(s));
    },
    async updateSubscriptionItems(id, items, key) {
      fake.calls.push('updateSubscriptionItems');
      fake.updates.push({ id, items, key });
      if (fake.failUpdates > 0) { fake.failUpdates--; throw new Error('Stripe is down (fake)'); }
      const s = fake.subscriptions.get(id)!;
      for (const ch of items) {
        if (ch.deleted) s.items.data = s.items.data.filter((i) => i.id !== ch.id);
        else if (ch.id) s.items.data.find((i) => i.id === ch.id)!.quantity = ch.quantity;
        else s.items.data.push({ id: next('si'), price: { id: ch.price! }, quantity: ch.quantity });
      }
      return JSON.parse(JSON.stringify(s));
    },
    addSubscription({ customer, companyId, items, status }) {
      const s: StripeSubscription = {
        id: next('sub'), status, customer, cancel_at_period_end: false,
        metadata: { archie_company_id: companyId },
        current_period_end: Math.floor(Date.UTC(2026, 11, 18) / 1000),
        items: { data: items.map(([price, quantity]) => ({ id: next('si'), price: { id: price }, quantity })) },
      };
      fake.subscriptions.set(s.id, s);
      return s;
    },
    completeCheckout(session, status = 'trialing') {
      return fake.addSubscription({
        customer: session.customer,
        companyId: session.subscription_data.metadata.archie_company_id,
        items: session.line_items.map((l: any) => [l.price, l.quantity]),
        status,
      });
    },
    async retrieveProduct() { throw new Error('not in tests'); },
    async createProduct() { throw new Error('not in tests'); },
    async listPricesByLookupKeys() { throw new Error('not in tests'); },
    async createPrice() { throw new Error('not in tests'); },
  };
  return fake;
}

/** A Stripe-Signature header for a body, made the way Stripe documents it. */
export function signStripe(body: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${sig}`;
}
