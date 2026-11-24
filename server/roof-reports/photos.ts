/**
 * Photos of a roof report, kept private (Task B5).
 *
 * They live in Archie's own private photo store (server/photos/store.ts)
 * under `c/<company>/rr/...`, never at a public address. What is stored is a
 * JPEG with every metadata block taken out (server/photos/jpeg-clean.ts), so
 * no location ever reaches the store. A photo leaves the store only two ways:
 * through the signed-in route here, which checks the person may see the
 * report first, or through a short signed link (./photo-links.ts) that the
 * html route makes after the same check.
 *
 * A photo belongs to one report of one company. It is uploaded first (no
 * report yet, `report_id` null) and claimed by the report its maker starts: a
 * photo can only be claimed by the person who uploaded it, only once, and a
 * claim naming any other id (another person's, another company's, one already
 * in a report, one that does not exist) quietly takes nothing, so no answer
 * ever confirms such an id exists. Everything runs as the company, so another
 * company's photo is simply not there.
 *
 * The thumbnail is a real small copy (./thumbnail.ts: longest side 480 px, a
 * fresh JPEG made from the cleaned copy, so no location data either). When a
 * picture cannot be made small (a file that cleans but does not decode), the
 * cleaned copy itself is kept as the thumbnail, as it always was.
 */
