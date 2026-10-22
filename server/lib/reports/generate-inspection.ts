/**
 * Core roof inspection report generation, extracted so both the HTTP route
 * (POST /api/reports/inspection) and the email intake orchestrator share one
 * code path. Pulls storm history, runs photo damage analysis, builds the
 * estimate, assembles the comprehensive report, persists it, and renders HTML.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { generateStormReport } from './storm-history-service.js';
import {
  analyzeRoofImageWithFallback,
  analyzeMultipleImages,
  combineAnalysisResults,
  falVisionConfigured,
  type RoofAnalysisResult,
} from './groq-vision.js';
import { consolidateFindings } from './consolidate-findings.js';
import { toPricingDamageType } from './damage-type-map.js';
import {
  generateEstimateFromDamageAnalysis,
  type RepairEstimateSummary,
} from './roof-repair-pricing.js';
import {
  createComprehensiveReport,
  type AnalyzedPhoto,
  type DamageDetection,
  type ComprehensiveRoofReport,
  type RoofAgeEstimation,
} from './comprehensive-roof-report.js';
import { renderInspectionHtml } from './render-inspection-html.js';
import { googleMapsKey } from './google-key.js';

export interface GenerateInspectionParams {
  address: string;
  city: string;
  state: string;
  zip?: string;
  photos?: Array<{ url: string; caption?: string }>;
  leadId?: string;
  jobId?: string;
  projectId?: string;
  roofSquares?: number | string;
  roofPitch?: string;
  roofStories?: number | string;
  roofMaterial?: string;
  damageCounts?: { windDamaged: number; hailDamaged: number; generalDamaged: number };
  measurements?: Record<string, unknown>;
  inspectorNotes?: string;
  jobType?: 'retail' | 'insurance';
  /**
   * False = an inspection RECORD: the photos are carried as the inspector
   * took them, with no vision pass, no detected findings, no roof-age guess
   * and no priced repairs. The Inspection document is built this way — it
   * must never say more than the inspector's checklist and notes do.
   */
  analyzePhotos?: boolean;
}

export interface GenerateInspectionResult {
  report: ComprehensiveRoofReport;
  html: string;
  processingTimeMs: number;
}

