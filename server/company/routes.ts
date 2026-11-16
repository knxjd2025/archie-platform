/**
 * The Company page: an admin makes Archie look like their company and picks
 * what each user level sees in the menu.
 *
 *   GET    /api/company/settings   { primaryColor, accentColor, logoUrl, menuHidden }
 *   PUT    /api/company/settings   { primaryColor?, accentColor?, menuHidden? }
 *   PUT    /api/company/logo       the image's bytes (PNG, JPEG or WebP, 300 KB at most)
 *   DELETE /api/company/logo
 *   GET    /api/public/company/:companyId/logo?v=<hash>   the logo, for anyone
 *
 * Admin only, except the public logo. Every change is to the signed-in
 * admin's own company: the company comes from the session, never the request.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { sendFailure } from '../lib/failure';
import { readCustomization, saveCustomization, validateCustomization } from './settings';
import { MAX_LOGO_BYTES, checkLogo, publicBaseUrl, readLogo, removeLogo, saveLogo } from './logo';

/** Reads the upload as raw bytes, whatever type the browser claims; checkLogo decides what it is. */
const rawLogoBody = express.raw({ type: () => true, limit: MAX_LOGO_BYTES + 1024 });

function readLogoBody(req: Request, res: Response, next: NextFunction): void {
  rawLogoBody(req, res, (err?: unknown) => {
    if (!err) return next();
    const tooBig = (err as { type?: string })?.type === 'entity.too.large';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'That logo is over 300 KB. Use a smaller image.' : 'Could not read that file. Try again.' });
  });
}

export function registerCompanyRoutes(app: Express) {
  const admin = [requireAuth, requireRole('admin')];

  app.get('/api/company/settings', ...admin, async (_req: Request, res: Response) => {
    try {
      res.json(await readCustomization());
    } catch (e) {
      return sendFailure(res, e, 'GET /api/company/settings');
    }
  });

  app.put('/api/company/settings', ...admin, async (req: Request, res: Response) => {
    try {
      const checked = validateCustomization(req.body);
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      await saveCustomization(checked.patch);
      res.json({ ...(await readCustomization()), adjusted: checked.adjusted });
    } catch (e) {
      return sendFailure(res, e, 'PUT /api/company/settings');
    }
  });

  app.put('/api/company/logo', ...admin, readLogoBody, async (req: Request, res: Response) => {
    try {
      const check = checkLogo(req.body);
      if (!check.ok) return res.status(check.status).json({ error: check.error });
      await saveLogo(req.body as Buffer, check.type, publicBaseUrl(req));
      res.json(await readCustomization());
    } catch (e) {
      return sendFailure(res, e, 'PUT /api/company/logo');
    }
  });

  app.delete('/api/company/logo', ...admin, async (_req: Request, res: Response) => {
    try {
      await removeLogo();
      res.json(await readCustomization());
    } catch (e) {
      return sendFailure(res, e, 'DELETE /api/company/logo');
    }
  });

  // Public: logos go on reports and emails read outside the app. Only ever
  // that company's logo, only ever as an image.
  app.get('/api/public/company/:companyId/logo', async (req: Request, res: Response) => {
    try {
      const logo = await readLogo(String(req.params.companyId));
      // A short cache on a miss too, so repeated requests for a company
      // with no logo do not each reach the database.
      if (!logo) return res.status(404).set('Cache-Control', 'public, max-age=60, s-maxage=60').type('text/plain').send('Not found');
      const current = req.query.v === logo.sha256.slice(0, 16);
      res.set({
        'Content-Type': logo.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Content-Disposition': 'inline',
        // The address changes with the image, so a matching one never goes
        // stale; s-maxage lets the CDN (Vercel's edge) answer it too. Any
        // other `v` gets the current logo for a short while.
        'Cache-Control': current ? 'public, max-age=31536000, s-maxage=31536000, immutable' : 'public, max-age=300, s-maxage=300',
        ETag: `"${logo.sha256.slice(0, 32)}"`,
      });
      if (req.headers['if-none-match'] === `"${logo.sha256.slice(0, 32)}"`) return res.status(304).end();
      res.end(logo.bytes);
    } catch (e) {
      console.error('[company] logo read failed', e);
      res.status(500).type('text/plain').send('Could not load the logo');
    }
  });
}
