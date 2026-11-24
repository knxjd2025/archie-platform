/**
 * Load one company's own presentation chapters (operator only).
 *
 *   npx tsx scripts/load-presentation-pack.ts --company <company id> --file <pack.json outside the repo>
 *   npx tsx scripts/load-presentation-pack.ts --company <company id> --file <pack.json outside the repo> --apply
 *
 * Without --apply nothing is written: the pack is checked and what would happen
 * is said. A pack with problems is refused with plain sentences and nothing is
 * written. Uses DATABASE_URL as the app does (user archie_app); the write is
 * done as the system role with a written reason, for the one company named.
 * The pack's words are never printed, only counts and chapter ids.
 * See docs/archie/03-roof-reports.md, "Presentation chapters".
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const { parseLoaderArgs, loadPack } = await import('../server/roof-reports/pack-loader');
  const args = parseLoaderArgs(process.argv.slice(2), path.resolve(__dirname, '..'));
  if (!args.ok) { console.error(args.error); process.exit(1); }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(args.file, 'utf8'));
  } catch {
    console.error('The pack file could not be read as JSON. Check the path and the file.');
    process.exit(1);
  }
  const { pool } = await import('../server/db');
  const { requireAppRole } = await import('./lib/require-app-role');
  try { await requireAppRole(pool); } catch (e) {
    console.error((e as Error).message);
    await pool.end();
    process.exit(1);
  }
  try {
    const result = await loadPack({ companyId: args.companyId, raw, apply: args.apply, by: os.userInfo().username });
    if (!result.ok) {
      console.error('This pack was not loaded. What needs fixing:');
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exitCode = 1;
      return;
    }
    const s = result.summary;
    const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    console.log(`${result.applied ? 'Loaded' : 'Checked (dry run, nothing written)'}: ${n(s.chapters, 'chapter')} (${s.ids.join(', ')}), ${n(s.mustSay, 'must-say phrase')} and ${n(s.mustNotSay, 'must-not-say phrase')}.`);
    console.log(result.applied
      ? (result.replaced ? 'This company\'s earlier pack was replaced.' : 'This company had no pack before.')
      : `Run again with --apply to write it${result.replaced ? ' (it would replace this company\'s earlier pack)' : ''}. Read the rendered presentation for that company before you do.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('The pack could not be loaded.'); void e; process.exit(1); });
