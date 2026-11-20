/**
 * Checking that a webhook really came from Stripe.
 *
 * Stripe signs each delivery: the Stripe-Signature header holds a timestamp
 * `t` and one or more `v1` signatures, each an HMAC-SHA256 of
 * `${t}.${raw body}` keyed with the endpoint's signing secret
 * (STRIPE_WEBHOOK_SECRET, "whsec_..."). The raw body is the exact bytes
 * Stripe sent: parsing the JSON and printing it again would change them, so
 * the webhook route gets the body unparsed (express.raw).
 *
 * A delivery older than five minutes is refused, so a captured one cannot be
 * replayed later.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!secret) return { ok: false, reason: 'no webhook secret configured' };
  if (!header) return { ok: false, reason: 'no Stripe-Signature header' };
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s?.trim());
    if (k === 't' && v && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && v) v1.push(v);
  }
  if (t === null || !v1.length) return { ok: false, reason: 'malformed Stripe-Signature header' };
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp outside the tolerance' };
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const match = v1.some((sig) => {
    if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
    const got = Buffer.from(sig, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'signature does not match' };
}
