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
 * the row's own number, as digits, and stays the same when a lead becomes a
 * job. A lead Roof Lee adds is given a job identity Archie makes itself
 * (server/production/native-jobs.ts) when it is made, so office staff can
 * open it in Archie; it is put on the board under that identity. An older
 * lead with none is given one the first time it is moved.
 */
import { and, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leadNotes, leads, productionPipeline, writeLog } from '../../shared/schema';
import { requireCompanyId } from '../tenant/context';
import { leadScopeFor, type ActingMember } from './acting';
import type { LeadChange, NewLead } from './contract';
import { rememberWithin, type SisterAnswer } from './idempotency';
import { isPipelineStage, jobtreadStatusFor, moveBlocker, normalizeTrades, stageForJobtreadStatus, type TradeStep } from '../../shared/production-pipeline';
import { ensureJobIdentity, isNativeJobId, NEW_LEAD_STAGE, newJobKey } from '../production/native-jobs';
import { gateContexts, moveStage } from '../production/pipeline';
import { MAX_PHOTO_BYTES, photosForRoofLee, readyPhoto, workingCopyBytes, type RoofLeePhoto } from '../photos/native';
import { cleanJpeg } from '../photos/jpeg-clean';
import type { PhotoStore } from '../photos/store';

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
  /** True only when a person recorded that the customer agreed to their photos being used. */
  photoConsent: boolean;
  /**
   * The job's own photos, kept by Archie (server/photos/native.ts), only once
   * a person recorded the customer's agreement and only for a job Archie
   * keeps: ready ones, Before, During, After, then any with no phase, oldest
   * first within each, at most 40 (photosForRoofLee). Empty otherwise.
   */
  photos: RoofLeePhoto[];
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
    jobType: r.jobType ?? r.serviceType,
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
  // Only what a person recorded (recordPhotoConsent). Without it no photo is
  // listed, and none is ever handed over (jobPhotoFile).
  const photoConsent = row.photoConsent === true;
  return {
    ...toJob(row, await boardStages([row])),
    address: row.address,
    message: row.notes,
    notes: notes.map((n) => ({ text: n.text, at: n.at.toISOString() })),
    photoConsent,
    photos: photoConsent && isNativeJobId(row.externalId) ? await photosForRoofLee(row.externalId) : [],
  };
}

/** One photo for Roof Lee: the file, or why there is none to give. */
export type SisterPhotoFile =
  | { found: true; jpeg: Buffer }
  | { found: false; storeOff?: true };

/**
 * One photo of a job, for Roof Lee: the job's working copy as a JPEG with no
 * metadata in it. Found only when this person may see the job, a person
 * recorded the customer's agreement, the job is one Archie keeps, and the
 * photo is one of its own ready photos. Anything else is simply not found,
 * the same as a photo that is not there.
 *
 * The copy was cleaned when it was taken in (server/photos/jpeg-clean.ts).
 * It is cleaned and checked again here, on the way out, so nothing that ever
 * reached the store some other way can carry a location to Roof Lee. A copy
 * that is not one whole JPEG is not handed over at all.
 */
export async function jobPhotoFile(id: number, photoId: string, member: ActingMember | undefined, store: PhotoStore | null): Promise<SisterPhotoFile> {
  const row = await findRow(id, member);
  if (!row || row.photoConsent !== true || !isNativeJobId(row.externalId)) return { found: false };
  const photo = await readyPhoto(photoId);
  if (!photo || photo.jobKey !== row.externalId) return { found: false };
  if (!store) return { found: false, storeOff: true };
  const bytes = await workingCopyBytes(photo, store, MAX_PHOTO_BYTES);
  if (!bytes) return { found: false };
  const clean = cleanJpeg(bytes);
  if (!clean.ok) {
    console.warn(`[sister] photo ${photo.id.slice(0, 8)} was not handed over: ${clean.reason}`);
    return { found: false };
  }
  return { found: true, jpeg: clean.jpeg };
}

