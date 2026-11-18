/**
 * Leads and jobs, as Roof Lee's assistant reads and changes them
 * (docs/archie/02-roof-lee-link.md).
 *
 * Everything here runs as one company (runAsCompany), so a record that
 * belongs to another company is simply not there. Nothing here calls JobTread,
 * KynexPro or any other outside system, and nothing here sends a message: a
 * lead Roof Lee adds is a row in Archie's own table and no more.
 *
 * Archie keeps leads and jobs in one table. A row is a "job" once it sits on
 * the production board, and a "lead" until then. The id Roof Lee is given is
 * the row's own number, as digits.
 */
import { and, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leadNotes, leads, productionPipeline, writeLog } from '../../shared/schema';
import { requireCompanyId } from '../tenant/context';
import { leadScopeFor, type ActingMember } from './acting';
import type { LeadChange, NewLead } from './contract';
import { rememberWithin, type SisterAnswer } from './idempotency';

type LeadRow = typeof leads.$inferSelect;

/** Marks a lead Roof Lee added. Such a lead is never told back to Roof Lee as news. */
export const ROOFLI_LEAD_SOURCE = 'roofli';

const MOST_LISTED = 100;
const MOST_NOTES = 50;

export interface SisterJob {
  id: string;
  kind: 'lead' | 'job';
  name: string | null;
  stage: string | null;
  jobType: string | null;
  town: string | null;
  phone: string | null;
  email: string | null;
  updatedAt: string | null;
}

export interface SisterJobDetail extends SisterJob {
  address: string | null;
  message: string | null;
  notes: Array<{ text: string; at: string }>;
  /** Whether the customer agreed to their photos being used. Archie does not record that yet, so: no. */
  photoConsent: boolean;
  photos: Array<{ id: string }>;
}

const nameOf = (r: LeadRow): string | null =>
  [r.firstName, r.lastName].filter((x) => x && x !== 'null').join(' ').trim() || r.jobName || null;

/** Board stages for the rows that are on the production board, by JobTread-style job key. */
async function boardStages(rows: LeadRow[]): Promise<Map<string, string>> {
  const keys = rows.map((r) => r.externalId).filter((k): k is string => !!k);
  if (!keys.length) return new Map();
  const on = await db.select({ key: productionPipeline.jobExternalId, stage: productionPipeline.stage })
    .from(productionPipeline).where(inArray(productionPipeline.jobExternalId, keys));
  return new Map(on.map((p) => [p.key, p.stage]));
}

function toJob(r: LeadRow, board: Map<string, string>): SisterJob {
  const boardStage = r.externalId ? board.get(r.externalId) : undefined;
  return {
    id: String(r.id),
    kind: boardStage ? 'job' : 'lead',
    name: nameOf(r),
    stage: boardStage ?? r.stage ?? r.status ?? null,
    jobType: r.serviceType,
    town: r.city,
    phone: r.phone,
    email: r.email,
    updatedAt: (r.updatedAt ?? r.createdAt)?.toISOString() ?? null,
  };
}

/** `%` and `_` mean themselves in what a person typed. */
const literal = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Leads and jobs this person may see, most recently changed first. */
export async function listJobs(member: ActingMember, filter: { text?: string }): Promise<SisterJob[]> {
  const clauses: SQL[] = [];
  const scope = await leadScopeFor(member);
  if (scope) clauses.push(scope);
  const text = filter.text?.trim().slice(0, 200);
  if (text) {
    const like = `%${literal(text)}%`;
    clauses.push(or(
      ilike(leads.firstName, like), ilike(leads.lastName, like), ilike(leads.jobName, like),
      ilike(leads.phone, like), ilike(leads.email, like), ilike(leads.address, like), ilike(leads.city, like),
    ) as SQL);
  }
  const rows = await db.select().from(leads).where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(leads.updatedAt), desc(leads.id)).limit(MOST_LISTED);
  const board = await boardStages(rows);
  return rows.map((r) => toJob(r, board));
}

/**
 * One lead or job this person may see, or null. `member` undefined is the
 * scheduled run, which asks for the company itself and is not narrowed.
 */
