/**
 * Loads one company's presentation chapters. The ONLY code that writes
 * `presentation_chapter_packs`; the operator script (scripts/load-presentation-pack.ts)
 * is a thin shell over it, and the permanent test packs-are-company-data.db.test.ts
 * holds that nothing else does.
 *
 * The app never writes a pack (a trigger refuses archie_app). This writes as the
 * system role, with a written reason, for ONE named company, and:
 *   - is a dry run unless told to apply: it checks everything, says what it
 *     would do, and writes nothing;
 *   - refuses a pack with problems, in plain sentences (`parsePack`: the shape,
 *     plain text, safe ids, whole minutes, only the two placeholders, the pack's
 *     own mustSay and mustNotSay), and writes nothing for it;
 *   - refuses a company that is not there;
 *   - replaces the company's row if it has one (a pack is replaced, never
 *     deleted), so there is at most one row a company.
 * It never prints the pack's words, only counts and chapter ids.
 */
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, presentationChapterPacks } from '../../shared/schema';
import { parsePack } from '../lib/roof-reports/presentation-chapters.js';
import { isCompanyId, runAsSystem } from '../tenant/context';

export interface LoadPackArgs {
  companyId: string;
  /** What was in the file, as parsed JSON (anything: it is checked here). */
  raw: unknown;
  apply: boolean;
  /** The operator's login name. */
  by: string;
}

export type LoadPackResult =
  | { ok: false; problems: string[] }
  | { ok: true; applied: boolean; replaced: boolean; summary: { chapters: number; ids: string[]; mustSay: number; mustNotSay: number } };

/** The reason written for the system role, so a reader of the code or the audit knows why it is being used. */
export const LOAD_PACK_REASON = 'operator: load one company\'s presentation pack';

export async function loadPack(args: LoadPackArgs): Promise<LoadPackResult> {
  if (!isCompanyId(args.companyId)) return { ok: false, problems: ['That is not a company id.'] };
  const read = parsePack(args.raw);
  if (!read.ok) return { ok: false, problems: read.problems };
  const pack = read.pack;
  const by = String(args.by || 'operator').replace(/[^\w.@-]/g, '').slice(0, 80) || 'operator';

  return runAsSystem(LOAD_PACK_REASON, async (): Promise<LoadPackResult> => {
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, args.companyId)).limit(1);
    if (!company) return { ok: false, problems: ['There is no company with that id.'] };
    const [existing] = await db.select({ id: presentationChapterPacks.id }).from(presentationChapterPacks).where(eq(presentationChapterPacks.companyId, args.companyId)).limit(1);
    const summary = { chapters: pack.chapters.length, ids: pack.chapters.map((c) => c.id), mustSay: pack.mustSay.length, mustNotSay: pack.mustNotSay.length };
    if (!args.apply) return { ok: true, applied: false, replaced: Boolean(existing), summary };
    await db.insert(presentationChapterPacks)
      .values({ companyId: args.companyId, pack, loadedBy: by })
      .onConflictDoUpdate({ target: presentationChapterPacks.companyId, set: { pack, loadedBy: by, loadedAt: new Date() } });
    return { ok: true, applied: true, replaced: Boolean(existing), summary };
  });
}

export type LoaderArgs = { ok: true; companyId: string; file: string; apply: boolean } | { ok: false; error: string };

/**
 * The script's arguments: `--company <uuid> --file <path outside the repository> [--apply]`.
 * A file inside the repository is refused however it is written (a pack is a
 * company's words and does not belong in the code's history), and nothing is
 * applied unless `--apply` is there.
 */
export function parseLoaderArgs(argv: string[], repoRoot: string, cwd: string = process.cwd()): LoaderArgs {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i > -1 ? argv[i + 1] : undefined;
  };
  const companyId = value('company');
  const file = value('file');
  if (!companyId || !file) return { ok: false, error: 'Needs --company <company id> and --file <path to the pack file>. Add --apply to write it; without it nothing is written.' };
  if (!isCompanyId(companyId)) return { ok: false, error: 'That is not a company id.' };
  const resolved = path.resolve(cwd, file);
  const root = path.resolve(repoRoot);
  const rel = path.relative(root, resolved);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return { ok: false, error: 'Keep the pack file outside the repository. It is a company\'s own words, not code.' };
  return { ok: true, companyId, file, apply: argv.includes('--apply') };
}
