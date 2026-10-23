import 'dotenv/config';
import { seedAgents } from '../server/seed';
import { forEachLiveCompany } from '../server/tenant/companies';

/** Seed the default agents for every live company, as that company. */
async function main() {
  const results = await forEachLiveCompany(() => seedAgents());
  for (const r of results) if (!r.ok) console.error(r.companyId, r.error);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
