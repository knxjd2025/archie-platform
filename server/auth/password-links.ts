/**
 * One-time links for setting a password (welcome emails and resets).
 *
 * Same shape as native-handoff.ts: a random token, usable once, and only its
 * SHA-256 is stored. The token travels in the URL fragment (`#t=`), which
 * browsers never send to servers or put in Referer headers or access logs.
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { passwordLinks } from '../../shared/schema';
import { requireCompanyId, runAsSystem } from '../tenant/context';

export const PASSWORD_LINK_TTL_MS = 60 * 60 * 1000;

export type PasswordLinkPurpose = 'welcome' | 'reset';

export interface PasswordLinkGrant { email: string; companyId: string; purpose: PasswordLinkPurpose }

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** A one-time token for `email` in the current company. */
export async function mintPasswordLink(email: string, purpose: PasswordLinkPurpose): Promise<string> {
  requireCompanyId();
  const token = crypto.randomBytes(32).toString('base64url');
  await db.insert(passwordLinks).values({
    tokenHash: hash(token),
    email: email.toLowerCase(),
    purpose,
    expiresAt: new Date(Date.now() + PASSWORD_LINK_TTL_MS),
  });
  return token;
}

/**
 * Spend a link. Returns who it was minted for, or null: expired, already used
 * and never existed all look the same on purpose. One DELETE ... RETURNING, so
 * racing requests cannot both win. The person is not signed in yet, so there is
 * no company; the row is found by hash alone and names its own company.
 */
export async function redeemPasswordLink(token: string): Promise<PasswordLinkGrant | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const [row] = await runAsSystem('redeem password link', () =>
    db.delete(passwordLinks).where(eq(passwordLinks.tokenHash, hash(token))).returning());
  if (!row || Date.now() > row.expiresAt.getTime()) return null;
  return { email: row.email, companyId: row.companyId, purpose: row.purpose as PasswordLinkPurpose };
}

/** The link emailed to the person. */
export const passwordLinkUrl = (token: string): string =>
  `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/set-password#t=${encodeURIComponent(token)}`;
