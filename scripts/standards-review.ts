/**
 * Prints the code / manufacturer citation worksheet as Markdown, for the
 * person verifying them (damage-standards.ts). Run:
 *
 *   npx tsx scripts/standards-review.ts > STANDARDS_REVIEW.md
 *
 * To verify a citation, set its `verifiedOn` in damage-standards.ts; it then
 * prints on every finding that uses it. Nothing here touches a database.
 */
import { standardsReviewSheet, CODE_EDITION } from '../server/lib/reports/damage-standards';

const rows = standardsReviewSheet();
const verified = rows.filter((r) => r.verifiedOn).length;

console.log(`# Standards citation review\n`);
console.log(`Edition drafted against: **${CODE_EDITION}** (2015 IRC base + NC amendments). Confirm the edition in force in Mecklenburg County on the date you verify.\n`);
console.log(`${verified} of ${rows.length} citations verified. A citation prints on customer documents only once \`verifiedOn\` is set in \`server/lib/reports/damage-standards.ts\`.\n`);
console.log('| Status | Citation | What it says | Used by | Reviewer note |');
console.log('|---|---|---|---|---|');
for (const r of rows) {
  const status = r.verifiedOn ? `✅ ${r.verifiedOn}` : '⬜ draft';
  console.log(`| ${status} | \`${r.cite}\` | ${r.title} | ${r.usedBy.join(', ')} | ${r.note ?? ''} |`);
}
