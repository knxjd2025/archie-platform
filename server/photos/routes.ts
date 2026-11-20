import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads, type Lead } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { JobTreadClient } from '../integrations/jobtread';
import { isImage } from '../reports/job-context';
import { logWrite } from '../writes/log';
import { sendFailure } from '../lib/failure';
import { getCurrentCompany } from '../tenant/companies';
import { isNativeJobId, jobBackendFor } from '../production/native-jobs';
import { addNativePhoto, deleteNativePhoto, editNativePhoto, keyFor, listNativePhotos, readyPhoto, MAX_PHOTO_BYTES, PHOTO_STORE_OFF } from './native';
import { photoStore } from './store';
import { crewJobFor } from '../crews/access';
import { MAX_PHOTO_PAGE } from '../../shared/job-photos';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** Server-side ceiling. The client downscales first, so real uploads are far smaller. */
export const MAX_UPLOAD_BYTES = MAX_PHOTO_BYTES;

/** Strip an optional data-URL prefix and decode. Returns null if it isn't valid base64. */
export function decodeImagePayload(base64: string): Buffer | null {
  const raw = String(base64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/** Does Archie keep this job itself (server/production/native-jobs.ts jobBackendFor, the one seam)? */
async function keptInArchie(lead: Pick<Lead, 'externalId'>): Promise<boolean> {
  return jobBackendFor(lead, await getCurrentCompany()) === 'archie';
}

/**
 * May this person open the photos of a job Archie keeps? Anyone who may open
 * the job (ownsLead), apart from a crew: crews get no job access through
 * ownsLead, and nothing here widens it.
 */
async function mayOpenArchieJob(user: SessionUser, lead: Pick<Lead, 'externalId'>): Promise<boolean> {
  if (user.role === 'production') return false;
  return ownsLead(user, lead.externalId);
}

/**
 * May this person see one photo of a job Archie keeps? As above, or a crew
 * member whose crew the job is booked for, asked through the crew check
 * (server/crews/access.ts crewJobFor), never through ownsLead. Used only for
 * one photo at a time: a crew's photo list comes from the crew's own routes.
 */
async function maySeeArchiePhoto(user: SessionUser, lead: Pick<Lead, 'externalId'>): Promise<boolean> {
  if (user.role === 'production') return !!lead.externalId && !!(await crewJobFor(user, lead.externalId));
  return mayOpenArchieJob(user, lead);
}

/**
 * A job's photos and files. For a job kept in JobTread they live in JobTread,
 * exactly as before. For a job Archie keeps (a company Roof Lee made) they
 * live in Archie's own private photo store (./native.ts, ./store.ts), and
 * JobTread is never asked about it.
 */
export function registerPhotoRoutes(app: Express) {
  // A client's job photos (newest first) — used by the gallery + report picker.
  app.get('/api/clients/:externalId/photos', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      if (await keptInArchie(lead)) {
        if (!(await mayOpenArchieJob(user, lead))) return res.status(404).json({ error: 'not found' });
        return res.json(await listNativePhotos(lead.externalId!, user, { before: req.query.before, limit: req.query.limit, phase: req.query.phase }));
      }

      const { files, total } = await new JobTreadClient().getJobFiles(req.params.externalId, 60, 1200);
      const photos = files
        .filter((f) => f.url && isImage(f.type, f.name))
        .map((f) => ({ id: f.id, name: f.name, url: f.url, description: f.description, createdAt: f.createdAt }));
      res.json({ photos, totalFiles: total });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/photos');
    }
  });

  /**
   * Everything attached to the job, photos and documents alike, with each one
   * flagged so a caller can pick the kind it wants. The depreciation letter
   * uses it to find the final invoice PDF sitting on the job already. A job
   * Archie keeps has photos only (documents come later).
   */
  app.get('/api/clients/:externalId/files', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      if (await keptInArchie(lead)) {
        if (!(await mayOpenArchieJob(user, lead))) return res.status(404).json({ error: 'not found' });
        const { photos, totalFiles } = await listNativePhotos(lead.externalId!, user, { limit: MAX_PHOTO_PAGE });
        return res.json({
          files: photos.map((p) => ({
            id: p.id, name: p.name, type: 'image/jpeg', size: null, folder: null,
            description: p.description, createdAt: p.createdAt, isImage: true, url: p.url, thumbUrl: p.thumbUrl,
          })),
          totalFiles,
        });
      }

      const { files, total } = await new JobTreadClient().getJobFiles(req.params.externalId, 100, 1200);
      res.json({
        files: files.filter((f) => f.url).map((f) => ({
          id: f.id, name: f.name, type: f.type, size: f.size, folder: f.folder,
          description: f.description, createdAt: f.createdAt, isImage: isImage(f.type, f.name),
        })),
        totalFiles: total,
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/files');
    }
  });

  // Upload one photo from the field: onto the JobTread job, or into Archie's own store for a job Archie keeps.
  app.post('/api/clients/:externalId/photos', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      if (await keptInArchie(lead)) {
        if (!(await mayOpenArchieJob(user, lead))) return res.status(404).json({ error: 'not found' });
        const r = await addNativePhoto({ user, jobKey: lead.externalId!, body: req.body ?? {}, store: photoStore(), maxBytes: MAX_UPLOAD_BYTES });
        return res.status(r.status).json(r.body);
      }

      const contentType = String(req.body?.contentType || 'image/jpeg').toLowerCase();
      if (!ALLOWED_TYPES.includes(contentType)) {
        return res.status(400).json({ error: 'Only JPEG, PNG, WEBP or HEIC photos can be uploaded.' });
      }
      const data = decodeImagePayload(req.body?.base64);
      if (!data) return res.status(400).json({ error: 'No image data received.' });
      if (data.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'That photo is too large — try again (photos are resized before upload).' });
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const name = String(req.body?.name || '').trim() || `Archie ${stamp}.jpg`;
      const description = String(req.body?.description || '').trim() || `Uploaded from the Team App by ${user.name}`;

      const r = await new JobTreadClient().uploadJobFile(req.params.externalId, {
        name, contentType, data, description,
      });

      await logWrite({
        actor: user.email, system: 'jobtread', action: 'upload_photo', targetId: req.params.externalId,
        summary: `${name} (${Math.round(data.length / 1024)} KB)`, ok: r.ok, error: r.error || null,
      });

      if (!r.ok) return res.status(502).json({ error: r.error || 'Upload failed' });
      res.json({ ok: true, fileId: r.fileId, name });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/photos');
    }
  });

  // ---- Photos of a job Archie keeps, one at a time (./native.ts) ----------------

  /**
   * The photo and its job, for this person, or null (answered 404): not a
   * ready photo of this company, not a job Archie keeps, or a job this
   * person may not open. Every one looks the same from outside.
   */
  async function visiblePhoto(req: Request) {
    const user = req.session.user! as SessionUser;
    const photo = await readyPhoto(req.params.id);
    if (!photo || !isNativeJobId(photo.jobKey)) return null;
    const [lead] = await db.select().from(leads).where(eq(leads.externalId, photo.jobKey));
    if (!lead || !(await keptInArchie(lead)) || !(await maySeeArchiePhoto(user, lead))) return null;
    return { user, photo };
  }

  /**
   * A photo's copy, streamed from the private store through this route. The
   * store has no public address and this never redirects to one.
   */
  app.get('/api/photos/:id/:variant', requireAuth, async (req: Request, res: Response) => {
    try {
      const variant = req.params.variant;
      if (variant !== 'working' && variant !== 'thumb') return res.status(404).json({ error: 'not found' });
      const seen = await visiblePhoto(req);
      if (!seen) return res.status(404).json({ error: 'not found' });
      const store = photoStore();
      if (!store) return res.status(503).json({ error: PHOTO_STORE_OFF });
      const key = keyFor(seen.photo, variant);
      const object = key ? await store.get(key) : null;
      if (!object) return res.status(404).json({ error: 'not found' });

      res.status(200);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (object.length !== null) res.setHeader('Content-Length', String(object.length));
      object.body.on('error', () => res.destroy());
      object.body.pipe(res);
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/photos/:id/:variant');
    }
  });

  // Change a photo's caption, phase or what it shows: the person who added it, or a manager.
  app.patch('/api/photos/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const seen = await visiblePhoto(req);
      if (!seen) return res.status(404).json({ error: 'not found' });
      const r = await editNativePhoto(seen.photo, seen.user, req.body ?? {});
      return res.status(r.status).json(r.body);
    } catch (error: any) {
      return sendFailure(res, error, 'PATCH /api/photos/:id');
    }
  });

  // Take a photo off its job: the person who added it on the same day, or a manager.
  app.delete('/api/photos/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const seen = await visiblePhoto(req);
      if (!seen) return res.status(404).json({ error: 'not found' });
      const r = await deleteNativePhoto(seen.photo, seen.user);
      return res.status(r.status).json(r.body);
    } catch (error: any) {
      return sendFailure(res, error, 'DELETE /api/photos/:id');
    }
  });
}
