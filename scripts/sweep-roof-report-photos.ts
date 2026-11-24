/**
 * Removes stored roof report photo copies that have no row (operator only).
 *
 *   npx tsx scripts/sweep-roof-report-photos.ts                       # dry run, every company
 *   npx tsx scripts/sweep-roof-report-photos.ts --company <id>        # dry run, one company
 *   npx tsx scripts/sweep-roof-report-photos.ts --apply               # remove them
 *
 * Without --apply nothing is removed: it only says how many copies it would
 * remove for each company. A copy younger than an hour, one that has a row, and
 * any key that is not that company's own roof report copy are never touched. Uses
 * DATABASE_URL as the app does (user archie_app) and the photo store's settings.
 * Companies are listed as the system role with a written reason; the rows are
 * read as each company. Only counts are printed, never a photo's name or key.
 * See docs/archie/03-roof-reports.md, "Photos".
 */
import 'dotenv/config';

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const at = argv.indexOf('--company');
  const only = at >= 0 ? argv[at + 1] : null;
  const unknown = argv.filter((a, i) => !['--apply', '--company'].includes(a) && argv[i - 1] !== '--company');
  if (unknown.length || (at >= 0 && !only)) { console.error('Use: sweep-roof-report-photos [--company <company id>] [--apply]'); process.exit(1); }

  const { pool, db } = await import('../server/db');
  const { requireAppRole } = await import('./lib/require-app-role');
  try { await requireAppRole(pool); } catch (e) {
    console.error((e as Error).message);
    await pool.end();
    process.exit(1);
  }
  try {
    const { photoStore } = await import('../server/photos/store');
    const store = photoStore();
    if (!store) { console.error('The photo store is not switched on here, so there is nothing to sweep.'); process.exitCode = 1; return; }
    const { companies } = await import('../shared/schema');
    const { isCompanyId, runAsSystem } = await import('../server/tenant/context');
    const { sweepOrphanCopies } = await import('../server/roof-reports/photo-sweep');
    if (only && !isCompanyId(only)) { console.error('That is not a company id.'); process.exitCode = 1; return; }
    const ids = only
      ? [only]
      : (await runAsSystem('operator: list companies to sweep stored roof report photo copies', () => db.select({ id: companies.id }).from(companies))).map((c) => c.id);
    let found = 0; let removed = 0; let failed = 0;
    for (const id of ids) {
      const r = await sweepOrphanCopies({ store, companyId: id, apply });
      found += r.orphans.length; removed += r.removed; failed += r.failed;
      if (r.orphans.length) console.log(`${id}: ${r.orphans.length} stored ${r.orphans.length === 1 ? 'copy' : 'copies'} with no photo${apply ? `, ${r.removed} removed, ${r.failed} could not be removed` : ''}`);
    }
    console.log(apply
      ? `Done. ${found} found, ${removed} removed, ${failed} could not be removed (each is noted; run again to retry).`
      : `Dry run: ${found} stored ${found === 1 ? 'copy' : 'copies'} would be removed. Nothing was changed. Add --apply to remove them.`);
    if (failed) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error('The sweep stopped:', (e as { name?: string })?.name ?? 'Error'); process.exit(1); });
