/**
 * Seed (or bring up to date) every live company's advisors and knowledge base.
 * The operator backfill for companies created before seeding moved off the
 * request path, and the way to push edited advisor wording to every company:
 *
 *   npx tsx scripts/seed-companies.ts                 # every live company
 *   npx tsx scripts/seed-companies.ts --company acme  # one company, by slug
 *
 * Idempotent: it only fills in what is missing. Each company runs as itself;
 * one company's failure is reported and the rest still run. Exits 1 if any
 * company failed, so it can be rerun.
 */
import 'dotenv/config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { pool } = await import('../server/db');
  const { seedAll, seedCompany } = await import('../server/seed');
  const { requireAppRole } = await import('./lib/require-app-role');
  try { await requireAppRole(pool); } catch (e) {
    console.error((e as Error).message);
    await pool.end();
    process.exit(1);
  }
  const only = arg('company')?.trim().toLowerCase();
  try {
    const results = await seedAll(async (company) => {
      if (only && company.slug !== only) return 'skipped';
      await seedCompany();
      return 'seeded';
    });
    for (const r of results) {
      if (r.value === 'skipped') continue;
      console.log(`${r.companyId}: ${r.ok ? 'ok' : `FAILED ${r.error}`}`);
    }
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