export async function generateInspectionReport(params: GenerateInspectionParams): Promise<GenerateInspectionResult> {
  const startedAt = Date.now();
  const photos = params.photos || [];

  const stormReport = await generateStormReport(params.address, params.city, params.state, params.zip, {
    yearsBack: 3,
    searchRadiusMiles: 5,
    googleApiKey: googleMapsKey(),
  });

  const analyzedPhotos: AnalyzedPhoto[] = [];
  let roofAge: RoofAgeEstimation | null = null;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

  if (params.analyzePhotos === false) {
    for (let i = 0; i < photos.length; i++) {
      analyzedPhotos.push({
        id: `photo-${i}`, url: photos[i].url, caption: photos[i].caption,
        damages: [], overallSeverity: 'none',
        aiSummary: 'Not analysed — inspection record.', analyzedAt: new Date().toISOString(),
      });
    }
  }

  // Vision runs through fal.ai (Qwen3-VL) when configured, Groq otherwise.
  if (params.analyzePhotos !== false && photos.length > 0 && (groqKey || falVisionConfigured())) {
    try {
      const urls = photos.map(p => p.url);
      // Leave headroom inside the 300s function limit for pricing, rendering
      // and the JobTread write that follow. A job with 100 photos analyses as
      // many as fit and says so, rather than running past the limit and
      // leaving the report stuck "running" forever.
      const visionDeadline = Date.now() + Math.max(
        30_000,
        (Number(process.env.VISION_BUDGET_MS) || 200_000),
      );
      const results: RoofAnalysisResult[] = urls.length === 1
        ? [await analyzeRoofImageWithFallback(urls[0], groqKey || '', geminiKey)]
        : await analyzeMultipleImages(urls, groqKey || '', {}, { deadline: visionDeadline });

      if (results.length < photos.length) {
        console.warn(`[report] analysed ${results.length} of ${photos.length} photos within the time budget`);
      }

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const r = results[i];
        if (r?.success) {
          const damages: DamageDetection[] = (r.damages_detected || [])
            .map((d: any, idx: number) => {
              const sev = mapSeverity(d.severity ?? d.severity_score);
              if (sev === 'none') return null;
              // The analyzer emits damage_type_id / damage_name / visual_evidence /
              // location_description. Reading d.type / d.name / d.description /
              // d.location missed EVERY field, so each finding became type
              // "unknown" with an empty description — which is why an inspection
              // with 11 findings still produced a $0 repair estimate.
              const label = d.damage_name || d.name || d.label || 'Damage';
              const description = d.description || d.details
                || (Array.isArray(d.visual_evidence) ? d.visual_evidence.join('; ') : '')
                || d.repair_recommendation || '';
              return {
                id: `damage-${i}-${idx}`,
                type: toPricingDamageType({
                  typeId: d.damage_type_id || d.type || d.damage_type,
                  name: label,
                  category: d.category,
                  description,
                }) || 'unknown',
                label,
                severity: sev as 'low' | 'medium' | 'high' | 'critical',
                confidence: d.confidence || 80,
                description,
                location: d.location_description || d.location,
              };
            })
            .filter(Boolean) as DamageDetection[];

          analyzedPhotos.push({
            id: `photo-${i}`,
            url: photo.url,
            caption: photo.caption,
            damages,
            overallSeverity: mapSeverity(r.overall_severity_score),
            aiSummary: r.summary || 'Analysis complete.',
            analyzedAt: new Date().toISOString(),
          });
        } else {
          analyzedPhotos.push({
            id: `photo-${i}`,
            url: photo.url,
            caption: photo.caption,
            damages: [],
            overallSeverity: 'none',
            aiSummary: 'Unable to analyze this image.',
            analyzedAt: new Date().toISOString(),
          });
        }
      }

      const combined = combineAnalysisResults(results);
      if (combined.roof_material) {
        roofAge = deriveRoofAge(combined);
      }
    } catch (err: any) {
      console.error('[generate-inspection] Photo analysis error:', err.message);
    }
  }

  // Price DISTINCT problems, not raw detections.
  //
  // This used to flatMap every per-photo detection straight into the estimate,
  // so a problem photographed 25 times was priced 25 times. On a real job that
  // produced 64 squares of shingle replacement and TEN chimney flashings — no
  // house has ten chimneys — and a $51,458 total where the same findings,
  // counted once each, come to $22,047.
  //
  // Photo count is not a measure of area: a rep can take twenty photos of one
  // damaged patch. Each distinct problem counts once, and the rep adjusts
  // quantities in the estimate editor, which no longer requires regenerating.
  const damageTypes = consolidateFindings(analyzedPhotos as any)
    .map(f => ({ type: String(f.type ?? ''), severity: String(f.severity ?? ''), count: 1, label: f.label }));
  const repairEstimate: RepairEstimateSummary = damageTypes.length > 0
    ? generateEstimateFromDamageAnalysis(damageTypes)
    : { lineItems: [], subtotalBase: 0, subtotalFinal: 0, multiplier: 1.65, generatedAt: new Date().toISOString() };

  const roofDetails = (params.roofSquares || params.roofPitch || params.roofStories || params.roofMaterial)
    ? {
        type: params.roofMaterial || undefined,
        squares: params.roofSquares ? Number(params.roofSquares) : undefined,
        pitch: params.roofPitch || undefined,
        stories: params.roofStories ? Number(params.roofStories) : undefined,
        material: params.roofMaterial || undefined,
        age_years: roofAge?.estimatedAgeYears || undefined,
      }
    : undefined;

  const report = createComprehensiveReport({
    property: {
      address: params.address,
      city: params.city,
      state: params.state,
      zip: params.zip,
      latitude: stormReport.latitude,
      longitude: stormReport.longitude,
    },
    stormReport,
    analyzedPhotos,
    repairEstimate,
    roofAge,
    crmLink: params.leadId || params.jobId || params.projectId
      ? { leadId: params.leadId, jobId: params.jobId, projectId: params.projectId }
      : undefined,
    roofDetails,
    damageCounts: params.damageCounts || undefined,
    measurements: params.measurements || undefined,
    inspectorNotes: params.inspectorNotes || '',
  });

  if (params.analyzePhotos === false) {
    // Say so on the data itself, so nothing downstream (estimate reuse, the
    // "problems found" counters, the editor's Findings tab) mistakes an
    // unanalysed photo set for a clean roof.
    Object.assign(report.damageAnalysis as any, { analysisSkipped: true, aiSummary: '', totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', damageTypes: [] });
  }

  await persistReport(report, params, stormReport);

  return {
    report,
    html: renderInspectionHtml(report, { jobType: params.jobType }),
    processingTimeMs: Date.now() - startedAt,
  };
}

async function persistReport(report: ComprehensiveRoofReport, params: GenerateInspectionParams, stormReport: any): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO roof_reports (
        id, lead_id, job_id, project_id,
        address, city, state, zip, latitude, longitude,
        storm_data, damage_data, estimate_data,
        total_estimate, data_quality,
        roof_details, damage_counts, replacement_data,
        inspector_notes, measurements, report_version
      ) VALUES (
        ${report.id},
        ${params.leadId || null},
        ${params.jobId || null},
        ${params.projectId || null},
        ${params.address},
        ${params.city},
        ${params.state},
        ${params.zip || null},
        ${stormReport.latitude},
        ${stormReport.longitude},
        ${JSON.stringify(report.stormHistory)}::jsonb,
        ${JSON.stringify(report.damageAnalysis)}::jsonb,
        ${JSON.stringify(report.repairEstimate)}::jsonb,
        ${(report.repairEstimate as any).total || 0},
        ${report.dataQuality},
        ${JSON.stringify(report.roofDetails || {})}::jsonb,
        ${JSON.stringify(report.damageCounts || {})}::jsonb,
        ${JSON.stringify(report.replacementOptions || [])}::jsonb,
        ${report.inspectorNotes || ''},
        ${JSON.stringify(report.measurements || {})}::jsonb,
        ${'2.0'}
      )
    `);
  } catch (dbErr: any) {
    console.error('[generate-inspection] DB save error:', dbErr.message);
  }
}

// ── severity / roof-age helpers (shared with the route) ──

export function mapSeverity(score: number | string | undefined): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (typeof score === 'string') {
    const lower = score.toLowerCase();
    if (['critical', 'severe'].includes(lower)) return 'critical';
    if (['high', 'major'].includes(lower)) return 'high';
    if (['medium', 'moderate'].includes(lower)) return 'medium';
    if (['low', 'minor'].includes(lower)) return 'low';
    return 'none';
  }
  if (typeof score === 'number') {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
    return 'none';
  }
  return 'none';
}

const MATERIAL_LIFESPANS: Record<string, number> = {
  asphalt_shingle: 20, architectural_shingle: 30, '3-tab_shingle': 20,
  metal: 50, metal_standing_seam: 60, tile: 50, clay_tile: 75, concrete_tile: 50,
  slate: 100, wood_shake: 30, wood_shingle: 25, flat_membrane: 20, tpo: 25, epdm: 25,
  modified_bitumen: 20, built_up: 25,
};

export function deriveRoofAge(result: RoofAnalysisResult): RoofAgeEstimation {
  const material = result.roof_material;
  const condition = result.overall_condition;
  const materialType = material?.type || null;
  const lifespan = (materialType && MATERIAL_LIFESPANS[materialType]) || 25;

  const conditionAgeMap: Record<string, number> = {
    excellent: 3, good: 8, fair: 15, poor: 22, critical: 28,
  };
  const estimatedAge = conditionAgeMap[condition] ?? 15;

  return {
    estimatedAgeYears: estimatedAge,
    expectedLifespanYears: lifespan,
    remainingLifeYears: Math.max(0, lifespan - estimatedAge),
    confidence: 'medium',
    indicators: [`Inferred from overall ${condition} condition`],
    roofMaterial: materialType,
    materialCondition: (condition as any) || 'fair',
  };
}
