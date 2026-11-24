/**
 * The share link: what a customer opens, with no sign-in.
 *
 *   GET /r/roof/:token                             the report's page
 *   GET /r/roof/:token/photos/:photoId/:variant    one photo copy of THAT report
 *
 * The long random token in the address is the capability. It is 32 random bytes
 * (64 hex characters), it names one report, it can be turned off, and it dies
 * the moment the report is archived. It is stored as it is made, like the
 * share links of Archie's own documents (`/r/:token`), found with one narrow
 * system lookup that also says which company the report is in; everything after
 * runs as that company, so the page and its photos can only be that company's.
 *
 * An unknown link, a link that was turned off, a link of an archived report and
 * anything that is not a link at all take ONE code path and give ONE answer:
 * the same plain page, the same status, the same headers (`unavailable`). The
 * page never says which of them it was, and does no more or less work for one
 * than for another.
 *
 * What is served: the page under the same sandbox and nonce policy as the
 * signed-in view (page.ts), never cached, never indexed, never sent with a
 * referrer. Photos come only through this route: the photo must belong to the
 * report the token names (another report's photo id under this token is the
 * same "not available"), and no storage key, id of another record, staff email or
 * cost ever goes into a page. A page asked for more than a person ever would is
 * answered with a plain page to wait, per address.
 *
 * The token is a credential: it is never logged (loggablePath hides it in
 * addresses the app writes down) and never passed on as a referrer.
 */
