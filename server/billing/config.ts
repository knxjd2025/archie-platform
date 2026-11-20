/**
 * Billing settings, read from the environment on every call (so a test or a
 * redeploy with new values takes effect at once).
 *
 * Billing is OFF while STRIPE_SECRET_KEY is unset: no gating, no buttons, no
 * Stripe calls. The app works as before until the owner configures Stripe.
 */
import type { PriceKey } from '../../shared/billing/pricing';

const PRICE_ENV: Record<PriceKey, string> = {
  solo_base: 'STRIPE_PRICE_SOLO_BASE',
  solo_extra: 'STRIPE_PRICE_SOLO_EXTRA',
  team_base: 'STRIPE_PRICE_TEAM_BASE',
  team_extra: 'STRIPE_PRICE_TEAM_EXTRA',
};

const env = (name: string): string => (process.env[name] || '').trim();

/** True when STRIPE_SECRET_KEY is set. */
export const billingEnabled = (): boolean => env('STRIPE_SECRET_KEY') !== '';

export const stripeSecretKey = (): string => env('STRIPE_SECRET_KEY');
export const stripeWebhookSecret = (): string => env('STRIPE_WEBHOOK_SECRET');

/** The Stripe price id for each price key. Throws, naming the missing variables, when any is unset. */
export function priceIds(): Record<PriceKey, string> {
  const out = {} as Record<PriceKey, string>;
  const missing: string[] = [];
  for (const [key, name] of Object.entries(PRICE_ENV) as [PriceKey, string][]) {
    const v = env(name);
    if (!v) missing.push(name);
    out[key] = v;
  }
  if (missing.length) throw new Error(`Billing is not fully set up: set ${missing.join(', ')}.`);
  return out;
}

/** The price key for a Stripe price id, or null for a price Archie does not know. */
export function priceKeyOf(priceId: string): PriceKey | null {
  for (const [key, name] of Object.entries(PRICE_ENV) as [PriceKey, string][]) {
    if (env(name) && env(name) === priceId) return key;
  }
  return null;
}

/** The app's address, for Stripe's return links. */
export const appBaseUrl = (): string => env('APP_BASE_URL').replace(/\/+$/, '');
