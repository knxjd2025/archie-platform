/**
 * What the wizard decides, as plain functions with no screen: the steps, the
 * check each step makes before going on (in the plain sentences a person reads),
 * which picked files become photos and how many fit, and the state of each
 * photo's tile from the moment it is picked. The screens only draw this.
 */
import { MAX_DAMAGE_COUNT, MAX_REPORT_PHOTOS, NEEDS_ADDRESS, NEEDS_CITY_STATE, ROOF_SQUARES_MAX, type ReportPhotoCategory } from '../../../shared/roof-reports';
import { LAST_STEP, type DamageDraft, type DraftPhoto, type RoofDraft, type WhereDraft, type WizardDraft } from './draft';
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

// ---------------------------------------------------------------- step 3: the roof

export const PITCH_OPTIONS = ['3/12', '4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '12/12'] as const;

export const STORIES_OPTIONS = [
  { value: '1', label: '1 story' },
  { value: '1.5', label: '1.5 stories' },
  { value: '2', label: '2 stories' },
  { value: '2.5', label: '2.5 stories' },
  { value: '3', label: '3 stories' },
] as const;

/** The values are the words the pricing already reads; the labels are what a person sees. */
export const MATERIAL_OPTIONS = [
  { value: 'asphalt_shingle', label: 'Asphalt shingle' },
  { value: 'metal', label: 'Metal' },
  { value: 'tile', label: 'Tile' },
  { value: 'slate', label: 'Slate' },
  { value: 'wood_shake', label: 'Wood shake' },
  { value: 'flat_tpo', label: 'TPO membrane' },
  { value: 'flat_epdm', label: 'EPDM (rubber)' },
  { value: 'flat_membrane', label: 'Flat membrane (other)' },
  { value: 'modified_bitumen', label: 'Modified bitumen' },
  { value: 'other', label: 'Other' },
] as const;

/** A size in squares as a number, or null when it is not one the report can use (more than 0, at most the cap). */
function parseSquares(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= ROOF_SQUARES_MAX ? n : null;
}

/** The sentence to show when the roof's size cannot be right, or null. Every fact may be left out. */
export function checkRoof(r: RoofDraft): string | null {
  return r.squares.trim() !== '' && parseSquares(r.squares) === null ? RR.roof.squaresBad : null;
}

/** "About 2,500 square feet." for a good size, else nothing. */
export function squareFeetLine(squares: string): string {
  const n = parseSquares(squares);
  return n === null ? '' : RR.roof.squareFeet(Math.round(n * 100).toLocaleString('en-US'));
}

/** The roof facts the report is made from, only the ones given; undefined when none were. */
export function toRoofDetails(r: RoofDraft): { squares?: number; pitch?: string; stories?: number; material?: string } | undefined {
  const out: { squares?: number; pitch?: string; stories?: number; material?: string } = {};
  const squares = parseSquares(r.squares);
  if (squares !== null) out.squares = squares;
  if (r.pitch.trim()) out.pitch = r.pitch.trim();
  const stories = Number(r.stories);
  if (r.stories.trim() && Number.isFinite(stories) && stories > 0) out.stories = stories;
  if (r.material.trim()) out.material = r.material.trim();
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- step 4: damaged shingles

export const DAMAGE_ROWS: readonly { field: keyof DamageDraft; label: string; what: string; description: string }[] = [
  { field: 'wind', label: 'Wind damage', what: 'wind damage', description: 'Creased, lifted or missing shingles' },
  { field: 'hail', label: 'Hail damage', what: 'hail damage', description: 'Bruised, cracked or losing granules' },
  { field: 'general', label: 'Other damage', what: 'other damage', description: 'Cracked, curling or worn' },
];

/** A count as a whole number from 0 up to the cap. A blank is none. Null when it is anything else. */
function parseCount(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_DAMAGE_COUNT ? n : null;
}

export function checkDamage(d: DamageDraft): string | null {
  return [d.wind, d.hail, d.general].some((v) => parseCount(v) === null) ? RR.damage.bad : null;
}

/** The counts the report is made from. */
export function toDamageCounts(d: DamageDraft): { windDamaged: number; hailDamaged: number; generalDamaged: number } {
  return { windDamaged: parseCount(d.wind) ?? 0, hailDamaged: parseCount(d.hail) ?? 0, generalDamaged: parseCount(d.general) ?? 0 };
}

/** One count moved up or down, kept between 0 and the cap. Anything that is not a number counts as 0 first. */
export function bumpCount(text: string, by: number): string {
  const n = parseCount(text) ?? 0;
  return String(Math.min(MAX_DAMAGE_COUNT, Math.max(0, n + by)));
}

export function damageTotal(d: DamageDraft): number {
  return (parseCount(d.wind) ?? 0) + (parseCount(d.hail) ?? 0) + (parseCount(d.general) ?? 0);
}

export const totalLine = (n: number): string => (n > 0 ? RR.damage.total(n) : RR.damage.none);

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
  if (draft.step === 3) {
    const error = checkRoof(draft.roof);
    return error ? { ok: false, error } : { ok: true, step: next };
  }
  const error = checkDamage(draft.damage);
  return error ? { ok: false, error } : { ok: true, step: next };
}
