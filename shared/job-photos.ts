/**
 * Photos of a job Archie keeps itself (server/photos/native.ts, the
 * job_photos table): the words a person picks from, shared by the server
 * (which checks them) and the screens (which offer them).
 *
 * The phases are the same three words Roof Lee files its photos under, so a
 * photo moves between the two with its meaning intact.
 */
import type { ChecklistField } from './preconstruction-checklist';

export const PHOTO_PHASES = ['before', 'during', 'after'] as const;
export type PhotoPhase = typeof PHOTO_PHASES[number];

export const PHASE_LABEL: Record<PhotoPhase, string> = {
  before: 'Before',
  during: 'During',
  after: 'After',
};

/**
 * What a photo shows, optional. A fixed list, so the same thing is always
 * called the same thing. `checklist` is a photo taken for the pre-construction
 * checklist or the final walkthrough.
 */
export const PHOTO_CATEGORIES = [
  'roof',
  'damage',
  'flashing',
  'vents',
  'gutters',
  'siding',
  'interior',
  'materials',
  'cleanup',
  'checklist',
  'other',
] as const;
export type PhotoCategory = typeof PHOTO_CATEGORIES[number];

export const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  roof: 'Roof',
  damage: 'Damage',
  flashing: 'Flashing',
  vents: 'Vents',
  gutters: 'Gutters',
  siding: 'Siding',
  interior: 'Inside the home',
  materials: 'Materials',
  cleanup: 'Clean-up',
  checklist: 'Checklist',
  other: 'Other',
};

/** The longest caption kept (the database holds the same limit: job_photos_caption_check). */
export const MAX_CAPTION_CHARS = 500;

/** How many photos one page of a job's photos holds, and the most a caller may ask for. */
export const PHOTO_PAGE_SIZE = 30;
export const MAX_PHOTO_PAGE = 100;

export const isPhotoPhase = (v: unknown): v is PhotoPhase => typeof v === 'string' && (PHOTO_PHASES as readonly string[]).includes(v);
export const isPhotoCategory = (v: unknown): v is PhotoCategory => typeof v === 'string' && (PHOTO_CATEGORIES as readonly string[]).includes(v);

/** The name a photo is shown under: its caption, else what it is ("Before photo", "Job photo"). */
export function photoDisplayName(p: { caption?: string | null; phase?: string | null }): string {
  const caption = (p.caption || '').trim();
  if (caption) return caption.length > 80 ? `${caption.slice(0, 77)}...` : caption;
  return isPhotoPhase(p.phase) ? `${PHASE_LABEL[p.phase]} photo` : 'Job photo';
}

/**
 * Every photo id a checklist's answers name (the pre-construction checklist
 * and the final walkthrough), from its photo fields only, in the order given.
 * A photo answer is a list of `{ fileId, name }`. An entry with no id of its
 * own is given as '' so it can never pass as a saved photo; a photo field
 * that holds no list names nothing.
 *
 * For a job Archie keeps, each of these must be one of the job's own ready
 * photos before the checklist is accepted (server/photos/native.ts
 * allReadyPhotosOfJob).
 */
export function photoAnswerIds(fields: readonly ChecklistField[], answers: Record<string, unknown> | null | undefined): string[] {
  if (!answers || typeof answers !== 'object') return [];
  const ids: string[] = [];
  for (const field of fields) {
    if (field.type !== 'photo') continue;
    const value = answers[field.name];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const id = item && typeof item === 'object' ? (item as { fileId?: unknown }).fileId : undefined;
      ids.push(typeof id === 'string' ? id : '');
    }
  }
  return ids;
}
