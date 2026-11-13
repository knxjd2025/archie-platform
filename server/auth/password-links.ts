/**
 * One-time links for setting a password (welcome emails and resets).
 *
 * Same shape as native-handoff.ts: a random token, usable once, and only its
 * SHA-256 is stored. The token travels in the URL fragment (`#t=`), which
 * browsers never send to servers or put in Referer headers or access logs.
 */
import crypto from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { passwordLinks } from '../../shared/schema';
import { requireCompanyId, runAsSystem } from '../tenant/context';

export const PASSWORD_LINK_TTL_MS = 60 * 60 * 1000;

/** At most one reset email per address in this window ("Forgot password?" cannot be used to flood an inbox). */
export const RESET_LINK_GAP_MS = 2 * 60 * 1000;

export type PasswordLinkPurpose = 'welcome' | 'reset';

export interface PasswordLinkGrant { email: string; companyId: string; purpose: PasswordLinkPurpose }

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Mint in one transaction, holding a lock on this email in this company so two
 * requests for the same person cannot both pass the gap check. The newest link
 * replaces any older one for the email, and the company's expired links are
 * swept. Mint time is not stored: it is expiresAt minus the TTL, which every
 * row shares. With `gapMs`, returns null instead when a link for this email
 * was minted less than gapMs ago.
 */
async function mint(email: string, purpose: PasswordLinkPurpose, gapMs?: number): Promise<string | null> {
  const companyId = requireCompanyId();
  const who = email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`password_links:${companyId}:${who}`}, 0))`);
    const now = Date.now();
    if (gapMs) {
      const recent = await tx.select({ h: passwordLinks.tokenHash }).from(passwordLinks)
        .where(and(eq(passwordLinks.email, who), gt(passwordLinks.expiresAt, new Date(now + PASSWORD_LINK_TTL_MS - gapMs))))
        .limit(1);
      if (recent.length) return null;
    }
    await tx.delete(passwordLinks).where(eq(passwordLinks.email, who));
    await tx.delete(passwordLinks).where(lt(passwordLinks.expiresAt, new Date(now)));
    const token = crypto.randomBytes(32).toString('base64url');
    await tx.insert(passwordLinks).values({
      tokenHash: hash(token),
      email: who,
      purpose,
      expiresAt: new Date(now + PASSWORD_LINK_TTL_MS),
    });
    return token;
  });
}

/** A one-time token for `email` in the current company. Replaces that email's older links. */
export async function mintPasswordLink(email: string, purpose: PasswordLinkPurpose): Promise<string> {
  return (await mint(email, purpose))!;
}

/**
 * A reset token for `email` in the current company, or null when a link went
 * to this email in the last RESET_LINK_GAP_MS. Decided by the database, so it
 * holds across serverless instances and cold starts.
 */
export function mintResetLinkUnlessRecent(email: string): Promise<string | null> {
  return mint(email, 'reset', RESET_LINK_GAP_MS);
}

/** Cancel every outstanding link for `email` in the current company (after a password is set). */
export async function deletePasswordLinksFor(email: string): Promise<void> {
  requireCompanyId();
  await db.delete(passwordLinks).where(eq(passwordLinks.email, email.trim().toLowerCase()));
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
