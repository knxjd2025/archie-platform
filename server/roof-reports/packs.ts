/**
 * A company's own presentation chapters, read for the page route.
 *
 * A pack is that company's DATA: one row in `presentation_chapter_packs`, found
 * by the company in context (the session's company, or the share link's), never
 * by matching a name, an email domain or a website. The database holds the
 * rest: row level security shows a company only its own row, so another
 * company's pack is simply not there, and a request with no company sees none.
 *
 * What is read is read again before it is shown (`parsePack`): the same checks
 * the loader ran, so a row that is not exactly a pack (an older shape, a hand
 * edit made as the owner) is treated as no pack at all. A read that fails is no
 * pack either, and the page is the base presentation, which promises nothing;
 * the failure is logged by its kind only, never its words.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { presentationChapterPacks } from '../../shared/schema';
import { parsePack, type ChapterPack } from '../lib/roof-reports/presentation-chapters.js';
import { currentCompanyId } from '../tenant/context';

/** A stored value as a pack, or null for anything that is not exactly one. */
export function readStoredPack(raw: unknown): ChapterPack | null {
  const read = parsePack(raw);
  return read.ok ? read.pack : null;
}

/** The pack of the company in context, or null: no company, no row, a row that is not a pack, or a failed read. */
export async function packForCurrentCompany(): Promise<ChapterPack | null> {
  const companyId = currentCompanyId();
  if (!companyId) return null;
  try {
    // Asked for by company as well as filtered by the database, so the query says what it means.
    const [row] = await db.select({ pack: presentationChapterPacks.pack }).from(presentationChapterPacks)
      .where(eq(presentationChapterPacks.companyId, companyId)).limit(1);
    return row ? readStoredPack(row.pack) : null;
  } catch (error) {
    const e = error as { cause?: { code?: unknown }; code?: unknown } | null;
    const code = e?.cause?.code ?? e?.code;
    console.error('[roof-reports] a chapter pack could not be read:', typeof code === 'string' && /^[\w.-]{1,16}$/.test(code) ? code : 'unknown');
    return null;
  }
}
