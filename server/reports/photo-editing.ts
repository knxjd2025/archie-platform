/**
 * Swap a photo or fix its caption on a finished report.
 *
 * A rep gets to the kitchen table and finds the report leads with a picture of
 * a downspout, or a caption that says "South elevation" over the north slope.
 * Regenerating to fix that would re-analyse every photo and rewrite the whole
 * document — for a caption.
 *
 * What this deliberately does NOT do: change the findings. Swapping the image
 * under an existing analysis would leave damage text describing a photo that is
 * no longer there, which is worse than the wrong photo. A swapped photo keeps
 * its own findings only when the image is unchanged; replacing the image clears
 * them and says so.
 */

import { addedPhotoId } from '../../shared/report-photos';

export interface ReportPhoto {
  id: string;
  url: string;
  caption?: string;
  damages?: any[];
  overallSeverity?: string;
  aiSummary?: string;
  [k: string]: any;
}

export interface PhotoEdit {
  id: string;
  /** New image. Omit to keep the current one. */
  url?: string;
  /** New caption. Empty string clears it; omit to keep. */
  caption?: string;
  /** Drop this photo from the report entirely. */
  remove?: boolean;
}

export const MAX_CAPTION = 300;
export const MAX_ADDED_PHOTOS = 60;

export interface PhotoAdd { url: string; caption?: string }

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Only http(s). A data: or javascript: url in an <img src> on a document we
 * email to customers is not something to accept from a form field.
 */
export function isSafeImageUrl(url: unknown): boolean {
  const s = String(url ?? '').trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ApplyResult {
  photos: ReportPhoto[];
  changed: string[];
  /** Photos whose analysis was dropped because the image was replaced. */
  clearedFindings: string[];
}

export function applyPhotoEdits(photos: ReportPhoto[], edits: PhotoEdit[]): ApplyResult {
  const byId = new Map((edits || []).filter((e) => e?.id).map((e) => [e.id, e]));
  const changed: string[] = [];
  const clearedFindings: string[] = [];
  const out: ReportPhoto[] = [];

  for (const p of photos) {
    const e = byId.get(p.id);
    if (!e) { out.push(p); continue; }

    if (e.remove) { changed.push(`removed ${p.id}`); continue; }

    const next: ReportPhoto = { ...p };

    if (e.url !== undefined && isSafeImageUrl(e.url) && e.url !== p.url) {
      next.url = String(e.url).trim();
      // The findings describe the OLD image. Keeping them would caption a new
      // photo with damage that was never in it.
      if ((p.damages?.length ?? 0) > 0 || p.aiSummary) {
        next.damages = [];
        next.overallSeverity = 'none';
        next.aiSummary = 'Image replaced by a team member — not analysed.';
        clearedFindings.push(next.id);
      }
      changed.push(`swapped image on ${p.id}`);
    }

    if (e.caption !== undefined) {
      const c = clean(e.caption, MAX_CAPTION);
      if (c !== (p.caption ?? '')) {
        next.caption = c || undefined;
        changed.push(`caption on ${p.id}`);
      }
    }

    out.push(next);
  }

  return { photos: out, changed, clearedFindings };
}

/**
 * Add photos from the job's pool. They carry no analysis — a rep chose them
 * for what they show, and the document labels them as such rather than
 * inventing findings for them. Duplicates of a photo already on the report
 * are ignored.
 */
export function applyPhotoAdds(photos: ReportPhoto[], adds: PhotoAdd[] | undefined): { photos: ReportPhoto[]; added: string[] } {
  const added: string[] = [];
  if (!Array.isArray(adds) || !adds.length) return { photos, added };
  const have = new Set(photos.map((p) => p.url));
  const ids = new Set(photos.map((p) => p.id));
  const out = [...photos];
  for (const a of adds.slice(0, MAX_ADDED_PHOTOS)) {
    if (!isSafeImageUrl(a?.url)) continue;
    const url = String(a.url).trim();
    if (have.has(url)) continue;
    const id = addedPhotoId(url);
    if (ids.has(id)) continue;
    const caption = clean(a.caption, MAX_CAPTION);
    out.push({ id, url, ...(caption ? { caption } : {}), damages: [], overallSeverity: 'none', aiSummary: 'Added by a team member — not analysed.' });
    have.add(url); ids.add(id); added.push(id);
  }
  return { photos: out, added };
}

/**
 * Reorder photos: listed ids first, in that order; anything unlisted keeps
 * its relative order after them. Unknown ids are ignored.
 */
export function orderPhotos(photos: ReportPhoto[], order: string[] | undefined): { photos: ReportPhoto[]; changed: boolean } {
  if (!Array.isArray(order) || !order.length) return { photos, changed: false };
  const byId = new Map(photos.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: ReportPhoto[] = [];
  for (const id of order) { const p = byId.get(String(id)); if (p && !seen.has(p.id)) { out.push(p); seen.add(p.id); } }
  for (const p of photos) if (!seen.has(p.id)) out.push(p);
  const changed = out.some((p, i) => p.id !== photos[i]?.id);
  return { photos: out, changed };
}

/** The photo list as the editor shows it. */
export function photosForEditing(data: any): Array<{ id: string; url: string; caption: string; findings: number; analyzed: boolean }> {
  const photos: ReportPhoto[] = data?.damageAnalysis?.photos ?? [];
  return photos.map((p) => ({
    id: p.id,
    url: p.url,
    caption: p.caption ?? '',
    findings: p.damages?.length ?? 0,
    analyzed: !/unable to analyze|not analysed/i.test(String(p.aiSummary || '')),
  }));
}

/** Write the edited photos back into the report data. */
export function withPhotos<T extends Record<string, any>>(data: T, photos: ReportPhoto[]): T {
  return {
    ...data,
    damageAnalysis: { ...(data?.damageAnalysis ?? {}), photos },
  };
}
