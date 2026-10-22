import type { Express, Request, Response } from 'express';
import { and, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '../db';
import { leads, clientReports, kpiEvents } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../lib/async-handler';
import { ownsLead, type SessionUser, teamMemberIdByEmail } from '../access/rep-scope';
import { generateReport, configStatus, newShareToken, VALID_TYPES, isDerived, countAnalyzedPhotos, type ReportType } from './generate-local';
import { visionAttempts, analyzeRoofImageViaFal } from '../lib/reports/groq-vision.js';
import { assertSafeExternalUrl } from '../lib/reports/safe-fetch-url.js';
import { getProjectMapMarkers } from '../lib/reports/project-map-proxy.js';
import { projectMapFeedUrl } from '../lib/reports/project-map-widget';
import { repairCoverName } from '../lib/reports/cover-name.js';
import { rateLimit } from '../lib/rate-limit.js';
import { isShareToken } from './share-token';

// Report generation runs several minutes of vision/LLM calls per request, so
// this exists to stop a runaway retry loop burning hundreds of them — not to
// ration normal work. The old ceiling of 10 per 10 minutes did both.
//
// Measured against what actually happens (client_reports, all time): the
// busiest ten minutes any person has ever had is **4 reports**, and the
// busiest whole day is 12. So 40 leaves ten times the real peak, and still
// caps a loop hard. It also clears the end-to-end suite, which generates ten
// back-to-back as one user and was failing on the last two — a test run is
// the most report-hungry thing this app ever does, and if the limit cannot
// survive that it was never going to survive a batch afternoon either.
//
// Refine is a single LLM call, an order of magnitude cheaper, so it gets
// proportionally more room.
const generateLimiter = rateLimit(40, 10 * 60 * 1000);
const refineLimiter = rateLimit(60, 10 * 60 * 1000);
// Generous: a customer scrolling through a 48-minute presentation legitimately
// fires several of these, keyed by IP since the token itself isn't a stable
// per-visitor identity worth keying on.
const trackLimiter = rateLimit(120, 10 * 60 * 1000);
// The proxy itself is cached, so this bounds abuse rather than upstream load.
const mapLimiter = rateLimit(120, 10 * 60 * 1000);
// The public report page is the one route here open to anyone, and each hit was
// a database read. Per IP, and generous: a customer reopening their report, or
// a household passing the link round on one WiFi, stays far under it. Answered
// as a page, since whoever hits it is looking at a browser window.
const reportViewLimiter = rateLimit(120, 10 * 60 * 1000, (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8')
    .send('<!doctype html><meta charset="utf-8"><title>Please wait</title><p style="font-family:sans-serif;padding:2rem">This report has been opened a lot in the last few minutes. Wait a little and reload the page.</p>');
});
import { renderInspectionHtml, inspectionSections } from '../lib/reports/render-inspection-html.js';
import { renderEstimateHtml, estimateSections } from '../lib/reports/render-estimate-html.js';
import { renderPresentationScrollcraftHtml, presentationSectionList } from '../lib/reports/render-presentation-scrollcraft.js';
import { renderProposalScrollcraftHtml, proposalSections } from '../lib/reports/render-proposal-scrollcraft.js';
import { renderCombinedHtml, combinedSections } from '../lib/reports/render-combined-html.js';
import { describeSections, enforceMinimumSections, type ReportSection, type SectionInfo } from '../lib/reports/layout.js';
import {
  applyReportPatch, parseRefineResponse, buildEditableSurface,
  appendTurns, transcriptForPrompt, REFINE_SYSTEM, summaryText, type RefineTurn,
} from './refine';
import { refineReport } from '../ai/assist-service';
import { pushReportToJobTread, linesFromReport } from './to-jobtread';
import { linesFingerprint, decideSync, staleFlag } from './jobtread-sync';
import { setEstimateLines, estimateLinesForEditing, estimateLinesProblem } from '../lib/reports/estimate-editing.js';
import { editEstimateByChat, editReportByChat } from './estimate-chat.js';
import { applyPhotoEdits, photosForEditing, withPhotos } from './photo-editing.js';
import { applyDraft, isEmptyDraft } from './draft.js';
import { unchangedSince } from './unchanged-since';
import { ANALYZE_LIMIT } from './photo-selection';
import { gatherJobContext } from './job-context';
import { JobTreadClient } from '../integrations/jobtread';
import { logWrite } from '../writes/log';
import { googleMapsConfigured, googleMapsKeySource } from '../lib/reports/google-key.js';
import { getLatestInspectionContext } from '../inspections/lookup';
import { ROOFING_PRODUCTS, productByKey, type ProductKey, type TierProductInput } from '../lib/reports/roofing-products.js';
import { SERVICE_TIER_LABELS, SERVICE_TIER_RATE_MIN, SERVICE_TIER_RATE_MAX, isServiceTierKey, serviceTierRateOk, type ServiceTierKey } from '../../shared/addon-pricing.js';
import { resolveScopeItems } from '../lib/reports/scope-items.js';
import { atLeast } from '../../shared/rbac';
import { renderCommercialInspectionHtml, commercialInspectionSections } from '../lib/reports/render-commercial-inspection-html.js';
import { renderCommercialProposalHtml, commercialProposalSections } from '../lib/reports/render-commercial-proposal.js';
import { renderCommercialPresentationHtml, commercialPresentationSectionList } from '../lib/reports/render-commercial-presentation.js';
import { isCommercialReport, commercialContextOf, commercialSummary } from '../lib/reports/commercial-context.js';
import { commercialScanEnabled, sameScanSelection } from '../lib/reports/commercial-photo-scan.js';
import { COMMERCIAL_MIN_CHAPTERS, DEFAULT_BEFORE_START_TERMS } from '../lib/reports/sections/commercial-chapters.js';
import { reportLinkCompany } from '../tenant/public-links';
import { assemblyForEditing } from '../lib/reports/sections/assembly-diagram.js';
import { COMMERCIAL_PRODUCTS, commercialProductByKey, type CommercialProductKey, type IsoTier } from '../lib/reports/commercial-products.js';
import { sendUpstreamFailure } from '../lib/upstream';
import { sendFailure } from '../lib/failure';

const isProductKey = (v: unknown): v is ProductKey => typeof v === 'string' && !!productByKey(v as ProductKey);
const isCommercialKey = (v: unknown): v is CommercialProductKey => typeof v === 'string' && !!commercialProductByKey(v as CommercialProductKey);
const asIsoTier = (v: unknown): IsoTier | undefined => (v === 'r25' || v === 'r30' ? v : undefined);

/** A rep-typed custom product for a Good/Better/Best tier, in place of a catalog key. */
const sanitizeCustomProduct = (v: any): { name: string; ratePerSquare: number } | null => {
  if (!v || typeof v !== 'object') return null;
  const name = String(v.name || '').trim().slice(0, 120);
  const rate = Number(v.ratePerSquare);
  if (!name || !Number.isFinite(rate) || rate <= 0) return null;
  return { name, ratePerSquare: Math.round(rate * 100) / 100 };
};

/** A tune-up or cleaning at the rep's rate — only inside the $29–$99/sq band (shared/addon-pricing.ts). */
const sanitizeServiceTier = (v: any): { service: ServiceTierKey; ratePerSquare: number } | null => {
  if (!v || typeof v !== 'object' || !isServiceTierKey(v.service) || !serviceTierRateOk(v.ratePerSquare)) return null;
  return { service: v.service, ratePerSquare: Math.round(Number(v.ratePerSquare) * 100) / 100 };
};

/** Either a real catalog key, a tune-up/cleaning at an in-band rate, or a valid rep-typed custom product+rate. */
const asTierProduct = (v: unknown): TierProductInput | null => {
  if (isProductKey(v) || isCommercialKey(v)) return v;
  if (v && typeof v === 'object' && 'service' in (v as any)) return sanitizeServiceTier(v);
  return sanitizeCustomProduct(v);
};

/**
 * A generation that outlives the serverless function's 300s limit is killed
 * mid-run, so nothing ever writes a result — the row sits on "running" and the
 * UI spins forever. Nothing is coming back after that, so say so.
 */
const STALE_AFTER_MS = 8 * 60 * 1000;

/**
 * Re-render a stored report after an edit. Types not listed here keep their
 * original HTML — better an unedited document than a blank one.
 */
interface RenderOpts {
  customer?: string;
  rep?: string;
  jobType?: 'retail' | 'insurance';
  recommendation?: string | null;
  damageSummary?: string | null;
  /** The rep's field inspection — several Inspection/Presentation sections read it. */
  inspection?: any;
}
// A report generated from a commercial checklist carries `commercial` on its
// data (commercial-context.ts) and re-renders as the commercial document.
const RENDERERS: Record<string, (data: any, opts: RenderOpts) => string> = {
  inspection: (d, o) => isCommercialReport(d)
    ? renderCommercialInspectionHtml(d, { jobType: o.jobType, inspection: o.inspection })
    : renderInspectionHtml(d, { jobType: o.jobType, inspection: o.inspection }),
  estimate: (d, o) => renderEstimateHtml(d, o),
  presentation: (d, o) => isCommercialReport(d)
    ? renderCommercialPresentationHtml(d, { customer: o.customer, rep: o.rep, jobType: o.jobType, inspection: o.inspection })
    : renderPresentationScrollcraftHtml(d, { customer: o.customer, rep: o.rep, jobType: o.jobType, inspection: o.inspection }),
  proposal: (d, o) => isCommercialReport(d)
    ? renderCommercialProposalHtml(d, { customer: o.customer, jobType: o.jobType, inspection: o.inspection })
    : renderProposalScrollcraftHtml(d, { customer: o.customer, jobType: o.jobType, damageSummary: o.damageSummary }),
  combined: (d) => {
    if (!d?.combinedProposal) throw new Error('This Combined report was made before editing was supported — generate it again to edit it.');
    return renderCombinedHtml({ report: d, proposal: d.combinedProposal });
  },
};

/** The section list each document is built from — what the editor's Layout tab shows. */
const SECTIONS: Record<string, (data: any, opts: RenderOpts) => ReportSection[]> = {
  inspection: (d, o) => isCommercialReport(d)
    ? commercialInspectionSections(d, { jobType: o.jobType, inspection: o.inspection })
    : inspectionSections(d, { jobType: o.jobType, inspection: o.inspection }),
  estimate: (d, o) => estimateSections(d, o),
  presentation: (d, o) => isCommercialReport(d)
    ? commercialPresentationSectionList(d, { customer: o.customer, rep: o.rep, jobType: o.jobType, inspection: o.inspection })
    : presentationSectionList(d, { customer: o.customer, rep: o.rep, jobType: o.jobType, inspection: o.inspection }),
  proposal: (d, o) => isCommercialReport(d)
    ? commercialProposalSections(d, { customer: o.customer, jobType: o.jobType, inspection: o.inspection })
    : proposalSections(d, { customer: o.customer, jobType: o.jobType, damageSummary: o.damageSummary }),
  combined: (d) => (d?.combinedProposal ? combinedSections({ report: d, proposal: d.combinedProposal }) : []),
};

/**
 * What a re-render needs beyond the data: the customer name and the rep's
 * field inspection. Previews and saves used to re-render without the
 * inspection, so the checklist-driven sections vanished from an edited
 * Inspection while the original still had them.
 */
async function renderOptsFor(externalId: string, data: any): Promise<RenderOpts> {
  const ctx = await getLatestInspectionContext(externalId).catch(() => null);
  // The documents were generated with the job's customer name, but the stored
  // report data never carried it, so every editor re-render fell back to
  // "Homeowner" / "Building Owner" on the cover. Read it from the job.
  let customer: string | undefined = typeof data?.customerName === 'string' && data.customerName.trim() ? data.customerName.trim() : undefined;
  if (!customer) {
    const [job] = await db.select({ firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName })
      .from(leads).where(eq(leads.externalId, externalId)).limit(1);
    customer = `${job?.firstName || ''} ${job?.lastName || ''}`.trim() || job?.jobName || undefined;
  }
  return {
    customer,
    jobType: ctx?.jobType,
    recommendation: ctx?.recommendation,
    damageSummary: ctx?.damageSummary,
    inspection: ctx,
  };
}

/** The commercial scroll documents: a minimum length, required chapters, and the extra editing tools. */
const isCommercialScrollDoc = (reportType: string | null, data: any): boolean =>
  (reportType === 'proposal' || reportType === 'presentation') && isCommercialReport(data);

function sectionInfoFor(reportType: string | null, data: any, opts: RenderOpts): SectionInfo[] {
  const list = SECTIONS[reportType || ''];
  if (!list) return [];
  try {
    const sections = list(data, opts);
    // Show the editor what the page will show: a commercial document puts
    // hidden chapters back rather than drop below its minimum length.
    const layout = isCommercialScrollDoc(reportType, data) ? enforceMinimumSections(sections, data?.layout, COMMERCIAL_MIN_CHAPTERS) : data?.layout;
    return describeSections(sections, layout);
  } catch { return []; }
}

/**
 * What the editor's Commercial tab opens with: the wording as it stands, and
 * the diagram's layers for the tier the document opens on. Null on any other
 * document, which hides the tab.
 */
function commercialEditorState(reportType: string | null, data: any, opts: RenderOpts) {
  if (!isCommercialScrollDoc(reportType, data)) return null;
  const ctx = commercialContextOf(data, opts.inspection);
  const tiers: any[] = Array.isArray(data?.replacementOptions) ? data.replacementOptions : [];
  const opening = tiers.find((t) => t?.tier === (data?.selectedTier ?? 'better')) ?? tiers[1];
  const assembly = ctx?.answers && opening
    ? assemblyForEditing(ctx.answers as Record<string, any>, opening, data?.assemblyEdits)
    : { system: null, layers: [], edits: null };
  return {
    minChapters: COMMERCIAL_MIN_CHAPTERS,
    summary: commercialSummary(data, ctx),
    terms: Array.isArray(data?.beforeStartTerms) ? data.beforeStartTerms : DEFAULT_BEFORE_START_TERMS,
    termsEdited: Array.isArray(data?.beforeStartTerms),
    defaultTerms: DEFAULT_BEFORE_START_TERMS,
    sectionNotes: data?.sectionNotes ?? {},
    customSections: Array.isArray(data?.customSections) ? data.customSections : [],
    assembly,
    openingProduct: opening?.product?.name ?? null,
    photoScan: data?.photoScan ?? null,
  };
}

/**
 * Preview-only bridge: lets the editor scroll the document to a section, and
 * tells the editor which section the rep clicked. Never part of the saved
 * document — the iframe is sandboxed to scripts only, so this cannot reach
 * the app's session.
 */
const PREVIEW_BRIDGE = `<style>[data-section].rpt-flash{outline:3px solid #d8a852;outline-offset:6px;transition:outline-color .8s}</style>
<script>(function(){
  function go(k){var el=document.querySelector('[data-section="'+k+'"]');if(!el)return;el.scrollIntoView({behavior:'smooth',block:'start'});el.classList.add('rpt-flash');setTimeout(function(){el.classList.remove('rpt-flash')},1800);}
  window.addEventListener('message',function(e){var d=e.data||{};if(d.type==='report:scrollTo'&&d.key)go(String(d.key));});
  document.addEventListener('click',function(e){var t=e.target;var s=t&&t.closest?t.closest('[data-section]'):null;if(s)window.parent.postMessage({type:'report:section',key:s.getAttribute('data-section')},'*');},true);
})();</script>`;
const withPreviewBridge = (html: string) => (html.includes('</body>') ? html.replace('</body>', `${PREVIEW_BRIDGE}</body>`) : html + PREVIEW_BRIDGE);

/** Log a KPI event tied to a report — best-effort, never blocks the caller's write. */
async function logReportKpi(email: string, type: 'report_created' | 'report_presented', reportRowId: number) {
  try {
    const teamMemberId = await teamMemberIdByEmail(email);
    await db.insert(kpiEvents).values({ teamMemberId, type, refTable: 'client_reports', refId: String(reportRowId) });
  } catch (e: any) {
    console.error(`[reports] failed to log ${type} KPI event:`, e?.message || e);
  }
}

// Previously only triggered lazily from the next GET /reports call for the
// same client — a report stuck 'running' for a client nobody revisits sat
// forever showing "Generating…" with nothing to clean it up. Also called
// from the hourly brain-sweep cron now (server/routes/brain.ts) so it runs
// even with no visitor.
export async function failStaleReports(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  await db.update(clientReports)
    .set({ status: 'failed', error: 'Generation timed out before it finished. Try again — reports run faster with fewer photos.', updatedAt: new Date() })
    .where(and(inArray(clientReports.status, ['running', 'queued']), lt(clientReports.createdAt, cutoff)))
    .catch(() => {});
}

export function registerRoofReportRoutes(app: Express) {
  // Is report generation ready to run? (names any missing key)
  app.get('/api/reports/status', requireAuth, (_req: Request, res: Response) => {
    // Measurements degrade silently without a Maps key — the report still
    // renders, just with rough estimates — so report the state explicitly
    // rather than leaving it to be inferred from a vague-looking number.
    res.json({
      ...configStatus(),
      measurements: {
        configured: googleMapsConfigured(),
        source: googleMapsKeySource(),
        detail: googleMapsConfigured()
          ? 'Google Solar API measurements enabled.'
          : 'No Google Maps key — roof measurements fall back to rough estimates.',
      },
    });
  });

  // Which vision models this Groq account can actually use. Guessing model ids
  // cost us several failed runs ("model_not_found" for every image), so ask the
  // account directly instead.
  app.get('/api/reports/vision-models', requireAuth, async (_req: Request, res: Response) => {
    const key = process.env.GROQ_API_KEY;
    if (!key) return res.status(503).json({ error: "Groq isn't connected. Ask an admin to add the key, then try again." });
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      const body: any = await r.json();
      if (!r.ok) return res.status(502).json({ error: body?.error?.message || `HTTP ${r.status}` });
      const ids: string[] = (body?.data || []).map((m: any) => m.id).sort();
      res.json({
        configured: ids.length,
        // Anything plausibly multimodal, so we can pick a real one.
        likelyVision: ids.filter((id) => /vision|scout|maverick|llava|multimodal|4b|11b|90b/i.test(id)),
        all: ids,
        current: process.env.GROQ_REPORT_MODEL || 'meta-llama/llama-4-maverick-17b-128e-instruct',
      });
    } catch (e) {
      return sendUpstreamFailure(res, e, 'Groq', 'GET /api/reports/vision-models');
    }
  });

  // End-to-end vision check: runs ONE known roof photo through each configured
  // provider/model and reports exactly which combination works. Guessing model
  // ids produced two reports that analysed zero photos and still read "no
  // damage" — this makes the answer checkable in one request instead.
  app.get('/api/reports/vision-test', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const sample = typeof req.query.url === 'string' && req.query.url.startsWith('http')
      ? req.query.url
      : 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Asphalt_shingle_roof_damage.jpg/640px-Asphalt_shingle_roof_damage.jpg';
    try {
      await assertSafeExternalUrl(sample);
    } catch (e: any) {
      return sendFailure(res, e, 'GET /api/reports/vision-test', 400, 'Not a valid photo URL.');
    }
    const attempts = visionAttempts();
    if (!attempts.length) return res.status(503).json({ error: "No vision provider is connected. Ask an admin to set one up." });

    const results = [];
    for (const a of attempts) {
      const r = await analyzeRoofImageViaFal(sample, { provider: a.provider, model: a.model as any });
      results.push({
        provider: a.provider, model: a.model, ok: r.success,
        damages: r.damages_detected?.length ?? 0,
        detail: r.success ? (r.summary || '').slice(0, 160) : (r.summary || '').slice(0, 300),
      });
      if (r.success) break; // first working combination is the one reports will use
    }
    const working = results.find((r) => r.ok) || null;
    res.json({ image: sample, working, tried: results });
  }));

  // Public share link — the rendered report. No auth: the random token is the
  // capability, which is what makes it sendable to a customer.
  app.get('/r/:token', reportViewLimiter, reportLinkCompany(), async (req: Request, res: Response) => {
    if (!isShareToken(req.params.token)) return res.status(404).send('Report not found.');
    try {
      const [row] = await db.select().from(clientReports).where(eq(clientReports.shareToken, req.params.token));
      if (!row?.html) return res.status(404).send('Report not found.');
      // Reports are editable after they're shared (see /refine), and a customer
      // opening a stale copy of a document that has since been corrected is the
      // failure that matters here. Revalidate every time.
      // A cover whose customer name was never shown is repaired on the way
      // out (cover-name.ts).
      res
        .set('Content-Type', 'text/html; charset=utf-8')
        .set('Cache-Control', 'no-cache, must-revalidate')
        .send(repairCoverName(row.html));
    } catch {
      res.status(500).send('Could not load that report.');
    }
  });

  // Engagement beacon from the report page itself: which chapters the
  // customer actually scrolled to, and which Good/Better/Best tier they
  // tapped — the thing a plain PDF can never tell a rep. No auth (same
  // capability-token model as the GET above); rate-limited since it's a
  // public, unauthenticated write path a client-side script calls repeatedly.
  app.post('/r/:token/track', trackLimiter, reportLinkCompany(), asyncHandler(async (req: Request, res: Response) => {
    const [row] = await db.select().from(clientReports).where(eq(clientReports.shareToken, req.params.token));
    if (!row) return res.status(404).json({ error: 'not found' });

    const TIERS = new Set(['good', 'better', 'best']);
    const incomingChapters = Array.isArray(req.body?.viewedChapterIds) ? req.body.viewedChapterIds : [];
    const cleanChapters = incomingChapters
      .filter((c: unknown): c is string => typeof c === 'string' && c.length > 0 && c.length <= 80)
      .slice(0, 60);
    const incomingTier = typeof req.body?.selectedTier === 'string' && TIERS.has(req.body.selectedTier) ? req.body.selectedTier : undefined;
    if (!cleanChapters.length && !incomingTier) return res.json({ ok: true });

    const prior = (row.engagement as { viewedChapterIds?: string[]; selectedTier?: string } | null) || {};
    const viewedChapterIds = Array.from(new Set([...(prior.viewedChapterIds || []), ...cleanChapters])).slice(0, 60);
    const engagement = {
      viewedChapterIds,
      selectedTier: incomingTier ?? prior.selectedTier ?? null,
      lastEventAt: new Date().toISOString(),
    };
    await db.update(clientReports).set({ engagement }).where(eq(clientReports.id, row.id));
    res.json({ ok: true });
  }));

  // Real project-map pins for the "Our Work" chapter every report type
  // embeds — proxied server-to-server from the company's own project feed
  // (see project-map-proxy.ts for why this can't be a direct browser fetch
  // or an iframe). No auth: it's public data the company's site already
  // serves; rate-limited since it's a public GET a client-side script calls
  // on every report view. (Archie answers 410 here until per-company feeds
  // exist: server/tenant/cron.ts.)
  app.get('/api/projects-map', mapLimiter, asyncHandler(async (_req: Request, res: Response) => {
    const { markers, stale } = await getProjectMapMarkers(projectMapFeedUrl());
    // A document being signed runs in a sandbox with an opaque ("null")
    // origin, so its map fetch is cross-origin and the app-wide CORS answer
    // (our own origin only) blocked it: the map showed with no pins. Public
    // data, fetched without cookies, so any origin may read it.
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300').json({ markers, stale });
  }));

  // A client's reports.
  app.get('/api/clients/:externalId/reports', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      await failStaleReports();

      const rows = await db
        .select({
          id: clientReports.id, reportId: clientReports.reportId, reportType: clientReports.reportType,
          status: clientReports.status, reportUrl: clientReports.reportUrl, pdfUrl: clientReports.pdfUrl,
          error: clientReports.error, title: clientReports.title, createdAt: clientReports.createdAt,
          presentedAt: clientReports.presentedAt,
          // Needed to tell whether JobTread still matches this report.
          data: clientReports.data,
          jobtreadDocumentId: clientReports.jobtreadDocumentId,
          jobtreadPushedHash: clientReports.jobtreadPushedHash,
          jobtreadDocStatus: clientReports.jobtreadDocStatus,
          jobtreadPushedAt: clientReports.jobtreadPushedAt,
        })
        .from(clientReports)
        .where(eq(clientReports.jobExternalId, req.params.externalId))
        .orderBy(desc(clientReports.createdAt));

      // Compare the CURRENT line items against the fingerprint of what was
      // pushed. Done here rather than in JobTread so the list stays a single
      // query — no per-report round trip just to render a badge.
      const reports = rows.map(({ data, jobtreadPushedHash, jobtreadDocumentId, jobtreadDocStatus, ...r }) => ({
        ...r,
        jobtread: {
          ...staleFlag(
            { documentId: jobtreadDocumentId, pushedHash: jobtreadPushedHash, docStatus: jobtreadDocStatus },
            linesFingerprint(linesFromReport(data)),
          ),
          pushedAt: r.jobtreadPushedAt ? new Date(r.jobtreadPushedAt).toISOString() : null,
        },
      }));

      res.json({ ...configStatus(), reports });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/reports');
    }
  });

  // What the report will pull in from JobTread (UI preview), plus Estimate
  // customization defaults from the job's latest submitted field inspection.
  app.get('/api/clients/:externalId/report-context', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      const ctx = await gatherJobContext(req.params.externalId);
      const inspection = await getLatestInspectionContext(req.params.externalId).catch(() => null);
      res.json({
        counts: ctx.counts,
        hasNotes: !!ctx.notes,
        // A measurement report on the job beats both the field guess and the
        // satellite estimate — it is the number someone paid to have measured.
        measurement: ctx.measurementDoc ?? null,
        // The rep picks which of these get analysed; the rest go in the
        // report's appendix. Sent as urls + captions so the picker can show
        // thumbnails without a second round trip.
        photos: ctx.photos.slice(0, 200),
        analyzeLimit: ANALYZE_LIMIT,
        // On a commercial job the Proposal and Presentation read the picked
        // photos before the document is written (commercial-photo-scan.ts).
        photoScan: inspection?.formKind === 'commercial' && commercialScanEnabled(),
        estimateDefaults: (inspection || ctx.measurementDoc) ? {
          mode: inspection?.recommendation === 'Full replacement' ? 'replacement' : 'repair',
          squares: ctx.measurementDoc?.squares ?? inspection?.approxSquares,
          squaresSource: ctx.measurementDoc
            ? `${ctx.measurementDoc.documentName} (measured)`
            : inspection ? 'field inspection (approx)' : null,
          jobType: inspection?.jobType,
          recommendation: inspection?.recommendation,
          // A commercial checklist → the picker defaults to the commercial systems.
          formKind: inspection?.formKind ?? 'residential',
        } : null,
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/report-context');
    }
  });

  // The Good/Better/Best product catalog, for the Estimate/Proposal/Presentation tier picker.
  // `commercial` rides along so the same picker offers the low-slope systems
  // in their own group; `system` tells the client when to ask for an ISO R-value.
  app.get('/api/reports/roofing-products', requireAuth, (_req: Request, res: Response) => {
    res.json({
      products: ROOFING_PRODUCTS.map((p) => ({ key: p.key, name: p.name, category: p.category, ratePerSquare: p.ratePerSquare, tagline: p.tagline })),
      commercial: COMMERCIAL_PRODUCTS.map((p) => ({ key: p.key, name: p.name, category: 'commercial', system: p.system, ratePerSquare: p.ratePerSquare, tagline: p.tagline })),
    });
  });

  // Commercial low-slope systems (Duro-Last, GAF Commercial, restoration coating) on their own.
  app.get('/api/reports/commercial-products', requireAuth, (_req: Request, res: Response) => {
    res.json({ products: COMMERCIAL_PRODUCTS.map((p) => ({ key: p.key, name: p.name, system: p.system, ratePerSquare: p.ratePerSquare, tagline: p.tagline })) });
  });

  // Generate a report in-process. Runs to completion in this request (1-3 min);
  // the row is marked running first so the UI can poll if the browser gives up.
  app.post('/api/clients/:externalId/reports/generate', requireAuth, generateLimiter, async (req: Request, res: Response) => {
    let rowId: number | null = null;
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

      const cfg = configStatus();
      if (!cfg.configured) return res.status(503).json({ error: `Report generation isn't set up yet (missing ${cfg.missing.join(', ')}).` });
      if (!lead.address) return res.status(400).json({ error: 'This client needs a street address before a report can be generated.' });

      const type: ReportType = VALID_TYPES.includes(req.body?.reportType) ? req.body.reportType : 'inspection';
      const reportId = newShareToken();
      // A typed line the pricing would have to drop (quantity 0, "abc") is
      // said back now, not left off the document without a word.
      const lineProblem = estimateLinesProblem(req.body?.customLines);
      if (lineProblem) return res.status(400).json({ error: lineProblem });

      // Estimate customization, requested by the rep before generating.
      // Validated here (not trusted from the client) since a bad product key
      // would otherwise silently price against `undefined`.
      let estimateMode: 'repair' | 'replacement' | 'both' | undefined;
      let tierSelection: { good: TierProductInput; better: TierProductInput; best: TierProductInput } | undefined;
      let selectedTier: 'good' | 'better' | 'best' | undefined;
      let squares: number | undefined;
      // ISO R-value for a commercial tear-off tier; harmless on any other tier.
      let isoTier: IsoTier | undefined;
      // Proposal and Presentation are always the Good/Better/Best comparison;
      // Estimate only needs these when the rep explicitly asked for replacement mode.
      const wantsReplacementPricing = type === 'estimate' && (req.body?.estimateMode === 'replacement' || req.body?.estimateMode === 'both');
      // An Inspection carries options and pricing only when the rep asked for
      // them; generation applies them to a commercial job and ignores them on
      // a residential one.
      const pricedInspection = type === 'inspection' && req.body?.includePricing === true;
      if (wantsReplacementPricing || type === 'proposal' || type === 'presentation' || pricedInspection) {
        const t = req.body?.tierSelection || {};
        const badService = [t.good, t.better, t.best].find((v: any) => v && typeof v === 'object' && isServiceTierKey(v.service) && !serviceTierRateOk(v.ratePerSquare));
        if (badService) {
          return res.status(400).json({ error: `${SERVICE_TIER_LABELS[(badService as any).service as ServiceTierKey]} is priced from $${SERVICE_TIER_RATE_MIN} to $${SERVICE_TIER_RATE_MAX} a square, in whole cents. Pick a rate in that range.` });
        }
        const good = asTierProduct(t.good);
        const better = asTierProduct(t.better);
        const best = asTierProduct(t.best);
        if (!good || !better || !best) {
          return res.status(400).json({ error: 'Pick a real product (or enter a custom name and rate) for each of Good, Better and Best.' });
        }
        const sq = Number(req.body?.squares);
        if (!(sq > 0)) return res.status(400).json({ error: 'Enter the roof size in squares.' });
        const sel = req.body?.selectedTier;
        if (type === 'estimate') estimateMode = req.body?.estimateMode === 'both' ? 'both' : 'replacement';
        tierSelection = { good, better, best };
        selectedTier = sel === 'good' || sel === 'best' ? sel : 'better';
        squares = sq;
        isoTier = asIsoTier(req.body?.isoTier);
      }

      // Specialty scope on a replacement quote. Priced against the catalog
      // with THIS caller's role — a rep's price is never trusted, a manager's
      // override is (shared/scope-catalog.ts, lib/reports/scope-items.ts).
      let scopeLines: ReturnType<typeof resolveScopeItems>['lines'] | undefined;
      if (tierSelection && Array.isArray(req.body?.scopeItems) && req.body.scopeItems.length) {
        const resolved = resolveScopeItems(req.body.scopeItems, { canOverride: atLeast(user.role, 'manager') });
        if (resolved.errors.length) return res.status(400).json({ error: resolved.errors.join(' ') });
        scopeLines = resolved.lines;
      }

      // An estimate or presentation restates an inspection's findings, so reuse
      // the newest one for this job: seconds instead of minutes, no second
      // vision bill, and figures identical to what the customer was shown.
      let reuseData: any;
      if (isDerived(type) && req.body?.reanalyze !== true) {
        const [prior] = await db.select({ data: clientReports.data })
          .from(clientReports)
          .where(and(
            eq(clientReports.jobExternalId, req.params.externalId),
            eq(clientReports.status, 'succeeded'),
          ))
          .orderBy(desc(clientReports.createdAt))
          .limit(1);
        // An Inspection record carries photos but no analysis — reusing it
        // would price a roof from zero findings and call it clean.
        const pd: any = prior?.data;
        // A rep who has just picked a different set of photos wants THOSE
        // read, not the previous document's scan handed back.
        const picked = Array.isArray(req.body?.analyzePhotoUrls) ? req.body.analyzePhotoUrls.filter((u: unknown) => typeof u === 'string') : [];
        const scanStillFits = !pd?.photoScan || sameScanSelection(pd, picked);
        if (pd?.damageAnalysis && !pd.damageAnalysis.analysisSkipped && countAnalyzedPhotos(pd) > 0 && scanStillFits) reuseData = pd;
      }

      // If the browser gave up on a still-in-flight generation (proxy timeout,
      // tab backgrounded) a retry click used to start a second, fully-billed
      // vision-API run — the row was only ever checked for staleness lazily,
      // never here at the point a NEW run gets kicked off. Reuse the
      // in-flight job instead of starting another one.
      const [inFlight] = await db.select({ id: clientReports.id, reportId: clientReports.reportId })
        .from(clientReports)
        .where(and(
          eq(clientReports.jobExternalId, req.params.externalId),
          eq(clientReports.reportType, type),
          eq(clientReports.status, 'running'),
          gte(clientReports.createdAt, new Date(Date.now() - STALE_AFTER_MS)),
        ))
        .orderBy(desc(clientReports.createdAt))
        .limit(1);
      if (inFlight) {
        return res.json({ ok: true, id: inFlight.reportId, status: 'running' });
      }

      const [row] = await db.insert(clientReports).values({
        jobExternalId: req.params.externalId,
        reportId,
        reportType: type,
        status: 'running',
        shareToken: reportId,
        createdBy: user.email,
      }).returning();
      rowId = row.id;

      const out = await generateReport({
        jobId: req.params.externalId,
        type,
        customer: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.jobName || 'Customer',
        address: lead.address,
        city: lead.city, state: lead.state, zip: lead.zip,
        jobNumber: lead.jobNumber, rep: lead.jtSalesRep,
        extraPhotos: Array.isArray(req.body?.photos) ? req.body.photos.filter((u: any) => typeof u === 'string' && u.trim()) : [],
        notes: req.body?.notes,
        includeJobFiles: req.body?.includeJobFiles !== false,
        estimateMode, tierSelection, selectedTier, squares, isoTier, scopeLines,
        customLines: Array.isArray(req.body?.customLines) ? req.body.customLines : undefined,
        analyzePhotoUrls: Array.isArray(req.body?.analyzePhotoUrls)
          ? req.body.analyzePhotoUrls.filter((u: unknown) => typeof u === 'string')
          : undefined,
        reuseData,
      });

      await db.update(clientReports).set({
        status: 'succeeded', html: out.html, data: out.data, title: out.title,
        // A report that analysed nothing still renders, but the gap is recorded
        // so nobody mistakes it for "we looked and found no damage".
        error: out.warning || null,
        reportUrl: `/r/${reportId}`, updatedAt: new Date(),
      }).where(eq(clientReports.id, row.id));

      // A generated report moves the sale to Report, and an inspection report
      // moves a claim on to the adjuster. Best-effort; the report is already saved.
      const { onReportGenerated } = await import('../pipelines/automation');
      onReportGenerated(req.params.externalId, type, user.email).catch(() => {});

      await logWrite({
        actor: user.email, system: 'jobtread', action: 'generate_report', targetId: req.params.externalId,
        summary: `${type} report (${out.analyzedPhotos}/${out.usedPhotos} photos analysed${reuseData ? ', reused prior analysis' : ''})`, ok: true, error: out.warning || null,
      });
      await logReportKpi(user.email, 'report_created', row.id);
      res.json({ ok: true, id: reportId, status: 'succeeded', reportUrl: `/r/${reportId}`, usedPhotos: out.usedPhotos, analyzedPhotos: out.analyzedPhotos, warning: out.warning });
    } catch (error: any) {
      if (rowId != null) {
        await db.update(clientReports)
          .set({ status: 'failed', error: String(error?.message || error).slice(0, 500), updatedAt: new Date() })
          .where(eq(clientReports.id, rowId)).catch(() => {});
      }
      // An address the geocoder cannot find is the caller's problem, not a
      // server fault — 500 sends it to the error trackers and tells the rep
      // nothing actionable. Everything else stays a 500.
      const message = String(error?.message || '');
      if (/geocode/i.test(message)) {
        return res.status(422).json({
          error: "We couldn't find that address on the map, so the storm history can't be pulled. Check the street, city and ZIP on the job.",
        });
      }
      return sendFailure(res, error, 'POST /api/clients/:externalId/reports/generate', 500, 'Report generation failed');
    }
  });

  // Poll one report (the UI polls this while a long generation finishes).
  app.get('/api/reports/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      await failStaleReports();
      const [row] = await db.select().from(clientReports).where(eq(clientReports.reportId, req.params.id));
      if (!row) return res.status(404).json({ error: 'not found' });
      // The id alone answered for any job, so a rep could read the share link
      // of a report on someone else's customer. The same 404 as a missing one.
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, row.jobExternalId))) return res.status(404).json({ error: 'not found' });
      res.json({ id: row.reportId, status: row.status, reportUrl: row.reportUrl, pdfUrl: row.pdfUrl, error: row.error });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/reports/:id');
    }
  });

  // The refinement conversation on one report.
  app.get('/api/clients/:externalId/reports/:reportId/chat', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const [row] = await db.select().from(clientReports).where(
        // Both keys, not just the report id: ownsLead above authorizes the JOB
        // in the URL, so matching on reportId alone would let a caller pair
        // their own externalId with someone else's reportId and act on it.
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json({ turns: (row.data as any)?.refinementChat ?? [] });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/reports/:reportId/chat');
    }
  });

  // Refine a finished report by asking for a change in plain English. The AI may
  // only rewrite prose (see refine.ts); the HTML is re-rendered from the edited
  // data so the document and its data can never disagree.
  /**
   * Read or edit an existing report's estimate lines — WITHOUT regenerating.
   *
   * Re-analysing photos is the slow, expensive part of a report; pricing is
   * not, so a price change has no business triggering one. The lines are
   * replaced wholesale, re-totalled, and the document re-rendered from the
   * same data, so the HTML, the share link and any later JobTread push all
   * stay in step.
   */
  app.get('/api/clients/:externalId/reports/:reportId/estimate', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });
      res.json({
        lines: estimateLinesForEditing(row.data),
        total: (row.data as any)?.repairEstimate?.total ?? 0,
        reportType: row.reportType,
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/reports/:reportId/estimate');
    }
  });

  app.put('/api/clients/:externalId/reports/:reportId/estimate', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      if (!Array.isArray(req.body?.lines)) return res.status(400).json({ error: 'lines must be an array' });

      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });
      const lineProblem = estimateLinesProblem(req.body.lines);
      if (lineProblem) return res.status(400).json({ error: lineProblem });

      const data = setEstimateLines(row.data as any, req.body.lines);

      // Re-render from the same data so the document, the share link and the
      // JobTread push never disagree about the price.
      const render = RENDERERS[row.reportType || ''];
      let html = row.html;
      if (render) {
        try {
          // The same options the editor's preview and save use. A bare
          // customer name dropped the inspection sections, the job type and
          // the cover's name fallback from the live /r/:token copy.
          html = render(data, await renderOptsFor(req.params.externalId, data));
        } catch (e: any) {
          console.error('[reports:estimate] re-render failed:', e?.message || e);
          return res.status(500).json({ error: 'The edit was understood but the report could not be re-rendered, so nothing was saved.' });
        }
      }

      await db.update(clientReports)
        .set({ data, html, updatedAt: new Date() })
        .where(eq(clientReports.id, row.id));

      await logWrite({
        actor: user.email, system: 'app', action: 'edit_estimate', targetId: req.params.externalId,
        summary: `${(data as any).repairEstimate.lineItems.length} lines, $${(data as any).repairEstimate.total}`,
        ok: true, error: null,
      });

      res.json({
        ok: true,
        lines: estimateLinesForEditing(data),
        total: (data as any).repairEstimate.total,
      });
    } catch (error: any) {
      return sendFailure(res, error, 'PUT /api/clients/:externalId/reports/:reportId/estimate');
    }
  });

  /**
   * Talk to the estimate. Returns the PROPOSED lines for the editor to show —
   * it never saves. A price is something a rep defends at a kitchen table, so
   * a person confirms it before it lands on the document.
   */
  /**
   * Ask for any change to the report. Returns a DRAFT for the editor to
   * preview — it never writes. The rep approves what they can see.
   */
  app.post('/api/clients/:externalId/reports/:reportId/chat', requireAuth, refineLimiter, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });

      // Show the model the report AS THE REP CURRENTLY SEES IT — pending edits
      // included. Answering about the saved version would contradict what is
      // on screen and quietly undo their unsaved work.
      const pending = req.body?.draft ?? {};
      const view = applyDraft(row.data, pending).data;
      const editable = {
        title: view.title ?? '',
        executiveSummary: summaryText(view),
        inspectorNotes: view.inspectorNotes ?? '',
        photos: photosForEditing(view).map((p) => ({ id: p.id, caption: p.caption })),
        findings: (view?.damageAnalysis?.photos ?? []).flatMap((p: any) =>
          (p.damages ?? []).map((x: any) => ({ id: x.id, label: x.label, description: x.description }))),
        lines: estimateLinesForEditing(view),
      };

      const out = await editReportByChat(editable, String(req.body?.message || ''));
      if ('error' in out) return res.status(422).json({ error: out.error });
      res.json({ reply: out.reply, draft: out.draft });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/reports/:reportId/chat');
    }
  });

  /**
   * Everything the doc builder needs to open: the current data as editable
   * fields, plus the photo pool to swap from.
   */
  app.get('/api/clients/:externalId/reports/:reportId/editor', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });
      const d: any = row.data;
      const [ctx, ropts] = await Promise.all([
        gatherJobContext(req.params.externalId).catch(() => null),
        renderOptsFor(req.params.externalId, d),
      ]);
      const editable = !!RENDERERS[row.reportType || ''] && (row.reportType !== 'combined' || !!d.combinedProposal);

      res.json({
        reportType: row.reportType,
        editable,
        sections: editable ? sectionInfoFor(row.reportType, d, ropts) : [],
        layout: d.layout ?? null,
        tiers: Array.isArray(d.replacementOptions) ? d.replacementOptions.map((o: any) => ({
          tier: o.tier, product: o.product?.name ?? null, ratePerSquare: Number(o.ratePerSquare) || 0, squares: Number(o.squares) || 0, total: Number(o.total) || 0,
        })) : [],
        selectedTier: d.selectedTier ?? null,
        title: d.title ?? row.title ?? '',
        commercial: editable ? commercialEditorState(row.reportType, d, ropts) : null,
        executiveSummary: summaryText(d),
        inspectorNotes: d.inspectorNotes ?? '',
        // Only the scroll documents carry a narrative; undefined hides the
        // fields on a report type that never had one.
        ...(d.narrative !== undefined && d.narrative !== null
          ? { narrativeFindings: d.narrative.findings ?? '', narrativeSolution: d.narrative.solution ?? '' }
          : {}),
        photos: photosForEditing(d),
        available: (ctx?.photos ?? []).map((p) => ({ url: p.url, caption: p.caption ?? '' })),
        lines: estimateLinesForEditing(d),
        total: d?.repairEstimate?.total ?? 0,
        findings: (d?.damageAnalysis?.photos ?? []).flatMap((p: any) =>
          (p.damages ?? []).map((x: any) => ({ id: x.id, photoId: p.id, label: x.label ?? '', description: x.description ?? '', severity: x.severity ?? null })),
        ),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/reports/:reportId/editor');
    }
  });

  /**
   * Render the report AS IT WOULD BE with these pending changes — without
   * saving. The same applyDraft the save path uses, so what a rep approves is
   * exactly what gets written.
   */
  app.post('/api/clients/:externalId/reports/:reportId/preview', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });

      const applied = applyDraft(row.data, req.body?.draft ?? {});
      const render = RENDERERS[row.reportType || ''];
      if (!render) return res.json({ html: withPreviewBridge(row.html || ''), changes: applied.changes, clearedFindings: applied.clearedFindings, sections: [] });
      try {
        const ropts = await renderOptsFor(req.params.externalId, applied.data);
        const html = render(applied.data, ropts);

        // Does this edit actually show up on THIS report type? A Proposal, for
        // instance, is built from the product tiers and never prints the
        // executive summary — so editing it reports "1 unsaved change", saves,
        // and changes nothing the customer sees. Render the unedited version
        // too and compare, rather than hard-coding which field belongs to
        // which template and getting it wrong as the templates change.
        let invisible: string[] = [];
        if (applied.changes.length) {
          const baseHtml = render(row.data, ropts);
          if (baseHtml === html) invisible = applied.changes;
        }

        res.json({
          html: withPreviewBridge(html), changes: applied.changes, clearedFindings: applied.clearedFindings, invisible,
          sections: sectionInfoFor(row.reportType, applied.data, ropts),
        });
      } catch (e: any) {
        res.status(422).json({ error: `That change can't be rendered: ${e?.message || 'unknown error'}` });
      }
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/reports/:reportId/preview');
    }
  });

  /** Commit the pending changes. */
  app.put('/api/clients/:externalId/reports/:reportId/draft', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const draft = req.body?.draft ?? {};
      if (isEmptyDraft(draft)) return res.status(400).json({ error: 'Nothing to save.' });
      const lineProblem = estimateLinesProblem(draft.lines);
      if (lineProblem) return res.status(400).json({ error: lineProblem });

      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });

      const applied = applyDraft(row.data, draft);
      if (!applied.changes.length) return res.json({ ok: true, changes: [] });

      const render = RENDERERS[row.reportType || ''];
      let html = row.html;
      if (render) {
        try {
          html = render(applied.data, await renderOptsFor(req.params.externalId, applied.data));
        } catch (e: any) {
          console.error('[reports:draft] re-render failed:', e?.message || e);
          return res.status(500).json({ error: 'The changes were understood but the report could not be re-rendered, so nothing was saved.' });
        }
      }

      await db.update(clientReports)
        .set({ data: applied.data, html, title: applied.data?.title || row.title, updatedAt: new Date() })
        .where(eq(clientReports.id, row.id));

      await logWrite({
        actor: user.email, system: 'app', action: 'edit_report', targetId: req.params.externalId,
        summary: applied.changes.join('; ').slice(0, 300), ok: true, error: null,
      });

      res.json({ ok: true, changes: applied.changes, clearedFindings: applied.clearedFindings });
    } catch (error: any) {
      return sendFailure(res, error, 'PUT /api/clients/:externalId/reports/:reportId/draft');
    }
  });

  /**
   * The report's photos, plus the job's other photos to swap one in from.
   * Editing an image or a caption should not cost a full regeneration.
   */
  app.get('/api/clients/:externalId/reports/:reportId/photos', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });

      // The pool to swap FROM: every photo on the job, including the ones that
      // were never analysed — those are exactly what a rep reaches for when the
      // report led with the wrong picture.
      const ctx = await gatherJobContext(req.params.externalId).catch(() => null);
      res.json({
        photos: photosForEditing(row.data),
        available: (ctx?.photos ?? []).map((p) => ({ url: p.url, caption: p.caption ?? '' })),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/reports/:reportId/photos');
    }
  });

  app.put('/api/clients/:externalId/reports/:reportId/photos', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      if (!Array.isArray(req.body?.edits)) return res.status(400).json({ error: 'edits must be an array' });

      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });

      const current = (row.data as any)?.damageAnalysis?.photos ?? [];
      const applied = applyPhotoEdits(current, req.body.edits);
      if (!applied.changed.length) return res.json({ ok: true, changed: [], photos: photosForEditing(row.data) });

      const data = withPhotos(row.data as any, applied.photos);
      const render = RENDERERS[row.reportType || ''];
      let html = row.html;
      if (render) {
        try {
          // renderOptsFor, as the editor's save does — see the estimate edit above.
          html = render(data, await renderOptsFor(req.params.externalId, data));
        } catch (e: any) {
          console.error('[reports:photos] re-render failed:', e?.message || e);
          return res.status(500).json({ error: 'The change was understood but the report could not be re-rendered, so nothing was saved.' });
        }
      }

      await db.update(clientReports).set({ data, html, updatedAt: new Date() }).where(eq(clientReports.id, row.id));
      await logWrite({
        actor: user.email, system: 'app', action: 'edit_report_photos', targetId: req.params.externalId,
        summary: applied.changed.join('; ').slice(0, 300), ok: true, error: null,
      });

      res.json({
        ok: true,
        changed: applied.changed,
        clearedFindings: applied.clearedFindings,
        photos: photosForEditing(data),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'PUT /api/clients/:externalId/reports/:reportId/photos');
    }
  });

  app.post('/api/clients/:externalId/reports/:reportId/estimate/chat', requireAuth, refineLimiter, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });
      const [row] = await db.select().from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'not found' });

      // Trust the lines the editor currently shows over the stored ones: the
      // rep may have typed edits that are not saved yet, and answering about a
      // stale list would silently discard them.
      const current = Array.isArray(req.body?.lines) ? req.body.lines : estimateLinesForEditing(row.data);
      const out = await editEstimateByChat(current, String(req.body?.message || ''));
      if ('error' in out) return res.status(422).json({ error: out.error });
      res.json({ lines: out.lines, summary: out.summary });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/reports/:reportId/estimate/chat');
    }
  });

  app.post('/api/clients/:externalId/reports/:reportId/refine', requireAuth, refineLimiter, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (!(await ownsLead(user, req.params.externalId))) return res.status(404).json({ error: 'not found' });

      const instruction = String(req.body?.instruction || '').trim();
      if (!instruction) return res.status(400).json({ error: 'Tell me what to change.' });
      if (instruction.length > 2000) return res.status(400).json({ error: 'That instruction is too long.' });

      const [row] = await db.select().from(clientReports).where(
        // Both keys, not just the report id: ownsLead above authorizes the JOB
        // in the URL, so matching on reportId alone would let a caller pair
        // their own externalId with someone else's reportId and act on it.
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row) return res.status(404).json({ error: 'not found' });
      if (row.status !== 'succeeded' || !row.data) return res.status(409).json({ error: 'That report has not finished generating yet.' });

      const ai = await refineReport({
        instruction,
        editable: buildEditableSurface(row.data),
        transcript: transcriptForPrompt(row.data),
        system: REFINE_SYSTEM,
      });
      if ('error' in ai) return res.status(502).json({ error: ai.error });

      const { reply, patch } = parseRefineResponse(ai.text);
      const applied = applyReportPatch(row.data, patch);
      const now = new Date().toISOString();
      const turns: RefineTurn[] = [
        { role: 'user', text: instruction, at: now, by: user.email },
        { role: 'assistant', text: reply, at: now, changes: applied.changes },
      ];
      const data = appendTurns(applied.data, turns);

      // Proposal and combined render from their own inputs, not from this data
      // model, so they keep their original HTML rather than risk a blank page.
      let html = row.html;
      const render = RENDERERS[row.reportType || ''];
      if (applied.changes.length && render) {
        try {
          // renderOptsFor, as the editor's save does. Reading the inspection
          // only for an estimate meant a refined Inspection or Presentation
          // lost its checklist sections on the live copy.
          html = render(data, await renderOptsFor(req.params.externalId, data));
        } catch (e: any) {
          console.error('[reports:refine] re-render failed:', e?.message || e);
          return res.status(500).json({ error: 'The edit was understood but the report could not be re-rendered, so nothing was saved.' });
        }
      }

      // The AI call takes seconds, and the editor can save over the same row
      // meanwhile. Writing regardless put this refinement on top of the data
      // as it was read and silently threw the other save away.
      const [saved] = await db.update(clientReports)
        .set({ data, html, title: (data as any).title || row.title, updatedAt: new Date() })
        .where(and(eq(clientReports.id, row.id), unchangedSince(row.updatedAt)))
        .returning({ id: clientReports.id });
      if (!saved) {
        return res.status(409).json({ error: 'This report was changed while I was working on it, so nothing was saved. Ask again and I will work from the latest version.' });
      }

      await logWrite({
        actor: user.email, system: 'jobtread', action: 'refine_report', targetId: req.params.externalId,
        summary: applied.changes.length ? `changed ${applied.changes.join(', ')}` : 'no change', ok: true,
      });
      res.json({ ok: true, reply, changes: applied.changes, reportUrl: row.reportUrl });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/reports/:reportId/refine', 500, 'Refinement failed');
    }
  });

  // Push a finished report into JobTread: proposal + budget + material order.
  app.post('/api/clients/:externalId/reports/:reportId/to-jobtread', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

      const [row] = await db.select().from(clientReports).where(
        // Both keys, not just the report id: ownsLead above authorizes the JOB
        // in the URL, so matching on reportId alone would let a caller pair
        // their own externalId with someone else's reportId and act on it.
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row?.data) return res.status(404).json({ error: 'That report has no saved data yet.' });

      // Does JobTread already hold a proposal for this report, and may it be
      // rewritten? A sent or signed document is one the customer is relying on.
      const lines = linesFromReport(row.data);
      if (!lines.length) {
        return res.status(422).json({ error: "That report has no priced estimate, so there's nothing to build a proposal from." });
      }
      const currentHash = linesFingerprint(lines);
      const jtClient = new JobTreadClient();
      const live = row.jobtreadDocumentId
        ? (await jtClient.getDocumentStatus(row.jobtreadDocumentId)).status
        : null;
      const verdict = decideSync(
        { documentId: row.jobtreadDocumentId, pushedHash: row.jobtreadPushedHash, docStatus: row.jobtreadDocStatus },
        currentHash,
        live,
      );

      if (verdict.action === 'blocked') {
        // 409, not 500: the request is understood and refused on purpose.
        return res.status(409).json({
          error: verdict.reason, blocked: true, documentId: verdict.documentId, status: verdict.status,
          canCreateNewVersion: true,
        });
      }
      if (verdict.action === 'up_to_date' && req.body?.force !== true) {
        return res.json({ ok: true, upToDate: true, documentId: verdict.documentId, message: verdict.reason });
      }

      // Update the existing draft rather than leaving a second proposal, with
      // two different prices, on the same job.
      if (verdict.action === 'update') {
        const upd = await jtClient.updateJobDocumentLines(verdict.documentId, lines, {
          taxRate: typeof req.body?.taxRate === 'number' ? req.body.taxRate : undefined,
        });
        if (!upd.ok) return res.status(502).json({ error: upd.error });
        await db.update(clientReports)
          .set({ jobtreadPushedAt: new Date(), jobtreadPushedHash: currentHash, jobtreadDocStatus: live || 'draft', updatedAt: new Date() })
          .where(eq(clientReports.id, row.id));
        await logWrite({
          actor: user.email, system: 'jobtread', action: 'report_to_jobtread_update', targetId: req.params.externalId,
          summary: `updated draft ${verdict.documentId} · ${lines.length} lines`, ok: true, error: null,
        });
        return res.json({ ok: true, updated: true, documentId: verdict.documentId, lineCount: lines.length });
      }

      const result = await pushReportToJobTread({
        jobId: req.params.externalId,
        report: row.data,
        customerName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.jobName || 'Customer',
        customerEmail: lead.email,
        address: [lead.address, lead.city, lead.state].filter(Boolean).join(', ') || null,
        want: {
          proposal: req.body?.proposal !== false,
          budget: req.body?.budget !== false,
          materialOrder: req.body?.materialOrder !== false,
        },
      });

      if (!result.lineCount) {
        return res.status(422).json({ error: "That report has no priced estimate, so there's nothing to build a proposal from." });
      }

      // Remember the document so the NEXT push updates it instead of stacking
      // another proposal onto the job.
      if (result.proposal?.ok && result.proposal.documentId) {
        await db.update(clientReports)
          .set({
            jobtreadDocumentId: result.proposal.documentId,
            jobtreadPushedAt: new Date(),
            jobtreadPushedHash: currentHash,
            jobtreadDocStatus: 'draft',
            updatedAt: new Date(),
          })
          .where(eq(clientReports.id, row.id));
      }

      await logWrite({
        actor: user.email, system: 'jobtread', action: 'report_to_jobtread', targetId: req.params.externalId,
        summary: `${result.lineCount} lines → ${[result.proposal?.ok && 'proposal', result.budget?.ok && 'budget', result.materialOrder?.ok && 'material order'].filter(Boolean).join(', ') || 'nothing'}`,
        ok: !!(result.proposal?.ok || result.budget?.ok || result.materialOrder?.ok),
        error: [result.proposal?.error, result.budget?.error, result.materialOrder?.error].filter(Boolean).join('; ') || null,
      });
      res.json({ ok: true, ...result });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/reports/:reportId/to-jobtread', 502); }
  });

  // Mark a report as shown to the customer (in person or otherwise) — distinct
  // from generating it and from sending a JobTread proposal. Idempotent: a
  // second call just returns the already-set state, no double-counting.
  app.post('/api/clients/:externalId/reports/:reportId/present', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

      const [row] = await db.select().from(clientReports).where(
        // Both keys, not just the report id: ownsLead above authorizes the JOB
        // in the URL, so matching on reportId alone would let a caller pair
        // their own externalId with someone else's reportId and act on it.
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row) return res.status(404).json({ error: 'not found' });

      // Conditional on presentedAt being NULL rather than read-then-write: two
      // concurrent calls (e.g. a double-tap) both used to pass the read-then-check
      // above and both log a KPI event, despite the comment claiming no
      // double-counting was possible.
      const presentedAt = new Date();
      const [updated] = await db.update(clientReports)
        .set({ presentedAt, presentedBy: user.email, updatedAt: presentedAt })
        .where(and(eq(clientReports.id, row.id), isNull(clientReports.presentedAt)))
        .returning();
      if (!updated) return res.json({ ok: true, presentedAt: row.presentedAt, presentedBy: row.presentedBy });

      await logReportKpi(user.email, 'report_presented', row.id);
      // Presenting the report is the sit-down: the sales board moves with it.
      const { onReportPresented } = await import('../pipelines/automation');
      const automation = await onReportPresented(req.params.externalId, user.email);
      res.json({ ok: true, presentedAt, presentedBy: user.email, automation });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/clients/:externalId/reports/:reportId/present');
    }
  });

  // Delete a report. Its share link stops working with it. A copy already sent
  // for signature is untouched — signing freezes its own copy of the HTML
  // (signatures/providers.ts buildSignable) — and so is a proposal already in
  // JobTread. The KPI event for making it stays: the work was still done.
  app.delete('/api/clients/:externalId/reports/:reportId', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead) return res.status(404).json({ error: 'not found' });
      if (!(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });

      // Both keys, as in /present: ownsLead authorizes the job in the URL, not the report id.
      const [row] = await db.select({ id: clientReports.id, status: clientReports.status }).from(clientReports).where(
        and(eq(clientReports.reportId, req.params.reportId), eq(clientReports.jobExternalId, req.params.externalId)),
      );
      if (!row) return res.status(404).json({ error: 'not found' });
      // A generation still running would finish into a row that is gone; let it land first.
      if (row.status === 'queued' || row.status === 'running') {
        return res.status(409).json({ error: 'This report is still being made. Delete it once it finishes.' });
      }

      await db.delete(clientReports).where(eq(clientReports.id, row.id));
      console.info(`[reports] ${user.email} deleted report ${req.params.reportId} on job ${req.params.externalId}`);
      res.json({ ok: true });
    } catch (error: any) {
      return sendFailure(res, error, 'DELETE /api/clients/:externalId/reports/:reportId');
    }
  });

  // Activate click-to-sign on a draft proposal (draft → pending).
  app.post('/api/documents/:documentId/activate-signing', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const jtDoc = new JobTreadClient();
      // A document id says nothing about who owns the work behind it, so
      // resolve it to a job and check scope. 404 rather than 403 so the
      // response is not an existence oracle for other reps' documents.
      const ownerJob = await jtDoc.getDocumentJobId(req.params.documentId);
      if (!ownerJob || !(await ownsLead(user as any, ownerJob))) {
        return res.status(404).json({ error: 'not found' });
      }
      const r = await jtDoc.setDocumentStatus(req.params.documentId, 'pending');
      await logWrite({ actor: user.email, system: 'jobtread', action: 'activate_signing', targetId: req.params.documentId, summary: 'draft → pending', ok: r.ok, error: r.error || null });
      if (!r.ok) return res.status(502).json({ error: r.error });
      res.json({ ok: true });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/documents/:documentId/activate-signing', 502); }
  });

  // Email a proposal to the customer for signature — explicit action only.
  app.post('/api/documents/:documentId/send', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const name = String(req.body?.name || '').trim();
      const email = String(req.body?.email || '').trim();
      if (!name || !email) return res.status(400).json({ error: 'Customer name and email are required.' });

      const jt = new JobTreadClient();
      // Without this, any signed-in user could mail ANY customer's proposal —
      // pricing included — to an address of their choosing, because both the
      // document id and the recipient come straight from the request.
      const ownerJob = await jt.getDocumentJobId(req.params.documentId);
      if (!ownerJob || !(await ownsLead(user as any, ownerJob))) {
        return res.status(404).json({ error: 'not found' });
      }
      await jt.setDocumentStatus(req.params.documentId, 'pending');
      const r = await jt.sendDocumentToCustomer(req.params.documentId, { name, email }, req.body?.message);

      await logWrite({ actor: user.email, system: 'jobtread', action: 'send_proposal', targetId: req.params.documentId, summary: `to ${email}`, ok: r.ok, error: r.error || null });
      if (!r.ok) return res.status(502).json({ error: r.error });
      res.json({ ok: true });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/documents/:documentId/send', 502); }
  });
}
