/**
 * Admin corrections to a client's account from the client page — customer
 * name, job name, address, project manager and the insurance claim — at any
 * stage. Written to JobTread (the source of truth) and mirrored onto the local
 * lead so the page reflects it before the next sync.
 */
import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads } from '../../shared/schema';
import { requireAuth, requireRole } from '../auth/middleware';
import { JobTreadClient } from '../integrations/jobtread';
import { logWrite } from '../writes/log';
import { sendFailure } from '../lib/failure';
import { parseAddress } from '../sync/leads-sync';
import { ACCOUNT_JOB_FIELDS, jobFieldWrites, parseAccountEdit, type AccountEdit } from '../../shared/client-account';

/** The local lead columns an account edit changes. */
export function leadMirror(edit: AccountEdit): Partial<typeof leads.$inferInsert> {
  const set: Partial<typeof leads.$inferInsert> = {};
  if (edit.customer !== undefined) set.firstName = edit.customer;
  if (edit.jobName !== undefined) set.jobName = edit.jobName;
  if (edit.address !== undefined) {
    const a = parseAddress(edit.address);
    Object.assign(set, { address: a.address, city: a.city, state: a.state, zip: a.zip });
  }
  const f = edit.fields || {};
  if (f.projectManager !== undefined) set.projectManager = (f.projectManager as string | null) ?? null;
  if (f.isClaim !== undefined) set.insuranceClaim = f.isClaim === true;
  return set;
}

export function registerClientAccountRoutes(app: Express) {
  /** The editable job fields, with JobTread's dropdown choices where it has them. */
  app.get('/api/jobtread/account-fields', requireAuth, requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const defs = await new JobTreadClient().getJobCustomFieldDefs().catch(() => []);
      const fields = ACCOUNT_JOB_FIELDS.map((f) => ({
        ...f,
        options: defs.find((d) => d.name.toLowerCase() === f.jtName.toLowerCase())?.options ?? [],
      }));
      res.json({ fields });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/jobtread/account-fields');
    }
  });

  app.patch('/api/clients/:externalId/account', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { externalId } = req.params;
      const actor = req.session.user!.email;
      const [lead] = await db.select({ source: leads.source }).from(leads).where(eq(leads.externalId, externalId));
      if (!lead) return res.status(404).json({ error: 'Client not found' });
      if (lead.source !== 'jobtread') return res.status(400).json({ error: 'Only a JobTread job can be edited here.' });

      const parsed = parseAccountEdit(req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const { edit } = parsed;

      const result = await new JobTreadClient().updateJobAccount(externalId, {
        customer: edit.customer, jobName: edit.jobName, address: edit.address, customFields: jobFieldWrites(edit.fields),
      });
      await logWrite({
        actor, system: 'jobtread', action: 'update_account', targetId: externalId,
        summary: JSON.stringify(edit).slice(0, 500), ok: result.ok, error: result.error || null,
      });
      if (!result.ok) return res.status(502).json({ error: result.error || 'JobTread update failed' });

      const set = leadMirror(edit);
      if (Object.keys(set).length) await db.update(leads).set(set).where(eq(leads.externalId, externalId));
      res.json({ ok: true });
    } catch (error: any) {
      return sendFailure(res, error, 'PATCH /api/clients/:externalId/account');
    }
  });
}
