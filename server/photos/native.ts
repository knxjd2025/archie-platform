/**
 * Photos of a job Archie keeps itself (server/production/native-jobs.ts),
 * kept in Archie's own private photo store (./store.ts) with a row each in
 * job_photos. docs/archie/02-roof-lee-link.md, "Archie's own jobs", Photos.
 *
 * Only the routes in ./routes.ts come here, and only after jobBackendFor has
 * said Archie keeps the job. Nothing here calls JobTread, CompanyCam or any
 * other outside system.
 *
 * Everything here runs as the company (runAsCompany), so a photo or a job of
 * another company is simply not there. A photo is always looked up together
 * with its job's key, and the job itself is looked up as the company before
 * a row is written (a foreign key would skip row level security).
 *
 * The copy that is stored is a JPEG with every metadata block taken out
 * (./jpeg-clean.ts), so no location ever reaches the store. The browser
 * sends one it drew itself; anything else is refused.
 */
import { and, count, desc, eq, lt, or } from 'drizzle-orm';
import { db } from '../db';
import { jobPhotos, leads, type JobPhoto } from '../../shared/schema';
import { atLeast, type TeamRole } from '../../shared/rbac';
import {
  CATEGORY_LABEL, MAX_CAPTION_CHARS, MAX_PHOTO_PAGE, PHASE_LABEL, PHOTO_PAGE_SIZE,
  isPhotoCategory, isPhotoPhase, photoDisplayName, type PhotoCategory, type PhotoPhase,
} from '../../shared/job-photos';
import { boardTz } from '../../shared/schedule-board';
import { logWrite } from '../writes/log';
import { cleanJpeg } from './jpeg-clean';
import { describeStoreError, photoObjectKey, type PhotoStore, type PhotoVariant } from './store';

// What a person is told. Plain words, no codes.
export const PHOTO_STORE_OFF = 'Photo storage isn\'t switched on yet. Please try again later.';
export const PHOTO_NOT_JPEG = 'Photos must be sent as JPEG.';
export const PHOTO_MISSING = 'No photo was received.';
export const PHOTO_UNREADABLE = 'That photo couldn\'t be read. Please take it again.';
export const PHOTO_TOO_LARGE = 'That photo is too large. Please try again.';
export const PHOTO_NOT_SAVED = 'The photo couldn\'t be saved. Please try again.';
export const PICK_PHASE = 'Pick Before, During or After.';
export const PICK_CATEGORY = 'Pick what the photo shows from the list.';
export const CAPTION_TOO_LONG = `A caption can be at most ${MAX_CAPTION_CHARS} characters.`;
export const CAPTION_NOT_TEXT = 'A caption must be text.';
export const EDIT_NOT_ALLOWED = 'Only the person who added this photo, or a manager, can change it.';
export const DELETE_NOT_ALLOWED = 'Only a manager can delete this photo. The person who added it can delete it on the day they added it.';

