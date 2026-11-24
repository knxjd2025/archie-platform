/**
 * The roof report routes. Every one of them:
 *
 *   1. answers a bare 404 while ARCHIE_ROOF_REPORTS is not exactly "on";
 *   2. needs a signed-in person, and answers crew (and any role nobody has
 *      decided) the same 404 as a report that is not there;
 *   3. takes the company from the session only: nothing in a body, a query or
 *      an address says whose a report is. The database holds the rest (row
 *      level security), so another company's report is simply not there;
 *   4. finds a report only through `roofReportFor`, which answers null for a
 *      report that is not the person's, is archived, is not there or is not an
 *      id, and every one of those is the same "not found".
 *
 * What a person is told is a plain sentence from shared/roof-reports.ts.
 * Nothing here ever shows a provider's words, a database error, an id of
 * anything but the report, a path or a key.
 *
 * Generation runs inside the request that asks for it (about 300 seconds on
 * this hosting; the run has a 240 second deadline). A run that dies midway
 * leaves a report that reads as failed after eight minutes and can be tried
 * again with POST /:id/retry. Nothing is deleted: archive sets a state.
 */
import { Router, type Express, type Request, type Response } from 'express';
import { and, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { roofReports, type RoofReport, type RoofReportPhoto } from '../../shared/schema';
import {
  BAD_REQUEST_KEY, GENERATE_FAILED, NOT_FOUND, ONLY_FAILED_RETRY, PAGE_NOT_READY, STILL_BEING_MADE, STILL_BEING_MADE_EDIT,
  REQUEST_KEY_REUSED, TOO_MANY_RECENT, TOO_MANY_TODAY, roofReportPhotoPath,
} from '../../shared/roof-reports';
import { requireAuth } from '../auth/middleware';
import { sendFailure } from '../lib/failure';
import { rateLimit } from '../lib/rate-limit';
import { ownsLead, teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { photoStore } from '../photos/store';
import { currentCompanyId, currentProfile } from '../tenant/context';
import { logWrite } from '../writes/log';
import { renderReportHtml } from '../lib/roof-reports/render-report-html.js';
import { normalizeReportNumbers } from '../lib/roof-reports/report-normalize.js';
import type { ComprehensiveRoofReport } from '../lib/roof-reports/comprehensive-roof-report.js';
import {
  decisionFor, jobExistsInCompany, mayAttachJob, mayChangeJob, requireRoofReportUser, roofReportFor, roofReportUser, visibleRoofReportWhere,
} from './access';
import { brandFor } from './brand';
import { GeocodeFailedError, liveDeps, modelKeysFromEnv, runGeneration, type GenerateDeps, type GenerateRequest } from './generate';
import { authedPhotoRoutes, claimPhotos, linkedPhotoRoute, photosOfReport } from './photos';
import { photoLinkPath, signPhotoLink } from './photo-links';
import { beginRetry, effectiveState, failureSentence, markFailed, requestFingerprint, saveGenerated, startReport, statusFilter } from './store';
import { PAGE_SIZE, parseGenerateBody, parseListQuery, parseUpdateBody, sanitizeReportJson, type UpdateFields } from './validate';
import { newNonce, pagePolicy } from './page-policy';
import { requireRoofReportsOn } from './switch';

export interface RoofReportRouteOptions {
  /** The real storm sources, models and photo store, unless a test hands in fakes. */
  deps?: (reportId: string) => GenerateDeps;
}

const notFound = (res: Response) => res.status(404).json({ error: NOT_FOUND });

/** What a log line may say about a failure: its name or database code, never its message. */
function kindOf(error: unknown): string {
  const e = error as { cause?: { code?: unknown }; code?: unknown; name?: unknown } | null | undefined;
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === 'string' && /^[\w.-]{1,16}$/.test(code)) return code;
  return typeof e?.name === 'string' && /^\w{1,40}$/.test(e.name) ? e.name : 'unknown';
}

/** A request key: 8 to 200 plain characters. Absent is fine (no repeat protection); present and unusable is refused, never quietly ignored. */
function readRequestKey(req: Request): { ok: true; key: string | null } | { ok: false } {
  const raw = req.get('idempotency-key');
  if (raw === undefined) return { ok: true, key: null };
  return /^[A-Za-z0-9_.:-]{8,200}$/.test(raw) ? { ok: true, key: raw } : { ok: false };
}

const money = (v: string | null): number | null => (v === null ? null : Number(v));
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** One row as a list shows it. No token, no company, no report contents. */
function listItem(row: RoofReport, now: Date) {
  const state = effectiveState(row, now);
  return {
    id: row.id, title: row.title, address: row.address, city: row.city, status: state.status, problem: state.problem,
    reportTypes: row.reportTypes, template: row.template, createdAt: row.createdAt.toISOString(), customerName: row.customerName,
    jobExternalId: row.jobExternalId, totalEstimate: money(row.totalEstimate),
  };
}

/** One report as it is opened: the row's own fields, the report when it is ready, and its photos by the app's own routes. */
function detail(row: RoofReport, photos: RoofReportPhoto[], now: Date) {
  const state = effectiveState(row, now);
  const ready = state.status === 'ready' && row.reportJson !== null;
  return {
    id: row.id, status: state.status, problem: state.problem, title: row.title,
    address: row.address, city: row.city, state: row.state, zip: row.zip,
    reportTypes: row.reportTypes, template: row.template, visualStyle: row.visualStyle,
    customerName: row.customerName, customerEmail: row.customerEmail, customerPhone: row.customerPhone,
    inspectionDate: iso(row.inspectionDate), inspectorNotes: row.inspectorNotes, jobExternalId: row.jobExternalId,
    totalEstimate: money(row.totalEstimate), damageSeverity: row.damageSeverity, stormEventsCount: row.stormEventsCount, dataQuality: row.dataQuality,
    emailSentAt: iso(row.emailSentAt), emailSentCount: row.emailSentCount,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    report: ready ? row.reportJson : null,
    photos: photos.map((p) => ({
      id: p.id, category: p.category, position: p.position,
      url: roofReportPhotoPath(row.id, p.id, 'working'), thumbUrl: roofReportPhotoPath(row.id, p.id, 'thumb'),
    })),
  };
}

/** The report to show a person: the saved report with the row's own settings on top, and every photo from a short signed link. */
function reportForPage(row: RoofReport, photos: RoofReportPhoto[], link: (photoId: string, variant: 'working' | 'thumb') => string): ComprehensiveRoofReport {
  const base = normalizeReportNumbers(row.reportJson as unknown as ComprehensiveRoofReport);
  const own = new Map(photos.map((p) => [p.id, p]));
  return {
    ...base,
    reportTemplate: row.template as ComprehensiveRoofReport['reportTemplate'],
    reportVisualStyle: (row.visualStyle ?? undefined) as ComprehensiveRoofReport['reportVisualStyle'],
    customerName: row.customerName ?? undefined,
    customerEmail: row.customerEmail ?? undefined,
    inspectionDate: row.inspectionDate ? row.inspectionDate.toISOString() : undefined,
    inspectorNotes: row.inspectorNotes ?? base.inspectorNotes,
    damageAnalysis: {
      ...base.damageAnalysis,
      // A photo not on this report is shown with no picture, whatever address the saved report holds.
      photos: (base.damageAnalysis?.photos ?? []).map((p) => ({
        ...p,
        url: own.has(p.id) ? link(p.id, 'working') : '',
        thumbnailUrl: own.has(p.id) ? link(p.id, 'thumb') : undefined,
      })),
    },
  };
}

/** The address the app is reached at, for the links inside a page. */
function appOrigin(req: Request): string {
  const configured = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export function registerRoofReportsRoutes(app: Express, options: RoofReportRouteOptions = {}): void {
  const makeDeps = options.deps ?? ((reportId: string) => liveDeps(reportId));
  // Generation is the one route that spends money. A runaway retry loop is what this stops, not ordinary work.
  const generateLimiter = rateLimit(40, 10 * 60 * 1000, (_req, res) => { res.json({ error: TOO_MANY_RECENT }); });
  const guard = [requireRoofReportsOn, requireAuth, requireRoofReportUser];

  const router = Router();
  router.use(requireRoofReportsOn);
  linkedPhotoRoute(router);
  router.use(requireAuth, requireRoofReportUser);
  authedPhotoRoutes(router);

  // ---------------------------------------------------------------- status
  router.get('/status', (_req, res) => {
    res.json({ on: true, photoStore: photoStore() !== null, analysis: Boolean(modelKeysFromEnv().groq) });
  });

  // ---------------------------------------------------------------- making one
  /**
   * Runs the generation for a report row that exists and is `generating`, and
   * answers the request. A report becomes ready only if it was made AND can be
   * shown: a report that cannot be rendered is a failure, not a ready report.
   */
  async function run(res: Response, user: SessionUser, row: RoofReport, request: GenerateRequest): Promise<void> {
    try {
      const { report, warning } = await runGeneration(row.id, request, makeDeps(row.id));
      await renderReportHtml(report, brandFor(currentProfile()).brandColors);
      const saved = await saveGenerated(row.id, report, warning);
      const [now] = await db.select().from(roofReports).where(eq(roofReports.id, row.id)).limit(1);
      const state = now ? effectiveState(now) : { status: saved ? 'ready' : 'failed', problem: warning };
      await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_generate', targetId: row.id, summary: 'roof report made', ok: saved, error: null });
      res.json({ id: row.id, status: state.status, problem: state.problem });
    } catch (error) {
      const sentence = failureSentence(error);
      console.error('[roof-reports] a report could not be finished:', kindOf(error));
      try { await markFailed(row.id, sentence); } catch (e) { console.error('[roof-reports] a failed report could not be marked:', kindOf(e)); }
      await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_generate', targetId: row.id, summary: 'roof report could not be finished', ok: false, error: kindOf(error) });
      if (error instanceof GeocodeFailedError) { res.status(422).json({ error: sentence, id: row.id }); return; }
      // The failure that is shown is the one sentence, never the error's own words, with the id the screen needs to offer a retry.
      res.status(500).json({ error: sentence, id: row.id });
    }
  }

  router.post('/generate', generateLimiter, async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      if (decisionFor(user.role, 'make') === 'no') return notFound(res);
      const parsed = parseGenerateBody(req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const request = parsed.value;
      let job: string | null = null;
      if (request.jobExternalId) {
        if (!(await mayAttachJob(user, request.jobExternalId))) return notFound(res);
        job = request.jobExternalId;
      }
      const requestKey = readRequestKey(req);
      if (!requestKey.ok) return res.status(400).json({ error: BAD_REQUEST_KEY });
      const started = await startReport({
        req: request, memberId: await teamMemberIdByEmail(user.email), jobExternalId: job,
        idempotencyKey: requestKey.key, requestHash: requestKey.key ? requestFingerprint({ ...request, jobExternalId: job }) : null,
      });
      if (started.kind === 'capped') return res.status(429).json({ error: TOO_MANY_TODAY });
      if (started.kind === 'key_reused') return res.status(409).json({ error: REQUEST_KEY_REUSED });
      if (started.kind === 'repeat') {
        // The same submit again: the first report as it stands now, and nothing is started.
        const state = effectiveState(started.row);
        return res.json({ id: started.row.id, status: state.status, problem: state.problem });
      }
      const row = started.row;
      const claimed = await claimPhotos(user, row.id, request.photoIds);
      await run(res, user, row, { ...request, photoIds: claimed, jobExternalId: job ?? undefined });
    } catch (error) {
      sendFailure(res, error, 'POST /api/roof-reports/generate', 500, GENERATE_FAILED);
    }
  });

  router.post('/:id/retry', generateLimiter, async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const found = await roofReportFor(user, req.params.id);
      if (!found || decisionFor(user.role, 'edit') === 'no') return notFound(res);
      if (effectiveState(found).status !== 'failed') return res.status(409).json({ error: ONLY_FAILED_RETRY });
      const row = await beginRetry(found.id);
      if (row === 'capped') return res.status(429).json({ error: TOO_MANY_TODAY });
      if (!row) return res.status(409).json({ error: ONLY_FAILED_RETRY });
      const kept = (row.reportJson as { retryInput?: { roofDetails?: unknown; damageCounts?: unknown; measurements?: unknown } } | null)?.retryInput ?? {};
      const photoIds = (await photosOfReport(row.id)).map((p) => p.id);
      await run(res, user, row, {
        reportTypes: row.reportTypes as GenerateRequest['reportTypes'], template: row.template as GenerateRequest['template'],
        address: row.address, city: row.city ?? undefined, state: row.state ?? undefined, zip: row.zip ?? undefined,
        photoIds, roofDetails: kept.roofDetails ?? undefined, damageCounts: kept.damageCounts ?? undefined, measurements: kept.measurements ?? undefined,
        inspectorNotes: row.inspectorNotes ?? '', customer: { name: row.customerName ?? '', email: row.customerEmail ?? '', phone: row.customerPhone ?? '' },
        jobExternalId: row.jobExternalId ?? undefined,
      });
    } catch (error) {
      sendFailure(res, error, 'POST /api/roof-reports/:id/retry', 500, GENERATE_FAILED);
    }
  });

  // ---------------------------------------------------------------- listing
  async function listWhere(user: SessionUser, query: ReturnType<typeof parseListQuery>, extra?: SQL): Promise<SQL> {
    const parts: SQL[] = [await visibleRoofReportWhere(user, { archived: query.status === 'archived' })];
    if (query.status && query.status !== 'archived') parts.push(statusFilter(query.status));
    if (query.kind) parts.push(sql`${roofReports.reportTypes} @> ARRAY[${query.kind}]::text[]`);
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      parts.push(or(ilike(roofReports.address, pattern), ilike(roofReports.city, pattern), ilike(roofReports.customerName, pattern), ilike(roofReports.title, pattern)) as SQL);
    }
    if (extra) parts.push(extra);
    return and(...parts) as SQL;
  }

  router.get('/', async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const query = parseListQuery(req.query);
      const where = await listWhere(user, query);
      const [{ n }] = await db.select({ n: count() }).from(roofReports).where(where);
      const rows = await db.select().from(roofReports).where(where).orderBy(desc(roofReports.createdAt), desc(roofReports.id))
        .limit(PAGE_SIZE).offset((query.page - 1) * PAGE_SIZE);
      const now = new Date();
      res.json({ reports: rows.map((r) => listItem(r, now)), page: query.page, pageSize: PAGE_SIZE, total: Number(n), hasMore: query.page * PAGE_SIZE < Number(n) });
    } catch (error) {
      sendFailure(res, error, 'GET /api/roof-reports');
    }
  });

  // ---------------------------------------------------------------- one report
  router.get('/:id/html', async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const row = await roofReportFor(user, req.params.id);
      if (!row) return notFound(res);
      const state = effectiveState(row);
      if (state.status !== 'ready' || row.reportJson === null) return res.status(409).json({ error: PAGE_NOT_READY });
      const origin = appOrigin(req);
      const logoUrl = brandFor(currentProfile()).brandColors.companyLogo;
      let html: string;
      let policy: string;
      if (row.editedHtml) {
        // A page a person saved is shown as saved, in a sandbox that cannot run script or reach anything of the app's.
        html = row.editedHtml;
        policy = pagePolicy({ kind: 'saved', appOrigin: origin, logoUrl });
      } else {
        const photos = await photosOfReport(row.id);
        const companyId = currentCompanyId();
        if (!companyId) return notFound(res);
        const link = (photoId: string, variant: 'working' | 'thumb') =>
          `${origin}${photoLinkPath(signPhotoLink({ companyId, reportId: row.id, photoId, variant }))}`;
        // The scroll pages carry the app's own scripts. They run in the sandbox, and only because
        // they carry this response's nonce: a script that got in any other way does not.
        const nonce = newNonce();
        const rendered = await renderReportHtml(reportForPage(row, photos, link), brandFor(currentProfile()).brandColors, { nonce });
        html = rendered.html;
        policy = pagePolicy({ kind: 'built', nonce, appOrigin: origin, logoUrl });
      }
      res.status(200)
        .set('Content-Type', 'text/html; charset=utf-8')
        .set('Content-Security-Policy', policy)
        .set('X-Content-Type-Options', 'nosniff')
        .set('Referrer-Policy', 'no-referrer')
        .set('Cache-Control', 'private, no-store')
        .send(html);
    } catch (error) {
      sendFailure(res, error, 'GET /api/roof-reports/:id/html');
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const row = await roofReportFor(user, req.params.id);
      if (!row) return notFound(res);
      res.json(detail(row, await photosOfReport(row.id), new Date()));
    } catch (error) {
      sendFailure(res, error, 'GET /api/roof-reports/:id');
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const row = await roofReportFor(user, req.params.id);
      if (!row || decisionFor(user.role, 'edit') === 'no') return notFound(res);
      if (effectiveState(row).status === 'generating') return res.status(409).json({ error: STILL_BEING_MADE_EDIT });
      const parsed = parseUpdateBody(req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const fields: UpdateFields = parsed.value;
      // Moving a report to another job, or off its job, takes more than being able to edit it (see mayChangeJob).
      if ('jobExternalId' in fields && !(await mayChangeJob(user, row, fields.jobExternalId ?? null))) return notFound(res);

      const changes: Partial<typeof roofReports.$inferInsert> = { updatedAt: new Date() };
      for (const key of ['title', 'customerName', 'customerEmail', 'customerPhone', 'inspectorNotes', 'inspectionDate', 'template', 'visualStyle', 'jobExternalId'] as const) {
        if (key in fields) (changes as Record<string, unknown>)[key] = fields[key];
      }
      if ('reportJson' in fields || 'editedHtml' in fields) {
        // Only a finished report has contents or a page to edit.
        if (effectiveState(row).status !== 'ready' || row.reportJson === null) return res.status(409).json({ error: PAGE_NOT_READY });
      }
      if ('reportJson' in fields) {
        const own = (await photosOfReport(row.id)).map((p) => p.id);
        const safe = sanitizeReportJson(fields.reportJson, row.id, own);
        if (!safe.ok) return res.status(400).json({ error: safe.error });
        changes.reportJson = safe.value as unknown as Record<string, unknown>;
      }
      if ('editedHtml' in fields) changes.editedHtml = fields.editedHtml ?? null;

      const [saved] = await db.update(roofReports).set(changes).where(and(eq(roofReports.id, row.id), ne(roofReports.status, 'archived'))).returning();
      if (!saved) return notFound(res);
      await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_update', targetId: row.id, summary: 'roof report changed', ok: true, error: null });
      res.json(detail(saved, await photosOfReport(saved.id), new Date()));
    } catch (error) {
      sendFailure(res, error, 'PUT /api/roof-reports/:id');
    }
  });

  router.post('/:id/archive', async (req, res) => {
    try {
      const user = roofReportUser(req)!;
      const row = await roofReportFor(user, req.params.id);
      if (!row || decisionFor(user.role, 'archive') === 'no') return notFound(res);
      if (effectiveState(row).status === 'generating') return res.status(409).json({ error: STILL_BEING_MADE });
      // A state, not a deletion: the row, its photos and its token all stay.
      const [saved] = await db.update(roofReports).set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(roofReports.id, row.id), ne(roofReports.status, 'archived'))).returning({ id: roofReports.id });
      if (!saved) return notFound(res);
      await logWrite({ actor: user.email, system: 'archie', action: 'roof_report_archive', targetId: row.id, summary: 'roof report archived', ok: true, error: null });
      res.json({ id: row.id, status: 'archived' });
    } catch (error) {
      sendFailure(res, error, 'POST /api/roof-reports/:id/archive');
    }
  });

  app.use('/api/roof-reports', router);

  // ---------------------------------------------------------------- a job's reports
  app.get('/api/clients/:externalId/roof-reports', ...guard, async (req: Request, res: Response) => {
    try {
      const user = roofReportUser(req)!;
      const jobKey = req.params.externalId;
      if (!(await jobExistsInCompany(jobKey)) || !(await ownsLead(user, jobKey))) return notFound(res);
      const query = parseListQuery(req.query);
      const where = await listWhere(user, query, eq(roofReports.jobExternalId, jobKey));
      const rows = await db.select().from(roofReports).where(where).orderBy(desc(roofReports.createdAt), desc(roofReports.id)).limit(100);
      const now = new Date();
      res.json({ reports: rows.map((r) => listItem(r, now)) });
    } catch (error) {
      sendFailure(res, error, 'GET /api/clients/:externalId/roof-reports');
    }
  });

}
