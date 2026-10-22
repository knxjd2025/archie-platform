/**
 * Loading a company's profile (shared/company.ts) for the current work.
 *
 * runAsCompany loads it before running anything, through the loader this file
 * registers, so synchronous rendering code can call currentProfile() and get
 * the right company's name, phone, colors and claims. Profiles are cached
 * per company for a minute; editing a company clears its entry.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { companies } from '../../shared/schema';
import { resolveCompanyProfile, type CompanyProfile } from '../../shared/company';
import { setProfileLoader } from './context';

export { currentProfile, withProfile, NEUTRAL_PROFILE } from './context';

const TTL_MS = 60_000;
const cache = new Map<string, { profile: CompanyProfile; at: number }>();

/** Read a company's profile. Runs as that company (its own row is visible to it). */
export async function loadProfile(companyId: string): Promise<CompanyProfile | null> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.profile;
  const rows = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!rows[0]) return null;
  const profile = resolveCompanyProfile(rows[0]);
  cache.set(companyId, { profile, at: Date.now() });
  return profile;
}

/** Forget a cached profile, after its company's branding or settings change. */
export function clearProfileCache(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

setProfileLoader(loadProfile);
