/**
 * In-process roof report generation.
 *
 * The generation engine (ported into server/lib/reports/) runs inside this app —
 * no second service, no API key. Photos, notes and documents come from the
 * client's JobTread job; the rendered HTML and the structured report are stored
 * on `client_reports` and served from /r/<token>.
 */
import crypto from 'crypto';
import { generateInspectionReport } from '../lib/reports/generate-inspection';
import { generateCombinedReport } from '../lib/reports/generate-combined';
import { gatherJobContext } from './job-context';
import { parseUsAddress } from '../lib/reports/address-utils';
import { renderEstimateHtml } from '../lib/reports/render-estimate-html';
import { renderInspectionHtml } from '../lib/reports/render-inspection-html';
import { renderPresentationScrollcraftHtml } from '../lib/reports/render-presentation-scrollcraft';
import { renderProposalScrollcraftHtml } from '../lib/reports/render-proposal-scrollcraft';
import { renderCommercialProposalHtml } from '../lib/reports/render-commercial-proposal';
import { renderCommercialPresentationHtml } from '../lib/reports/render-commercial-presentation';
import { renderCommercialInspectionHtml } from '../lib/reports/render-commercial-inspection-html';
import { commercialSnapshot } from '../lib/reports/commercial-context';
import { getLatestInspectionContext } from '../inspections/lookup';
import { applyReplacementPricing } from '../lib/reports/estimate-replacement';
import { withCustomLines, buildEstimateOptions, type CustomLineInput } from '../lib/reports/estimate-editing.js';
import { splitPhotosForAnalysis, renderPhotoAppendix, ANALYZE_LIMIT } from './photo-selection.js';
import type { TierSelection } from '../lib/reports/roofing-products';
import type { RepairEstimate } from '../lib/reports/roof-repair-pricing';
import { buildReportNarrative } from '../lib/reports/report-narrative.js';
import { commercialScanEnabled, scanCommercialPhotos, applyPhotoScan, scanWarning, scanDeadline } from '../lib/reports/commercial-photo-scan.js';

export type ReportType = 'inspection' | 'estimate' | 'proposal' | 'presentation' | 'combined';
export const VALID_TYPES: ReportType[] = ['inspection', 'estimate', 'proposal', 'presentation', 'combined'];

/**
 * Types that are a different PRESENTATION of an inspection's findings rather
 * than new analysis. They can be built from a previous inspection's stored data
 * in a second or two, instead of re-running vision on every photo — which costs
 * money and, at 3-7 minutes, runs close to the serverless time limit. Proposal
 * is "basically a retail estimate and inspection combination" (per design
 * discussion), so it reuses the same stored damage/storm data too, rather than
 * running its own separate generation path.
 */
export const DERIVED_TYPES: ReportType[] = ['estimate', 'presentation', 'proposal'];
export const isDerived = (t: ReportType): boolean => DERIVED_TYPES.includes(t);

/**
 * Photo damage analysis runs on Groq specifically (generate-inspection gates on
 * GROQ_API_KEY; Gemini is only a per-image fallback *inside* that path). Checking
 * a broader set — especially the generically-named API_KEY — made the app report
 * itself "configured" while every report silently analysed zero photos and came
 * back "no damage". Be exact.
 */
export function visionConfigured(): boolean {
  // fal.ai (Qwen3-VL) is the primary provider; Groq is a secondary.
  return !!(process.env.FAL_AI_API_KEY || process.env.FAL_KEY || process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY);
}
export function generationConfigured(): boolean {
  return visionConfigured();
}

/**
 * Whether reports may run the vision model over job photos at all. OFF until
 * the owner turns it on (REPORT_IMAGE_ANALYSIS=on): every document carries
 * the photos as taken and takes its findings from the field checklist and
 * the inspector's notes. The Inspection is record-only regardless.
 */
export function imageAnalysisEnabled(): boolean {
  return process.env.REPORT_IMAGE_ANALYSIS === 'on';
}

