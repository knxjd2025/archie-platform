import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { JobTreadClient } from '../integrations/jobtread';
import { isImage } from '../reports/job-context';
import { logWrite } from '../writes/log';
import { sendFailure } from '../lib/failure';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** Server-side ceiling. The client downscales first, so real uploads are far smaller. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

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

export function registerPhotoRoutes(app: Express) {
  // A client's job photos (newest first) — used by the gallery + report picker.
  app.get('/api/clients/:externalId/photos', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

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
   * uses it to find the final invoice PDF sitting on the job already.
   */
  app.get('/api/clients/:externalId/files', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

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

  // Upload one photo from the field straight onto the JobTread job.
  app.post('/api/clients/:externalId/photos', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

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
}