/** The person asking, as the session has them. */
export interface PhotoUser { email: string; name: string; role: TeamRole }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isPhotoId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The calendar day a moment falls on in a time zone. */
function localDay(d: Date, timeZone: string): string {
  try {
    return d.toLocaleDateString('en-CA', { timeZone });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** May this person change a photo's caption, phase or what it shows? The person who added it, or a manager and up. */
export function mayEditPhoto(user: PhotoUser, photo: Pick<JobPhoto, 'uploadedBy'>): boolean {
  return atLeast(user.role, 'manager') || sameEmail(user.email, photo.uploadedBy);
}

/**
 * May this person delete a photo? A manager and up, always. The person who
 * added it, on the same day (in the company's time zone), so a photo taken by
 * mistake can be taken back but a job's record cannot be emptied later.
 */
export function mayDeletePhoto(user: PhotoUser, photo: Pick<JobPhoto, 'uploadedBy' | 'createdAt'>, now = new Date(), timeZone = boardTz()): boolean {
  if (atLeast(user.role, 'manager')) return true;
  return sameEmail(user.email, photo.uploadedBy) && localDay(photo.createdAt, timeZone) === localDay(now, timeZone);
}

/** One photo as the screens see it: the JobTread list's shape plus what Archie keeps. */
export interface PhotoView {
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
  mayEdit: boolean;
  mayDelete: boolean;
}

export function photoView(row: JobPhoto, user: PhotoUser, now = new Date()): PhotoView {
  return {
    id: row.id,
    name: photoDisplayName(row),
    url: `/api/photos/${row.id}/working`,
    thumbUrl: `/api/photos/${row.id}/thumb`,
    description: row.caption,
    createdAt: row.createdAt.toISOString(),
    phase: isPhotoPhase(row.phase) ? row.phase : null,
    category: isPhotoCategory(row.category) ? row.category : null,
    caption: row.caption,
    takenAt: row.takenAt ? row.takenAt.toISOString() : null,
    width: row.width,
    height: row.height,
    uploadedByName: row.uploadedByName,
    mayEdit: mayEditPhoto(user, row),
    mayDelete: mayDeletePhoto(user, row, now),
  };
}

type Fields = { phase?: PhotoPhase | null; category?: PhotoCategory | null; caption?: string | null };

/**
 * Reads the phase, category and caption a person sent. A field not sent is
 * left out; an empty one clears it. Anything else is refused in plain words.
 */
export function parsePhotoFields(body: Record<string, unknown>): { ok: true; fields: Fields } | { ok: false; error: string } {
  const fields: Fields = {};
  if (body.phase !== undefined) {
    if (body.phase === null || body.phase === '') fields.phase = null;
    else if (isPhotoPhase(body.phase)) fields.phase = body.phase;
    else return { ok: false, error: PICK_PHASE };
  }
  if (body.category !== undefined) {
    if (body.category === null || body.category === '') fields.category = null;
    else if (isPhotoCategory(body.category)) fields.category = body.category;
    else return { ok: false, error: PICK_CATEGORY };
  }
  if (body.caption !== undefined) {
    if (body.caption !== null && typeof body.caption !== 'string') return { ok: false, error: CAPTION_NOT_TEXT };
    const caption = (body.caption ?? '').trim();
    if (caption.length > MAX_CAPTION_CHARS) return { ok: false, error: CAPTION_TOO_LONG };
    fields.caption = caption || null;
  }
  return { ok: true, fields };
}

/**
 * When the photo was taken, as the browser read it from the photo before
 * redrawing it. Optional: a date that does not read as a real one, or one
 * far in the past or the future, is simply not kept.
 */
export function parseTakenAt(v: unknown, now = new Date()): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < Date.UTC(2000, 0, 1) || d.getTime() > now.getTime() + 24 * 3600_000) return null;
  return d;
}

/** Strip an optional data-URL prefix and decode. Null when nothing usable was sent. */
function decode(base64: unknown): Buffer | null {
  if (typeof base64 !== 'string') return null;
  const raw = base64.replace(/^data:[^;]+;base64,/, '').trim();
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  return buf.length ? buf : null;
}

export interface Answer { status: number; body: unknown }

/**
 * Adds one photo to a job Archie keeps. The caller has already checked the
 * person may open the job. The row is written as `pending` first and only
 * marked `ready` once both copies are in the store, so a failure part way
 * leaves a pending row and never a stored copy with no row.
 */
