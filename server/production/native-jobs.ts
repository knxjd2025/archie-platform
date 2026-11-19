/**
 * Archie's own jobs: a job kept on Archie's own boards with no JobTread
 * behind it (docs/archie/02-roof-lee-link.md, "Archie's own jobs").
 *
 * The boards are keyed on a job key (leads.external_id), which for the
 * original company is JobTread's id for the job. A company that keeps its own
 * jobs has no JobTread, so a lead of its gets a key Archie makes itself:
 * 'archie-' and 32 hex characters, given when the lead is made (newJobKey: the
 * lead form and a canvassed door, server/production/native-leads.ts, and a lead
 * Roof Lee adds, server/sister/leads.ts). An older lead with none is given one
 * the first time it is put on a board (ensureJobIdentity). The key names
 * nothing outside Archie, and nothing is ever sent to JobTread, or to any
 * other outside system, for a job that has one (server/production/pipeline.ts
 * and server/sales/store.ts check isNativeJobId before they would).
 *
 * jobBackendFor is the one place that answers "which system keeps this job".
 *
 * WHO KEEPS THEIR OWN JOBS: only a company Roof Lee made (keepsOwnJobs). For
 * every other company nothing here ever writes anything, so its leads and
 * boards are exactly as they were.
 *
 * Everything here must run as the company (runAsCompany).
 */
import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { leads, type Company } from '../../shared/schema';
import { getCurrentCompany } from '../tenant/companies';
import { logWrite } from '../writes/log';

export const NATIVE_JOB_PREFIX = 'archie-';
const NATIVE_JOB_RE = /^archie-[0-9a-f]{32}$/;

/** True for a job key Archie made itself. Such a job has nothing behind it in JobTread. */
export function isNativeJobId(id: unknown): id is string {
  return typeof id === 'string' && NATIVE_JOB_RE.test(id);
}

/**
 * Does this company keep its jobs on Archie's own board, without JobTread?
 * The one switch: the capability Roof Lee is told (`jobs.native`) and the
 * code that makes a job identity both read it, so they cannot disagree.
 */
export function keepsOwnJobs(company: Pick<Company, 'roofliCompanyId'> | null | undefined): boolean {
  return !!company?.roofliCompanyId;
}

/**
 * Said when a company that keeps its own jobs tries to connect other job
 * software (server/integrations/connection-routes.ts). Until other systems
 * plug in through jobBackendFor, such a company keeps every job in Archie,
 * never a mix.
 */
export const OTHER_JOB_SOFTWARE_SOON = 'Connecting other job software is coming soon for your company.';

/**
 * Said when a company that keeps its own jobs tries to connect KynexPro
 * (server/integrations/ghl/routes.ts). Its KynexPro is Roof Lee's, and Archie
 * never connects to it: a fact, not a promise of anything to come.
 */
export const KYNEXPRO_IS_ROOF_LEES = 'Roof Lee looks after your KynexPro, so Archie does not connect to it.';

/** Said when a company that keeps its own jobs tries to connect CompanyCam (server/integrations/connection-routes.ts). Promises nothing. */
export const COMPANYCAM_NOT_FOR_YOU = 'CompanyCam can\'t be connected for your company.';

/** Said when a photo is added to a job Archie keeps, until Archie keeps photos itself (server/photos/routes.ts). */
export const NATIVE_PHOTOS_SOON = 'Adding photos to jobs is coming soon for your company.';

/** Said when a file or a proposal of a job Archie keeps would be sent to other job software. */
export const NATIVE_SEND_ELSEWHERE_SOON = 'Sending this to other job software is coming soon for your company.';

/**
 * Said when a commission statement would be saved on a job Archie keeps
 * (server/job-commissions/routes.ts): Archie has nowhere to file it on the
 * job yet. Preview still opens it.
 */
export const NATIVE_STATEMENT_NOT_FILED = 'Saving files to a job is coming soon for your company. Open the statement with Preview instead.';

/** Where a new lead of Archie's own starts: the first step of the Sales board (shared/sales-pipeline.ts SALES_BAND). */
export const NEW_LEAD_STAGE = 'New Lead';

/** A new job key of Archie's own: 'archie-' and 32 hex characters. Names nothing outside Archie. */
export function newJobKey(): string {
  return `${NATIVE_JOB_PREFIX}${randomBytes(16).toString('hex')}`;
}

/** The system that keeps a job: Archie itself, or JobTread. */
export type JobBackend = 'archie' | 'jobtread';

/**
 * Which system keeps this job. THE ONE SEAM: every "do we tell JobTread, or
 * keep it here?" decision asks this, so another job system can be plugged in
 * later in one place (a connector lookup instead of these two rules).
 *
 *   - a key Archie made itself: Archie, in any company;
 *   - no key yet, in a company that keeps its own jobs: Archie (it gets one
 *     of Archie's own keys, never anyone else's);
 *   - anything else: JobTread, exactly as before. That includes a lead with
 *     no key in the original company (the JobTread sync gives it one) and a
 *     job another system keeps in a company Roof Lee made.
 *
 * Ask it with `{ externalId: null }` for a job that is about to be made.
 */
export function jobBackendFor(
  lead: { externalId?: string | null },
  company: Pick<Company, 'roofliCompanyId'> | null | undefined,
): JobBackend {
  if (isNativeJobId(lead.externalId)) return 'archie';
  if (!lead.externalId && keepsOwnJobs(company)) return 'archie';
  return 'jobtread';
}

/**
 * The job key for one of the current company's leads, made now if the lead
 * has none. Null when there is no such lead here, or when this company does
 * not keep its own jobs (nothing is written for it). A lead that already has
 * a key, of either kind, keeps it.
 */
export async function ensureJobIdentity(leadId: number): Promise<string | null> {
  const read = async () => (await db.select({ externalId: leads.externalId }).from(leads).where(eq(leads.id, leadId)))[0];
  const lead = await read();
  if (!lead) return null;
  if (lead.externalId) return lead.externalId;
  if (!keepsOwnJobs(await getCurrentCompany())) return null;
  const made = newJobKey();
  // Only if it still has none: of two requests arriving together, one key wins and both get it.
  const [mine] = await db.update(leads).set({ externalId: made })
    .where(and(eq(leads.id, leadId), isNull(leads.externalId))).returning({ externalId: leads.externalId });
  return mine?.externalId ?? (await read())?.externalId ?? null;
}

/**
 * Records whether the customer agreed to photos of their job being used.
 * Only a person does this; nothing sets it by itself. False when the current
 * company has no such job.
 */
export async function recordPhotoConsent(externalId: string, agreed: boolean, actor: string): Promise<boolean> {
  const [row] = await db.update(leads).set({ photoConsent: agreed, updatedAt: new Date() })
    .where(eq(leads.externalId, externalId)).returning({ id: leads.id });
  if (!row) return false;
  await logWrite({
    actor, system: 'app', action: 'photo_consent', targetId: externalId,
    summary: agreed ? 'Customer agreed to photos of their job being used' : 'Customer\'s agreement to photos being used was withdrawn', ok: true, error: null,
  });
  return true;
}