import type { Express, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { roofReports } from '../../shared/schema';
import { SHARE_BUSY, SHARE_FAILED, SHARE_UNAVAILABLE } from '../../shared/roof-reports';
import { rateLimit } from '../lib/rate-limit';
import { isCompanyId, runAsCompany, runAsSystem } from '../tenant/context';
import { appOrigin, servedPage } from './page';
import { photoLinkNamed } from './photo-links';
import { photosOfReport, reportPhotoBytes } from './photos';
import { requireRoofReportsOn } from './switch';

export const SHARE_TOKEN_RE = /^[0-9a-f]{64}$/;
const UUID_FULL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The headers every answer here carries, a page or a photo, good or bad. */
function baseHeaders(res: Response): Response {
  return res
    .set('Cache-Control', 'no-store')
    .set('Referrer-Policy', 'no-referrer')
    .set('X-Robots-Tag', 'noindex, nofollow')
    .set('X-Content-Type-Options', 'nosniff');
}

/** A small plain page: no company, no report, nothing from the request. */
function plainPage(sentence: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${sentence}</title></head><body style="font-family:sans-serif;padding:2rem;max-width:36rem;margin:0 auto"><p>${sentence}</p></body></html>`;
}

function sendPlain(res: Response, status: number, sentence: string): void {
  baseHeaders(res)
    .status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    .send(plainPage(sentence));
}

/** The one answer for a link that does not open, whatever the reason. */
function unavailable(res: Response): void {
  sendPlain(res, 404, SHARE_UNAVAILABLE);
}

interface Found { companyId: string; reportId: string }

/**
 * The report a token names, if it names one that can be shown: finished, not
 * archived. One narrow lookup as the system role (it has to find the company
 * before there is one), and nothing else. Null for every other case alike.
 */
async function findShared(token: unknown): Promise<Found | null> {
  if (typeof token !== 'string' || !SHARE_TOKEN_RE.test(token)) return null;
  const rows = await runAsSystem('roof report share link: find the report for a token', () =>
    db.select({ id: roofReports.id, companyId: roofReports.companyId, status: roofReports.status }).from(roofReports).where(eq(roofReports.shareToken, token)).limit(2));
  // Tokens are random and unique; anything else is treated as unknown.
  if (rows.length !== 1 || rows[0].status !== 'ready' || !isCompanyId(rows[0].companyId)) return null;
  return { companyId: rows[0].companyId, reportId: rows[0].id };
}

/** What a person saved keeps its words; the photo addresses in it become this link's own, or nothing, so no other report's photo is ever shown. */
export function shareSavedPage(html: string, ctx: { reportId: string; token: string; origin: string }): string {
  return html.replace(/(?:https?:\/\/[^\s"'<>()]*)?\/api\/roof-reports\/linked-photo\/([A-Za-z0-9_.-]{1,600})/g, (_m, signed: string) => {
    const named = photoLinkNamed(signed);
    return named && named.reportId === ctx.reportId ? `${ctx.origin}/r/roof/${ctx.token}/photos/${named.photoId}/${named.variant}` : '';
  });
}

const kindOf = (error: unknown): string => {
  const e = error as { cause?: { code?: unknown }; code?: unknown; name?: unknown } | null | undefined;
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === 'string' && /^[\w.-]{1,16}$/.test(code)) return code;
  return typeof e?.name === 'string' && /^\w{1,40}$/.test(e.name) ? e.name : 'unknown';
};

export function registerPublicShareRoutes(app: Express): void {
  // Per address, and generous: a customer reopening their report, or a household passing the link round on one WiFi,
  // stays far under it. Answered as a page, since whoever hits it is looking at a browser window. A page is a few
  // database reads and a photo-heavy one is what a person loads once, so photos have an allowance of their own.
  const byAddress = (req: Request) => req.ip || 'anon';
  const pageLimiter = rateLimit(120, 10 * 60 * 1000, (_req, res) => sendPlain(res, 429, SHARE_BUSY), byAddress);
  const photoLimiter = rateLimit(1200, 10 * 60 * 1000, (_req, res) => sendPlain(res, 429, SHARE_BUSY), byAddress);

  app.get('/r/roof/:token', requireRoofReportsOn, pageLimiter, async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token ?? '');
      const found = await findShared(token);
      if (!found) return unavailable(res);
      const origin = appOrigin(req);
      const served = await runAsCompany(found.companyId, async () => {
        // Asked again for in the company's own context, by the token and the state, so what is shown is what was found.
        const [row] = await db.select().from(roofReports).where(and(eq(roofReports.id, found.reportId), eq(roofReports.shareToken, token), eq(roofReports.status, 'ready'))).limit(1);
        if (!row || row.reportJson === null) return null;
        const photos = await photosOfReport(row.id);
        return servedPage({
          row, photos, origin,
          link: (photoId, variant) => `${origin}/r/roof/${token}/photos/${photoId}/${variant}`,
          savedPage: (html) => shareSavedPage(html, { reportId: row.id, token, origin }),
        });
      });
      if (!served) return unavailable(res);
      baseHeaders(res).status(200).set('Content-Type', 'text/html; charset=utf-8').set('Content-Security-Policy', served.policy).send(served.html);
    } catch (error) {
      console.error('[roof-reports] a shared report could not be shown:', kindOf(error));
      sendPlain(res, 500, SHARE_FAILED);
    }
  });

  app.get('/r/roof/:token/photos/:photoId/:variant', requireRoofReportsOn, photoLimiter, async (req: Request, res: Response) => {
    try {
      const { photoId, variant } = req.params;
      const found = await findShared(req.params.token);
      if (!found || !UUID_FULL.test(photoId ?? '') || (variant !== 'working' && variant !== 'thumb')) return unavailable(res);
      // Only a photo that belongs to the report the token names: reportPhotoBytes asks for both ids together.
      const bytes = await runAsCompany(found.companyId, () => reportPhotoBytes(found.reportId, photoId, variant), { loadProfile: false });
      if (!bytes) return unavailable(res);
      baseHeaders(res).status(200).set('Content-Type', 'image/jpeg').set('Content-Length', String(bytes.length)).end(bytes);
    } catch (error) {
      console.error('[roof-reports] a shared photo could not be shown:', kindOf(error));
      sendPlain(res, 500, SHARE_FAILED);
    }
  });
}
