/**
 * An admin connects the company's GHL sub-account and sets up its webhook.
 *
 *   GET  /api/integrations/ghl/connection   status, webhook URL and secret
 *   PUT  /api/integrations/ghl/connection   { locationId, token } (a Private Integration Token)
 *   POST /api/integrations/ghl/webhook-secret/rotate
 *
 * Admin only. The token is checked against the location before it is saved,
 * sealed at rest, and never sent back.
 */
import type { Express, Request, Response } from 'express';
import { requireAuth, requireRole } from '../../auth/middleware';
import { getCurrentCompany } from '../../tenant/companies';
import { sendFailure } from '../../lib/failure';
import { GhlLocationTakenError, hasGhlConnection, saveGhlConnection, verifyGhlCredentials } from './connection';
import { ensureGhlWebhookSecret } from './webhook-secret';

const webhookUrl = (req: Request) => `${(process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')}/api/webhooks/gohighlevel`;

export function registerGhlConnectionRoutes(app: Express) {
  app.get('/api/integrations/ghl/connection', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const company = await getCurrentCompany();
      res.json({
        connected: await hasGhlConnection(),
        locationId: company?.ghlLocationId ?? null,
        webhook: { url: webhookUrl(req), header: 'x-webhook-secret', secret: await ensureGhlWebhookSecret() },
      });
    } catch (e) {
      return sendFailure(res, e, 'GET /api/integrations/ghl/connection');
    }
  });

  app.put('/api/integrations/ghl/connection', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const locationId = String(req.body?.locationId ?? '').trim();
      const token = String(req.body?.token ?? '').trim();
      if (!locationId || !token) return res.status(400).json({ error: 'Both the location id and the token are needed.' });
      const check = await verifyGhlCredentials(locationId, token);
      if (!check.ok) return res.status(400).json({ error: check.error });
      await saveGhlConnection(locationId, { kind: 'pit', token });
      res.json({ connected: true, locationId, locationName: check.name });
    } catch (e) {
      if (e instanceof GhlLocationTakenError) return res.status(409).json({ error: e.message });
      return sendFailure(res, e, 'PUT /api/integrations/ghl/connection');
    }
  });

  app.post('/api/integrations/ghl/webhook-secret/rotate', requireAuth, requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      res.json({ secret: await ensureGhlWebhookSecret(true) });
    } catch (e) {
      return sendFailure(res, e, 'POST /api/integrations/ghl/webhook-secret/rotate');
    }
  });
}
