/**
 * The generation service: makes one roof report from an address, optional
 * photos and what the person typed. Everything outside it (the storm sources,
 * the models, the photo store) comes in through `GenerateDeps`, so the steps
 * are tested with fakes and nothing here reaches the network by itself.
 *
 * It runs inside one request (about 300 seconds on this hosting), so:
 *   - ONE deadline (createDeadline, 240 seconds) is made at the start and the
 *     same signal goes to the storm fetch, every photo and the narrative;
 *   - at most 40 photos, analysed three at a time with a pause between;
 *   - storm and photo analysis return what they have rather than throw;
 *   - the narrative and the labels are non-fatal and get a minute each.
 * It returns the report and, when part of it is missing, one plain sentence
 * saying so. It does not save anything: ./store.ts does, in one statement.
 *
 * Photos reach every dependency as bytes, never as an address. Each photo is
 * named in the report by id, and its page address is the app's own route, never
 * a place in the photo store.
 */
import {
  createDeadline,
} from '../lib/roof-reports/deadline.js';
import {
  createComprehensiveReport, type AnalyzedPhoto, type ComprehensiveRoofReport, type DamageDetection, type PhotoCategory,
  type ReportTemplate, type ReportType,
} from '../lib/roof-reports/comprehensive-roof-report.js';
import { buildEnhancedStormData, generateStormReport, type StormReport } from '../lib/roof-reports/storm-history-service.js';
import { analyzeRoofImageWithFallback, combineAnalysisResults, type RoofAnalysisResult } from '../lib/roof-reports/groq-vision.js';
import { generateEstimateFromDamageAnalysis, type RepairEstimateSummary } from '../lib/roof-reports/roof-repair-pricing.js';
import { calculateReplacementTiers } from '../lib/roof-reports/roof-report-pricing.js';
import { generateNarrativeWithClaude } from '../lib/roof-reports/claude-report-narrator.js';
import { labelPhotosWithClaude, type LabelInput } from '../lib/roof-reports/claude-image-labeler.js';
import { providerCaller, type ModelCaller, type ProviderKeys } from '../lib/roof-reports/model-call.js';
import type { ImageLabel } from '../lib/roof-reports/comprehensive-roof-report.js';
import {
  GEOCODE_FAILED, GENERATE_FAILED, MAX_REPORT_PHOTOS, NEEDS_ADDRESS, NEEDS_CITY_STATE, PICK_A_KIND, TOO_MANY_PHOTOS,
  REPORT_KINDS, TEMPLATES,
} from '../../shared/roof-reports';
import { googleMapsKey } from '../lib/reports/google-key.js';
import { meteredModelCaller, type CostOperation } from './metered';
import { estimateRoofAge } from './roof-age';
import { buildMeasurementSection, cleanDamageCounts, cleanMeasurements, cleanRoofDetails, cleanText } from './inputs';
import { loadReportPhoto } from './photos';

export interface GenerateRequest {
  reportTypes: ReportType[];
  template: ReportTemplate;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  photoIds: string[];
  roofDetails?: unknown;
  damageCounts?: unknown;
  measurements?: unknown;
  inspectorNotes?: string;
  customer?: { name?: string; email?: string; phone?: string };
  jobExternalId?: string;
}

/** One photo as the generation reads it: the cleaned bytes and what the person said it shows. */
export interface LoadedPhoto { bytes: Buffer; category: string | null }

type NarrateInput = Parameters<typeof generateNarrativeWithClaude>[0];
type NarrateOutput = Awaited<ReturnType<typeof generateNarrativeWithClaude>>;

export interface GenerateDeps {
  storm: typeof generateStormReport;
  enhancedStorm: typeof buildEnhancedStormData;
  /** One photo, from its bytes. Metered by whoever builds it (liveDeps does). Never given an address. */
  analyze: (photo: { bytes: Buffer }, ctx: { signal: AbortSignal; roofSquares?: number }) => Promise<RoofAnalysisResult>;
  narrate: (input: NarrateInput, opts: { signal: AbortSignal }) => Promise<NarrateOutput>;
  label: (inputs: LabelInput[], opts: { signal: AbortSignal }) => Promise<Record<string, ImageLabel[]> | null>;
  photoBytes: (reportId: string, photoId: string) => Promise<LoadedPhoto | null>;
  now: () => Date;
  /** The pause between batches of photos. Defaults to a real wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Makes the one deadline for the run. Defaults to 240 seconds. */
  deadline?: () => AbortSignal;
}

