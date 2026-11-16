/**
 * An admin connects the company's own Current CRM (JobTread today) and
 * CompanyCam accounts, the same way KynexPro is connected (ghl/routes.ts).
 *
 *   GET    /api/integrations/crm/connection         { connected, source, accountName? }
 *   PUT    /api/integrations/crm/connection         { provider: 'jobtread', grantKey, organizationId? }
 *   DELETE /api/integrations/crm/connection
 *   GET    /api/integrations/companycam/connection  { connected, source, accountName? }
 *   PUT    /api/integrations/companycam/connection  { token }
 *   DELETE /api/integrations/companycam/connection
 *
 * Admin only. Credentials are checked with a read-only call to the provider
 * before they are saved, sealed at rest, and never sent back. `source` says
 * whether the company's own credentials are in use ('company') or the
 * deployment's env account, which only its owning company can use ('shared').
 */
import type { Express, Request, Response } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { sendFailure } from '../lib/failure';
import { rateLimit } from '../lib/rate-limit';
import { deleteCompanyCredentials, saveCompanyCredentials } from '../tenant/company-credentials';
import {
  JOBTREAD_PROVIDER, jobTreadConnectionStatus, verifyJobTreadCredentials, type JobTreadCredentials,
} from './jobtread-connection';
import {
  COMPANYCAM_PROVIDER, companyCamConnectionStatus, verifyCompanyCamToken, type CompanyCamCredentials,
} from './companycam-connection';

/** The CRMs a company can connect as its Current CRM. */
export const CRM_PROVIDERS = ['jobtread'] as const;

const field = (v: unknown) => String(v ?? '').trim();

/** Longest values accepted. Real keys are far shorter; anything longer is refused before it reaches a provider. */
export const MAX_SECRET_LENGTH = 512;
export const MAX_ORGANIZATION_ID_LENGTH = 64;

/**
 * Saving a connection makes a call to the provider with whatever was typed,
 * so without a limit the form could be used to test stolen keys at volume.
 * 10 saves per 10 minutes, per IP, shared by both save routes.
 */
const saveLimit = rateLimit(10, 10 * 60_000, undefined, (req) => `integration-save:${req.ip || 'unknown'}`);

export function registerConnectionRoutes(app: Express) {
  const admin = [requireAuth, requireRole('admin')];

  app.get('/api/integrations/crm/connection', ...admin, async (_req: Request, res: Response) => {
    try {
      res.json(await jobTreadConnectionStatus());
    } catch (e) {
      return sendFailure(res, e, 'GET /api/integrations/crm/connection');
    }
  });

  app.put('/api/integrations/crm/connection', ...admin, saveLimit, async (req: Request, res: Response) => {
    try {
      const provider = field(req.body?.provider) || 'jobtread';
      if (!(CRM_PROVIDERS as readonly string[]).includes(provider)) return res.status(400).json({ error: 'That CRM cannot be connected yet.' });
      const grantKey = field(req.body?.grantKey);
      const organizationId = field(req.body?.organizationId) || undefined;
      if (!grantKey) return res.status(400).json({ error: 'The grant key is needed.' });
      if (grantKey.length > MAX_SECRET_LENGTH) return res.status(400).json({ error: 'That grant key is too long.' });
      if (organizationId && (organizationId.length > MAX_ORGANIZATION_ID_LENGTH || !/^[A-Za-z0-9_-]+$/.test(organizationId))) {
        return res.status(400).json({ error: 'That does not look like a JobTread Organization ID.' });
      }
      const check = await verifyJobTreadCredentials(grantKey, organizationId);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const creds: JobTreadCredentials = { grantKey, organizationId: check.organizationId };
      await saveCompanyCredentials(JOBTREAD_PROVIDER, creds, { accountName: check.name });
      res.json({ connected: true, source: 'company', accountName: check.name || undefined });
    } catch (e) {
      return sendFailure(res, e, 'PUT /api/integrations/crm/connection');
    }
  });

  app.delete('/api/integrations/crm/connection', ...admin, async (_req: Request, res: Response) => {
    try {
      await deleteCompanyCredentials(JOBTREAD_PROVIDER);
      res.json(await jobTreadConnectionStatus());
    } catch (e) {
      return sendFailure(res, e, 'DELETE /api/integrations/crm/connection');
    }
  });

  app.get('/api/integrations/companycam/connection', ...admin, async (_req: Request, res: Response) => {
    try {
      res.json(await companyCamConnectionStatus());
    } catch (e) {
      return sendFailure(res, e, 'GET /api/integrations/companycam/connection');
    }
  });

  app.put('/api/integrations/companycam/connection', ...admin, saveLimit, async (req: Request, res: Response) => {
    try {
      const token = field(req.body?.token);
      if (!token) return res.status(400).json({ error: 'The API token is needed.' });
      if (token.length > MAX_SECRET_LENGTH) return res.status(400).json({ error: 'That API token is too long.' });
      const check = await verifyCompanyCamToken(token);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const creds: CompanyCamCredentials = { token };
      await saveCompanyCredentials(COMPANYCAM_PROVIDER, creds, { accountName: check.name });
      res.json({ connected: true, source: 'company', accountName: check.name || undefined });
    } catch (e) {
      return sendFailure(res, e, 'PUT /api/integrations/companycam/connection');
    }
  });

  app.delete('/api/integrations/companycam/connection', ...admin, async (_req: Request, res: Response) => {
    try {
      await deleteCompanyCredentials(COMPANYCAM_PROVIDER);
      res.json(await companyCamConnectionStatus());
    } catch (e) {
      return sendFailure(res, e, 'DELETE /api/integrations/companycam/connection');
    }
  });
}
