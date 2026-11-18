/**
 * Archie's own jobs: a job kept on Archie's own boards with no JobTread
 * behind it (docs/archie/02-roof-lee-link.md, "Archie's own jobs").
 *
 * The boards are keyed on a job key (leads.external_id), which for the
 * original company is JobTread's id for the job. A company that keeps its own
 * jobs has no JobTread, so a lead of its gets a key Archie makes itself the
 * first time it is put on a board: 'archie-' and 32 hex characters. The key
 * names nothing outside Archie, and nothing is ever sent to JobTread, or to
 * any other outside system, for a job that has one (server/production/pipeline.ts
 * and server/sales/store.ts check isNativeJobId before they would).
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
  const made = `${NATIVE_JOB_PREFIX}${randomBytes(16).toString('hex')}`;
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
