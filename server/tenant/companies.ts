/**
 * Reading and creating companies. See docs/archie/01-multi-company.md.
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { companies, type Company } from '../../shared/schema';
import { currentCompanyId, runAsCompany, runAsSystem } from './context';
import './profile';

import { LIVE_STATUSES, isLiveCompany } from '../../shared/company';

export { LIVE_STATUSES, isLiveCompany };

/** The current request's company row, or null when there is no company in context. */
export async function getCurrentCompany(): Promise<Company | null> {
  const id = currentCompanyId();
  if (!id) return null;
  const rows = await db.select().from(companies).where(eq(companies.id, id));
  return rows[0] ?? null;
}

/** Any company by id. System lookup: for sign-in and admin tools only. */
export function getCompanyById(id: string): Promise<Company | null> {
  return runAsSystem('read company by id', async () => {
    const rows = await db.select().from(companies).where(eq(companies.id, id));
    return rows[0] ?? null;
  });
}

/** The company that owns a GHL sub-account, for routing GHL webhooks. */
export function getCompanyByGhlLocation(locationId: string): Promise<Company | null> {
  return runAsSystem('route GHL webhook by location', async () => {
    const rows = await db.select().from(companies).where(eq(companies.ghlLocationId, locationId));
    return rows[0] ?? null;
  });
}

export interface NewCompany {
  slug: string;
  name: string;
  trade?: string;
  status?: Company['status'];
  ghlLocationId?: string | null;
  branding?: Company['branding'];
  settings?: Company['settings'];
}

/** Create a company. System work: only sign-up and admin tools call this. */
export function createCompany(input: NewCompany): Promise<Company> {
  return runAsSystem('create company', async () => {
    const rows = await db.insert(companies).values({
      slug: input.slug.trim().toLowerCase(),
      name: input.name.trim(),
      trade: input.trade ?? 'roofing',
      status: input.status ?? 'trial',
      ghlLocationId: input.ghlLocationId ?? null,
      branding: input.branding ?? {},
      settings: input.settings ?? {},
    }).returning();
    return rows[0];
  });
}

/** Companies that are allowed to run (trial or active). */
export function listLiveCompanies(): Promise<Company[]> {
  return runAsSystem('list live companies', () =>
    db.select().from(companies).where(inArray(companies.status, [...LIVE_STATUSES])));
}

export interface FanOutResult<T> { companyId: string; ok: boolean; value?: T; error?: string }

/**
 * Run a job once per live company, each as that company, one at a time. One
 * company's failure is recorded and the rest still run. For crons.
 */
export async function forEachLiveCompany<T>(job: (company: Company) => Promise<T>): Promise<FanOutResult<T>[]> {
  const list = await listLiveCompanies();
  const results: FanOutResult<T>[] = [];
  for (const company of list) {
    try {
      const value = await runAsCompany(company.id, () => job(company));
      results.push({ companyId: company.id, ok: true, value });
    } catch (err) {
      console.error(`[tenant] job failed for company ${company.slug}:`, err);
      results.push({ companyId: company.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