/** Who did it, in the company's own log. */
const logEntry = (member: ActingMember, action: string, targetId: string, summary: string) => ({
  actor: member.email, system: 'roofli', action, targetId, summary: summary.slice(0, 300), ok: true,
});

/**
 * A new lead, kept in Archie and nowhere else. `key` is the request's
 * idempotency key: the lead and the answer to that key are saved together, so
 * the same key can never make a second lead.
 *
 * It is given its job key now (the company keeps its own jobs: only a company
 * Roof Lee made is ever reached here) and sits in New Lead, so office staff
 * can open it in Archie and it shows on the Sales board.
 */
export async function createLead(member: ActingMember, lead: NewLead, key: string | undefined): Promise<SisterAnswer> {
  const companyId = requireCompanyId();
  const [first, ...rest] = lead.name.split(/\s+/);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(leads).values({
      source: ROOFLI_LEAD_SOURCE, externalId: newJobKey(), stage: NEW_LEAD_STAGE,
      firstName: first, lastName: rest.join(' ') || null, jobName: lead.name,
      phone: lead.phone ?? null, email: lead.email ?? null,
      address: lead.address ?? null, city: lead.town ?? null,
      serviceType: lead.jobType ?? null, jobType: lead.jobType ?? null, notes: lead.message ?? null,
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

/**
 * Moves a job along the production board, putting the lead on the board first
 * if it is not there yet. Null when there is no such record for this person.
 *
 * The move is Archie's own (server/production/pipeline.ts), made as the person
 * it is for, so the board's rules apply exactly as they do to someone using
 * Archie: a stage that is waiting for something answers 409 with the reason.
 * Only one of Archie's own jobs is moved here. A job that another system
 * keeps is left where it is, because moving it would mean telling that system.
 */
export async function moveJob(member: ActingMember, id: number, stage: unknown): Promise<SisterAnswer | null> {
  if (!isPipelineStage(stage)) return { status: 400, body: { error: 'Archie has no such stage.' }, remember: false };
  const row = await findRow(id, member);
  if (!row) return null;
  if (row.externalId && !isNativeJobId(row.externalId)) {
    return { status: 409, body: { error: 'This job is kept in another system, so Archie cannot move it from here.' }, remember: false };
  }
  if (!row.externalId || !(await boardStages([row])).has(row.externalId)) {
    // Not on the board yet. It would start where its status puts it (Approved
    // for a new lead): if the board would refuse the move from there, refuse
    // now, before a request that was turned down puts it on the board (or
    // gives an older lead with none an identity).
    const start = stageForJobtreadStatus(row.stage) ?? 'approved';
    const gates = row.externalId ? (await gateContexts([row.externalId])).get(row.externalId)! : { preconSubmitted: false, walkthroughSubmitted: false };
    const blocker = moveBlocker(stage, { stage: start, trades: normalizeTrades(['roofing']), checks: {} }, gates);
    if (blocker) return { status: 409, body: { error: blocker }, remember: false };
  }
  const key = row.externalId ?? await ensureJobIdentity(row.id);
  if (!isNativeJobId(key)) return { status: 409, body: { error: 'This company does not keep its jobs in Archie.' }, remember: false };
  const moved = await moveStage(key, stage, member.email);
  if (!moved.ok) return { status: moved.status, body: { error: moved.error }, remember: false };
  // Put on the board where it already stood: no move was made, so nothing set
  // the status the rest of Archie reads (a new lead's is still New Lead). Set
  // it once, here, unless it already says where the job is.
  if (!moved.moved && stageForJobtreadStatus(row.stage) !== moved.row.stage) {
    await db.update(leads).set({ stage: jobtreadStatusFor(stage, normalizeTrades(moved.row.trades.map((t) => t.key), moved.row.trades as TradeStep[])), updatedAt: new Date() })
      .where(eq(leads.id, row.id));
  }
  await db.insert(writeLog).values(logEntry(member, 'move_job', String(row.id), `Moved to ${stage}`));
  return { status: 200, body: { ok: true, stage: moved.row.stage } };
}