export async function addNativePhoto(args: {
  user: PhotoUser; jobKey: string; body: Record<string, unknown>; store: PhotoStore | null; maxBytes: number;
}): Promise<Answer> {
  const { user, jobKey, body, store, maxBytes } = args;
  if (!store) return { status: 503, body: { error: PHOTO_STORE_OFF } };

  if (String(body.contentType ?? 'image/jpeg').toLowerCase() !== 'image/jpeg') return { status: 400, body: { error: PHOTO_NOT_JPEG } };
  const working = decode(body.base64);
  if (!working) return { status: 400, body: { error: PHOTO_MISSING } };
  const thumb = body.thumbBase64 === undefined || body.thumbBase64 === null || body.thumbBase64 === '' ? null : decode(body.thumbBase64);
  if (body.thumbBase64 && !thumb) return { status: 400, body: { error: PHOTO_UNREADABLE } };
  if (working.length + (thumb?.length ?? 0) > maxBytes) return { status: 413, body: { error: PHOTO_TOO_LARGE } };

  const parsed = parsePhotoFields(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const cleanWorking = cleanJpeg(working);
  if (!cleanWorking.ok) return { status: 400, body: { error: PHOTO_UNREADABLE } };
  const cleanThumb = thumb ? cleanJpeg(thumb) : null;
  if (cleanThumb && !cleanThumb.ok) return { status: 400, body: { error: PHOTO_UNREADABLE } };

  // The job, looked up as the company, right before the row is written.
  const [job] = await db.select({ key: leads.externalId }).from(leads).where(eq(leads.externalId, jobKey));
  if (!job?.key) return { status: 404, body: { error: 'not found' } };

  const [row] = await db.insert(jobPhotos).values({
    jobKey: job.key,
    phase: parsed.fields.phase ?? null,
    category: parsed.fields.category ?? null,
    caption: parsed.fields.caption ?? null,
    source: 'archie_app',
    status: 'pending',
    width: cleanWorking.width,
    height: cleanWorking.height,
    takenAt: parseTakenAt(body.takenAt),
    uploadedBy: user.email,
    uploadedByName: user.name || null,
  }).returning();

  // The keys come from the row: its company and its own id, nothing sent.
  const workingKey = photoObjectKey(row.companyId, row.id, 'working');
  const thumbKey = cleanThumb?.ok ? photoObjectKey(row.companyId, row.id, 'thumb') : null;
  const name = photoDisplayName(row);
  const kb = Math.round(cleanWorking.jpeg.length / 1024);
  try {
    await store.put(workingKey, cleanWorking.jpeg, 'image/jpeg');
    if (thumbKey && cleanThumb?.ok) await store.put(thumbKey, cleanThumb.jpeg, 'image/jpeg');
  } catch (e) {
    await logWrite({
      actor: user.email, system: 'archie', action: 'upload_photo', targetId: jobKey,
      summary: `${name} (${kb} KB) was not saved`, ok: false, error: describeStoreError(e),
    });
    return { status: 502, body: { error: PHOTO_NOT_SAVED } };
  }

  await db.update(jobPhotos).set({ status: 'ready', workingKey, thumbKey, updatedAt: new Date() })
    .where(and(eq(jobPhotos.id, row.id), eq(jobPhotos.jobKey, job.key)));
  await logWrite({
    actor: user.email, system: 'archie', action: 'upload_photo', targetId: jobKey,
    summary: `${name}${row.phase && isPhotoPhase(row.phase) ? ` (${PHASE_LABEL[row.phase]})` : ''}, ${kb} KB`, ok: true, error: null,
  });
  return { status: 200, body: { ok: true, fileId: row.id, name } };
}

/**
 * One page of a job's ready photos, newest first, and how many there are in
 * all. With a phase, only that phase's photos (and that phase's count).
 * `before` is the last photo id of the page already shown.
 */
export async function listNativePhotos(jobKey: string, user: PhotoUser, opts: { before?: unknown; limit?: unknown; phase?: unknown } = {}): Promise<{
  photos: PhotoView[]; totalFiles: number; nextBefore: string | null;
}> {
  const asked = Number(opts.limit);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), MAX_PHOTO_PAGE) : PHOTO_PAGE_SIZE;
  const ready = and(eq(jobPhotos.jobKey, jobKey), eq(jobPhotos.status, 'ready'),
    isPhotoPhase(opts.phase) ? eq(jobPhotos.phase, opts.phase) : undefined);

  let where = ready;
  if (isPhotoId(opts.before)) {
    const [after] = await db.select({ id: jobPhotos.id, createdAt: jobPhotos.createdAt }).from(jobPhotos)
      .where(and(ready, eq(jobPhotos.id, opts.before)));
    if (after) {
      where = and(ready, or(lt(jobPhotos.createdAt, after.createdAt), and(eq(jobPhotos.createdAt, after.createdAt), lt(jobPhotos.id, after.id))));
    }
  }
  const rows = await db.select().from(jobPhotos).where(where).orderBy(desc(jobPhotos.createdAt), desc(jobPhotos.id)).limit(limit + 1);
  const [{ n }] = await db.select({ n: count() }).from(jobPhotos).where(ready);
  const page = rows.slice(0, limit);
  const now = new Date();
  return {
    photos: page.map((r) => photoView(r, user, now)),
    totalFiles: Number(n),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}

