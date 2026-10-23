/**
 * Push the team advisor definitions (server/agents/team-advisors.ts) into the
 * live `agents` table, for every live company. Run after editing a prompt:
 * `npx tsx scripts/sync-advisors.ts`.
 */
import 'dotenv/config';
import { syncTeamAdvisors, pruneUnavailableToolNotes } from '../server/agents/team-advisors';
import { forEachLiveCompany } from '../server/tenant/companies';

forEachLiveCompany(async () => {
  const r = await syncTeamAdvisors((m) => console.log(m));
  const pruned = await pruneUnavailableToolNotes((m) => console.log(m));
  return `updated ${r.updated.length}, inserted ${r.inserted.length}, pruned ${pruned.length}`;
})
  .then((results) => {
    for (const r of results) console.log(r.companyId, r.ok ? r.value : r.error);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); });
