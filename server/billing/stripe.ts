/**
 * The few Stripe API calls Archie makes, over plain fetch to Stripe's REST API.
 *
 * Why not the `stripe` npm package: the project adds no new dependencies, and
 * Archie needs eight endpoints. Plain fetch keeps it to one small file with a
 * pinned API version, and the whole client sits behind the StripeApi
 * interface, so tests swap in a fake (setStripeApi) and never reach Stripe.
 *
 * Every write that could be repeated takes an idempotency key, so a retry
 * (ours or the network's) never does the work twice.
 */
import { fetchWithTimeout } from '../lib/fetch-timeout';
import { stripeSecretKey } from './config';

/**
 * Pinned, so the shapes below do not change under us. The last version with
 * current_period_end on the subscription itself (newer versions also put it
 * on each item; the code reads either).
 */
export const STRIPE_API_VERSION = '2025-02-24.acacia';
const API = 'https://api.stripe.com/v1';

export interface StripeCustomer { id: string; deleted?: boolean; metadata: Record<string, string> }
export interface StripeSubscriptionItem { id: string; quantity?: number; price: { id: string }; current_period_end?: number }
export interface StripeSubscription {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata: Record<string, string>;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  trial_end?: number | null;
  items: { data: StripeSubscriptionItem[] };
}
export interface StripeSession { id: string; url: string | null }
export interface StripePrice { id: string; lookup_key: string | null; unit_amount: number | null; currency: string; recurring: { interval: string } | null; product: string | { id: string }; active: boolean }
export interface StripeProduct { id: string; name: string; active: boolean }

export interface ItemChange { id?: string; price?: string; quantity?: number; deleted?: boolean }

export interface StripeApi {
  createCustomer(p: { name: string; email?: string; metadata: Record<string, string> }, idempotencyKey: string): Promise<StripeCustomer>;
  retrieveCustomer(id: string): Promise<StripeCustomer>;
  createCheckoutSession(p: Record<string, unknown>): Promise<StripeSession>;
  createPortalSession(p: { customer: string; return_url: string }): Promise<StripeSession>;
  retrieveSubscription(id: string): Promise<StripeSubscription>;
  updateSubscriptionItems(id: string, items: ItemChange[], idempotencyKey: string): Promise<StripeSubscription>;
  // Used by scripts/stripe-setup.ts only.
  retrieveProduct(id: string): Promise<StripeProduct | null>;
  createProduct(p: { id: string; name: string; description?: string }, idempotencyKey: string): Promise<StripeProduct>;
  listPricesByLookupKeys(keys: string[]): Promise<StripePrice[]>;
  createPrice(p: Record<string, unknown>, idempotencyKey: string): Promise<StripePrice>;
}

export class StripeError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/** Stripe's form encoding: nested objects and arrays as a[b][0][c]=v. */
export function toForm(obj: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined) return;
    if (v === null) { out.push(`${encodeURIComponent(prefix)}=`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(`${prefix}[${i}]`, x)); return; }
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(prefix ? `${prefix}[${k}]` : k, x); return; }
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  walk('', obj);
  return out.join('&');
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = stripeSecretKey();
  if (!key) throw new StripeError('Billing is off: STRIPE_SECRET_KEY is not set.', 0);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetchWithTimeout(`${API}${path}`, { method, headers, body: method === 'POST' ? toForm(body ?? {}) : undefined }, 20_000);
  const json = await res.json().catch(() => null) as any;
  if (!res.ok) {
    throw new StripeError(json?.error?.message || `Stripe answered ${res.status}`, res.status, json?.error?.code);
  }
  return json as T;
}

const id = (s: string) => encodeURIComponent(s);

export const httpStripeApi: StripeApi = {
  createCustomer: (p, k) => call('POST', '/customers', p, k),
  retrieveCustomer: (c) => call('GET', `/customers/${id(c)}`),
  createCheckoutSession: (p) => call('POST', '/checkout/sessions', p),
  createPortalSession: (p) => call('POST', '/billing_portal/sessions', p),
  retrieveSubscription: (s) => call('GET', `/subscriptions/${id(s)}`),
  updateSubscriptionItems: (s, items, k) => call('POST', `/subscriptions/${id(s)}`, { items, proration_behavior: 'create_prorations' }, k),
  retrieveProduct: async (p) => {
    try { return await call<StripeProduct>('GET', `/products/${id(p)}`); }
    catch (e) { if (e instanceof StripeError && e.status === 404) return null; throw e; }
  },
  createProduct: (p, k) => call('POST', '/products', p, k),
  listPricesByLookupKeys: async (keys) => {
    const q = keys.map((k) => `lookup_keys[]=${encodeURIComponent(k)}`).join('&');
    const r = await call<{ data: StripePrice[] }>('GET', `/prices?active=true&limit=100&${q}`);
    return r.data;
  },
  createPrice: (p, k) => call('POST', '/prices', p, k),
};

let current: StripeApi = httpStripeApi;

/** The Stripe client in use. */
export const stripe = (): StripeApi => current;

/** Tests only: swap in a fake. Pass null to restore the real one. */
export function setStripeApi(api: StripeApi | null): void { current = api ?? httpStripeApi; }

export const customerIdOf = (c: string | { id: string } | null | undefined): string | null =>
  !c ? null : typeof c === 'string' ? c : c.id;

/** When the current period ends, as a Date, from the subscription or its first item. */
export function periodEndOf(sub: StripeSubscription): Date | null {
  const t = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof t === 'number' && t > 0 ? new Date(t * 1000) : null;
}