/** The request cannot be made into a report. The message is a plain sentence for the person. */
export class GenerateInputError extends Error {
  constructor(message: string) { super(message); this.name = 'GenerateInputError'; }
}
/** The address could not be placed on the map. */
export class GeocodeFailedError extends Error {
  constructor() { super(GEOCODE_FAILED); this.name = 'GeocodeFailedError'; }
}
/** The run used its whole time before it had enough to make a report. */
export class RanOutOfTimeError extends Error {
  constructor() { super(GENERATE_FAILED); this.name = 'RanOutOfTimeError'; }
}

const BATCH_SIZE = 3;
const BATCH_PAUSE_MS = 1000;
const STEP_BUDGET_MS = 60_000;
const STORM_YEARS_DEFAULT = 3;
const STORM_YEARS_STANDALONE = 10;
const STORM_RADIUS_MILES = 5;

const SUMMARY_NOT_ANALYSED = 'This photo could not be analysed. It is included for reference.';
const SUMMARY_NO_TIME = 'This photo was not analysed because the report ran out of time.';
const WARN_ALL_PHOTOS = 'The photos could not be analysed, so this report does not describe their condition. Please try again.';
const WARN_OUT_OF_TIME = 'The report ran out of time, so part of it is missing.';
const WARN_STORM_PARTIAL = 'Some storm data sources did not all answer in time, so the storm history may be incomplete.';

const PHOTO_CATEGORIES: readonly string[] = ['roof_surface', 'gutter', 'flashing', 'vent', 'chimney', 'interior', 'overview', 'closeup', 'other'];
const isCategory = (v: unknown): v is PhotoCategory => typeof v === 'string' && PHOTO_CATEGORIES.includes(v);

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Severity words the vision models use, mapped to the report's own. */
function mapSeverity(score: number | string | undefined): AnalyzedPhoto['overallSeverity'] {
  if (typeof score === 'string') {
    const s = score.toLowerCase();
    if (s === 'critical') return 'critical';
    if (['high', 'major', 'severe'].includes(s)) return 'high';
    if (['medium', 'moderate'].includes(s)) return 'medium';
    if (['low', 'minor'].includes(s)) return 'low';
    return 'none';
  }
  if (typeof score === 'number') {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
  }
  return 'none';
}

function mapDamages(result: RoofAnalysisResult, photoIndex: number): DamageDetection[] {
  const out: DamageDetection[] = [];
  const list = Array.isArray(result.damages_detected) ? result.damages_detected : [];
  list.forEach((d, i) => {
    const severity = mapSeverity(d.severity);
    if (severity === 'none') return;
    out.push({
      id: `damage-${photoIndex}-${i}`,
      type: d.damage_type_id || 'unknown',
      label: d.damage_name || d.damage_type_id || 'Damage',
      severity,
      confidence: Number.isFinite(d.confidence) ? d.confidence : 0,
      description: (Array.isArray(d.visual_evidence) && d.visual_evidence.length ? d.visual_evidence.join('; ') : d.repair_recommendation) || '',
      location: d.location_description || undefined,
    });
  });
  return out;
}

/** The address of a photo inside the app. A route that checks who is asking, never a place in the store. */
const photoPath = (reportId: string, photoId: string, variant: 'working' | 'thumb') => `/api/roof-reports/${reportId}/photos/${photoId}/${variant}`;

function stub(reportId: string, photoId: string, category: PhotoCategory | undefined, summary: string): AnalyzedPhoto {
  return {
    id: photoId, url: photoPath(reportId, photoId, 'working'), thumbnailUrl: photoPath(reportId, photoId, 'thumb'),
    damages: [], overallSeverity: 'none', aiSummary: summary, analyzedAt: new Date().toISOString(),
    ...(category && { photoCategory: category }),
  };
}

