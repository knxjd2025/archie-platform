/**
 * Push the team advisor definitions (server/agents/team-advisors.ts) into the
 * live `agents` table. Run after editing a prompt: `npx tsx scripts/sync-advisors.ts`.
 */
import 'dotenv/config';
import { syncTeamAdvisors, pruneUnavailableToolNotes } from '../server/agents/team-advisors';

syncTeamAdvisors((m) => console.log(m))
  .then(async (r) => {
    const pruned = await pruneUnavailableToolNotes((m) => console.log(m));
    console.log(`done — updated ${r.updated.length}, inserted ${r.inserted.length}, pruned ${pruned.length}`);
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
