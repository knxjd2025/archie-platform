/**
 * What the wizard decides, as plain functions with no screen: the steps, the
 * check each step makes before going on (in the plain sentences a person reads),
 * which picked files become photos and how many fit, and the state of each
 * photo's tile from the moment it is picked. The screens only draw this.
 */
import { MAX_REPORT_PHOTOS, NEEDS_ADDRESS, NEEDS_CITY_STATE, type ReportPhotoCategory } from '../../../shared/roof-reports';
import { LAST_STEP, type DraftPhoto, type WhereDraft, type WizardDraft } from './draft';
import { RR } from './words';

export const STEPS = [
  { key: 'where', label: 'Where' },
  { key: 'photos', label: 'Photos' },
  { key: 'roof', label: 'Roof' },
  { key: 'damage', label: 'Damage' },
] as const;

// ---------------------------------------------------------------- step 1

const ZIP_RE = /^\d{5}(-\d{4})?$/;

/** The sentence to show when the address is not whole, or null when it is. */
export function checkWhere(w: WhereDraft): string | null {
  if (!w.address.trim()) return NEEDS_ADDRESS;
  if (!w.city.trim() || !w.state.trim()) return NEEDS_CITY_STATE;
  if (w.zip.trim() && !ZIP_RE.test(w.zip.trim())) return RR.where.zipBad;
  return null;
}

// ---------------------------------------------------------------- step 2: photos

export type TileState = 'preparing' | 'uploading' | 'done' | 'failed';

/** One photo on the photo step. `preview` exists only while this page is open; it is never kept. */
export interface PhotoTile {
  key: string;
  name: string;
  state: TileState;
  percent: number;
  /** The server's id, once it has the photo. */
  id: string | null;
  category: ReportPhotoCategory | null;
  error: string | null;
  preview?: string | null;
}

const IMAGE_NAME = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i;

const isPicture = (f: { name: string; type: string }): boolean =>
  f.type ? f.type.toLowerCase().startsWith('image/') : IMAGE_NAME.test(f.name);

/** Photos that will count toward the cap: everything but the ones that did not save. */
export const countedPhotos = (tiles: readonly PhotoTile[]): number => tiles.filter((t) => t.state !== 'failed').length;

/**
 * Which of the picked files become photos. Pictures only, and no more than a
 * report holds; the rest are counted so the person is told what was left out.
 */
export function planAdditions<F extends { name: string; type: string }>(counted: number, picked: readonly F[]): { accept: F[]; leftOutNotPictures: number; leftOutFull: number } {
  const pictures = picked.filter(isPicture);
  const room = Math.max(0, MAX_REPORT_PHOTOS - counted);
  return {
    accept: pictures.slice(0, room),
    leftOutNotPictures: picked.length - pictures.length,
    leftOutFull: Math.max(0, pictures.length - room),
  };
}

/** How many photos there are and what still fits, in plain words. */
export function photoCountLine(count: number): string {
  if (count <= 0) return RR.photos.cap;
  if (count >= MAX_REPORT_PHOTOS) return RR.photos.capReached;
  return RR.photos.added(count, MAX_REPORT_PHOTOS - count);
}

/** What was left out of a pick, and why. Empty when nothing was. */
export function leftOutLine(notPictures: number, full: number): string {
  return [notPictures > 0 ? RR.photos.leftOutNotPicture(notPictures) : '', full > 0 ? RR.photos.leftOutFull(full) : ''].filter(Boolean).join(' ');
}

export type PhotoAction =
  | { type: 'add'; tiles: PhotoTile[] }
  | { type: 'progress'; key: string; percent: number }
  | { type: 'done'; key: string; id: string }
  | { type: 'failed'; key: string; error: string }
  | { type: 'retry'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'reset'; tiles: PhotoTile[] };

const inFlight = (t: PhotoTile) => t.state === 'preparing' || t.state === 'uploading';

/** Moves one photo's tile forward. A finished photo never goes back, so a late report cannot undo it. */
export function photosReducer(tiles: PhotoTile[], a: PhotoAction): PhotoTile[] {
  switch (a.type) {
    case 'add': return [...tiles, ...a.tiles];
    case 'reset': return a.tiles;
    case 'remove': return tiles.some((t) => t.key === a.key) ? tiles.filter((t) => t.key !== a.key) : tiles;
    case 'progress': return tiles.map((t) => (t.key === a.key && inFlight(t) ? { ...t, state: 'uploading', percent: Math.max(0, Math.min(99, Math.round(a.percent))) } : t));
    case 'done': return tiles.map((t) => (t.key === a.key && inFlight(t) ? { ...t, state: 'done', percent: 100, id: a.id, error: null } : t));
    case 'failed': return tiles.map((t) => (t.key === a.key && inFlight(t) ? { ...t, state: 'failed', error: a.error } : t));
    case 'retry': return tiles.map((t) => (t.key === a.key && t.state === 'failed' ? { ...t, state: 'preparing', percent: 0, error: null } : t));
  }
}

export const tileLabel = (t: Pick<PhotoTile, 'state' | 'percent'>): string =>
  t.state === 'preparing' ? RR.photos.gettingReady : t.state === 'uploading' ? RR.photos.uploading(t.percent) : t.state === 'done' ? RR.photos.done : RR.photos.failed;

/** How the photos are going, in one plain line. Empty with none. */
export function progressLine(tiles: readonly PhotoTile[]): string {
  if (tiles.length === 0) return '';
  const failed = tiles.filter((t) => t.state === 'failed').length;
  const done = tiles.filter((t) => t.state === 'done').length;
  if (failed > 0 && !tiles.some(inFlight)) return RR.photos.failedLine(failed);
  return RR.photos.progress(done, tiles.length);
}

export const photosInFlight = (tiles: readonly PhotoTile[]): boolean => tiles.some(inFlight);

/** The photos the draft keeps: only those the server has, as its ids. */
export const draftPhotosFromTiles = (tiles: readonly PhotoTile[]): DraftPhoto[] =>
  tiles.filter((t) => t.state === 'done' && t.id).map((t) => ({ id: t.id as string, name: t.name, category: t.category }));

/** Tiles for photos the draft remembers: saved, and shown by name since the browser keeps no picture. */
export const tilesFromDraft = (photos: readonly DraftPhoto[]): PhotoTile[] =>
  photos.map((p) => ({ key: `draft-${p.id}`, name: p.name, state: 'done', percent: 100, id: p.id, category: p.category, error: null, preview: null }));

/** The ids the report is made from: saved photos only, in the order they sit. */
export const photoIdsForReport = (tiles: readonly PhotoTile[]): string[] =>
  tiles.filter((t) => t.state === 'done' && t.id).map((t) => t.id as string);

// ---------------------------------------------------------------- going on

export type Advance = { ok: true; step: number } | { ok: false; error: string };

/** Checks the step the person is on and says which step comes next, or why not yet. */
export function tryAdvance(draft: WizardDraft, tiles: readonly PhotoTile[]): Advance {
  const next = Math.min(LAST_STEP, draft.step + 1);
  if (draft.step === 1) {
    const error = checkWhere(draft.where);
    return error ? { ok: false, error } : { ok: true, step: next };
  }
  if (draft.step === 2) {
    return photosInFlight(tiles) ? { ok: false, error: RR.wizard.photosBusyAdvance } : { ok: true, step: next };
  }
  return { ok: true, step: next };
}
