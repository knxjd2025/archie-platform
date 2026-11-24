/**
 * Removes stored roof report photo copies that have no row.
 *
 * A copy is left with no row when a removal committed its row and then could
 * not remove a copy (photos.ts notes each one), or when an upload stored its
 * copies and then could not save the row. Nobody can reach such a copy (a photo
 * leaves the store only through a row), but it is private data kept for no
 * reason, so this finds and removes it.
 *
 * Safe by construction:
 *   - a dry run unless told to apply;
 *   - lists only ONE company's own roof report prefix (`c/<company id>/rr/`),
 *     and acts only on a key that has exactly the shape the app builds for that
 *     company, so a job photo or another company's copy is never named;
 *   - a copy younger than the grace (an hour) is left alone: it may be a photo
 *     whose row is being saved right now;
 *   - the row lookup runs as the company, by photo id: a copy with a row, in a
 *     report or waiting, is never touched;
 *   - removing is repeatable, one failure never stops the rest, and each is
 *     noted plainly (the kind of failure, never the error's message).
 * Run by the operator script scripts/sweep-roof-report-photos.ts.
 */
import { inArray } from 'drizzle-orm';
import { db } from '../db';
import { roofReportPhotos } from '../../shared/schema';
import { describeStoreError, type PhotoStore } from '../photos/store';
import { isCompanyId, runAsCompany } from '../tenant/context';
import { logWrite } from '../writes/log';

export const SWEEP_GRACE_MS = 60 * 60 * 1000;
const SWEEP_ACTION = 'sweep_roof_report_photo_copy';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export interface SweepResult {
  /** How many keys the store listed under the company's prefix. */
  listed: number;
  /** The copies that have no row and are old enough to go (removed when `apply`). */
  orphans: string[];
  removed: number;
  failed: number;
}

export interface SweepArgs {
  store: PhotoStore;
  companyId: string;
  apply: boolean;
  /** For tests. */
  now?: number;
}

export async function sweepOrphanCopies(args: SweepArgs): Promise<SweepResult> {
  const { store, companyId, apply } = args;
  if (!isCompanyId(companyId)) throw new Error('That is not a company id.');
  if (!store.list) throw new Error('The photo store cannot list what it holds, so there is nothing to sweep.');
  if (apply && !store.delete) throw new Error('The photo store cannot remove copies, so nothing can be swept.');
  const now = args.now ?? Date.now();
  const prefix = `c/${companyId}/rr/`;
  const own = new RegExp(`^c/${companyId}/rr/(?:pending|${UUID})/(${UUID})/(?:working|thumb)\\.jpg$`);

  const listed = await store.list(prefix);
  const candidates: Array<{ key: string; photoId: string }> = [];
  for (const o of listed) {
    const m = own.exec(o.key);
    if (!m || !o.key.startsWith(prefix)) continue;
    // Unknown age is treated as young: a copy is only removed when it is known to be old.
    if (!o.lastModified || now - o.lastModified.getTime() < SWEEP_GRACE_MS) continue;
    candidates.push({ key: o.key, photoId: m[1].toLowerCase() });
  }

  const ids = [...new Set(candidates.map((c) => c.photoId))];
  const withRow = new Set<string>();
  // One lookup per chunk, as the company, so only its own rows are seen.
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await runAsCompany(companyId, () => db.select({ id: roofReportPhotos.id }).from(roofReportPhotos).where(inArray(roofReportPhotos.id, ids.slice(i, i + 500))));
    for (const r of rows) withRow.add(r.id.toLowerCase());
  }
  const orphans = candidates.filter((c) => !withRow.has(c.photoId));

  let removed = 0;
  let failed = 0;
  if (apply) {
    for (const { key, photoId } of orphans) {
      try {
        await store.delete!(key);
        removed++;
        await runAsCompany(companyId, () => logWrite({ actor: 'system:photo-sweep', system: 'archie', action: SWEEP_ACTION, targetId: photoId, summary: `a stored copy with no photo row was removed (${key.endsWith('/thumb.jpg') ? 'thumbnail' : 'working copy'})`, ok: true, error: null }));
      } catch (e) {
        failed++;
        await runAsCompany(companyId, () => logWrite({ actor: 'system:photo-sweep', system: 'archie', action: SWEEP_ACTION, targetId: photoId, summary: `a stored copy with no photo row could not be removed (${key.endsWith('/thumb.jpg') ? 'thumbnail' : 'working copy'})`, ok: false, error: describeStoreError(e) }));
      }
    }
  }
  return { listed: listed.length, orphans: orphans.map((o) => o.key), removed, failed };
}