/** Runs a step for at most `ms`; null when it is not done by then. Never rejects. */
async function timeBoxed<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, deadline: AbortSignal): Promise<T | null> {
  const own = new AbortController();
  const signal = AbortSignal.any([deadline, own.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => { own.abort(); resolve(null); }, ms); });
  try {
    return await Promise.race([Promise.resolve().then(() => run(signal)).catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function checkRequest(req: GenerateRequest) {
  const kinds = new Set(REPORT_KINDS.map((k) => k.value));
  const reportTypes = [...new Set(Array.isArray(req.reportTypes) ? req.reportTypes : [])].filter((k): k is ReportType => kinds.has(k as never));
  if (reportTypes.length === 0) throw new GenerateInputError(PICK_A_KIND);
  const address = cleanText(req.address, 200);
  if (!address) throw new GenerateInputError(NEEDS_ADDRESS);
  const city = cleanText(req.city, 100);
  const state = cleanText(req.state, 50);
  if (!city || !state) throw new GenerateInputError(NEEDS_CITY_STATE);
  const photoIds = Array.isArray(req.photoIds) ? req.photoIds : [];
  if (photoIds.length > MAX_REPORT_PHOTOS) throw new GenerateInputError(TOO_MANY_PHOTOS);
  const template = TEMPLATES.some((t) => t.value === req.template) ? req.template : 'full';
  return { reportTypes, address, city, state, zip: cleanText(req.zip, 20), photoIds, template, notes: cleanText(req.inspectorNotes, 20_000) };
}

export async function runGeneration(
  reportId: string,
  req: GenerateRequest,
  deps: GenerateDeps,
): Promise<{ report: ComprehensiveRoofReport; warning: string | null }> {
  const input = checkRequest(req);
  const roofDetailsIn = cleanRoofDetails(req.roofDetails);
  const damageCounts = cleanDamageCounts(req.damageCounts);
  const measurementsIn = cleanMeasurements(req.measurements);
  const hasInspection = input.reportTypes.includes('inspection');
  const hasMeasurement = input.reportTypes.includes('measurement');
  const hasStorm = input.reportTypes.includes('storm');

  // One deadline for the whole run. Every step below gets this same signal.
  const signal = (deps.deadline ?? (() => createDeadline()))();
  const sleep = deps.sleep ?? realSleep;

  // 1. Storm history (it also places the address, so it always runs).
  let stormReport: StormReport;
  try {
    stormReport = await deps.storm(input.address, input.city, input.state, input.zip || undefined, {
      yearsBack: hasStorm && !hasInspection ? STORM_YEARS_STANDALONE : STORM_YEARS_DEFAULT,
      searchRadiusMiles: STORM_RADIUS_MILES,
      signal,
    });
  } catch {
    throw new GeocodeFailedError();
  }
  if (!stormReport || (stormReport.latitude === 0 && stormReport.longitude === 0)) {
    // The deadline fired before the address was even placed: not the address's fault.
    throw stormReport?.partial || signal.aborted ? new RanOutOfTimeError() : new GeocodeFailedError();
  }

  let stormEnhanced: ReturnType<typeof buildEnhancedStormData> | undefined;
  if (hasStorm) {
    try { stormEnhanced = deps.enhancedStorm(stormReport); } catch { stormEnhanced = undefined; }
  }

  // 2. Photos, three at a time. Each one that cannot be analysed is still in the report, said plainly.
  const analyzed: AnalyzedPhoto[] = [];
  const results: RoofAnalysisResult[] = [];
  const kept = new Map<string, Buffer>();
  let failed = 0;
  const roofSquares = roofDetailsIn?.squares;
  if (hasInspection && input.photoIds.length > 0) {
    const ids = [...new Set(input.photoIds)];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      if (signal.aborted) {
        for (const id of batch) { analyzed.push(stub(reportId, id, undefined, SUMMARY_NO_TIME)); failed++; }
        continue;
      }
      const done = await Promise.all(batch.map(async (id, j) => {
        const index = i + j;
        let loaded: LoadedPhoto | null = null;
        try { loaded = await deps.photoBytes(reportId, id); } catch { loaded = null; }
        const category = loaded && isCategory(loaded.category) ? loaded.category : undefined;
        if (!loaded) return { photo: stub(reportId, id, category, SUMMARY_NOT_ANALYSED), ok: false as const };
        let result: RoofAnalysisResult | null = null;
        try { result = await deps.analyze({ bytes: loaded.bytes }, { signal, roofSquares }); } catch { result = null; }
        if (!result || !result.success) return { photo: stub(reportId, id, category, SUMMARY_NOT_ANALYSED), ok: false as const };
        const damages = mapDamages(result, index);
        const photo: AnalyzedPhoto = {
          ...stub(reportId, id, category, result.summary || 'Analysis complete.'),
          damages, overallSeverity: mapSeverity(result.overall_severity_score),
        };
        if (damages.length) kept.set(id, loaded.bytes);
        return { photo, ok: true as const, result };
      }));
      for (const d of done) {
        analyzed.push(d.photo);
        if (d.ok) results.push(d.result); else failed++;
      }
      if (i + BATCH_SIZE < ids.length && !signal.aborted) await sleep(BATCH_PAUSE_MS);
    }
  }

  // Roof age, from what the photos showed.
  let roofAge = null;
  if (results.length > 0) {
    const combined = combineAnalysisResults(results);
    if (combined.roof_material) roofAge = estimateRoofAge(combined);
  }

  // 3. Repair estimate and replacement options (inspection only).
  let repairEstimate: RepairEstimateSummary = { lineItems: [], subtotalBase: 0, subtotalFinal: 0, multiplier: 1.65, generatedAt: deps.now().toISOString() };
  if (hasInspection) {
    const types = analyzed.flatMap((p) => p.damages.map((d) => ({ type: d.type, severity: d.severity, count: 1 })));
    if (types.length > 0) repairEstimate = generateEstimateFromDamageAnalysis(types);
  }
  let replacementOptions: unknown[] | undefined;
  if (hasInspection && roofSquares && roofSquares > 0) {
    try {
      const tiers = calculateReplacementTiers({
        roofSquares, pitch: roofDetailsIn?.pitch, stories: roofDetailsIn?.stories, roofType: roofDetailsIn?.material,
        companyProfile: null, state: input.state,
      });
      if (tiers?.tiers.length) replacementOptions = tiers.tiers;
    } catch {
      replacementOptions = undefined;
    }
  }

  // 4. The report itself.
  const roofDetails = roofDetailsIn || roofAge
    ? { ...roofDetailsIn, ...(roofAge?.estimatedAgeYears ? { age_years: roofAge.estimatedAgeYears } : {}) }
    : undefined;
  const report = createComprehensiveReport({
    property: { address: input.address, city: input.city, state: input.state, zip: input.zip || undefined, latitude: stormReport.latitude, longitude: stormReport.longitude },
    stormReport,
    analyzedPhotos: analyzed,
    repairEstimate,
    roofAge,
    roofDetails,
    damageCounts,
    replacementOptions,
    measurements: measurementsIn,
    inspectorNotes: input.notes,
    reportTypes: input.reportTypes,
    reportTemplate: input.template,
    stormEnhanced,
    measurementReport: hasMeasurement ? buildMeasurementSection(measurementsIn, roofSquares, roofDetailsIn?.pitch) : undefined,
  });
  report.id = reportId;

  // 5. Narrative and photo labels, in parallel. Neither can fail the report.
  if (hasInspection && analyzed.some((p) => p.damages.length > 0) && !signal.aborted) {
    const labelInputs: LabelInput[] = analyzed.filter((p) => p.damages.length > 0 && kept.has(p.id)).map((p) => ({
      photoId: p.id, image: { bytes: kept.get(p.id)!, mediaType: 'image/jpeg' as const }, existingDamages: p.damages,
    }));
    const [narrative, labels] = await Promise.all([
      timeBoxed(STEP_BUDGET_MS, (s) => deps.narrate({
        analyzedPhotos: analyzed, damageAnalysis: report.damageAnalysis, stormHistory: report.stormHistory,
        roofDetails: report.roofDetails, inspectorNotes: input.notes,
      }, { signal: s }), signal),
      labelInputs.length ? timeBoxed(STEP_BUDGET_MS, (s) => deps.label(labelInputs, { signal: s }), signal) : Promise.resolve(null),
    ]);
    if (narrative?.findings.length) report.structuredFindings = narrative.findings;
    if (narrative?.executiveSummary) report.executiveSummary = narrative.executiveSummary;
    if (labels && Object.keys(labels).length > 0) report.photoLabels = labels;
  }

  // 6. One plain sentence for whatever is missing.
  const warnings: string[] = [];
  const total = analyzed.length;
  const stormPartial = stormReport.partial === true;
  if ((failed > 0 || stormPartial) && signal.aborted) warnings.push(WARN_OUT_OF_TIME);
  if (total > 0 && failed === total) warnings.push(WARN_ALL_PHOTOS);
  else if (failed > 0) warnings.push(`${failed} of the ${total} photos could not be analysed.`);
  if (stormPartial) warnings.push(WARN_STORM_PARTIAL);
  return { report, warning: warnings.length ? warnings.join(' ') : null };
}

// ---------------------------------------------------------------------------
// The real dependencies
// ---------------------------------------------------------------------------

/** The keys the models are called with. A provider without a key is never called. */
export function modelKeysFromEnv(env: Record<string, string | undefined> = process.env): ProviderKeys {
  const keys: ProviderKeys = {};
  if (env.GROQ_API_KEY) keys.groq = env.GROQ_API_KEY;
  if (env.GEMINI_API_KEY) keys.google = env.GEMINI_API_KEY;
  if (env.ANTHROPIC_API_KEY) keys.anthropic = env.ANTHROPIC_API_KEY;
  return keys;
}

const NOT_ANALYSED: RoofAnalysisResult = {
  success: false, image_quality: 'poor', roof_material: null, damages_detected: [], overall_condition: 'poor',
  overall_severity_score: 0, insurance_claim_recommended: false, summary: SUMMARY_NOT_ANALYSED, detailed_findings: '',
  recommendations: [], model_used: 'none', processing_time_ms: 0,
};

/**
 * The real storm sources, models and photo store, for the company in context.
 * Every model call goes through `meteredModelCaller`, so each one writes a
 * cost row for the company that caused it, tagged with this report. A model
 * whose key is not set is never called and never recorded. `base` replaces
 * the provider caller, for tests.
 */
export function liveDeps(reportId: string, options: { keys?: ProviderKeys; base?: ModelCaller } = {}): GenerateDeps {
  const keys = options.keys ?? modelKeysFromEnv();
  const base = options.base ?? providerCaller(keys);
  const anyKey = Boolean(keys.groq || keys.google || keys.anthropic) || options.base !== undefined;
  const metered = (operation: CostOperation) => meteredModelCaller(base, { operation, ref: reportId });
  return {
    storm: (address, city, state, zip, opts) => generateStormReport(address, city, state, zip, { ...opts, googleApiKey: googleMapsKey() }),
    enhancedStorm: buildEnhancedStormData,
    analyze: async (photo, ctx) => {
      if (!anyKey) return NOT_ANALYSED;
      try {
        return await analyzeRoofImageWithFallback(
          `data:image/jpeg;base64,${photo.bytes.toString('base64')}`, keys.groq ?? '', keys.google,
          { call: metered('photo_analysis'), signal: ctx.signal, roofSquares: ctx.roofSquares }, keys.anthropic,
        );
      } catch {
        return NOT_ANALYSED;
      }
    },
    narrate: async (input, opts) => (keys.anthropic || options.base ? generateNarrativeWithClaude(input, { call: metered('narrative'), signal: opts.signal }) : null),
    label: async (inputs, opts) => (keys.anthropic || options.base ? labelPhotosWithClaude(inputs, { call: metered('photo_labels'), signal: opts.signal }) : null),
    photoBytes: (rid, photoId) => loadReportPhoto(rid, photoId),
    now: () => new Date(),
  };
}
