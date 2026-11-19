/**
 * The client (job) page for a job Archie keeps itself (./native-jobs.ts): a
 * note, a corrected phone or email, the client's messages and where the job
 * sits on the Production board.
 *
 * Nothing here calls JobTread, KynexPro or any other outside system: such a
 * job has nothing behind it anywhere else, and the company's KynexPro belongs
 * to Roof Lee. The routes ask jobBackendFor first and come here only for a
 * job Archie keeps. Every other job takes the route's own path, unchanged.
 *
 * Everything here must run as the company (runAsCompany), so a job of
 * another company is simply not there.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { leadNotes, leads, productionPipeline } from '../../shared/schema';
import { isPipelineStage, stageLabel } from '../../shared/production-pipeline';
import { logWrite } from '../writes/log';

/** The longest note kept, the same as a note Roof Lee adds (server/sister/contract.ts parseNote). */
export const MAX_NOTE_CHARS = 2000;
export const NOTE_TOO_LONG = `A note can be at most ${MAX_NOTE_CHARS} characters.`;

export const PHONE_LOOKS_WRONG = 'That phone number doesn\'t look right.';
export const EMAIL_LOOKS_WRONG = 'That email address doesn\'t look right.';

// The same checks the lead form makes (server/writes/routes.ts).
const PHONE_RE = /^[\d\s()+.-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How many notes the client's messages show, newest first (the same cap as the merged JobTread feed). */
const MOST_NOTES_SHOWN = 60;

/** One entry in the client's messages, in the same shape the JobTread and KynexPro entries have. */
export interface NoteMessage {
  source: string;
  channel: 'note';
  /** Neither to nor from the customer: a note the team keeps. */
  direction: 'internal';
  /** What the client page shows above it: 'From Roof Lee' for one that came through Roof Lee, else 'Note'. */
  label: string;
  author: string;
  body: string;
  date: number;
}

/** The label a note carries in the client's messages, by where it came from. */
export function noteLabel(system: string | null | undefined): string {
  return system === 'roofli' ? 'From Roof Lee' : 'Note';
}

/** A note row as one entry in the client's messages. */
export function noteMessage(n: { text: string; author: string; authorName: string | null; system: string | null; createdAt: Date }): NoteMessage {
  const author = n.authorName || n.author;
  return {
    source: n.system || 'archie', channel: 'note', direction: 'internal', label: noteLabel(n.system),
    author, body: `${author}: ${n.text}`, date: n.createdAt.getTime(),
  };
}

/** What a person typed as a new phone or email: undefined when not sent, null to clear it. */
export type ContactChange = { email?: string | null; phone?: string | null };

/** Checks a contact change for a job Archie keeps. A blank value clears the field. */
export function parseNativeContact(input: { email?: string; phone?: string }): { ok: true; change: ContactChange } | { ok: false; error: string } {
  const change: ContactChange = {};
  if (input.phone !== undefined) {
    if (input.phone && !PHONE_RE.test(input.phone)) return { ok: false, error: PHONE_LOOKS_WRONG };
    change.phone = input.phone || null;
  }
  if (input.email !== undefined) {
    if (input.email && !EMAIL_RE.test(input.email)) return { ok: false, error: EMAIL_LOOKS_WRONG };
    change.email = input.email || null;
  }
  return { ok: true, change };
}

const leadIdOf = async (externalId: string): Promise<number | null> =>
  (await db.select({ id: leads.id }).from(leads).where(eq(leads.externalId, externalId)))[0]?.id ?? null;

/**
 * Keeps a note on the job, with who wrote it, and writes it to the company's
 * log. Roof Lee reads the same notes (server/sister/leads.ts getJob). False
 * when the current company has no such job.
 */
export async function addNativeNote(externalId: string, text: string, by: { email: string; name?: string | null }): Promise<boolean> {
  const leadId = await leadIdOf(externalId);
  if (leadId == null) return false;
  await db.transaction(async (tx) => {
    await tx.insert(leadNotes).values({ leadId, text, author: by.email, authorName: by.name || null, system: 'archie' });
    await tx.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, leadId));
  });
  await logWrite({ actor: by.email, system: 'archie', action: 'add_note', targetId: externalId, summary: text.slice(0, 120), ok: true, error: null });
  return true;
}

/** Corrects the job's phone or email on the lead itself, and logs it. False when the current company has no such job. */
export async function updateNativeContact(externalId: string, change: ContactChange, actor: string): Promise<boolean> {
  const [row] = await db.update(leads).set({ ...change, updatedAt: new Date() })
    .where(eq(leads.externalId, externalId)).returning({ id: leads.id });
  if (!row) return false;
  await logWrite({
    actor, system: 'archie', action: 'update_contact', targetId: externalId,
    summary: [change.email !== undefined ? `email=${change.email ?? ''}` : null, change.phone !== undefined ? `phone=${change.phone ?? ''}` : null].filter(Boolean).join(' '),
    ok: true, error: null,
  });
  return true;
}

/** The job's notes as the client's messages, newest first. */
export async function noteMessagesFor(leadId: number): Promise<NoteMessage[]> {
  const rows = await db.select({
    text: leadNotes.text, author: leadNotes.author, authorName: leadNotes.authorName, system: leadNotes.system, createdAt: leadNotes.createdAt,
  }).from(leadNotes).where(eq(leadNotes.leadId, leadId))
    .orderBy(desc(leadNotes.createdAt), desc(leadNotes.id)).limit(MOST_NOTES_SHOWN);
  return rows.map(noteMessage);
}

/** Where the job sits on the Production board, or null when it is not on it. Only the stage: nothing about money. */
export async function boardStageFor(externalId: string): Promise<{ key: string; label: string } | null> {
  const [row] = await db.select({ stage: productionPipeline.stage }).from(productionPipeline)
    .where(eq(productionPipeline.jobExternalId, externalId));
  if (!row) return null;
  return { key: row.stage, label: isPipelineStage(row.stage) ? stageLabel(row.stage) : row.stage };
}
