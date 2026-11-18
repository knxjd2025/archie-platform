/**
 * Create a company and its first admin.
 *
 *   npx tsx scripts/create-company.ts \
 *     --slug archie-demo --name "Archie Demo Co" --trade roofing \
 *     --admin-email you@example.com --admin-name "Your Name" \
 *     [--ghl-location <GHL location id>] [--status trial|active]
 *
 * Uses DATABASE_URL. Safe to run twice: an existing slug or email is reported,
 * not duplicated.
 */
import 'dotenv/config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg('slug');
  const name = arg('name');
  const adminEmail = arg('admin-email')?.trim().toLowerCase();
  const adminName = arg('admin-name');
  if (!slug || !name || !adminEmail || !adminName) {
    console.error('Needs --slug, --name, --admin-email and --admin-name.');
    process.exit(1);
  }
  const { db, pool } = await import('../server/db');
  const { companies, teamMembers } = await import('../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../server/tenant/context');
  const { provisionCompany, seedCompany } = await import('../server/seed');
  const { requireAppRole } = await import('./lib/require-app-role');
  try { await requireAppRole(pool); } catch (e) {
    console.error((e as Error).message);
    await pool.end();
    process.exit(1);
  }

  try {
    const existing = await runAsSystem('create-company script: check slug', () =>
      db.select().from(companies).where(eq(companies.slug, slug)));
    // A new company is seeded as it is created (provisionCompany).
    const provisioned = existing[0] ? null : await provisionCompany({
      slug, name,
      trade: arg('trade') ?? 'roofing',
      status: (arg('status') as 'trial' | 'active' | undefined) ?? 'trial',
      ghlLocationId: arg('ghl-location') ?? null,
    });
    const company = existing[0] ?? provisioned!.company;
    console.log(existing[0] ? `Company already exists: ${company.name} (${company.id})` : `Created company: ${company.name} (${company.id})`);
    if (provisioned && !provisioned.seeded) console.error(`Seeding failed (${provisioned.error}); trying again below.`);

    const taken = await runAsSystem('create-company script: check admin email', () =>
      db.select({ companyId: teamMembers.companyId }).from(teamMembers).where(eq(teamMembers.email, adminEmail)));
    if (taken[0] && taken[0].companyId !== company.id) {
      console.error(`${adminEmail} already belongs to another company. One person, one company for now.`);
      process.exit(1);
    }
    await runAsCompany(company.id, async () => {
      if (!taken[0]) {
        await db.insert(teamMembers).values({ name: adminName, email: adminEmail, role: 'admin', canLogin: true, createdBy: 'script:create-company' });
        console.log(`Added admin: ${adminName} <${adminEmail}>`);
      } else {
        console.log(`Admin already on the team: ${adminEmail}`);
      }
      // Idempotent: an existing company is brought up to date, a new one is
      // already seeded and this only confirms it (or retries a failed seed).
      if (!provisioned?.seeded) await seedCompany();
      console.log('Seeded advisors and knowledge base.');
    });
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
