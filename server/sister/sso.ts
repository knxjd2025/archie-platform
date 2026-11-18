/**
 * One sign-in: a person who is signed in to Roof Lee opens Archie without
 * signing in again (docs/archie/02-roof-lee-link.md).
 *
 * Their browser posts a ticket Roof Lee made for them. It lives sixty seconds
 * and works once. Archie checks it in the order the agreement sets out
 * (docs/sisters/contract-v2.md in the Roof Lee repository, "What the receiver
 * must do"):
 *
 *   1 to 5  the signature over the bytes as they arrived, then what the
 *           ticket says: version, product, times (./ticket.ts)
 *   6       the ticket has not been used before, recorded in the same step
 *   7       the person is found by their shared sign-in id inside the company
 *           the ticket names, and never by email
 *   8       the company is live, and the person may sign in here
 *
 * Steps 9 and 10 (a fresh session, then the landing page) are the route's.
 * Every refusal looks the same from outside: this returns null and says
 * nothing about which check failed.
 *
 * The role in the ticket grants nothing. The person gets the role Archie
 * holds for them from the last team list Roof Lee sent.
 */
import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db';
import { sisterSsoTickets, teamMembers } from '../../shared/schema';
import { isLiveCompany } from '../../shared/company';
import type { TeamRole } from '../../shared/rbac';
import { runAsCompany } from '../tenant/context';
import { isAllowedLoginEmail, isBlockedLoginEmail, memberCanLogin } from '../auth/allowlist';
import { findRoofLeeCompany } from './companies';
import { pairSecret } from './door';
import { ROOFLI_SOURCE } from './members';
import { readTicket } from './ticket';

/** Who to sign in, as the session holds them. */
export interface SsoUser { email: string; name: string; role: TeamRole; companyId: string }

/** Only a SHA-256 of a ticket's id is kept, so the table holds nothing that was ever worth anything. */
const hashOf = (jti: string): string => createHash('sha256').update(jti).digest('hex');

/**
 * Used tickets are kept this long past their end before being cleared away.
 * The agreement asks for "at least until its end"; the margin covers a clock
 * that runs a little behind.
 */
const KEEP_AFTER_END_MINUTES = 10;

/**
 * Spends a ticket and says who it signs in, or null. Never throws for a bad
 * ticket; a database failure does throw, and the route answers it the same way.
 */
export async function signInFromTicket(raw: unknown, now: Date = new Date()): Promise<SsoUser | null> {
  const secret = pairSecret();
  // With the pair secret unset the link is off: nobody comes in this way.
  if (!secret || typeof raw !== 'string') return null;

  // Steps 1 to 5. Only Archie's own pair secret, and only a ticket made for Archie.
  const ticket = readTicket(raw, secret, now, 'archie');
  if (!ticket) return null;

  const company = await findRoofLeeCompany(ticket.roofliCompanyId.toLowerCase());
  if (!company) return null;

  return runAsCompany(company.id, async () => {
    // Step 6, in one statement: the row either goes in (first use) or is
    // already there (any later use, including one arriving at the same
    // moment). The ticket is spent from here on, whatever happens next.
    const first = await db.insert(sisterSsoTickets)
      .values({ jtiHash: hashOf(ticket.jti), expiresAt: new Date(ticket.exp * 1000) })
      .onConflictDoNothing().returning({ jtiHash: sisterSsoTickets.jtiHash });
    if (!first[0]) return null;
    // Clear away this company's long-finished tickets while here. Best effort.
    // Compared with the SAME clock that wrote expires_at (this process's), as
    // every other one-time store here does. The database's now() reads in its
    // session's time zone: on a session east of UTC it would call the row just
    // written long finished and delete it, and the ticket would work twice.
    await db.delete(sisterSsoTickets)
      .where(lt(sisterSsoTickets.expiresAt, new Date(now.getTime() - KEEP_AFTER_END_MINUTES * 60_000)))
      .then(() => {}, () => {});

    // Step 7. By the shared sign-in id, inside this company, among the people
    // Roof Lee sent. The email in the ticket is never used to find anyone.
    const [member] = await db.select().from(teamMembers).where(and(
      eq(teamMembers.companyId, company.id),
      eq(teamMembers.authUserId, ticket.authUserId.toLowerCase()),
      eq(teamMembers.source, ROOFLI_SOURCE),
    ));
    if (!member) return null;

    // Step 8. The same gates every other sign-in applies.
    if (!isLiveCompany(company)) return null;
    if (!memberCanLogin(member)) return null;
    if (isBlockedLoginEmail(member.email)) return null;
    if (process.env.LOGIN_ALLOWLIST && !isAllowedLoginEmail(member.email)) return null;

    await db.update(teamMembers).set({ lastLoginAt: new Date() }).where(eq(teamMembers.id, member.id));
    return { email: member.email, name: member.name, role: member.role as TeamRole, companyId: company.id };
  }, { loadProfile: false });
}

/**
 * What every refused sign-in is shown: one short plain sentence, and nothing
 * about why. No link back, because Archie is never told Roof Lee's address.
 */
export const SSO_REFUSED_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title></head>'
  + '<body style="font-family:system-ui,sans-serif;margin:3rem auto;max-width:28rem;padding:0 1rem"><p>That sign-in did not work. Go back to Roof Lee and open Archie again.</p></body></html>';
