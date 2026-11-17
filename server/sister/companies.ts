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
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, type Company } from '../../shared/schema';
import type { CompanyBranding, CompanySettings } from '../../shared/company';
import { isLiveCompany } from '../../shared/company';
import { runAsSystem } from '../tenant/context';
import { noteRoofLeeCompany } from '../tenant/per-company';
import { clearProfileCache } from '../tenant/profile';
import { endSessionsForCompany } from '../auth/sessions';
import { mapCompanyFacts } from './facts';
import { syncMembers } from './members';
import type { CompanyRequest, ProvisionPlan, Skipped } from './contract';

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
  return { companyId: company.id, created, live: isLiveCompany(after), skipped };
}
