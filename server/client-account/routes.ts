/**
 * Admin corrections to a client's account from the client page — customer
 * name, job name, address, project manager and the insurance claim — at any
 * stage. Written to JobTread (the source of truth) and mirrored onto the local
 * lead so the page reflects it before the next sync.
 *
 * A job Archie keeps itself (server/production/native-jobs.ts) has no JobTread:
 * the lead is the record, so the edit is written there and nowhere else, and
 * only the fields the lead has a place for can be changed (nativeAccountChange).
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
import { ACCOUNT_JOB_FIELDS, NATIVE_ACCOUNT_FIELD_KEYS, jobFieldWrites, parseAccountEdit, type AccountEdit } from '../../shared/client-account';
import { jobTreadWriteFailStatus } from '../integrations/jobtread-connection';
import { getCurrentCompany } from '../tenant/companies';
import { jobBackendFor, keepsOwnJobs } from '../production/native-jobs';

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

/** The job fields a job Archie keeps has a place for on the lead (leadMirror). The rest live only in JobTread. */
export const NATIVE_ACCOUNT_FIELDS: ReadonlySet<string> = new Set(NATIVE_ACCOUNT_FIELD_KEYS);

export const NATIVE_CLAIM_DETAILS_REFUSED = 'Insurance details like the carrier, claim number and adjuster can\'t be saved for this job yet.';

/**
 * The lead columns an account edit changes, for a job Archie keeps. The same
 * as leadMirror, except that the customer's name is split into first and last
 * name, the way such a lead was made. Refuses, in plain words, a claim detail
 * the lead has no place for, rather than dropping it.
 */
export function nativeAccountChange(edit: AccountEdit): { ok: true; set: Partial<typeof leads.$inferInsert> } | { ok: false; error: string } {
  if (Object.keys(edit.fields || {}).some((k) => !NATIVE_ACCOUNT_FIELDS.has(k))) return { ok: false, error: NATIVE_CLAIM_DETAILS_REFUSED };
  const set = leadMirror(edit);
  if (edit.customer !== undefined) {
    const [first, ...rest] = edit.customer.split(/\s+/);
    set.firstName = first;
    set.lastName = rest.join(' ') || null;
  }
  return { ok: true, set };
}

export function registerClientAccountRoutes(app: Express) {
  /** The editable job fields, with JobTread's dropdown choices where it has them. */
  app.get('/api/jobtread/account-fields', requireAuth, requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      // A company that keeps its own jobs: only what the lead can hold, and JobTread is not asked.
      if (keepsOwnJobs(await getCurrentCompany())) {
        return res.json({ fields: ACCOUNT_JOB_FIELDS.filter((f) => NATIVE_ACCOUNT_FIELDS.has(f.key)).map((f) => ({ ...f, options: [] })) });
      }
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

      // A job Archie keeps: written to the lead and nowhere else.
      if (jobBackendFor({ externalId }, await getCurrentCompany()) === 'archie') {
        const parsed = parseAccountEdit(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const change = nativeAccountChange(parsed.edit);
        if (!change.ok) return res.status(400).json({ error: change.error });
        await db.update(leads).set({ ...change.set, updatedAt: new Date() }).where(eq(leads.externalId, externalId));
        await logWrite({
          actor, system: 'archie', action: 'update_account', targetId: externalId,
          summary: JSON.stringify(parsed.edit).slice(0, 500), ok: true, error: null,
        });
        return res.json({ ok: true });
      }

      if (lead.source !== 'jobtread') return res.status(400).json({ error: 'Only a CRM job can be edited here.' });

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
      if (!result.ok) return res.status(jobTreadWriteFailStatus(result.error)).json({ error: result.error || 'Current CRM update failed' });

      const set = leadMirror(edit);
      if (Object.keys(set).length) await db.update(leads).set(set).where(eq(leads.externalId, externalId));
      res.json({ ok: true });
    } catch (error: any) {
      return sendFailure(res, error, 'PATCH /api/clients/:externalId/account');
    }
  });
}
