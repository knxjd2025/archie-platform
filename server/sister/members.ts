/**
 * A Roof Lee company's team in Archie.
 *
 * Roof Lee sends the whole team as it now stands. The list is the whole
 * truth for the people Roof Lee sent (source 'roofli'): exactly the ones in it
 * have access through Roof Lee, and one it sent before and now leaves out is
 * switched off. Not everyone signs in to Roof Lee, though: someone the company
 * added in Archie itself (no source) is not Roof Lee's to remove, and keeps
 * their access and their email sign-in whatever list arrives.
 *
 * People Roof Lee sent are known by their shared sign-in id (auth_user_id),
 * never by email, and nobody who already existed is ever attached by a
 * matching address or id: an email that belongs to someone else, in this
 * company or any other, is left out and named, never moved or merged, and so
 * is an id already on a row the company added itself.
 */
import { inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { teamMembers } from '../../shared/schema';
import { runAsCompany, runAsSystem } from '../tenant/context';
import { isBlockedLoginEmail } from '../auth/allowlist';
import { clearSessionRevalidationCache } from '../auth/middleware';
import { endSessionsFor } from '../auth/sessions';
import { REASON, type IncomingMember, type Skipped } from './contract';

/** Marks a person Roof Lee sent. Their way in is Roof Lee's hand-off, never an email sign-in. */
export const ROOFLI_SOURCE = 'roofli';

/**
 * Makes the people Roof Lee sent exactly the given list, and leaves everyone
 * the company added in Archie alone. Returns who was left out. Safe to run
 * twice, and two runs at once for one company take turns.
 */
export async function syncMembers(companyId: string, incoming: IncomingMember[]): Promise<Skipped[]> {
  // Email is unique across Archie, so whether an address is free has to be
  // asked across every company. Only the address and who holds it are read.
  const emails = incoming.map((m) => m.email);
  const holders = emails.length
    ? await runAsSystem('sister: check whether these email addresses already belong to someone', () =>
      db.select({ id: teamMembers.id, email: teamMembers.email }).from(teamMembers).where(inArray(teamMembers.email, emails)))
    : [];
  const heldBy = new Map(holders.map((h) => [h.email, h.id]));

  const skipped: Skipped[] = [];
  const signOut: string[] = [];
  const recheck: string[] = [];

  await runAsCompany(companyId, () => db.transaction(async (tx) => {
    // One sync at a time per company, so two requests arriving together
    // cannot both add the same person or undo each other's work.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sister-team:${companyId}`}))`);
    const existing = await tx.select().from(teamMembers);
    const kept = new Set<number>();

    for (const m of incoming) {
      // Only a row Roof Lee sent is ever theirs to change.
      const row = existing.find((r) => r.source === ROOFLI_SOURCE && r.authUserId === m.authUserId);
      const holder = existing.find((r) => r.email === m.email)?.id ?? heldBy.get(m.email);
      if (row) {
        kept.add(row.id);
        // A changed address is taken only when it is free. Sign-in is by id, so the old one does no harm.
        const email = holder === undefined || holder === row.id ? m.email : row.email;
        if (row.name !== m.name || row.email !== email || row.role !== m.role || !row.active || !row.canLogin) {
          await tx.update(teamMembers)
            .set({ name: m.name, email, role: m.role, active: true, canLogin: true })
            .where(sql`${teamMembers.id} = ${row.id}`);
          recheck.push(row.email, email);
        }
        continue;
      }
      if (isBlockedLoginEmail(m.email)) { skipped.push({ authUserId: m.authUserId, reason: REASON.blocked }); continue; }
      if (holder !== undefined) { skipped.push({ authUserId: m.authUserId, reason: REASON.taken }); continue; }
      // No password: this person comes in through Roof Lee. The database has
      // the last word on a race for the address (email is unique).
      const added = await tx.insert(teamMembers).values({
        name: m.name, email: m.email, role: m.role, active: true, canLogin: true,
        authUserId: m.authUserId, source: ROOFLI_SOURCE, createdBy: ROOFLI_SOURCE,
      }).onConflictDoNothing().returning({ id: teamMembers.id });
      if (added[0]) kept.add(added[0].id);
      else skipped.push({ authUserId: m.authUserId, reason: REASON.taken });
    }

    // Everyone else Roof Lee sent has left. Rows stay (their history hangs
    // off them); access goes. Someone the company added in Archie itself is
    // not on Roof Lee's list to begin with, and is left exactly as they are.
    const leaving = existing.filter((r) => r.source === ROOFLI_SOURCE && !kept.has(r.id) && (r.active || r.canLogin));
    if (leaving.length) {
      await tx.update(teamMembers).set({ active: false, canLogin: false })
        .where(inArray(teamMembers.id, leaving.map((r) => r.id)));
      signOut.push(...leaving.map((r) => r.email));
    }
  }));

  // After the change is saved: end the sessions of everyone who left, and
  // make the next request of anyone who changed re-read the roster.
  for (const email of signOut) await endSessionsFor(email);
  for (const email of recheck) clearSessionRevalidationCache(email);
  return skipped;
}