export function configStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (imageAnalysisEnabled() && !visionConfigured()) missing.push('FAL_AI_API_KEY (or GROQ_API_KEY)');
  return { configured: missing.length === 0, missing };
}

export const newShareToken = (): string => crypto.randomBytes(16).toString('hex');

export interface GenerateInput {
  jobId: string;
  type: ReportType;
  customer: string;
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  jobNumber?: string | null;
  rep?: string | null;
  /** Extra photo URLs on top of whatever is attached to the job. */
  extraPhotos?: string[];
  notes?: string;
  /** Pull the job's photos/messages/documents from JobTread (default true). */
  includeJobFiles?: boolean;
  /**
   * A previous inspection's report data. When present, an estimate or
   * presentation is rendered straight from it — no geocoding, no storm lookup,
   * no re-analysing photos.
   */
  reuseData?: any;
  /**
   * Estimate customization, requested by the rep before generating (the
   * "repair or replace, which products, what roof size" step). Repair is the
   * default — replacement requires all three replacement fields or generation
   * fails with a clear message rather than guessing.
   */
  /** 'both' shows repair AND replacement side by side on one document. */
  estimateMode?: 'repair' | 'replacement' | 'both';
  /** Lines the rep typed in, appended to the repair scope. */
  customLines?: CustomLineInput[];
  /**
   * Which photos to run through damage analysis. Everything else on the job
   * still appears in the report, just in the appendix rather than analysed.
   * Empty/absent = take the first ANALYZE_LIMIT.
   */
  analyzePhotoUrls?: string[];
  /**
   * Good/Better/Best inputs. Required for Proposal (it's always a three-way
   * comparison); only used for Estimate when estimateMode is 'replacement'.
   */
  tierSelection?: TierSelection;
  /** Estimate: which tier is priced/pushed. Proposal: which tier opens selected in the interactive comparison. */
  selectedTier?: 'good' | 'better' | 'best';
  squares?: number;
  /** ISO R-value for a commercial tear-off tier (validated by the route). */
  isoTier?: 'r25' | 'r30';
  /**
   * Priced specialty scope for a replacement quote, already resolved against
   * the catalog and the caller's role (scope-items.ts) — the route does that,
   * because the role is known there and not here.
   */
  scopeLines?: RepairEstimate[];
}

export interface GenerateOutput {
  html: string;
  data: any;
  title: string;
  usedPhotos: number;
  /** How many photos the AI actually examined (0 means no damage was assessed). */
  analyzedPhotos: number;
  /** Set when the report is materially incomplete — surfaced in the UI. */
  warning?: string;
}

/**
 * A report that examined no photos still renders, but it must not be mistaken
 * for "we looked and found nothing" — that's a claim a rep could put in front of
 * a customer. Count what the engine actually analysed.
 */
export function countAnalyzedPhotos(data: any): number {
  // The engine stores them under damageAnalysis.photos (not data.photos), and a
  // photo the model couldn't read is recorded with an "Unable to analyze this
  // image." summary — those must NOT count as examined, or a report where every
  // image failed would look like a clean inspection.
  const photos = data?.damageAnalysis?.photos ?? data?.photos ?? data?.analyzedPhotos;
  if (!Array.isArray(photos)) return 0;
  return photos.filter((p: any) => !/unable to analyze|not analysed/i.test(String(p?.aiSummary || ''))).length;
}

/**
 * Types that make a damage claim. For these, analysing no photos is a real
 * problem worth surfacing. Proposal's "What We Found" chapter shows real
 * damage photos too (it's the same stored inspection data as Estimate), so
 * it belongs here now — the old proposal system that only sold replacement
 * packages and never looked at photos is retired.
 */
// The Inspection is deliberately absent: it is the inspector's record and
// never analyses photos, so "no photos analysed" is not a defect there.
export const ASSESSES_DAMAGE: ReportType[] = ['estimate', 'presentation', 'proposal', 'combined'];

