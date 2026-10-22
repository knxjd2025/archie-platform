/**
 * Which of a job's photos get run through damage analysis, and which are shown
 * as evidence without it.
 *
 * A job carries ~100 photos; six of them show the damage. Analysing all of
 * them is slow, costs per image, and dilutes the findings with pictures of a
 * driveway. So the rep picks — and everything they did not pick still appears
 * in the report, because a photo the customer's roof has is evidence whether
 * or not a model looked at it.
 */

/** The most a rep can send for analysis in one report. */
export const ANALYZE_LIMIT = 40;

export interface PhotoLike { url: string; caption?: string }

export function splitPhotosForAnalysis<T extends PhotoLike>(
  all: T[],
  selectedUrls?: string[],
): { analyzed: T[]; appendix: T[] } {
  if (!all.length) return { analyzed: [], appendix: [] };

  // No selection = take the first ANALYZE_LIMIT, so the flow still works for
  // a rep who just hits generate.
  if (!selectedUrls?.length) {
    return { analyzed: all.slice(0, ANALYZE_LIMIT), appendix: all.slice(ANALYZE_LIMIT) };
  }

  const wanted = new Set(selectedUrls);
  const picked: T[] = [];
  const rest: T[] = [];
  for (const p of all) {
    // The cap is enforced here, not just in the UI — a hand-made request
    // must not be able to queue 100 images past the time budget.
    if (wanted.has(p.url) && picked.length < ANALYZE_LIMIT) picked.push(p);
    else rest.push(p);
  }
  // A selection that matched nothing (stale urls) falls back rather than
  // producing a report with no damage assessment at all.
  if (!picked.length) return { analyzed: all.slice(0, ANALYZE_LIMIT), appendix: all.slice(ANALYZE_LIMIT) };
  return { analyzed: picked, appendix: rest };
}

const esc = (s: string) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));

/**
 * The remaining job photos, as a labelled gallery at the end of the report.
 *
 * Explicitly says these were not analysed. A customer seeing 90 photos in a
 * document would reasonably assume each was examined; saying otherwise is the
 * difference between evidence and an implied claim.
 */
export function renderPhotoAppendix(photos: PhotoLike[]): string {
  if (!photos.length) return '';
  const cells = photos.map((p) => `
    <figure style="margin:0">
      <img src="${esc(p.url)}" alt="${esc(p.caption || 'Job photo')}" loading="lazy"
           style="width:100%;height:150px;object-fit:cover;border-radius:8px;display:block;background:#f3f4f6">
      ${p.caption ? `<figcaption style="font-size:11px;color:#6b7280;margin-top:4px">${esc(p.caption)}</figcaption>` : ''}
    </figure>`).join('');
  return `<section style="margin:32px 0 0;padding-top:24px;border-top:1px solid #e5e7eb">
    <h2 style="font-size:20px;color:#0e1f57;margin:0 0 4px">Additional job photos</h2>
    <p style="margin:0 0 14px;color:#6b7280;font-size:13px">
      ${photos.length} further photo${photos.length === 1 ? '' : 's'} from this job, included for the record.
      These were not part of the damage analysis above.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">${cells}</div>
  </section>`;
}
