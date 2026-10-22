/**
 * CompanyCam connection.
 *
 * CompanyCam photos already reach this app indirectly (they sync into JobTread,
 * and the job's files are read from there). What a direct connection adds:
 *   • see a client's CompanyCam project and its photos, including ones JobTread
 *     hasn't synced yet
 *   • push photos the other way — app/JobTread photos into the CompanyCam project
 *   • tag photos
 * Dormant until COMPANYCAM_API_TOKEN is set.
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads, settings } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { CompanyCamClient } from '../integrations/companycam';
import { JobTreadClient } from '../integrations/jobtread';
import { isImage } from '../reports/job-context';
import { logWrite } from '../writes/log';
import { sendFailure } from '../lib/failure';

export function companyCamConfigured(): boolean {
  return !!process.env.COMPANYCAM_API_TOKEN;
}

/** Max photos pushed in one request — each is a separate CompanyCam call. */
export const MAX_PUSH = 25;

/** Ids remembered per job and project; far more photos than any job carries. */
const MAX_REMEMBERED = 2000;

/**
 * Where a job's already-pushed JobTread file ids are kept: a settings row per
 * job and project. Pushing used to send the same first 25 photos every time
 * the button was pressed, so a project collected duplicates of those and the
 * rest of the job's photos never went across.
 */
export const pushedKey = (externalId: string, projectId: string) => `companycam.pushed.${externalId}.${projectId}`;

async function pushedIds(key: string): Promise<Set<string>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  const v = row?.value;
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

async function rememberPushed(key: string, ids: Set<string>): Promise<void> {
  const value = [...ids].slice(-MAX_REMEMBERED);
  await db.insert(settings).values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** The lead's own city/zip, which beat whatever is parsed from the address string. */
const addressHints = (lead: { city?: string | null; zip?: string | null }) => ({ city: lead.city, postalCode: lead.zip });

export function registerCompanyCamRoutes(app: Express) {
  app.get('/api/integrations/companycam/status', requireAuth, async (_req: Request, res: Response) => {
    if (!companyCamConfigured()) return res.json({ configured: false, missing: ['COMPANYCAM_API_TOKEN'] });
    try {
      const health = await new CompanyCamClient().healthCheck();
      res.json({ configured: true, ...health });
    } catch (e: any) {
      res.json({ configured: true, ok: false, error: e.message });
    }
  });

  // A client's CompanyCam project + photos (matched by street address).
  app.get('/api/clients/:externalId/companycam', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      if (!companyCamConfigured()) return res.json({ configured: false, project: null, photos: [] });
      if (!lead.address) return res.json({ configured: true, project: null, photos: [], note: 'This client has no address to match on.' });

      const cc = new CompanyCamClient();
      const project = await cc.findProjectByAddress(lead.address, addressHints(lead));
      if (!project) return res.json({ configured: true, project: null, photos: [] });

      let photos: any[] = [];
      try {
        photos = await cc.getProjectPhotos(String(project.id), { per_page: 50 });
      } catch { /* project exists but photos unavailable — still report the project */ }

      res.json({
        configured: true,
        project: { id: project.id, name: (project as any).name, status: (project as any).status },
        photos: photos.map((p: any) => ({
          id: p.id,
          url: p.uris?.find?.((u: any) => u.type === 'web')?.uri || p.uris?.[0]?.uri || p.uri,
          capturedAt: p.captured_at,
        })).filter((p: any) => p.url),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/companycam', 502); }
  });

  // Push this job's photos from JobTread into the client's CompanyCam project.
  app.post('/api/clients/:externalId/companycam/push', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      if (!companyCamConfigured()) return res.status(503).json({ error: 'CompanyCam is not connected (COMPANYCAM_API_TOKEN).' });
      if (!lead.address) return res.status(400).json({ error: 'This client needs an address to match a CompanyCam project.' });

      const cc = new CompanyCamClient();
      let project = await cc.findProjectByAddress(lead.address, addressHints(lead));

      // Create the project on request rather than silently — pushing photos into
      // a brand-new project is a real change in their account.
      if (!project) {
        if (req.body?.createProject !== true) {
          return res.status(404).json({ error: 'No matching CompanyCam project for this address.', canCreate: true });
        }
        const [street, city, stateZip] = lead.address.split(',').map((s) => s.trim());
        project = await cc.createProject({
          name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.jobName || street,
          address: {
            street_address_1: street,
            city: lead.city || city,
            state: lead.state || (stateZip || '').split(' ')[0],
            postal_code: lead.zip || undefined,
          },
        });
      }

      const { files } = await new JobTreadClient().getJobFiles(req.params.externalId, 60);
      const allImages = files.filter((f) => f.url && isImage(f.type, f.name));
      if (!allImages.length) return res.status(422).json({ error: 'This job has no photos to push.' });

      const key = pushedKey(req.params.externalId, String(project.id));
      const already = await pushedIds(key);
      const images = allImages.filter((f) => !already.has(f.id)).slice(0, MAX_PUSH);
      if (!images.length) {
        return res.json({ ok: true, pushed: 0, attempted: 0, alreadyPushed: already.size, projectId: project.id, failures: [] });
      }

      const tags = Array.isArray(req.body?.tags) ? req.body.tags.filter((t: any) => typeof t === 'string') : undefined;
      let pushed = 0; const failures: string[] = [];
      for (const img of images) {
        try {
          await cc.addPhotoToProject(String(project.id), {
            uri: img.url as string,
            capturedAt: img.createdAt ? new Date(img.createdAt) : undefined,
            tags,
          });
          already.add(img.id);
          pushed++;
        } catch (e: any) {
          failures.push(`${img.name}: ${e?.message || 'failed'}`);
        }
      }

      if (pushed > 0) await rememberPushed(key, already);

      await logWrite({
        actor: user.email, system: 'ghl', action: 'companycam_push', targetId: req.params.externalId,
        summary: `${pushed}/${images.length} photos → CompanyCam project ${project.id}`,
        ok: pushed > 0, error: failures.slice(0, 3).join('; ') || null,
      });

      res.json({
        ok: pushed > 0, pushed, attempted: images.length, remaining: allImages.filter((f) => !already.has(f.id)).length,
        projectId: project.id, failures: failures.slice(0, 5),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/companycam/push', 502); }
  });
}
