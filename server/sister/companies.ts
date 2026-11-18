/**
 * Companies Roof Lee made (docs/archie/02-roof-lee-link.md).
 *
 * Roof Lee is where these accounts are born. Archie finds one by Roof Lee's
 * id for it (companies.roofli_company_id) and by nothing else: never by
 * Archie's own id, a name, a slug or an email. A new Roof Lee id always makes
 * a new company. Nothing that already existed is ever attached.
 *
 * A company cannot write its own companies row (row level security), so the
 * writes here are system work, each for exactly one company named by id.
 */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, teamMembers, writeLog, type Company } from '../../shared/schema';
import type { CompanyBranding, CompanySettings } from '../../shared/company';
import { isLiveCompany } from '../../shared/company';
import { atLeast } from '../../shared/rbac';
import { runAsCompany, runAsSystem } from '../tenant/context';
import { noteRoofLeeCompany } from '../tenant/per-company';
import { clearProfileCache } from '../tenant/profile';
import { clearSessionRevalidationCache } from '../auth/middleware';
import { endSessionsForCompany } from '../auth/sessions';
import { mapCompanyFacts } from './facts';
import { syncMembers } from './members';
import { ROLE_MAP, type Acting, type CloseMode, type CompanyRequest, type ProvisionPlan, type Skipped } from './contract';

type Status = Company['status'];

/** The company Roof Lee knows by this id, or null. The only way a sister request finds a company. */
export async function findRoofLeeCompany(roofliCompanyId: string): Promise<Company | null> {
  const rows = await runAsSystem('sister: find the company Roof Lee names by its own id', () =>
    db.select().from(companies).where(eq(companies.roofliCompanyId, roofliCompanyId)));
  const company = rows[0] ?? null;
  if (company) noteRoofLeeCompany(company.id);
  return company;
}

/**
 * Where a company stands after Roof Lee has said what it pays for.
 *   closed for good   stays closed, whatever is sent
 *   nothing said      no change (a new company starts as a trial)
 *   stopped paying    paused
 *   paying            active, or trial while the trial runs
 */
export function statusFromPlan(current: Status | null, plan: ProvisionPlan | undefined): Status {
  if (current === 'cancelled') return 'cancelled';
  if (!plan) return current ?? 'trial';
  if (!plan.active) return 'paused';
  return plan.trial ? 'trial' : 'active';
}

/** A slug Archie can use: lower case letters, digits and single hyphens. */
export function tidySlug(...candidates: Array<string | undefined>): string {
  for (const c of candidates) {
    const slug = (c ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    if (slug) return slug;
  }
  return 'company';
}

/** Makes the company row, or returns the one a request arriving at the same moment made. */
async function createRoofLeeCompany(req: CompanyRequest): Promise<{ company: Company; created: boolean }> {
  const base = tidySlug(req.slug, req.name);
  for (let attempt = 0; attempt < 6; attempt++) {
    // Its own slug: the one Roof Lee suggests when it is free, with something
    // added when another company already has it.
    const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
    const inserted = await runAsSystem('sister: make the company for a new Roof Lee id', () =>
      db.insert(companies).values({
        slug,
        name: req.name,
        trade: 'roofing',
        status: statusFromPlan(null, req.plan),
        roofliCompanyId: req.roofliCompanyId,
      }).onConflictDoNothing().returning());
    if (inserted[0]) return { company: inserted[0], created: true };
    // Nothing was made: either the same request got here first (use its
    // company), or the slug is taken (try another). Never a company that
    // merely shares the slug.
    const existing = await findRoofLeeCompany(req.roofliCompanyId);
    if (existing) return { company: existing, created: false };
  }
  throw new Error('could not find a free slug for a new company');
}

/**
 * Brings the company's name, standing and confirmed facts up to date. Only the
 * keys Roof Lee's facts fill are touched, plus any it filled last time and no
 * longer does (a withdrawn warranty must not stay on a document). Everything
 * else in branding and settings, such as colors an admin chose, stays.
 */
async function updateFromRequest(companyId: string, req: CompanyRequest): Promise<Company> {
  const mapped = mapCompanyFacts({ city: req.city, state: req.state, timezone: req.timezone, facts: req.facts });
  return runAsSystem('sister: bring one Roof Lee company up to date', () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(companies).where(eq(companies.id, companyId)).for('update');
    const before = row.settings.roofli?.derived ?? { branding: [], settings: [] };

    const branding: Record<string, unknown> = { ...row.branding };
    for (const key of before.branding) delete branding[key];
    Object.assign(branding, mapped.branding);

    const settings: Record<string, unknown> = { ...row.settings };
    for (const key of before.settings) delete settings[key];
    Object.assign(settings, mapped.settings);
    settings.roofli = {
      facts: req.facts ?? row.settings.roofli?.facts ?? {},
      ...(req.plan ?? row.settings.roofli?.plan ? { plan: req.plan ?? row.settings.roofli?.plan } : {}),
      derived: { branding: Object.keys(mapped.branding), settings: Object.keys(mapped.settings) },
      syncedAt: new Date().toISOString(),
    };

    const [after] = await tx.update(companies).set({
      name: req.name,
      status: statusFromPlan(row.status, req.plan),
      branding: branding as CompanyBranding,
      settings: settings as CompanySettings,
      updatedAt: new Date(),
    }).where(eq(companies.id, companyId)).returning();
    return after;
  }));
}