/** A ready photo of the current company, or null. */
export async function readyPhoto(id: string): Promise<JobPhoto | null> {
  if (!isPhotoId(id)) return null;
  const [row] = await db.select().from(jobPhotos).where(and(eq(jobPhotos.id, id), eq(jobPhotos.status, 'ready')));
  return row ?? null;
}

/**
 * A ready photo's working copy as bytes, for a letter that carries it
 * (server/insurance-letters/routes.ts). Null when it is not a ready photo of
 * this job, the store has lost it, or it is larger than allowed. Throws when
 * the store cannot be read.
 */
export async function nativePhotoBytes(jobKey: string, photoId: string, store: PhotoStore, maxBytes: number): Promise<{ bytes: Buffer; name: string; caption: string | null } | null> {
  const photo = await readyPhoto(photoId);
  if (!photo || photo.jobKey !== jobKey || !photo.workingKey) return null;
  const object = await store.get(photo.workingKey);
  if (!object) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of object.body) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > maxBytes) { object.body.destroy(); return null; }
    chunks.push(b);
  }
  return { bytes: Buffer.concat(chunks), name: `${photoDisplayName(photo)}.jpg`, caption: photo.caption };
}

/** The stored key for a variant. A photo with no small copy of its own shows its working copy. */
export function keyFor(photo: JobPhoto, variant: PhotoVariant): string | null {
  return variant === 'thumb' ? (photo.thumbKey ?? photo.workingKey) : photo.workingKey;
}

/** Changes a photo's caption, phase or what it shows. The caller has checked the person may open its job. */
export async function editNativePhoto(photo: JobPhoto, user: PhotoUser, body: Record<string, unknown>): Promise<Answer> {
  if (!mayEditPhoto(user, photo)) return { status: 403, body: { error: EDIT_NOT_ALLOWED } };
  const parsed = parsePhotoFields(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const change = parsed.fields;
  if (!Object.keys(change).length) return { status: 200, body: { ok: true, photo: photoView(photo, user) } };

  const [row] = await db.update(jobPhotos).set({ ...change, updatedAt: new Date() })
    .where(and(eq(jobPhotos.id, photo.id), eq(jobPhotos.jobKey, photo.jobKey), eq(jobPhotos.status, 'ready'))).returning();
  if (!row) return { status: 404, body: { error: 'not found' } };
  const said = [
    change.phase !== undefined ? `phase ${change.phase ? PHASE_LABEL[change.phase] : 'cleared'}` : null,
    change.category !== undefined ? `shows ${change.category ? CATEGORY_LABEL[change.category] : 'cleared'}` : null,
    change.caption !== undefined ? (change.caption ? 'caption changed' : 'caption cleared') : null,
  ].filter(Boolean).join(', ');
  await logWrite({
    actor: user.email, system: 'archie', action: 'edit_photo', targetId: photo.jobKey,
    summary: `Photo ${photo.id.slice(0, 8)}: ${said}`, ok: true, error: null,
  });
  return { status: 200, body: { ok: true, photo: photoView(row, user) } };
}

/**
 * Takes a photo off its job: the row is marked deleted, with who and when.
 * The stored copies are kept for now (a later sweep clears them). The caller
 * has checked the person may open its job.
 */
export async function deleteNativePhoto(photo: JobPhoto, user: PhotoUser): Promise<Answer> {
  if (!mayDeletePhoto(user, photo)) return { status: 403, body: { error: DELETE_NOT_ALLOWED } };
  const now = new Date();
  const [row] = await db.update(jobPhotos).set({ status: 'deleted', deletedAt: now, deletedBy: user.email, updatedAt: now })
    .where(and(eq(jobPhotos.id, photo.id), eq(jobPhotos.jobKey, photo.jobKey), eq(jobPhotos.status, 'ready'))).returning({ id: jobPhotos.id });
  if (!row) return { status: 404, body: { error: 'not found' } };
  await logWrite({
    actor: user.email, system: 'archie', action: 'delete_photo', targetId: photo.jobKey,
    summary: `Photo ${photo.id.slice(0, 8)} (${photoDisplayName(photo)}) deleted`, ok: true, error: null,
  });
  return { status: 200, body: { ok: true } };
}