async function findRow(id: number, member: ActingMember | undefined): Promise<LeadRow | null> {
  const scope = member ? await leadScopeFor(member) : undefined;
  const [row] = await db.select().from(leads).where(scope ? and(eq(leads.id, id), scope) : eq(leads.id, id));
  return row ?? null;
}

export async function getJob(id: number, member: ActingMember | undefined): Promise<SisterJobDetail | null> {
  const row = await findRow(id, member);
  if (!row) return null;
  const notes = await db.select({ text: leadNotes.text, at: leadNotes.createdAt }).from(leadNotes)
    .where(eq(leadNotes.leadId, row.id)).orderBy(desc(leadNotes.createdAt), desc(leadNotes.id)).limit(MOST_NOTES);
  return {
    ...toJob(row, await boardStages([row])),
    address: row.address,
    message: row.notes,
    notes: notes.map((n) => ({ text: n.text, at: n.at.toISOString() })),
    // Archie keeps no record of a customer agreeing to their photos being
    // used, so it never says they did and hands over no photo (task A8).
    photoConsent: false,
    photos: [],
  };
}

/** Who did it, in the company's own log. */
const logEntry = (member: ActingMember, action: string, targetId: string, summary: string) => ({
  actor: member.email, system: 'roofli', action, targetId, summary: summary.slice(0, 300), ok: true,
});

/**
 * A new lead, kept in Archie and nowhere else. `key` is the request's
 * idempotency key: the lead and the answer to that key are saved together, so
 * the same key can never make a second lead.
 */
export async function createLead(member: ActingMember, lead: NewLead, key: string | undefined): Promise<SisterAnswer> {
  const companyId = requireCompanyId();
  const [first, ...rest] = lead.name.split(/\s+/);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(leads).values({
      source: ROOFLI_LEAD_SOURCE,
      firstName: first, lastName: rest.join(' ') || null, jobName: lead.name,
      phone: lead.phone ?? null, email: lead.email ?? null,
      address: lead.address ?? null, city: lead.town ?? null,
      serviceType: lead.jobType ?? null, notes: lead.message ?? null,
      status: 'new',
      enteredBy: member.email, enteredByName: member.name,
    }).returning({ id: leads.id });
    await tx.insert(writeLog).values(logEntry(member, 'create_lead', String(row.id), lead.name));
    const answer: SisterAnswer = { status: 201, body: { leadId: String(row.id) } };
    await rememberWithin(tx, companyId, key, answer);
    return answer;
  });
}

/** Changes a lead this person may see. False when there is no such lead for them. */
export async function updateLead(member: ActingMember, id: number, change: LeadChange): Promise<boolean> {
  const row = await findRow(id, member);
  if (!row) return false;
  const set: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
  if (change.status) set.status = change.status;
  if (change.notes) set.notes = change.notes;
  if (change.phone) set.phone = change.phone;
  if (change.email) set.email = change.email;
  if (change.name) {
    const [first, ...rest] = change.name.split(/\s+/);
    set.firstName = first;
    set.lastName = rest.join(' ') || null;
    // The job's own title is left alone once the lead has one from elsewhere.
    if (!row.jobName || row.source === ROOFLI_LEAD_SOURCE) set.jobName = change.name;
  }
  await db.transaction(async (tx) => {
    await tx.update(leads).set(set).where(eq(leads.id, row.id));
    await tx.insert(writeLog).values(logEntry(member, 'update_lead', String(row.id), `Changed: ${Object.keys(change).join(', ')}`));
  });
  return true;
}

/** Adds a note to a lead or job this person may see. Null when there is no such record for them. */
export async function addNote(member: ActingMember, id: number, text: string, key: string | undefined): Promise<SisterAnswer | null> {
  const companyId = requireCompanyId();
  const row = await findRow(id, member);
  if (!row) return null;
  return db.transaction(async (tx) => {
    await tx.insert(leadNotes).values({ leadId: row.id, text, author: member.email, authorName: member.name, system: 'roofli' });
    await tx.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, row.id));
    await tx.insert(writeLog).values(logEntry(member, 'add_note', String(row.id), text));
    const answer: SisterAnswer = { status: 201, body: { ok: true } };
    await rememberWithin(tx, companyId, key, answer);
    return answer;
  });
}
