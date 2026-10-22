/**
 * Each company's own secret for webhooks from its GHL sub-account.
 *
 * GHL does not sign workflow webhooks, so the company's GHL workflow sends
 * this secret in an `x-webhook-secret` header. It is per company: a secret
 * shared by every company would let one company forge events for another
 * (location ids are not secret). A company with no secret gets no webhooks.
 */
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { companyIntegrations } from '../../../shared/schema';
import { requireCompanyId } from '../../tenant/context';
import { openSecret, sealSecret } from '../../tenant/secrets';

const PROVIDER = 'ghl_webhook';

/** The current company's webhook secret, or null when it has none. */
export async function getGhlWebhookSecret(): Promise<string | null> {
  const companyId = requireCompanyId();
  const [row] = await db.select({ credentials: companyIntegrations.credentials }).from(companyIntegrations)
    .where(and(eq(companyIntegrations.companyId, companyId), eq(companyIntegrations.provider, PROVIDER)));
  return row ? openSecret<{ secret: string }>(row.credentials).secret : null;
}

/** The current company's webhook secret, made now if it has none. `rotate` replaces it. */
export async function ensureGhlWebhookSecret(rotate = false): Promise<string> {
  if (!rotate) {
    const existing = await getGhlWebhookSecret();
    if (existing) return existing;
  }
  const secret = crypto.randomBytes(32).toString('base64url');
  const credentials = sealSecret({ secret });
  await db.insert(companyIntegrations)
    .values({ provider: PROVIDER, credentials, meta: {} })
    .onConflictDoUpdate({ target: [companyIntegrations.companyId, companyIntegrations.provider], set: { credentials, updatedAt: new Date() } });
  return secret;
}

/** Does `got` match the current company's secret? False when it has none. */
export async function verifyGhlWebhookSecret(got: string | undefined): Promise<boolean> {
  const expected = await getGhlWebhookSecret();
  if (!expected || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
