/**
 * Setting a Roof Lee company up with its advisors and knowledge base.
 *
 * The same rule as everywhere else in Archie (server/seed.ts): a company is
 * seeded when it is made and backfilled by the seed-companies cron, once per
 * version of the seed definitions, and that is recorded in company_job_runs.
 * Seeding is never done before a request is answered.
 *
 * Roof Lee makes its companies through POST /api/sister/v1/companies, which
 * inserts the row itself (it must carry Roof Lee's id), so it cannot go
 * through provisionCompany in server/seed.ts. This does the same two things
 * for it: seed as the company, then record it so the cron does not seed the
 * company a second time for this version. If it fails, nothing is recorded
 * and the cron seeds the company on its next run.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { companyJobRuns } from '../../shared/schema';
import { runAsCompany } from '../tenant/context';
import { markCompanyJobDone } from '../tenant/fan-out';
import { SEED_JOB, seedCompany, seedVersion } from '../seed';

/**
 * Seeds one live company unless that is already recorded for this version.
 * Returns whether it seeded. Safe to call on every request about the company:
 * after the first time it costs one read of the company's own progress row.
 */
export async function setUpCompany(companyId: string): Promise<boolean> {
  const version = seedVersion();
  const seeded = await runAsCompany(companyId, async () => {
    const [run] = await db.select({ donePeriod: companyJobRuns.donePeriod }).from(companyJobRuns)
      .where(eq(companyJobRuns.job, SEED_JOB));
    if (run?.donePeriod === version) return false;
    await seedCompany();
    return true;
  });
  if (seeded) await markCompanyJobDone(companyId, SEED_JOB, version);
  return seeded;
}
