import 'dotenv/config';
import { seedAgents } from '../server/seed';

async function main() {
  await seedAgents();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
