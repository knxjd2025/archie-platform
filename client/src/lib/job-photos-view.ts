/**
 * What the photo box on a job's page shows and says for a job Archie keeps
 * itself (components/JobPhotos.tsx). Its photos are kept in Archie's own
 * private store (server/photos/native.ts), so nothing here names JobTread, a
 * CRM or CompanyCam. Every other job's photo box is exactly as before.
 */
import {
  CATEGORY_LABEL, PHASE_LABEL, PHOTO_CATEGORIES, PHOTO_PAGE_SIZE, PHOTO_PHASES,
  type PhotoCategory, type PhotoPhase,
} from '../../../shared/job-photos';

export { CATEGORY_LABEL, PHASE_LABEL, PHOTO_CATEGORIES, PHOTO_PHASES, PHOTO_PAGE_SIZE };
export type { PhotoCategory, PhotoPhase };

/** One photo as GET /api/clients/:key/photos gives it for a job Archie keeps. */
export interface ArchiePhoto {
  id: string;
  name: string;
  url: string;
  thumbUrl: string;
  description: string | null;
  createdAt: string;
  phase: PhotoPhase | null;
  category: PhotoCategory | null;
  caption: string | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  uploadedByName: string | null;
  /** May the person looking change its caption, phase or what it shows? */
  mayEdit: boolean;
  /** May the person looking delete it? */
  mayDelete: boolean;
}

export interface ArchiePhotoPage { photos: ArchiePhoto[]; totalFiles: number; nextBefore: string | null }

export type PhaseFilter = PhotoPhase | 'all';

/** The address of one page of a job's photos. */
export function photoPagePath(externalId: string, filter: PhaseFilter, before?: string | null): string {
  const q = new URLSearchParams({ limit: String(PHOTO_PAGE_SIZE) });
  if (filter !== 'all') q.set('phase', filter);
  if (before) q.set('before', before);
  return `/api/clients/${encodeURIComponent(externalId)}/photos?${q.toString()}`;
}

/** The filter's choices, in order. */
export const PHASE_FILTERS: Array<{ key: PhaseFilter; label: string }> = [
  { key: 'all', label: 'All' },
  ...PHOTO_PHASES.map((p) => ({ key: p as PhaseFilter, label: PHASE_LABEL[p] })),
];

/** The words of the photo box. */
export const PHOTO_WORDS = {
  heading: 'Job photos',
  add: '＋ Add photos',
  phasePrompt: 'These photos are',
  categoryPrompt: 'What they show (optional)',
  categoryNone: 'Not set',
  captionPrompt: 'Caption (optional)',
  captionPlaceholder: 'For example: north slope, by the chimney',
  saving: 'Saving...',
  deleting: 'Deleting...',
  notSaved: 'Didn\'t save',
  showMore: 'Show more',
  loadFailed: 'Couldn\'t load photos.',
  retry: 'Retry',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  close: 'Close',
  deleteConfirm: 'Delete this photo? It comes off the job.',
  saved: 'Photo saved.',
  deleted: 'Photo deleted.',
  empty: 'No photos on this job yet. Add Before, During and After photos from your phone.',
  emptyFiltered: (phase: PhotoPhase) => `No ${PHASE_LABEL[phase]} photos yet.`,
} as const;

/** What one upload says when it ends, for the line under the box. */
export function uploadSummary(saved: number, failed: number): string {
  if (!failed) return `${saved} photo${saved === 1 ? '' : 's'} added to the job.`;
  if (!saved) return `${failed === 1 ? 'The photo' : `All ${failed} photos`} didn't save. Tap one to try again.`;
  return `${saved} added, ${failed} didn't save. Tap one to try again.`;
}

/** The small line under a photo in the large view: what it is, when it was taken, who added it. */
export function photoDetails(p: Pick<ArchiePhoto, 'phase' | 'category' | 'takenAt' | 'createdAt' | 'uploadedByName'>, timeZone?: string): string {
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(timeZone ? { timeZone } : {}) });
  return [
    p.phase ? PHASE_LABEL[p.phase] : null,
    p.category ? CATEGORY_LABEL[p.category] : null,
    p.takenAt ? `Taken ${when(p.takenAt)}` : null,
    `Added ${when(p.createdAt)}${p.uploadedByName ? ` by ${p.uploadedByName}` : ''}`,
  ].filter(Boolean).join(' · ');
}