/**
 * Notes the company's KynexPro sub-account. An id only: Archie holds no
 * credential for it and makes no call with it. A location another company
 * already holds is not taken over; this company simply goes without.
 */
async function noteKynexProLocation(company: Company, locationId: string | undefined): Promise<void> {
  if (!locationId || company.ghlLocationId === locationId) return;
  try {
    await runAsSystem('sister: note the KynexPro location of one Roof Lee company', () =>
      db.update(companies).set({ ghlLocationId: locationId, updatedAt: new Date() }).where(eq(companies.id, company.id)));
  } catch (e: any) {
    if ((e?.cause?.code ?? e?.code) !== '23505') throw e;
    console.warn(`[sister] the KynexPro location sent for company ${company.id} already belongs to another company; not stored`);
  }
}

export interface Provisioned { companyId: string; created: boolean; live: boolean; skipped: Skipped[] }

/** POST /api/sister/v1/companies: make the company, or bring it up to date. Safe to receive any number of times. */
export async function provisionCompany(req: CompanyRequest): Promise<Provisioned> {
  const found = await findRoofLeeCompany(req.roofliCompanyId);
  const { company, created } = found ? { company: found, created: false } : await createRoofLeeCompany(req);
  noteRoofLeeCompany(company.id);

  const after = await updateFromRequest(company.id, req);
  await noteKynexProLocation(after, req.kynexproLocationId);
  clearProfileCache(company.id);

  const skipped = [...req.skipped, ...(await syncMembers(company.id, req.members))];
  // A company that has stopped paying is switched off: nobody stays signed in.
  if (isLiveCompany(company) && !isLiveCompany(after)) await endSessionsForCompany(company.id);
  // One that is paying again is let back in at once, not when a cached "no" runs out.
  if (!isLiveCompany(company) && isLiveCompany(after)) clearSessionRevalidationCache();
  return { companyId: company.id, created, live: isLiveCompany(after), skipped };
}

/** Where a company stands, in the three words the contract uses. */
export type SisterStatus = 'active' | 'paused' | 'closed';

export function sisterStatus(status: Status): SisterStatus {
  if (status === 'cancelled') return 'closed';
  return status === 'paused' ? 'paused' : 'active';
}

/**
 * May this person pause or close this company? Archie's own answer (contract
 * rule 4), from its own roster: Roof Lee naming someone is not enough.
 *
 * They must be on this company's team right now, found by their shared
 * sign-in id inside this company only, and hold the admin role here (an owner
 * or admin in Roof Lee). The role the request states must agree: if Roof Lee
 * itself says they are office or crew, the answer is no, whatever Archie
 * still holds from before.
 *
 * Nobody named (a subscription simply ended) is allowed, as the contract says.
 */
export async function mayCloseCompany(company: Company, acting: Acting | undefined): Promise<boolean> {
  if (!acting) return true;
  if (ROLE_MAP[acting.role] !== 'admin') return false;
  const [person] = await runAsCompany(company.id, () =>
    db.select({ role: teamMembers.role, active: teamMembers.active }).from(teamMembers)
      .where(and(eq(teamMembers.companyId, company.id), eq(teamMembers.authUserId, acting.authUserId))),
  { loadProfile: false });
  return !!person && person.active && atLeast(person.role, 'admin');
}

/**
 * DELETE .../companies/{roofliCompanyId}: switch a company off. `pause` until
 * it pays again (a later POST with an active plan brings it back), `close`
 * for good. Neither deletes anything: every person and record stays, and
 * deleting is a separate, manual decision outside the agreement.
 *
 * Switched off means nobody can sign in (the roster re-check refuses a
 * company that is not live, and stored sessions are ended here) and no
 * scheduled work runs for it (crons only visit live companies).
 */
export async function closeCompany(company: Company, mode: CloseMode, acting: Acting | undefined): Promise<SisterStatus> {
  // Closed for good is never undone here, not even into "paused".
  const next: Status = company.status === 'cancelled' || mode === 'close' ? 'cancelled' : 'paused';
  if (next !== company.status) {
    await runAsSystem('sister: pause or close one Roof Lee company', () =>
      db.update(companies).set({ status: next, updatedAt: new Date() }).where(eq(companies.id, company.id)));
    clearProfileCache(company.id);
  }
  await endSessionsForCompany(company.id);
  // Who asked, in the company's own log. No person is named when a subscription simply ended.
  await runAsCompany(company.id, () => db.insert(writeLog).values({
    actor: acting ? `roofli:${acting.authUserId}` : 'roofli',
    system: 'roofli',
    action: mode === 'close' ? 'close_company' : 'pause_company',
    targetId: company.id,
    summary: mode === 'close' ? 'Closed from Roof Lee. Nothing was deleted.' : 'Paused from Roof Lee. Nothing was deleted.',
    ok: true,
  }), { loadProfile: false });
  return sisterStatus(next);
}
