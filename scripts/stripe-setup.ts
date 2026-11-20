/**
 * Set up Archie's product and its four monthly prices in a Stripe account,
 * and print the four price ids to paste into Vercel.
 *
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-setup.ts --yes
 *
 * Safe to run again: the product has a fixed id (archie_subscription) and
 * each price is found by its lookup key before anything is created, so a
 * second run creates nothing and prints the same ids. Creating also sends
 * idempotency keys, so a run cut off half way and repeated makes no doubles.
 *
 * It refuses to run without --yes, and says first whether the key is a live
 * (real money) or a test key.
 *
 * The amounts come from shared/billing/pricing.ts. A price's amount cannot be
 * changed at Stripe; if a price with the right lookup key has a different
 * amount, this stops and says so rather than guessing.
 */
import 'dotenv/config';
import { PRICES_CENTS, type PriceKey } from '../shared/billing/pricing';
import { httpStripeApi as stripe, customerIdOf, type StripePrice } from '../server/billing/stripe';

export const PRODUCT_ID = 'archie_subscription';
export const PRODUCT_NAME = 'New Archie';

export const PRICE_SETUP: Array<{ key: PriceKey; env: string; lookupKey: string; nickname: string }> = [
  { key: 'solo_base', env: 'STRIPE_PRICE_SOLO_BASE', lookupKey: 'archie_solo_base_monthly', nickname: 'Solo (1 person)' },
  { key: 'solo_extra', env: 'STRIPE_PRICE_SOLO_EXTRA', lookupKey: 'archie_solo_extra_monthly', nickname: 'Solo extra person' },
  { key: 'team_base', env: 'STRIPE_PRICE_TEAM_BASE', lookupKey: 'archie_team_base_monthly', nickname: 'Team (includes 3 people)' },
  { key: 'team_extra', env: 'STRIPE_PRICE_TEAM_EXTRA', lookupKey: 'archie_team_extra_monthly', nickname: 'Team extra person' },
];

function keyKind(key: string): 'live' | 'test' | null {
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return null;
}

const priceMatches = (p: StripePrice, cents: number) =>
  p.unit_amount === cents && p.currency === 'usd' && p.recurring?.interval === 'month';

async function main() {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  const kind = keyKind(key);
  if (!kind) {
    console.error('Set STRIPE_SECRET_KEY to your Stripe secret key (sk_test_... or sk_live_...).');
    process.exit(1);
  }
  console.log(kind === 'live'
    ? 'This is a LIVE key: the product and prices will be made in your real Stripe account.'
    : 'This is a TEST key: the product and prices will be made in Stripe test mode.');
  if (!process.argv.includes('--yes')) {
    console.error('Nothing was changed. Run again with --yes to go ahead.');
    process.exit(1);
  }

  let product = await stripe.retrieveProduct(PRODUCT_ID);
  if (!product) {
    product = await stripe.createProduct(
      { id: PRODUCT_ID, name: PRODUCT_NAME, description: 'Archie for roofing companies, billed monthly by team size.' },
      `archie-setup-product-${PRODUCT_ID}`,
    );
    console.log(`Created product ${product.id} (${PRODUCT_NAME}).`);
  } else {
    console.log(`Found product ${product.id} (${product.name}).`);
  }

  const existing = await stripe.listPricesByLookupKeys(PRICE_SETUP.map((p) => p.lookupKey));
  const lines: string[] = [];
  for (const p of PRICE_SETUP) {
    const cents = PRICES_CENTS[p.key];
    let price = existing.find((x) => x.lookup_key === p.lookupKey);
    if (price && !priceMatches(price, cents)) {
      console.error(`Price ${price.id} has lookup key ${p.lookupKey} but is not $${cents / 100} a month in USD. `
        + 'Archive it in Stripe (or remove its lookup key), then run this again.');
      process.exit(1);
    }
    if (price && customerIdOf(price.product) !== PRODUCT_ID) {
      console.warn(`Note: ${price.id} (${p.lookupKey}) belongs to product ${customerIdOf(price.product)}, not ${PRODUCT_ID}. Using it anyway.`);
    }
    if (!price) {
      price = await stripe.createPrice({
        product: PRODUCT_ID,
        currency: 'usd',
        unit_amount: cents,
        recurring: { interval: 'month' },
        lookup_key: p.lookupKey,
        nickname: p.nickname,
      }, `archie-setup-price-${p.lookupKey}-${cents}`);
      console.log(`Created ${p.nickname}: ${price.id}`);
    } else {
      console.log(`Found ${p.nickname}: ${price.id}`);
    }
    lines.push(`${p.env}=${price.id}`);
  }

  console.log(`\nPaste these into Vercel (Settings > Environment Variables), for the ${kind} key:\n`);
  for (const l of lines) console.log(l);
}

main().catch((err) => {
  console.error('Stripe setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
