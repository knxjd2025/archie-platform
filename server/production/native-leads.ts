/**
 * A new lead for a company that keeps its own jobs (./native-jobs.ts), made by
 * someone in Archie: typed in on the lead form, or a canvassed door turned
 * into a lead.
 *
 * It is kept in Archie and nowhere else. Nothing here calls JobTread, KynexPro
 * or any other outside system: such a company has no JobTread, and its
 * KynexPro belongs to Roof Lee.
 *
 * The lead gets its job key at once (not the first time it is put on a
 * board), so it can be opened, noted and assigned straight away, and it sits
 * in New Lead so the Sales board shows it.
 *
 * Only for such a company: callers ask jobBackendFor first. Everything here
 * must run as the company (runAsCompany).
 */
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { leads, teamMembers } from '../../shared/schema';
import { NEW_LEAD_STAGE, newJobKey } from './native-jobs';
import { applyAssignment, canOwnJobs } from '../access/assignment-service';
import { logWrite } from '../writes/log';
import { emitLeadCreated } from '../sister/events';

/** `leads.source` of a lead someone made in Archie for a company that keeps its own jobs. */
export const ARCHIE_LEAD_SOURCE = 'archie';

type LeadRow = typeof leads.$inferSelect;

/** What the person gave. Who keeps the lead, its key and its first stage are decided here. */
export type NativeLeadValues = Omit<typeof leads.$inferInsert, 'id' | 'companyId' | 'source' | 'externalId' | 'stage'>;

export interface NewNativeLead {
  values: NativeLeadValues;
  /** Who made it (their sign-in email), for the company's log. */
  actor: string;
  /** The log line: what was done, and a short human summary. */
  action: string;
  summary: string;
  /**
   * The team member who owns it from the start, by id. Given only when the
   * caller has decided someone should; ignored unless that person is active
   * and in a role that can own jobs (never a crew).
   */
  ownerId?: number | null;
  /** How the owner was chosen, kept with the assignment ('created', 'canvass'). */
  ownerSource?: string;
  /** Why they own it, in words, kept with the assignment. */
  ownerEvidence?: string;
}

export interface NativeLeadMade {
  row: LeadRow;
  /** The team member who owns it now, or null when nobody does yet (a manager assigns it). */
  ownerId: number | null;
}

/**
 * An active team member who may own jobs, found by sign-in email, or null.
 * Crews (production) and customer service never are.
 */
export async function jobOwnerByEmail(email: string | null | undefined): Promise<{ id: number; role: string } | null> {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return null;
  const [m] = await db.select({ id: teamMembers.id, role: teamMembers.role, active: teamMembers.active }).from(teamMembers)
    .where(sql`lower(${teamMembers.email}) = ${wanted}`);
  return m && m.active && canOwnJobs(m.role) ? { id: m.id, role: m.role } : null;
}

/**
 * An active team member who may own jobs, found by the name a sales leader
 * picked on the lead form (the person's name, or their JobTread rep name), or
 * null when no one active matches.
 */
export async function jobOwnerByName(name: string | null | undefined): Promise<{ id: number; role: string } | null> {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  const found = await db.select({ id: teamMembers.id, role: teamMembers.role, active: teamMembers.active }).from(teamMembers)
    .where(sql`(lower(trim(${teamMembers.name})) = ${wanted} or lower(trim(${teamMembers.jobtreadSalesRep})) = ${wanted})`);
  const owners = found.filter((m) => m.active && canOwnJobs(m.role));
  // Two people with the same name: do not guess, a manager assigns it.
  return owners.length === 1 ? { id: owners[0].id, role: owners[0].role } : null;
}

async function assignOwner(key: string, input: NewNativeLead): Promise<number | null> {
  if (input.ownerId == null) return null;
  const [m] = await db.select({ id: teamMembers.id, role: teamMembers.role, active: teamMembers.active }).from(teamMembers)
    .where(sql`${teamMembers.id} = ${input.ownerId}`);
  if (!m || !m.active || !canOwnJobs(m.role)) return null;
  try {
    await applyAssignment({
      jobExternalId: key, primaryTeamMemberId: m.id, secondaryTeamMemberIds: [],
      source: input.ownerSource || 'created', confidence: 'high', evidence: input.ownerEvidence ?? null, assignedBy: input.actor,
    });
    return m.id;
  } catch (e) {
    // The lead stands without an owner; it shows on the Assignments page for a manager.
    console.error('[native-leads] could not assign the new lead:', (e as Error)?.message || e);
    return null;
  }
}

/**
 * Makes the lead: one row with a key of Archie's own, in New Lead; its owner
 * when one is given; one line in the company's log; and the news to Roof Lee
 * (lead.created, which does nothing unless the link is on for this company).
 */
export async function createNativeLead(input: NewNativeLead): Promise<NativeLeadMade> {
  const key = newJobKey();
  const [row] = await db.insert(leads).values({
    ...input.values, source: ARCHIE_LEAD_SOURCE, externalId: key, stage: NEW_LEAD_STAGE,
  }).returning();
  const ownerId = await assignOwner(key, input);
  await logWrite({
    actor: input.actor, system: 'archie', action: input.action, targetId: key,
    summary: input.summary.slice(0, 300), ok: true, error: null,
  });
  await emitLeadCreated(row);
  return { row, ownerId };
}