/** Attach photo-analysis diagnostics so a hollow report is never mistaken for a clean one. */
function withDiagnostics(
  base: { html: string; data: any; title: string },
  usedPhotos: number,
  type: ReportType,
  appendixPhotos: Array<{ url: string; caption?: string }> = [],
  /**
   * A commercial scroll document shows the unscanned photos in its own
   * findings chapter and reports its own scan shortfall — so it neither
   * appends the plain appendix nor takes the residential vision warning.
   */
  commercialScan?: { warning: string | undefined },
): GenerateOutput {
  const analyzed = countAnalyzedPhotos(base.data);
  let warning: string | undefined = commercialScan?.warning;
  // With image analysis switched off, an unanalysed photo set is the design,
  // not a failed vision pass — no warning.
  if (!commercialScan && ASSESSES_DAMAGE.includes(type) && imageAnalysisEnabled()) {
    if (usedPhotos > 0 && analyzed === 0) {
      warning = `No photos were analysed (${usedPhotos} were attached), so this report contains no damage assessment. Check the vision provider (FAL_AI_API_KEY / GROQ_API_KEY).`;
    } else if (usedPhotos === 0) {
      warning = 'No photos were available for this job, so this report contains no damage assessment.';
    } else if (analyzed < usedPhotos) {
      // Say so rather than let a partial read look complete: on a big job the
      // vision pass stops at its time budget, and which photos were seen is
      // the difference between a supported finding and a missed one.
      warning = `Analysed ${analyzed} of ${usedPhotos} photos before hitting the time limit. Regenerate to pick up the rest, or raise VISION_BUDGET_MS.`;
    }
  }
  // Photos the rep did not send for analysis are still the customer's
  // evidence — appended so they appear in the document, clearly labelled as
  // not analysed rather than quietly dropped.
  const html = appendixPhotos.length && !commercialScan
    ? base.html.replace(/<\/body>/i, `${renderPhotoAppendix(appendixPhotos)}</body>`)
    : base.html;
  return {
    ...base,
    html,
    // A reused report keeps the appendix it was built with: the list passed
    // here is empty on that path, and overwriting it would drop the photos
    // from the next re-render.
    data: { ...base.data, appendixPhotos: appendixPhotos.length ? appendixPhotos : (base.data?.appendixPhotos ?? []) },
    usedPhotos,
    analyzedPhotos: analyzed,
    warning,
  };
}

/**
 * Generate a report end to end. Throws on failure so the caller can record the
 * error against the report row.
 */