import { randomUUID } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { and, asc, count, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { roofReportPhotos, roofReports, type RoofReportPhoto } from '../../shared/schema';
import {
  MAX_WAITING_PHOTOS, NOT_FOUND, PHOTO_IN_REPORT, PHOTO_NOT_REMOVED, PICK_PHOTO_KIND, REPORT_PHOTO_CATEGORIES, TOO_MANY_WAITING,
  type ReportPhotoCategory,
} from '../../shared/roof-reports';
import { teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { requireAuth } from '../auth/middleware';
import { sendFailure } from '../lib/failure';
import { cleanJpeg } from '../photos/jpeg-clean';
import {
  MAX_PHOTO_BYTES, PHOTO_MISSING, PHOTO_NOT_JPEG, PHOTO_NOT_SAVED, PHOTO_STORE_OFF, PHOTO_TOO_LARGE, PHOTO_UNREADABLE,
} from '../photos/native';
import { describeStoreError, photoStore, roofReportPhotoKey, type PhotoStore, type PhotoVariant } from '../photos/store';
import { currentCompanyId, runAsCompany } from '../tenant/context';
import { logWrite } from '../writes/log';
import { decisionFor, requireRoofReportUser, roofReportFor, roofReportUser } from './access';
import { verifyPhotoLink } from './photo-links';
import { makeThumbnail } from './thumbnail';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const isCategory = (v: unknown): v is ReportPhotoCategory => (REPORT_PHOTO_CATEGORIES as readonly string[]).includes(v as string);

export interface Answer { status: number; body: unknown }

/**
 * Adds one uploaded photo for the person. The bytes are checked by what they
 * are: a JPEG (SVG, PNG, HEIC, text and the rest are refused), no larger than
 * the cap, and one the cleaner can walk to its end. At most MAX_WAITING_PHOTOS
 * photos may wait unused per person per day.
 */
export async function addReportPhoto(user: SessionUser, bytes: Buffer, category: unknown, store: PhotoStore | null): Promise<Answer> {
  if (!store) return { status: 503, body: { error: PHOTO_STORE_OFF } };
  if (decisionFor(user.role, 'make') === 'no') return { status: 404, body: { error: NOT_FOUND } };
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { status: 400, body: { error: PHOTO_MISSING } };
  if (bytes.length > MAX_PHOTO_BYTES) return { status: 413, body: { error: PHOTO_TOO_LARGE } };
  // A JPEG starts FF D8 FF. Whatever the request called it, nothing else is taken.
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return { status: 400, body: { error: PHOTO_NOT_JPEG } };
  let kind: ReportPhotoCategory | null = null;
  if (category !== undefined && category !== null && category !== '') {
    if (!isCategory(category)) return { status: 400, body: { error: PICK_PHOTO_KIND } };
    kind = category;
  }
  const clean = cleanJpeg(bytes);
  if (!clean.ok) return { status: 400, body: { error: PHOTO_UNREADABLE } };

  const memberId = await teamMemberIdByEmail(user.email);
  if (memberId === null) return { status: 404, body: { error: NOT_FOUND } };
  const since = new Date(Date.now() - 24 * 3600_000);
  const [{ n }] = await db.select({ n: count() }).from(roofReportPhotos)
    .where(and(isNull(roofReportPhotos.reportId), eq(roofReportPhotos.uploadedByMemberId, memberId), gte(roofReportPhotos.createdAt, since)));
  if (Number(n) >= MAX_WAITING_PHOTOS) return { status: 429, body: { error: TOO_MANY_WAITING } };

  const companyId = currentCompanyId();
  if (!companyId) return { status: 404, body: { error: NOT_FOUND } };
  const id = randomUUID();
  const workingKey = roofReportPhotoKey(companyId, 'pending', id, 'working');
  const thumbKey = roofReportPhotoKey(companyId, 'pending', id, 'thumb');
  // Both copies go in first, then the row: a row always has its copies behind it.
  try {
    await store.put(workingKey, clean.jpeg, 'image/jpeg');
    await store.put(thumbKey, makeThumbnail(clean.jpeg) ?? clean.jpeg, 'image/jpeg');
  } catch (e) {
    await logWrite({ actor: user.email, system: 'archie', action: 'upload_roof_report_photo', targetId: id, summary: 'a report photo was not saved', ok: false, error: describeStoreError(e) });
    return { status: 502, body: { error: PHOTO_NOT_SAVED } };
  }
  await db.insert(roofReportPhotos).values({ id, uploadedByMemberId: memberId, category: kind, workingKey, thumbKey });
  await logWrite({ actor: user.email, system: 'archie', action: 'upload_roof_report_photo', targetId: id, summary: `report photo, ${Math.round(clean.jpeg.length / 1024)} KB`, ok: true, error: null });
  return { status: 200, body: { id } };
}

class PhotoGone extends Error {}

/**
 * Takes back a photo that was uploaded and never put in a report: its row and
 * both stored copies. Reports and their photos are archived, never deleted, so
 * a photo that is already in a report is refused with a plain sentence.
 *
 * Who: the person who uploaded it, or a role that sees every report. Anyone
 * else, another company's person and a photo that is not there all get the same
 * "not found". The row goes first, inside a transaction that also removes the
 * copies: if the store cannot remove them the row comes back and the person
 * can try again, and a claim racing this finds the row locked and then gone.
 * Removing the copies is safe to repeat.
 */
export async function removeReportPhoto(user: SessionUser, photoId: string, store: PhotoStore | null): Promise<Answer> {
  if (!isId(photoId) || decisionFor(user.role, 'remove_photo') === 'no') return { status: 404, body: { error: NOT_FOUND } };
  const memberId = await teamMemberIdByEmail(user.email);
  if (memberId === null) return { status: 404, body: { error: NOT_FOUND } };
  const [photo] = await db.select().from(roofReportPhotos).where(eq(roofReportPhotos.id, photoId)).limit(1);
  if (!photo) return { status: 404, body: { error: NOT_FOUND } };
  if (decisionFor(user.role, 'remove_photo') !== 'all' && photo.uploadedByMemberId !== memberId) return { status: 404, body: { error: NOT_FOUND } };
  if (photo.reportId !== null) return { status: 409, body: { error: PHOTO_IN_REPORT } };
  if (!store) return { status: 503, body: { error: PHOTO_STORE_OFF } };
  const remove = store.delete?.bind(store);
  if (!remove) return { status: 502, body: { error: PHOTO_NOT_REMOVED } };
  try {
    await db.transaction(async (tx) => {
      const gone = await tx.delete(roofReportPhotos).where(and(eq(roofReportPhotos.id, photoId), isNull(roofReportPhotos.reportId)))
        .returning({ workingKey: roofReportPhotos.workingKey, thumbKey: roofReportPhotos.thumbKey });
      if (!gone.length) throw new PhotoGone();
      await remove(gone[0].workingKey);
      await remove(gone[0].thumbKey);
    });
  } catch (e) {
    if (e instanceof PhotoGone) {
      // Taken into a report a moment ago, or already removed.
      const [now] = await db.select({ reportId: roofReportPhotos.reportId }).from(roofReportPhotos).where(eq(roofReportPhotos.id, photoId)).limit(1);
      return now ? { status: 409, body: { error: PHOTO_IN_REPORT } } : { status: 404, body: { error: NOT_FOUND } };
    }
    await logWrite({ actor: user.email, system: 'archie', action: 'remove_roof_report_photo', targetId: photoId, summary: 'a report photo was not removed', ok: false, error: describeStoreError(e) });
    return { status: 502, body: { error: PHOTO_NOT_REMOVED } };
  }
  await logWrite({ actor: user.email, system: 'archie', action: 'remove_roof_report_photo', targetId: photoId, summary: 'an unused report photo was removed', ok: true, error: null });
  return { status: 200, body: { id: photoId, removed: true } };
}

/**
 * Puts the photos the person uploaded, and has not used, into a report, in the
 * order asked for. Returns the ids that went in. Any other id is left out
 * without a word: not theirs, not waiting, not in this company, not an id.
 * One statement per photo, so two requests cannot both take the same photo.
 */
export async function claimPhotos(user: SessionUser, reportId: string, photoIds: readonly string[]): Promise<string[]> {
  if (!isId(reportId)) return [];
  // The report must be one of this company's own that this person may see. The
  // photo table has no foreign key to it (that would skip row level security),
  // so this lookup, as the company, is what stops a photo being put in another
  // company's report by sending its id.
  if (!(await roofReportFor(user, reportId))) return [];
  const memberId = await teamMemberIdByEmail(user.email);
  if (memberId === null) return [];
  const claimed: string[] = [];
  const seen = new Set<string>();
  for (const id of photoIds) {
    if (!isId(id) || seen.has(id)) continue;
    seen.add(id);
    const taken = await db.update(roofReportPhotos).set({ reportId, position: claimed.length })
      .where(and(eq(roofReportPhotos.id, id), isNull(roofReportPhotos.reportId), eq(roofReportPhotos.uploadedByMemberId, memberId)))
      .returning({ id: roofReportPhotos.id });
    if (taken.length) claimed.push(id);
  }
  return claimed;
}

/** The photos of one report, in order. Runs as the company, so only its own. */
export async function photosOfReport(reportId: string): Promise<RoofReportPhoto[]> {
  if (!isId(reportId)) return [];
  return db.select().from(roofReportPhotos).where(eq(roofReportPhotos.reportId, reportId))
    .orderBy(asc(roofReportPhotos.position), asc(roofReportPhotos.createdAt));
}

/** The photos named, when they are this report's own: for the generation, which must never read one that is not. */
export async function photosNamedOfReport(reportId: string, ids: readonly string[]): Promise<RoofReportPhoto[]> {
  const wanted = [...new Set(ids.filter(isId))];
  if (!isId(reportId) || !wanted.length) return [];
  return db.select().from(roofReportPhotos).where(and(eq(roofReportPhotos.reportId, reportId), inArray(roofReportPhotos.id, wanted)))
    .orderBy(asc(roofReportPhotos.position));
}

/** One stored copy as bytes, or null when the store has lost it or it is larger than allowed. */
async function readCopy(store: PhotoStore, key: string): Promise<Buffer | null> {
  const object = await store.get(key);
  if (!object) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of object.body) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > MAX_PHOTO_BYTES) { object.body.destroy(); return null; }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** One copy of a photo, as bytes. Null when the photo is not this report's own, has no copy in the store, or is too large to hand on. */
export async function reportPhotoBytes(reportId: string, photoId: string, variant: PhotoVariant, store: PhotoStore | null = photoStore()): Promise<Buffer | null> {
  if (!store || !isId(reportId) || !isId(photoId) || (variant !== 'working' && variant !== 'thumb')) return null;
  const [photo] = await db.select().from(roofReportPhotos).where(and(eq(roofReportPhotos.id, photoId), eq(roofReportPhotos.reportId, reportId))).limit(1);
  if (!photo) return null;
  return readCopy(store, variant === 'thumb' ? photo.thumbKey : photo.workingKey);
}

/** The working copy of one of this report's photos with what it was said to show, for the generation. Null for any other photo. */
export async function loadReportPhoto(reportId: string, photoId: string, store: PhotoStore | null = photoStore()): Promise<{ bytes: Buffer; category: string | null } | null> {
  if (!store || !isId(reportId) || !isId(photoId)) return null;
  const [photo] = await db.select().from(roofReportPhotos).where(and(eq(roofReportPhotos.id, photoId), eq(roofReportPhotos.reportId, reportId))).limit(1);
  if (!photo) return null;
  const bytes = await readCopy(store, photo.workingKey);
  return bytes ? { bytes, category: photo.category } : null;
}

function sendPhoto(res: Response, bytes: Buffer): void {
  res.status(200)
    .set('Content-Type', 'image/jpeg')
    .set('Content-Length', String(bytes.length))
    .set('X-Content-Type-Options', 'nosniff')
    // A photo link's token is in its address: never pass that address on as a referrer.
    .set('Referrer-Policy', 'no-referrer')
    // Private: a signed-in person's own copy, kept by their browser only.
    .set('Cache-Control', 'private, max-age=300')
    .end(bytes);
}
const notFound = (res: Response) => res.status(404).json({ error: NOT_FOUND });

/** Reads the raw bytes of an upload. Too large and unreadable bodies get a plain sentence, never the parser's own words. */
const rawBody = express.raw({ type: () => true, limit: MAX_PHOTO_BYTES });
function readUpload(req: Request, res: Response, next: NextFunction): void {
  rawBody(req, res, (err?: unknown) => {
    if (!err) return next();
    const status = (err as { status?: number })?.status === 413 ? 413 : 400;
    res.status(status).json({ error: status === 413 ? PHOTO_TOO_LARGE : PHOTO_UNREADABLE });
  });
}

/**
 * The photo routes, in two parts so the caller controls the order around the
 * sign-in check:
 *
 *   linkedPhotoRoute  GET /linked-photo/:token  a short signed link; no session; the signature IS the check
 *   authedPhotoRoutes (after the sign-in and role check)
 *                     POST /photos                         a raw JPEG body, ?category=
 *                     DELETE /photos/:photoId              takes back a photo not yet in a report
 *                     GET  /:id/photos/:photoId/:variant   through the report's own access rule
 */
export function linkedPhotoRoute(router: Router): void {
  router.get('/linked-photo/:token', async (req, res) => {
    try {
      const link = verifyPhotoLink(req.params.token);
      if (!link) return notFound(res);
      const bytes = await runAsCompany(link.companyId, async () => {
        // An archived report's links stop working, as its share link does.
        const [report] = await db.select({ status: roofReports.status }).from(roofReports).where(eq(roofReports.id, link.reportId)).limit(1);
        if (!report || report.status === 'archived') return null;
        return reportPhotoBytes(link.reportId, link.photoId, link.variant);
      }, { loadProfile: false });
      if (!bytes) return notFound(res);
      sendPhoto(res, bytes);
    } catch (error) {
      sendFailure(res, error, 'roof reports: GET linked-photo');
    }
  });
}

export function authedPhotoRoutes(router: Router): void {
  router.post('/photos', readUpload, async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const r = await addReportPhoto(user, bytes, category, photoStore());
      res.status(r.status).json(r.body);
    } catch (error) {
      sendFailure(res, error, 'roof reports: POST photos');
    }
  });

  router.delete('/photos/:photoId', async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const r = await removeReportPhoto(user, req.params.photoId, photoStore());
      res.status(r.status).json(r.body);
    } catch (error) {
      sendFailure(res, error, 'roof reports: DELETE photo');
    }
  });

  router.get('/:id/photos/:photoId/:variant', async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const { id, photoId, variant } = req.params;
      if (variant !== 'working' && variant !== 'thumb') return notFound(res);
      if (!(await roofReportFor(user, id))) return notFound(res);
      const store = photoStore();
      if (!store) return res.status(503).json({ error: PHOTO_STORE_OFF });
      const bytes = await reportPhotoBytes(id, photoId, variant, store);
      if (!bytes) return notFound(res);
      sendPhoto(res, bytes);
    } catch (error) {
      sendFailure(res, error, 'roof reports: GET photo');
    }
  });
}

/** The whole photo surface as one router (the switch is the caller's). Used by the photo tests; the app mounts the two parts itself. */
export function photoRouter(): Router {
  const router = Router();
  linkedPhotoRoute(router);
  router.use(requireAuth, requireRoofReportUser);
  authedPhotoRoutes(router);
  return router;
}
