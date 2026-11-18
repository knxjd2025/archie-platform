/**
 * Rehearsal step (scripts/rehearse-supabase.sh): through the app's own pool,
 * system work must run as archie_system and everything else as archie_app,
 * seeing no company at all with no context. Uses DATABASE_URL (archie_app).
 */
async function main() {
  const { pool } = await import('../server/db');
  const { runAsSystem } = await import('../server/tenant/context');
  const check = 'select current_user as u, (select count(*) from companies)::int as companies';
  const inside = (await runAsSystem('rehearsal: role check', () => pool.query(check))).rows[0];
  const outside = (await pool.query(check)).rows[0];
  console.log('inside runAsSystem:', inside, ' outside:', outside);
  await pool.end();
  if (inside.u !== 'archie_system' || outside.u !== 'archie_app' || outside.companies !== 0) {
    console.error('FAIL: expected archie_system inside, archie_app outside seeing no companies');
    process.exit(1);
  }
  console.log('ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