export async function generateReport(input: GenerateInput): Promise<GenerateOutput> {
  const startedAt = Date.now();
  if (imageAnalysisEnabled() && !generationConfigured()) {
    throw new Error('Report generation is not configured — add FAL_AI_API_KEY (or GROQ_API_KEY).');
  }
  if (!input.address) throw new Error('This client needs a street address before a report can be generated.');

  // The job's own photos/notes/documents feed the report.
  const ctx = input.includeJobFiles === false ? null : await gatherJobContext(input.jobId);
  const seen = new Set<string>();
  const allPhotos = [
    ...(input.extraPhotos || []).map((url) => ({ url })),
    ...(ctx?.photos || []),
  ].filter((p) => p.url && !seen.has(p.url) && seen.add(p.url));

  // A rep picks which photos are worth analysing — the ones that show the
  // damage. The rest are still the customer's evidence, so they go in the
  // appendix rather than being dropped. Analysing 100 photos to find damage
  // in six is slow and dilutes the findings.
  const { analyzed: photos, appendix: appendixPhotos } = splitPhotosForAnalysis(allPhotos, input.analyzePhotoUrls);

  // The rep's own notes ONLY.
  //
  // The job-context dump (JobTread comments, documents on file, photo counts)
  // used to be concatenated in here, so the editor's "Inspector Notes" box
  // opened full of internal material — other people's field notes, draft
  // document numbers, "60 job photos on file" — presented as though the rep
  // had written it. Nothing reads this field for generation; it exists to be
  // edited and shown. The context still reaches the report through the
  // channels that are actually read: photos, measurements and job type.
  const inspectorNotes = input.notes?.trim() || undefined;

  // JobTread stores the FULL formatted address ("123 Main St, Springfield, IL
  // 62701, USA"), but the engine appends city/state/zip itself — concatenating
  // both produces a duplicated string that geocoders reject outright. Split it
  // back into parts and prefer those.
  const parsed = parseUsAddress(input.address);
  const street = parsed.address || input.address;
  const city = parsed.city || input.city || '';
  const state = parsed.state || input.state || '';
  const zip = parsed.zip || input.zip || undefined;
  const dated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // The field inspection (rep's on-site checklist) is the main source
  // document for every report type: its job type (retail/insurance) and
  // recommendation drive framing across Inspection, Estimate, Proposal and
  // Presentation alike, so a rep never re-answers what the inspector
  // already answered on-site. Best effort — a lookup failure or no
  // submission yet just falls back to each report's existing framing
  // rather than blocking generation.
  const inspectionCtx = await getLatestInspectionContext(input.jobId).catch(() => null);
  // A commercial checklist routes the job to the commercial documents and is
  // snapshotted onto the report data so re-renders can rebuild them.
  const commercial = commercialSnapshot(inspectionCtx);

  // The storm date + type the rep explicitly picked on the field inspection
  // (never an automatic NOAA guess) — only set when BOTH are answered, so a
  // half-filled checklist doesn't produce a storm claim with no type, or a
  // type with no date. This is what Proposal's top timeline reads to decide
  // whether to show a storm event at all (see chapterWhatWeFound).
  const stormDateAnswer = inspectionCtx?.answers?.['Storm Date'];
  const stormTypeAnswer = inspectionCtx?.answers?.['Storm Type'];
  const repConfirmedStorm = (stormDateAnswer && stormTypeAnswer)
    ? { date: String(stormDateAnswer), type: String(stormTypeAnswer) }
    : null;

  // The estimate mode requested by the rep (repair is the itemized-damage
  // default; replacement needs the three customization fields). Applied to
  // whichever source report Estimate ends up rendering from, below.
  const buildEstimate = (source: any) => {
    const mode = input.estimateMode ?? 'repair';
    // Typed lines join the REPAIR scope, so they survive into 'both' as part
    // of the repair option rather than being replaced by the new-roof line.
    const withTyped = withCustomLines(source, input.customLines);

    let report: any;
    if (mode === 'repair') {
      report = withTyped;
    } else {
      const replaced = applyReplacementPricing(withTyped, {
        tierSelection: input.tierSelection!,
        squares: input.squares ?? 0,
        selectedTier: input.selectedTier ?? 'better',
        scopeLines: input.scopeLines,
        isoTier: input.isoTier,
      });
      if (mode === 'replacement') {
        report = replaced;
      } else {
        // 'both': keep the itemised repair AND the new-roof price, so the
        // customer sees the actual choice. applyReplacementPricing overwrites
        // repairEstimate.lineItems, so the repair scope is taken from the
        // pre-replacement report.
        const repairLines = withTyped.repairEstimate?.lineItems ?? [];
        const replacementLines = replaced.repairEstimate?.lineItems ?? [];
        const built = buildEstimateOptions({
          repairLines,
          replacementLines,
          roofAgeYears: source?.roofAge?.estimatedAge ?? source?.roofDetails?.age_years ?? null,
        });
        report = {
          ...replaced,
          // The repair scope is what the document leads with; the replacement
          // price rides alongside as the second option.
          repairEstimate: withTyped.repairEstimate,
          estimateOptions: built.options,
          recommendedOption: built.recommend,
          recommendedOptionReason: built.because,
        };
      }
    }
    const html = renderEstimateHtml(report, { customer: input.customer, jobType: inspectionCtx?.jobType, recommendation: inspectionCtx?.recommendation, inspection: inspectionCtx });
    return { html, data: report };
  };
  // The stored title must say which kind of estimate this is — the hero
  // already does (estimateTitle), the list the rep sees should agree.
  const estimateTitleFor = (data: any) => `${data?.replacementOptions?.length ? 'Roof Replacement Estimate' : 'Roof Repair Estimate'} — ${dated}`;

  // Proposal is always the Good/Better/Best comparison — the three
  // customization fields are required, not optional the way Estimate's
  // replacement mode is. Reuses applyReplacementPricing (same helper as
  // Estimate's replacement mode) so the SAME single selected-tier line item
  // ends up in repairEstimate.lineItems — Proposal's "push to JobTread"
  // button then needs no separate code path.
  // The property-specific narrative chapters. Written from the stored
  // findings and the rep's checklist (never a second vision pass), best
  // effort: a failure means the document has no narrative, not no document.
  const withNarrative = async (report: any, wantSolution = true) => {
    const selected = (report.replacementOptions ?? []).find((o: any) => o.tier === report.selectedTier);
    const narrative = await buildReportNarrative({
      wantSolution,
      report,
      customer: input.customer,
      inspectorNotes,
      damageSummary: inspectionCtx?.damageSummary,
      answers: inspectionCtx?.answers as Record<string, unknown> | null | undefined,
      recommendation: inspectionCtx?.recommendation,
      recommendedProduct: selected?.product?.name,
      squares: input.squares ?? null,
      jobType: inspectionCtx?.jobType,
    }).catch(() => null);
    return narrative ? { ...report, narrative } : report;
  };

  const buildProposal = async (source: any) => {
    if (!input.tierSelection || !(input.squares! > 0)) {
      throw new Error('Pick your Good, Better and Best products and confirm the roof size before generating a Proposal.');
    }
    const report = await withNarrative(applyReplacementPricing(source, {
      tierSelection: input.tierSelection,
      squares: input.squares!,
      selectedTier: input.selectedTier ?? 'better',
      scopeLines: input.scopeLines,
      isoTier: input.isoTier,
    }));
    const html = commercial
      ? renderCommercialProposalHtml(report, { customer: input.customer, jobType: inspectionCtx?.jobType, inspection: inspectionCtx })
      : renderProposalScrollcraftHtml(report, { customer: input.customer, jobType: inspectionCtx?.jobType, damageSummary: inspectionCtx?.damageSummary });
    return { html, data: report };
  };

  // Presentation is also always the Good/Better/Best comparison, same
  // required fields as Proposal — it's the "most detailed" of the four
  // types and shows the same real tier pricing, just as a rep-narrated
  // gallery instead of a customer-explored document.
  const buildPresentation = async (source: any) => {
    if (!input.tierSelection || !(input.squares! > 0)) {
      throw new Error('Pick your Good, Better and Best products and confirm the roof size before generating a Presentation.');
    }
    const report = await withNarrative(applyReplacementPricing(source, {
      tierSelection: input.tierSelection,
      squares: input.squares!,
      selectedTier: input.selectedTier ?? 'better',
      scopeLines: input.scopeLines,
      isoTier: input.isoTier,
    }));
    const html = commercial
      ? renderCommercialPresentationHtml(report, { customer: input.customer, rep: input.rep ?? undefined, jobType: inspectionCtx?.jobType, inspection: inspectionCtx })
      : renderPresentationScrollcraftHtml(report, { customer: input.customer, rep: input.rep ?? undefined, jobType: inspectionCtx?.jobType, inspection: inspectionCtx });
    return { html, data: report };
  };

  // A measurement report on the job (GAF / EagleView) is the basis of the
  // price — its facets, pitch and edge lengths ride on the report so the
  // document can say where the squares came from.
  const md = ctx?.measurementDoc;
  const measurements = md ? {
    source: md.source, documentName: md.documentName, roofAreaSqFt: md.roofAreaSqFt, squares: md.squares, facets: md.facets,
    predominantPitch: md.predominantPitch, ridgesHipsFt: md.ridgesHipsFt, valleysFt: md.valleysFt, rakesFt: md.rakesFt, eavesFt: md.eavesFt,
  } : undefined;

  // Estimate, Proposal and Presentation restate an inspection's findings.
  // Rendering them from the stored report keeps every figure identical to
  // the inspection the customer may already have been shown.
  if (isDerived(input.type) && input.reuseData?.damageAnalysis) {
    // Always read from the LATEST inspection answers, not whatever was true
    // when the reused report was first generated — a rep can fill in the
    // storm lookup after the fact and regenerate the proposal to pick it up.
    const source = { ...input.reuseData, repConfirmedStorm, ...(measurements ? { measurements } : {}), ...(commercial ? { commercial } : {}) };
    const built = await (input.type === 'estimate' ? buildEstimate(source)
      : input.type === 'proposal' ? buildProposal(source)
      : input.type === 'presentation' ? buildPresentation(source)
      : null);
    if (!built) throw new Error(`Unhandled derived report type: ${input.type}`);
    const title = input.type === 'estimate' ? estimateTitleFor(built.data) : input.type === 'proposal' ? `${commercial ? 'Commercial ' : ''}Roofing Proposal — ${dated}` : `${commercial ? 'Commercial ' : ''}Roof Presentation — ${dated}`;
    const reusedScan = commercial && input.type !== 'estimate' && source.photoScan ? { warning: undefined } : undefined;
    return withDiagnostics({ html: built.html, data: built.data, title }, source.damageAnalysis?.totalPhotosAnalyzed ?? 0, input.type, [], reusedScan);
  }

  if (input.type === 'combined') {
    const r: any = await generateCombinedReport({
      customer: input.customer,
      address: street,
      city, state, zip,
      jobNumber: input.jobNumber || undefined,
      rep: input.rep || undefined,
      photos,
      inspectorNotes,
    } as any);
    // Keep the proposal inputs on the data, so the editor can re-render this
    // document after a change (it used to keep only the inspection report,
    // which left a Combined report un-editable).
    const combinedData = { ...(r.report ?? r), combinedProposal: r.proposal ?? null };
    return withDiagnostics({ html: r.html, data: combinedData, title: `Roof Inspection & Proposal — ${dated}` }, photos.length, input.type, appendixPhotos);
  }

  // The Inspection document is the inspector's record: every job photo as
  // taken, the checklist, and the notes — no vision pass, no generated
  // findings, no narrative. Derived documents (Estimate/Proposal/Presentation)
  // still analyse photos, on their own run, below.
  if (input.type === 'inspection') {
    // A commercial Inspection reads the photos the rep picked, the same scan
    // the Proposal and Presentation run; every job photo is still on the
    // record as taken. A residential Inspection never analyses a photo.
    const scanRecord = !!commercial && commercialScanEnabled();
    const [rec, recScan] = await Promise.all([
      generateInspectionReport({
        address: street, city, state, zip, jobId: input.jobId,
        photos: allPhotos.slice(0, 200), inspectorNotes, jobType: inspectionCtx?.jobType, analyzePhotos: false,
      }),
      scanRecord
        ? scanCommercialPhotos(photos, inspectionCtx?.answers, { deadline: scanDeadline(startedAt) }).catch((err) => {
            console.error('[report] commercial photo scan failed:', err?.message || err);
            return { results: photos.map(() => null), requested: photos.length, scanned: 0, timedOut: false };
          })
        : Promise.resolve(null),
    ]);
    let base: any = { ...rec.report, customerName: input.customer, repConfirmedStorm, ...(measurements ? { measurements } : {}), ...(commercial ? { commercial } : {}) };
    if (recScan) base = applyPhotoScan(base, photos, recScan);
    // Options and pricing ride on a commercial Inspection only when the rep
    // picked the three systems for it; otherwise the document carries no price.
    if (commercial && input.tierSelection && input.squares! > 0) {
      base = applyReplacementPricing(base, {
        tierSelection: input.tierSelection,
        squares: input.squares!,
        selectedTier: input.selectedTier ?? 'better',
        scopeLines: input.scopeLines,
        isoTier: input.isoTier,
      });
    }
    // The in-depth write-up is composed from the checklist and the notes
    // (findings only — no sales argument on the adjuster's document), plus
    // what the scan read in the photos when there was one.
    const record = await withNarrative(base, false);
    const recordHtml = commercial
      ? renderCommercialInspectionHtml(record, { jobType: inspectionCtx?.jobType, inspection: inspectionCtx })
      : renderInspectionHtml(record, { jobType: inspectionCtx?.jobType, inspection: inspectionCtx });
    return withDiagnostics(
      { html: recordHtml, data: record, title: commercial ? `Commercial Roof Condition Report — ${dated}` : `Roof Inspection — ${dated}` },
      allPhotos.length, input.type, [], recScan ? { warning: scanWarning(recScan) } : undefined,
    );
  }

  // A commercial Proposal or Presentation reads the photos the rep picked
  // with its own low-slope scan (commercial-photo-scan.ts) instead of the
  // residential damage pass, which looks for shingle damage and prices
  // repairs by type. It runs alongside the storm lookup, not after it.
  const scanPhotos = !!commercial && (input.type === 'proposal' || input.type === 'presentation') && commercialScanEnabled();
  const [r, scan] = await Promise.all([
    generateInspectionReport({
      address: street,
      city, state, zip,
      jobId: input.jobId,
      photos,
      inspectorNotes,
      jobType: inspectionCtx?.jobType,
      // The owner's switch: until it is on, no document analyses images.
      analyzePhotos: scanPhotos ? false : imageAnalysisEnabled(),
    }),
    scanPhotos
      ? scanCommercialPhotos(photos, inspectionCtx?.answers, { deadline: scanDeadline(startedAt) }).catch((err) => {
          console.error('[report] commercial photo scan failed:', err?.message || err);
          return { results: photos.map(() => null), requested: photos.length, scanned: 0, timedOut: false };
        })
      : Promise.resolve(null),
  ]);
  // customerName travels with the data so the editor's re-render (routes.ts
  // renderOptsFor) addresses the same person the original document did.
  const baseReport = { ...r.report, customerName: input.customer, repConfirmedStorm, ...(measurements ? { measurements } : {}), ...(commercial ? { commercial } : {}) };
  // The commercial documents show the photos that were not scanned in their
  // own findings chapter, so the list has to be on the data before the render.
  const freshReport = scan ? { ...applyPhotoScan(baseReport, photos, scan), appendixPhotos } : baseReport;
  const scanned = scan ? { warning: scanWarning(scan) } : undefined;

  // No prior inspection to reuse, so one was just run — render the requested
  // document from it rather than making the rep generate an inspection first.
  if (input.type === 'estimate') {
    const built = buildEstimate(freshReport);
    return withDiagnostics({ html: built.html, data: built.data, title: estimateTitleFor(built.data) }, photos.length, input.type, appendixPhotos);
  }
  if (input.type === 'proposal') {
    const built = await buildProposal(freshReport);
    return withDiagnostics({ html: built.html, data: built.data, title: `${commercial ? 'Commercial ' : ''}Roofing Proposal — ${dated}` }, photos.length, input.type, appendixPhotos, scanned);
  }
  if (input.type === 'presentation') {
    const built = await buildPresentation(freshReport);
    return withDiagnostics({ html: built.html, data: built.data, title: `${commercial ? 'Commercial ' : ''}Roof Presentation — ${dated}` }, photos.length, input.type, appendixPhotos, scanned);
  }
  // The Inspection is rendered here, not inside generateInspectionReport, so
  // it carries what only this layer knows: the rep's checklist, the
  // measurement report, and the in-depth write-up (findings only — no sales
  // argument on the document the adjuster reads).
  const inspectionReport = await withNarrative(freshReport, false);
  const inspectionHtml = commercial
    ? renderCommercialInspectionHtml(inspectionReport, { jobType: inspectionCtx?.jobType, inspection: inspectionCtx })
    : renderInspectionHtml(inspectionReport, { jobType: inspectionCtx?.jobType, inspection: inspectionCtx });
  return withDiagnostics({ html: inspectionHtml, data: inspectionReport, title: commercial ? `Commercial Roof Condition Report — ${dated}` : `Roof Inspection — ${dated}` }, photos.length, input.type, appendixPhotos);
}
