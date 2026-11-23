/**
 * Comprehensive Roof Report Generator
 * Combines storm data, damage analysis, and repair pricing into a unified report.
 */

import type { StormReport, StormEvent } from './storm-history-service.js';
import type { RepairEstimateSummary, RepairEstimate } from './roof-repair-pricing.js';

// ─── Report Type System ──────────────────────────────────────────────────────

export type ReportType = 'inspection' | 'measurement' | 'storm';

export type ReportTemplate = 'insurance' | 'homeowner' | 'full' | 'quick';

/**
 * Visual presentation style. Declared here as well as in report-templates.ts to
 * keep this module free of imports from it, matching how ReportTemplate is
 * already duplicated. `flight` renders the report as a continuous scroll-driven
 * descent through the photographs rather than as a document.
 */
export type ReportVisualStyle = 'formal' | 'presentation' | 'flight';

export interface EnhancedStormData {
  noaaEventPageUrls: { eventId: string; url: string; date: string; type: string }[];
  nexradRadarImageUrls: { date: string; url: string; caption: string }[];
  countyStormDatabaseUrl: string;
  narratives: { eventId: string; narrative: string; date: string; type: string }[];
  propertyProfile: StormReport['property_profile'] | null;
  hailSizeDistribution: Record<number, number>;
}

export interface MeasurementReportSection {
  segments: { name: string; footprintSqFt: number; pitch: string; adjustedSqFt: number }[];
  totalFootprintSqFt: number;
  totalAdjustedSqFt: number;
  totalSquares: number;
  averagePitch: string;
  wastePercentage: number;
  edgeLengths: { ridge: number; hip: number; valley: number; eave: number; rake: number; dripEdge: number; flashing: number };
  materialTakeoff: Record<string, any>;
  dataSource: 'google-solar-api' | 'manual' | 'hybrid' | 'eagleview';
  eagleviewReportId?: number;
  pitchTable?: { pitch: string; area: number; percentage: number }[];
  gutterMeasurements?: { frontGutterLength: number; backGutterLength: number; leftGutterLength: number; rightGutterLength: number; totalGutterLength: number };
  structureComplexity?: string;
}

export interface DamageDetection {
  id: string;
  type: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  location?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type PhotoCategory = 'roof_surface' | 'gutter' | 'flashing' | 'vent' | 'chimney' | 'interior' | 'overview' | 'closeup' | 'other';

export interface AnalyzedPhoto {
  id: string;
  url: string;
  thumbnailUrl?: string;
  caption?: string;
  takenAt?: string;
  damages: DamageDetection[];
  overallSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  aiSummary: string;
  analyzedAt: string;
  photoCategory?: PhotoCategory;
  providersUsed?: string[];
}

export interface MostRecentStorm {
  date: string;
  type: 'hail' | 'wind';
  magnitude: string;
  distanceMiles: number;
  description: string;
  event: StormEvent;
}

export interface StormSummarySection {
  yearsAnalyzed: number;
  searchRadiusMiles: number;
  totalEvents: number;
  hailEvents: number;
  windEvents: number;
  tornadoEvents: number;
  largestHailInches?: number;
  highestWindMph?: number;
  mostRecentHailStorm?: MostRecentStorm;
  mostRecentWindStorm?: MostRecentStorm;
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  claimPotential: 'none' | 'low' | 'medium' | 'high';
  recommendedDateOfLoss?: {
    date: string;
    eventType: string;
    magnitude: string;
    reason: string;
  };
  eventsByYear: Record<number, { hail: number; wind: number; total: number }>;
}

export interface RoofAgeEstimation {
  estimatedAgeYears: number | null;
  expectedLifespanYears: number | null;
  remainingLifeYears: number | null;
  confidence: 'low' | 'medium' | 'high';
  indicators: string[];
  roofMaterial: string | null;
  materialCondition: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

// ─── Structured Findings (v4 — Claude-enhanced) ────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'moderate' | 'minor' | 'advisory' | 'cosmetic';

export interface NarrativeFinding {
  id: string;
  title: string;
  severity: FindingSeverity;
  narrative: string;
  relatedPhotoIds: string[];
  repairAction: string;
  insuranceRelevant: boolean;
  /** Damage type IDs from AI analysis that contributed to this finding */
  sourceDamageTypes?: string[];
}

export interface ImageLabel {
  id: string;
  text: string;
  /** Position hint for overlay placement */
  position: 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  severity: FindingSeverity;
  /** Links to the damage detection ID */
  damageId?: string;
}

export interface RoofConditionIndex {
  overallScore: number; // 0-100
  components: {
    name: string;
    weight: number;
    score: number; // 0-100
    condition: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    notes: string;
  }[];
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface DamageAnalysisSection {
  totalPhotosAnalyzed: number;
  photosWithDamage: number;
  overallSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  roofAge: RoofAgeEstimation | null;
  damageTypes: {
    type: string;
    count: number;
    severity: string;
  }[];
  photos: AnalyzedPhoto[];
  aiSummary: string;
}

export interface RepairEstimateSection {
  lineItems: RepairEstimate[];
  subtotal: number;
  multiplierApplied: number;
  total: number;
  notes: string[];
}

export interface ComprehensiveRoofReport {
  id: string;
  generatedAt: string;
  version: string;

  // Property Info
  property: {
    address: string;
    city: string;
    state: string;
    zip?: string;
    latitude: number;
    longitude: number;
  };

  // CRM linking (optional)
  crmLink?: {
    leadId?: string;
    jobId?: string;
    projectId?: string;
  };

  // Report sections
  stormHistory: StormSummarySection;
  damageAnalysis: DamageAnalysisSection;
  repairEstimate: RepairEstimateSection;

  // Enhanced v2 fields
  roofDetails?: {
    type?: string;
    squares?: number;
    pitch?: string;
    stories?: number;
    material?: string;
    age_years?: number;
  };
  damageCounts?: {
    windDamaged: number;
    hailDamaged: number;
    generalDamaged: number;
  };
  // Stored as JSONB; the typed shape is `EstimateTierData[]` from
  // `pdf-templates/EstimatePDF` but we keep this loose here to avoid a
  // circular type dependency (this file is imported by EstimatePDF).
  replacementOptions?: unknown[];
  measurements?: Record<string, unknown>;

  // Report type system (v3)
  reportTypes?: ReportType[];
  reportTemplate?: ReportTemplate;
  /** Per-report override of the template's default visual style. */
  reportVisualStyle?: ReportVisualStyle;
  stormEnhanced?: EnhancedStormData;
  measurementReport?: MeasurementReportSection;

  // Inspector notes (editable by user)
  inspectorNotes: string;

  // Roof Condition Index (v3.1)
  roofConditionIndex?: RoofConditionIndex;
  executiveSummary?: string;
  narrativeFindings?: string;

  // Structured findings (v4 — Claude-enhanced)
  structuredFindings?: NarrativeFinding[];
  photoLabels?: Record<string, ImageLabel[]>;

  // Customer / inspection metadata — these are merged in by the
  // GET /api/roof-reports/:id handler and are editable in the
  // ReportEditor's metadata panel. They aren't produced by
  // createComprehensiveReport, so they're optional here.
  customerName?: string;
  customerEmail?: string;
  inspectionDate?: string;

  // Metadata
  dataQuality: 'verified' | 'partial' | 'degraded';
  dataSources: string[];
}

// ─── RCI scoring constants (hoisted out of `calculateRoofConditionIndex`) ──
// One source of truth for severity → deduction; used inside scoreComponent
// and easier to tune without re-reading 200 lines of context.
const SEVERITY_TO_DEDUCTION: Record<string, number> = {
  critical: 50, high: 35, medium: 20, low: 10,
};
/** Fallback deduction when a damage entry has an unknown severity string. */
const RCI_DEFAULT_DEDUCTION = 15;
/** Cap on the cumulative per-shingle deduction so a 100-shingle roof
 *  doesn't drive the score below zero before other components run. */
const MAX_SHINGLE_DEDUCTION = 60;
/** Inspector rating, when supplied, blends with the AI score at this
 *  weight; the inspector's seen the roof in person. */
const INSPECTOR_RATING_WEIGHT = 0.6;

const FLAT_ROOF_MATERIAL_KEYWORDS = ['flat', 'tpo', 'epdm', 'membrane', 'modified', 'bur', 'bitumen'];

const COVERING_DAMAGE_TYPES = [
  'hail_damage', 'wind_damage', 'missing_shingles', 'cracked_shingles',
  'curled_shingles', 'granule_loss',
  'seam_failure', 'blistering', 'puncture', 'shrinkage', 'alligatoring', 'ponding',
];

const WEAR_KEYWORDS = [
  'wear and tear', 'wear pattern', 'weathering', 'deterioration',
  'aging', 'aged', 'weathered', 'worn', 'fading', 'end of life',
];

/** Component weights (must sum to 1.0). Hoisted so a future tweak doesn't
 *  require touching every `components.push(...)` line. */
const RCI_COMPONENT_WEIGHTS = {
  covering: 0.40,
  flashing: 0.15,
  ventilation: 0.10,
  gutters: 0.10,
  structure: 0.15,
  penetrations: 0.10,
} as const;

// ─── scoreComponent inner-function constants (hoisted from inline magic) ──
/** Wear-and-tear penalty applied to the covering score when keywords match. */
const WEAR_AND_TEAR_PENALTY = 35;
/** Per-damaged-shingle deductions in three diminishing-returns tiers. */
const SHINGLE_DEDUCT_TIER_1 = 8;  // First 3 shingles: 8 points each
const SHINGLE_DEDUCT_TIER_2 = 4;  // Next 5 shingles (4-8): 4 points each
const SHINGLE_DEDUCT_TIER_3 = 2;  // 9th onwards: 2 points each
/** Tier-boundaries (exclusive upper bounds for tier 1/tier 2). */
const SHINGLE_TIER_1_MAX = 3;
const SHINGLE_TIER_2_MAX = 8;

/** Per-component score bounds (`scoreComponent` clamps to [0, 99]). */
const COMPONENT_SCORE_MIN = 0;
const COMPONENT_SCORE_MAX = 99;
/** Material-condition values that trigger the wear-and-tear flag. */
const POOR_MATERIAL_CONDITIONS: ReadonlySet<string> = new Set(['poor', 'critical']);

/** Severity-cap thresholds for the overall score. */
const RCI_CAP_CRITICAL = 35;          // Any critical damage → cap at D-max
const RCI_CAP_3_PLUS_HIGH = 45;       // 3+ high-severity items → cap at D-max
const RCI_CAP_1_OR_2_HIGH = 58;       // 1-2 high-severity items → cap at C-max
const RCI_HIGH_DAMAGE_THRESHOLD = 3;  // Number of high-severity items that triggers RCI_CAP_3_PLUS_HIGH

/** Age-penalty caps applied based on remaining-life years. */
const RCI_CAP_PAST_END_OF_LIFE = 30;   // remainingLifeYears <= 0 → D/F max
const RCI_CAP_NEAR_END_OF_LIFE = 45;   // remainingLifeYears <= 3 → D max
const RCI_NEAR_EOL_YEARS = 3;

/** Overall RCI score bounds. */
const OVERALL_SCORE_MIN = 0;
const OVERALL_SCORE_MAX = 100;
/** Inspector-rating valid range [1, 100]. Out-of-range disables the blend. */
const INSPECTOR_RATING_MIN = 1;
const INSPECTOR_RATING_MAX = 100;

/** Component-score → condition label mapping (extracted from inline ladder). */
function scoreToCondition(score: number): RoofConditionIndex['components'][number]['condition'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 25) return 'poor';
  return 'critical';
}

/** Overall-score → letter-grade mapping (extracted from inline ladder). */
function scoreToGrade(score: number): RoofConditionIndex['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/** Safely read a numeric counter from an optional damage-counts object. */
function safeDamageCount(value: number | undefined): number {
  return Math.max(0, Number(value) || 0);
}

/**
 * Calculate the Roof Condition Index (RCI) from damage analysis and roof age
 */
export function calculateRoofConditionIndex(
  damageAnalysis: DamageAnalysisSection,
  roofAge: RoofAgeEstimation | null,
  damageCounts?: { windDamaged: number; hailDamaged: number; generalDamaged: number },
  material?: string,
  inspectorRating?: number,
): RoofConditionIndex {
  const components: RoofConditionIndex['components'] = [];

  // Determine if this is a flat/low-slope roof based on material
  const matLower = (material || '').toLowerCase();
  const isFlatRoof = FLAT_ROOF_MATERIAL_KEYWORDS.some(k => matLower.includes(k));
  const coveringLabel = isFlatRoof ? RCI_LABEL_COVERING_FLAT : RCI_LABEL_COVERING_SHINGLE;

  // Categorize damages from AI photo analysis
  const damages: DamageDetection[] = [...damageAnalysis.photos.flatMap(p => p.damages)];

  // Add synthetic damages from user-reported counts (these affect RCI even if AI didn't detect them)
  if (damageCounts) {
    const aiWindCount = damages.filter(d => SYNTHETIC_WIND_TYPE_KEYWORDS.some(k => (d.type || '').includes(k)) || d.type === SYNTHETIC_WIND_TYPE_EXACT).length;
    const aiHailCount = damages.filter(d => SYNTHETIC_HAIL_TYPE_KEYWORDS.some(k => (d.type || '').includes(k)) || d.type === SYNTHETIC_HAIL_TYPE_EXACT).length;
    const aiGeneralCount = damages.filter(d =>
      !SYNTHETIC_GENERAL_EXCLUDE_KEYWORDS.some(k => (d.type || '').includes(k)) && d.type !== SYNTHETIC_WIND_TYPE_EXACT
    ).length;

    // DRY the three "push synthetic damage entries" blocks. severity stays
    // 'high' for wind/hail (those drive most claim totals) and 'medium' for
    // the general bucket — preserves prior behavior exactly.
    const pushSynthetic = (
      reported: number, aiSeen: number, prefix: string,
      type: DamageDetection['type'], label: string,
      severity: DamageDetection['severity'], description: string,
    ) => {
      const extra = Math.max(0, reported - aiSeen);
      for (let i = 0; i < extra; i++) {
        damages.push({ id: `${prefix}-${i}`, type, label, severity, confidence: SYNTHETIC_DAMAGE_CONFIDENCE, description });
      }
    };
    pushSynthetic(safeDamageCount(damageCounts.windDamaged), aiWindCount, SYNTHETIC_PREFIX_WIND,
      SYNTHETIC_TYPE_WIND_DAMAGE, SYNTHETIC_LABEL_WIND_REPORTED, 'high', SYNTHETIC_DESC_WIND_REPORTED);
    pushSynthetic(safeDamageCount(damageCounts.hailDamaged), aiHailCount, SYNTHETIC_PREFIX_HAIL,
      SYNTHETIC_TYPE_HAIL_DAMAGE, SYNTHETIC_LABEL_HAIL_REPORTED, 'high', SYNTHETIC_DESC_HAIL_REPORTED);
    pushSynthetic(safeDamageCount(damageCounts.generalDamaged), aiGeneralCount, SYNTHETIC_PREFIX_GENERAL,
      SYNTHETIC_TYPE_CRACKED_SHINGLES, SYNTHETIC_LABEL_GENERAL_REPORTED, 'medium', SYNTHETIC_DESC_GENERAL_REPORTED);
  }
  // Covering damage types: shingle terms + flat roof terms (seam failure, blistering, puncture, etc.)
  const shingleDamages = damages.filter(d => COVERING_DAMAGE_TYPES.some(t => (d.type || '').includes(t) || d.label?.toLowerCase().includes(t.replace(UNDERSCORE_TO_SPACE_RE, ' '))));
  const flashingDamages = damages.filter(d => damageMatchesTypeOrLabel(d, FLASHING_DAMAGE_KEYWORDS, LABEL_KEYWORD_FLASHING));
  const ventDamages = damages.filter(d => damageMatchesTypeOrLabel(d, VENT_DAMAGE_TYPE_KEYWORDS, LABEL_KEYWORD_VENT));
  const gutterDamages = damages.filter(d => damageMatchesTypeOrLabel(d, [GUTTER_DAMAGE_KEYWORD], GUTTER_DAMAGE_KEYWORD));
  const structuralDamages = damages.filter(d => damageMatchesTypeOrLabel(d, STRUCTURAL_DAMAGE_TYPE_KEYWORDS, LABEL_KEYWORD_STRUCTURAL));
  const penetrationDamages = damages.filter(d => damageMatchesTypeOrLabel(d, PENETRATION_DAMAGE_TYPE_KEYWORDS, LABEL_KEYWORD_PENETRATION));

  // Age-based starting score cap (replaces old ageRatio penalty)
  let startingScore = RCI_DEFAULT_STARTING_SCORE;
  if (roofAge?.estimatedAgeYears) {
    const age = roofAge.estimatedAgeYears;
    const tier = AGE_STARTING_SCORE_TIERS.find(t => age > t.minAgeYears);
    if (tier) startingScore = tier.startingScore;
  }

  // Detect wear and tear from AI descriptions
  const hasWearAndTear = damages.some(d => {
    const text = `${d.description || ''} ${d.label || ''} ${d.type || ''}`.toLowerCase();
    return WEAR_KEYWORDS.some(kw => text.includes(kw));
  }) || (roofAge?.materialCondition && POOR_MATERIAL_CONDITIONS.has(roofAge.materialCondition));

  // Total damaged shingle count for per-shingle deduction
  const totalDamagedShingles = damageCounts
    ? safeDamageCount(damageCounts.windDamaged) + safeDamageCount(damageCounts.hailDamaged) + safeDamageCount(damageCounts.generalDamaged)
    : 0;

  function scoreComponent(name: string, weight: number, componentDamages: typeof damages): typeof components[0] {
    let score = startingScore;

    if (name === coveringLabel) {
      // Wear and tear penalty
      if (hasWearAndTear) {
        score -= WEAR_AND_TEAR_PENALTY;
      }

      // Per-damaged-shingle deduction (diminishing returns, cap MAX_SHINGLE_DEDUCTION).
      // Closed-form equivalent of summing one increment per shingle —
      // avoids walking N shingles when N is large.
      if (totalDamagedShingles > 0) {
        const tier1 = Math.min(totalDamagedShingles, SHINGLE_TIER_1_MAX);
        const tier2 = Math.max(0, Math.min(totalDamagedShingles, SHINGLE_TIER_2_MAX) - SHINGLE_TIER_1_MAX);
        const tier3 = Math.max(0, totalDamagedShingles - SHINGLE_TIER_2_MAX);
        const shingleDeduction =
          tier1 * SHINGLE_DEDUCT_TIER_1 +
          tier2 * SHINGLE_DEDUCT_TIER_2 +
          tier3 * SHINGLE_DEDUCT_TIER_3;
        score -= Math.min(shingleDeduction, MAX_SHINGLE_DEDUCTION);
      } else {
        // No per-shingle counts — fall back to standard severity deduction
        for (const d of componentDamages) {
          score -= SEVERITY_TO_DEDUCTION[d.severity] || RCI_DEFAULT_DEDUCTION;
        }
      }
    } else {
      // Non-shingle components: standard severity deduction
      for (const d of componentDamages) {
        score -= SEVERITY_TO_DEDUCTION[d.severity] || RCI_DEFAULT_DEDUCTION;
      }
    }

    score = Math.max(COMPONENT_SCORE_MIN, Math.min(COMPONENT_SCORE_MAX, score));
    return { name, weight, score, condition: scoreToCondition(score), notes: componentDamages.length > 0 ? `${componentDamages.length}${ISSUES_DETECTED_SUFFIX}` : MSG_NO_ISSUES_DETECTED };
  }

  components.push(scoreComponent(coveringLabel, RCI_COMPONENT_WEIGHTS.covering, shingleDamages));
  components.push(scoreComponent(RCI_LABEL_FLASHING, RCI_COMPONENT_WEIGHTS.flashing, flashingDamages));
  components.push(scoreComponent(RCI_LABEL_VENTILATION, RCI_COMPONENT_WEIGHTS.ventilation, ventDamages));
  components.push(scoreComponent(RCI_LABEL_GUTTERS, RCI_COMPONENT_WEIGHTS.gutters, gutterDamages));
  components.push(scoreComponent(RCI_LABEL_STRUCTURE, RCI_COMPONENT_WEIGHTS.structure, structuralDamages));
  components.push(scoreComponent(RCI_LABEL_PENETRATIONS, RCI_COMPONENT_WEIGHTS.penetrations, penetrationDamages));

  let overallScore = Math.round(components.reduce((sum, c) => sum + c.score * c.weight, 0));

  // If the inspector provided a rating (1-100), blend it with the AI score.
  // Inspector rating is weighted INSPECTOR_RATING_WEIGHT (they've seen the roof in person).
  if (inspectorRating != null && inspectorRating >= INSPECTOR_RATING_MIN && inspectorRating <= INSPECTOR_RATING_MAX) {
    overallScore = Math.round(
      inspectorRating * INSPECTOR_RATING_WEIGHT +
      overallScore * (1 - INSPECTOR_RATING_WEIGHT),
    );
  }

  // Severity-based score caps — a roof with critical/high damage can't score "Good"
  const hasCriticalDamage = damages.some(d => d.severity === 'critical');
  const hasHighDamage = damages.some(d => d.severity === 'high');
  const highDamageCount = damages.filter(d => d.severity === 'high' || d.severity === 'critical').length;

  if (hasCriticalDamage) {
    overallScore = Math.min(overallScore, RCI_CAP_CRITICAL);
  } else if (highDamageCount >= RCI_HIGH_DAMAGE_THRESHOLD) {
    overallScore = Math.min(overallScore, RCI_CAP_3_PLUS_HIGH);
  } else if (highDamageCount >= RCI_MIN_HIGH_DAMAGE_FOR_C_CAP) {
    overallScore = Math.min(overallScore, RCI_CAP_1_OR_2_HIGH);
  }

  // Age penalty — roofs past expected lifespan can't score well
  if (roofAge?.remainingLifeYears != null && roofAge.remainingLifeYears <= 0) {
    overallScore = Math.min(overallScore, RCI_CAP_PAST_END_OF_LIFE);
  } else if (roofAge?.remainingLifeYears != null && roofAge.remainingLifeYears <= RCI_NEAR_EOL_YEARS) {
    overallScore = Math.min(overallScore, RCI_CAP_NEAR_END_OF_LIFE);
  }

  overallScore = Math.max(OVERALL_SCORE_MIN, Math.min(OVERALL_SCORE_MAX, overallScore));
  return { overallScore, components, grade: scoreToGrade(overallScore) };
}

/**
 * Enhanced date-of-loss recommendation that cross-references damage types with storm types
 */
// ─── Date-of-loss scoring constants ────────────────────────────────
/** Milliseconds per day — used for the recency-bonus calculation. */
const DOL_MS_PER_DAY = 1000 * 60 * 60 * 24;
/** Recency window: events newer than this many days get the bonus. */
const DOL_RECENT_DAYS = 365;

/** Score weights for the DOL matching logic. */
const DOL_TYPE_MATCH_SCORE = 40;        // Damage type matches event type
const DOL_MAGNITUDE_BONUS = 20;          // Event has functional-damage magnitude
const DOL_PROXIMITY_NEAR_SCORE = 15;     // ≤ NEAR_MILES from property
const DOL_PROXIMITY_MID_SCORE = 10;      // ≤ MID_MILES from property
const DOL_RECENCY_SCORE = 10;            // Within DOL_RECENT_DAYS

/** Proximity tiers (miles). */
const DOL_PROXIMITY_NEAR_MILES = 2;
const DOL_PROXIMITY_MID_MILES = 3;

/** NWS severe-wind threshold (58 mph). Distinct from `HIGH_WIND_MPH = 60`
 *  because NOAA's severe-wind classification kicks in slightly earlier
 *  than HAAG's roofing-functional threshold. */
const NWS_SEVERE_WIND_MPH = 58;

/** HAAG functional-damage threshold for hail (1.0" = quarter-size).
 *  Mirrors `LARGE_HAIL_INCHES` in `storm-history-service.ts`; kept local
 *  so this module doesn't take a circular import on the storm service. */
const LARGE_HAIL_INCHES = 1.0;

/** DOL keyword sets — used to detect AI-classified hail/wind damage on
 *  individual `DamageDetection` records when matching against storm events. */
const DOL_HAIL_KEYWORDS = ['hail', 'impact'] as const;
const DOL_WIND_KEYWORDS = ['wind', 'lifted', 'missing'] as const;

/** Map a `StormReport.recommended_date_of_loss` to the report-level DOL
 *  shape — used by both fall-back branches in `enhanceDateOfLossRecommendation`. */
function mapStormReportDolToReport(
  rec: StormReport['recommended_date_of_loss'],
): StormSummarySection['recommendedDateOfLoss'] | undefined {
  if (!rec) return undefined;
  return {
    date: rec.date,
    eventType: rec.event_type,
    magnitude: rec.magnitude,
    reason: rec.reason,
  };
}

function enhanceDateOfLossRecommendation(
  stormReport: StormReport,
  damageAnalysis?: DamageAnalysisSection,
  damageCounts?: { windDamaged: number; hailDamaged: number; generalDamaged: number }
): StormSummarySection['recommendedDateOfLoss'] {
  // Reuse safeDamageCount instead of re-implementing the `(x || 0) > 0`
  // ladder; one source of truth for "is the user-reported count
  // meaningful given that the field could be NaN/null/negative".
  const hasUserReportedDamage = damageCounts && (
    safeDamageCount(damageCounts.windDamaged) > 0 ||
    safeDamageCount(damageCounts.hailDamaged) > 0 ||
    safeDamageCount(damageCounts.generalDamaged) > 0
  );

  // If no recommended DOL and no user-reported damage to cross-reference, bail
  if (!stormReport.recommended_date_of_loss && !hasUserReportedDamage) return undefined;

  // If we have a recommendation but no damage data to cross-reference, return as-is
  if (stormReport.recommended_date_of_loss && (!damageAnalysis || damageAnalysis.photos.length === 0) && !hasUserReportedDamage) {
    return mapStormReportDolToReport(stormReport.recommended_date_of_loss);
  }

  // Analyze what types of damage were found (AI + user-reported).
  // Defensive: damage arrays might come from JSONB rows where `type` is null.
  const allDamages = damageAnalysis ? damageAnalysis.photos.flatMap(p => p.damages) : [];
  const damageMatchesAny = (d: { type: string; label?: string }, keywords: readonly string[]) => {
    const type = d.type || '';
    return keywords.some(k => type.includes(k) || (d.label?.toLowerCase().includes(k) ?? false));
  };
  const hasHailDamage = (damageCounts && safeDamageCount(damageCounts.hailDamaged) > 0) ||
    allDamages.some(d => damageMatchesAny(d, DOL_HAIL_KEYWORDS));
  const hasWindDamage = (damageCounts && safeDamageCount(damageCounts.windDamaged) > 0) ||
    allDamages.some(d => damageMatchesAny(d, DOL_WIND_KEYWORDS));

  // Find best matching storm event
  const events = stormReport.events || [];
  let bestEvent = events[0]; // Default to most recent
  let bestScore = 0;

  for (const event of events) {
    let score = 0;
    // Type matching
    if (hasHailDamage && event.event_type === EVENT_TYPE_HAIL) score += DOL_TYPE_MATCH_SCORE;
    if (hasWindDamage && isWindOrTornadoEvent(event)) score += DOL_TYPE_MATCH_SCORE;
    // Magnitude bonus
    if (event.hail_size_inches && event.hail_size_inches >= LARGE_HAIL_INCHES) score += DOL_MAGNITUDE_BONUS;
    if (event.wind_speed_mph && event.wind_speed_mph >= NWS_SEVERE_WIND_MPH) score += DOL_MAGNITUDE_BONUS;
    // Proximity bonus (closer = more likely)
    if (event.distance_miles !== undefined && event.distance_miles <= DOL_PROXIMITY_NEAR_MILES) score += DOL_PROXIMITY_NEAR_SCORE;
    else if (event.distance_miles !== undefined && event.distance_miles <= DOL_PROXIMITY_MID_MILES) score += DOL_PROXIMITY_MID_SCORE;
    // Recency bonus (more recent = better for claims). A malformed
    // event.date string (corrupt DB row) yields NaN-time; skip the
    // bonus rather than tilting toward an invalid event.
    const eventTime = new Date(event.date).getTime();
    if (Number.isFinite(eventTime)) {
      const daysSince = (Date.now() - eventTime) / DOL_MS_PER_DAY;
      if (daysSince < DOL_RECENT_DAYS) score += DOL_RECENCY_SCORE;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEvent = event;
    }
  }

  if (!bestEvent) return mapStormReportDolToReport(stormReport.recommended_date_of_loss);

  const magnitude = bestEvent.hail_size_inches
    ? `${bestEvent.hail_size_inches}${MAGNITUDE_HAIL_SUFFIX}`
    : bestEvent.wind_speed_mph
      ? `${bestEvent.wind_speed_mph}${MAGNITUDE_WIND_SUFFIX}`
      : bestEvent.event_type;

  const damageMatch = hasHailDamage && bestEvent.event_type === EVENT_TYPE_HAIL
    ? DOL_HAIL_REASON
    : hasWindDamage && bestEvent.event_type.includes(EVENT_TYPE_WIND_INFIX)
      ? DOL_WIND_REASON
      : DOL_DEFAULT_REASON;

  return {
    date: bestEvent.date,
    eventType: bestEvent.event_type,
    magnitude,
    reason: `${damageMatch}${DOL_REASON_INFIX}${bestEvent.distance_miles?.toFixed(DOL_DISTANCE_DECIMALS) || DOL_DISTANCE_UNKNOWN}${DOL_REASON_SUFFIX}`,
  };
}

/** Severity sentinel meaning "no significant damage". Hoisted so the
 *  six call sites that compare against `'none'` all read from one source. */
const SEVERITY_NONE = 'none' as const;

/** Fallback severity when no severity in `DAMAGE_SEVERITY_ORDER` matched
 *  any of the recorded severities for an aggregated damage-type bucket. */
const WORST_SEVERITY_FALLBACK = 'low' as const;

/** Sentinel rendered in DOL-recommendation text when distance is unknown. */
const DOL_DISTANCE_UNKNOWN = '?';
/** Decimal precision for the DOL distance display. */
const DOL_DISTANCE_DECIMALS = 1;
/** DOL reason template fragments — `'${REASON}. ${distance} miles from property.'`. */
const DOL_REASON_INFIX = '. ';
const DOL_REASON_SUFFIX = ' miles from property.';

/** Reason strings used by `enhanceDateOfLossRecommendation` to label why
 *  a particular event was picked as the recommended date of loss. */
const DOL_HAIL_REASON = 'AI-detected hail damage pattern matches this hail event';
const DOL_WIND_REASON = 'AI-detected wind damage pattern matches this wind event';
const DOL_DEFAULT_REASON = 'Strongest storm event within search radius';

/** "Wind" infix used to recognise wind-class events (`'Thunderstorm Wind'`,
 *  `'High Wind'`, `'Strong Wind'`, etc.). Matches the substring contained
 *  in `event.event_type` for every wind-class event we track. */
const EVENT_TYPE_WIND_INFIX = 'Wind';

// ─── RCI component-label constants ───────────────────────────────────
/** Display label for the covering component on flat-roof systems. */
const RCI_LABEL_COVERING_FLAT = 'Membrane/Covering';
/** Display label for the covering component on shingle systems. */
const RCI_LABEL_COVERING_SHINGLE = 'Shingles/Covering';
/** Display labels for the 5 non-covering RCI components. */
const RCI_LABEL_FLASHING = 'Flashing';
const RCI_LABEL_VENTILATION = 'Ventilation';
const RCI_LABEL_GUTTERS = 'Gutters';
const RCI_LABEL_STRUCTURE = 'Structure';
const RCI_LABEL_PENETRATIONS = 'Penetrations';

// ─── RCI starting-score tiers ────────────────────────────────────────
/** Starting score for a roof with no estimated age. Never 100% — even
 *  brand-new roofs have minor imperfections. */
const RCI_DEFAULT_STARTING_SCORE = 99;
/** Age-based starting-score ladder. First row whose `> minAgeYears` is
 *  satisfied wins (table is sorted descending by age). */
const AGE_STARTING_SCORE_TIERS: ReadonlyArray<{ minAgeYears: number; startingScore: number }> = [
  { minAgeYears: 20, startingScore: 60 },
  { minAgeYears: 15, startingScore: 68 },
  { minAgeYears: 10, startingScore: 75 },
  { minAgeYears: 5,  startingScore: 90 },
];

/** Confidence stamped onto user-reported (non-AI) synthetic damage entries. */
const SYNTHETIC_DAMAGE_CONFIDENCE = 100;

/** Threshold for the `RCI_CAP_1_OR_2_HIGH` cap to engage. */
const RCI_MIN_HIGH_DAMAGE_FOR_C_CAP = 1;

/** Component-notes messages — kept here so the wording is editable in one place. */
const MSG_NO_ISSUES_DETECTED = 'No issues detected';
const ISSUES_DETECTED_SUFFIX = ' issue(s) detected';

// ─── Per-component damage-keyword sets (RCI categorisation) ──────────
/** Flashing-component damage keywords. Pairs with `LABEL_KEYWORD_FLASHING`. */
const FLASHING_DAMAGE_KEYWORDS: readonly string[] = ['flashing'];
const LABEL_KEYWORD_FLASHING = 'flashing';
/** Ventilation-component damage keywords. */
const VENT_DAMAGE_TYPE_KEYWORDS: readonly string[] = ['vent', 'pipe_boot'];
const LABEL_KEYWORD_VENT = 'vent';
/** Gutter-component damage keyword. */
const GUTTER_DAMAGE_KEYWORD = 'gutter';
/** Structural-component damage keywords. */
const STRUCTURAL_DAMAGE_TYPE_KEYWORDS: readonly string[] = ['structural', 'sagging', 'decking'];
const LABEL_KEYWORD_STRUCTURAL = 'structural';
/** Penetration-component damage keywords (skylight, chimney, ridge cap). */
const PENETRATION_DAMAGE_TYPE_KEYWORDS: readonly string[] = ['skylight', 'chimney', 'ridge_cap'];
const LABEL_KEYWORD_PENETRATION = 'penetration';

// ─── Synthetic-damage classification keywords (user-reported buckets) ─
/** Damage-type substrings that indicate AI already classified this as wind. */
const SYNTHETIC_WIND_TYPE_KEYWORDS: readonly string[] = ['wind'];
const SYNTHETIC_WIND_TYPE_EXACT = 'missing_shingles';
/** Damage-type substrings that indicate AI already classified this as hail. */
const SYNTHETIC_HAIL_TYPE_KEYWORDS: readonly string[] = ['hail'];
const SYNTHETIC_HAIL_TYPE_EXACT = 'granule_loss';
/** Substrings that exclude an AI-detected damage from the user-reported "general" bucket. */
const SYNTHETIC_GENERAL_EXCLUDE_KEYWORDS: readonly string[] = ['wind', 'hail', 'granule'];

/** Helper for the per-component RCI filters: returns true when the damage's
 *  `type` contains any of `typeKeywords` OR its `label` (lowercased) contains
 *  `labelKeyword`. Centralises the 5 near-identical filter expressions
 *  that used to live in `calculateRoofConditionIndex`. */
function damageMatchesTypeOrLabel(
  d: { type: string; label?: string },
  typeKeywords: readonly string[],
  labelKeyword: string,
): boolean {
  // Defensive: a malformed JSONB row could have a missing/null type even
  // though the type signature requires string. Default to '' so the
  // includes check returns false rather than throwing.
  const type = d.type || '';
  if (typeKeywords.some(k => type.includes(k))) return true;
  return d.label?.toLowerCase().includes(labelKeyword) ?? false;
}

// ─── Executive-summary thresholds & helpers ─────────────────────────
/** Homeowner-template RCI thresholds: ≥75 = "great news", ≥50 = "needs attention", <50 = "concerns". */
const RCI_GOOD_THRESHOLD = 75;
const RCI_FAIR_THRESHOLD = 50;

/** Quick-template RCI thresholds: <40 = Replace, <65 = Repair, else Monitor. */
const RCI_REPLACE_THRESHOLD = 40;
const RCI_REPAIR_THRESHOLD = 65;

/** Max damage types listed in the "Key findings include: ..." line. */
const MAX_TOP_DAMAGE_TYPES = 4;

/** Default material noun when the AI didn't extract one. */
const DEFAULT_MATERIAL_NAME = 'roof';

/** Severity sort order for the top-damage list (lowest index = worst). */
const SEVERITY_SORT_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};
const SEVERITY_SORT_DEFAULT = 4;

/** snake_case_or_kebab → space-separated for the damage-type display strings. */
function replaceUnderscores(s: string): string {
  return s.replace(UNDERSCORE_TO_SPACE_RE, ' ');
}

/** Quick-template recommendation: < REPLACE_THRESHOLD = Replace,
 *  < REPAIR_THRESHOLD = Repair, otherwise Monitor. */
function pickQuickRecommendation(score: number | undefined): 'Replace' | 'Repair' | 'Monitor' {
  if (typeof score !== 'number') return 'Monitor';
  if (score < RCI_REPLACE_THRESHOLD) return 'Replace';
  if (score < RCI_REPAIR_THRESHOLD) return 'Repair';
  return 'Monitor';
}

/**
 * Generate an executive summary from the completed report
 * Adapts tone based on report template (insurance=formal, homeowner=friendly, quick=concise)
 */
export function generateExecutiveSummary(report: ComprehensiveRoofReport): string {
  const template = report.reportTemplate || 'full';
  const parts: string[] = [];

  const rci = report.roofConditionIndex;
  const materialName = (report.damageAnalysis?.roofAge?.roofMaterial && replaceUnderscores(report.damageAnalysis.roofAge.roofMaterial)) || DEFAULT_MATERIAL_NAME;
  const totalDamageTypes = report.damageAnalysis?.damageTypes?.length || 0;
  // Use total damage instance count (sum of all damage type counts), not just number of distinct types
  const totalDamageInstances = report.damageAnalysis?.damageTypes?.reduce((sum, dt) => sum + dt.count, 0) || 0;
  const totalDamages = totalDamageTypes; // Distinct damage types for summary
  const photosAnalyzed = report.damageAnalysis?.totalPhotosAnalyzed || 0;
  const photosWithDamage = report.damageAnalysis?.photosWithDamage || 0;
  const severity = report.damageAnalysis?.overallSeverity || SEVERITY_NONE;
  const userReportedTotal = (report.damageCounts?.windDamaged || 0) + (report.damageCounts?.hailDamaged || 0) + (report.damageCounts?.generalDamaged || 0);

  if (template === 'insurance') {
    // Formal insurance language
    if (rci) {
      parts.push(`Subject property located at ${report.property.address}, ${report.property.city}, ${report.property.state} was inspected and assessed with a Roof Condition Index of ${rci.overallScore}/100 (Grade ${rci.grade}).`);
    }
    if (totalDamages > 0) {
      const instanceDetail = totalDamageInstances > totalDamages ? ` (${totalDamageInstances} total instances)` : '';
      parts.push(`Inspection revealed ${totalDamages} distinct damage type(s)${instanceDetail} classified at ${severity} overall severity, consistent with storm-related deterioration.`);
    }
    const claimPotential = report.stormHistory?.claimPotential;
    if (claimPotential === 'high' || claimPotential === 'medium') {
      const dol = report.stormHistory.recommendedDateOfLoss;
      parts.push(`NOAA storm data analysis covering ${report.stormHistory.yearsAnalyzed} years within a ${report.stormHistory.searchRadiusMiles}-mile radius identified ${report.stormHistory.totalEvents} qualifying weather events. Insurance claim filing is recommended${dol ? ` with proposed date of loss: ${dol.date} (${dol.eventType} - ${dol.magnitude})` : ''}.`);
    }
    if (report.repairEstimate?.total > 0) {
      parts.push(`Estimated repair scope totals $${report.repairEstimate.total.toLocaleString()}, subject to adjuster review and supplemental documentation.`);
    }
  } else if (template === 'homeowner') {
    // Friendly homeowner language
    if (rci) {
      parts.push(`Your ${materialName} at ${report.property.address} scored ${rci.overallScore} out of 100 on our Roof Condition Index, which is a Grade ${rci.grade}.`);
      if (rci.overallScore >= RCI_GOOD_THRESHOLD) parts.push(`Great news: your roof is in solid shape!`);
      else if (rci.overallScore >= RCI_FAIR_THRESHOLD) parts.push(`Your roof has some areas that need attention, but nothing urgent.`);
      else parts.push(`We found some concerns that should be addressed soon to protect your home.`);
    }
    if (totalDamages > 0) {
      const instanceNote = totalDamageInstances > totalDamages ? ` across ${totalDamageInstances} areas` : '';
      parts.push(`We found ${totalDamages} type(s) of damage${instanceNote} during our inspection.`);
    }
    if (report.repairEstimate?.total > 0) {
      parts.push(`Repair costs are estimated around $${report.repairEstimate.total.toLocaleString()}. We've included replacement options so you can compare your choices.`);
    }
  } else if (template === 'quick') {
    // Ultra-concise
    if (rci) {
      parts.push(`RCI: ${rci.overallScore}/100 (${rci.grade}). ${materialName} at ${report.property.address}.`);
    }
    if (totalDamages > 0) {
      parts.push(`${totalDamages} damage type(s), ${severity} severity.`);
    }
    if (report.repairEstimate?.total > 0) {
      parts.push(`Est. repairs: $${report.repairEstimate.total.toLocaleString()}.`);
    }
    const recommendation = pickQuickRecommendation(rci?.overallScore);
    parts.push(`Recommendation: ${recommendation}.`);
  } else {
    // Full / default — existing behavior
    if (rci) {
      parts.push(`This ${materialName} at ${report.property.address} received an overall Roof Condition Index score of ${rci.overallScore}/100 (Grade ${rci.grade}).`);
    } else {
      parts.push(`Comprehensive inspection completed for the ${materialName} at ${report.property.address}.`);
    }

    if (totalDamages > 0) {
      const damageDetail = totalDamageInstances > totalDamages
        ? `${totalDamages} distinct type(s) of damage across ${totalDamageInstances} instance(s)`
        : `${totalDamages} type(s) of damage`;
      const photoDetail = photosAnalyzed > 0
        ? ` Analysis of ${photosAnalyzed} photo(s) found damage in ${photosWithDamage} photo(s).`
        : '';
      parts.push(`The AI inspection identified ${damageDetail} with an overall severity rating of ${severity}.${photoDetail}`);

      // List top damage types by severity
      const topTypes = [...(report.damageAnalysis?.damageTypes || [])]
        .sort((a, b) =>
          (SEVERITY_SORT_ORDER[a.severity] ?? SEVERITY_SORT_DEFAULT) -
          (SEVERITY_SORT_ORDER[b.severity] ?? SEVERITY_SORT_DEFAULT))
        .slice(0, MAX_TOP_DAMAGE_TYPES)
        .map(dt => `${replaceUnderscores(dt.type)} (${dt.severity})`)
        .join(', ');
      if (topTypes) {
        parts.push(`Key findings include: ${topTypes}.`);
      }
    } else if (userReportedTotal > 0) {
      const details: string[] = [];
      if (report.damageCounts?.windDamaged) details.push(`${report.damageCounts.windDamaged} wind-damaged`);
      if (report.damageCounts?.hailDamaged) details.push(`${report.damageCounts.hailDamaged} hail-damaged`);
      if (report.damageCounts?.generalDamaged) details.push(`${report.damageCounts.generalDamaged} general damage`);
      parts.push(`The inspector reported ${details.join(', ')} area(s) requiring attention. Professional on-site inspection recommended to confirm full extent of damage.`);
    } else if (photosAnalyzed > 0) {
      parts.push(`Analysis of ${photosAnalyzed} photo(s) did not detect specific damage types, but a professional on-site inspection is recommended to confirm roof condition.`);
    } else {
      parts.push('No photos were provided for AI damage analysis.');
    }

    const claimPotential = report.stormHistory?.claimPotential;
    if (claimPotential === 'high' || claimPotential === 'medium') {
      const dol = report.stormHistory.recommendedDateOfLoss;
      parts.push(`Based on ${report.stormHistory.totalEvents} storm events over ${report.stormHistory.yearsAnalyzed} years, an insurance claim is recommended${dol ? ` with a suggested date of loss of ${dol.date}` : ''}.`);
    }

    if (report.repairEstimate?.total > 0) {
      parts.push(`Estimated repair costs total $${report.repairEstimate.total.toLocaleString()}.`);
    }
  }

  return parts.join(' ');
}

/**
 * Generate photo-by-photo narrative findings from damage analysis
 */
/** Default narrative when no photos were uploaded (the entire AI vision step is skipped). */
const NARRATIVE_NO_PHOTOS = 'No photos were provided for analysis.';

/** Paragraph separator used in the multi-paragraph narrative. */
const NARRATIVE_PARAGRAPH_SEPARATOR = '\n\n';

/** Damage-row separator inside a single photo's narrative line. */
const NARRATIVE_DAMAGE_SEPARATOR = '; ';

/** Damage-type-summary separator (final paragraph of the narrative). */
const NARRATIVE_TYPE_SUMMARY_SEPARATOR = ', ';

/** Hoisted regex shared by `replaceUnderscores` (defined earlier in the file). */
const UNDERSCORE_TO_SPACE_RE = /_/g;

/** Title-case the first character of a string ("low" → "Low"). Empty-safe. */
function capitalizeFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Humanise an underscore-separated slug ("granule_loss" → "granule loss"). */
function humanizeSlug(slug: string): string {
  return slug.replace(UNDERSCORE_TO_SPACE_RE, ' ');
}

/** Per-damage-entry template fragments — assembled into:
 *  `'LABEL (SEVERITY severity, CONFIDENCE% confidence) at LOCATION'`. */
const DAMAGE_ENTRY_OPEN_PAREN = ' (';
const DAMAGE_ENTRY_SEVERITY_SUFFIX = ' severity, ';
const DAMAGE_ENTRY_CONFIDENCE_SUFFIX = '% confidence)';
const DAMAGE_ENTRY_LOCATION_PREFIX = ' at ';

/** Damage-types summary row template fragments — assembled into:
 *  `'TYPE (N instances, SEVERITY severity)'`, with the instance count
 *  correctly pluralized via `pluralizeCount` (e.g. "1 instance"). */
const DAMAGE_TYPE_OPEN_PAREN = ' (';
/** Singular noun pluralized per damage-type count ("1 instance" / "3 instances"). */
const DAMAGE_TYPE_INSTANCE_NOUN = 'instance';
/** Separator between the instance count and the severity clause. */
const DAMAGE_TYPE_INSTANCE_SEVERITY_SEPARATOR = ', ';
const DAMAGE_TYPE_SEVERITY_SUFFIX = ' severity)';

/**
 * Render a count with a correctly pluralized noun:
 *  `pluralizeCount(1, 'instance')` → "1 instance",
 *  `pluralizeCount(3, 'instance')` → "3 instances",
 *  `pluralizeCount(2, 'foot', 'feet')` → "2 feet".
 * Only a count of exactly 1 uses the singular form (0 and 2+ use the plural).
 */
export function pluralizeCount(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Format a single damage row inside the per-photo narrative line. */
function formatDamageEntry(d: AnalyzedPhoto['damages'][number]): string {
  const severity = capitalizeFirst(d.severity);
  const label = d.label || humanizeSlug(d.type);
  const location = d.location ? `${DAMAGE_ENTRY_LOCATION_PREFIX}${d.location}` : '';
  return `${label}${DAMAGE_ENTRY_OPEN_PAREN}${severity}${DAMAGE_ENTRY_SEVERITY_SUFFIX}${d.confidence}${DAMAGE_ENTRY_CONFIDENCE_SUFFIX}${location}`;
}

/** Format the "In total, the following damage types were identified..." summary. */
function formatDamageTypesSummary(types: DamageAnalysisSection['damageTypes']): string {
  return types
    .map((dt) => `${humanizeSlug(dt.type)}${DAMAGE_TYPE_OPEN_PAREN}${pluralizeCount(dt.count, DAMAGE_TYPE_INSTANCE_NOUN)}${DAMAGE_TYPE_INSTANCE_SEVERITY_SEPARATOR}${dt.severity}${DAMAGE_TYPE_SEVERITY_SUFFIX}`)
    .join(NARRATIVE_TYPE_SUMMARY_SEPARATOR);
}

/** Narrative opening template fragments — assembled into:
 *  `'A total of N photograph(s) were analyzed using AI-powered roof inspection technology. M photo(s) showed evidence of damage or deterioration.'` */
const NARRATIVE_OPENING_PREFIX = 'A total of ';
const NARRATIVE_OPENING_INFIX = ' photograph(s) were analyzed using AI-powered roof inspection technology. ';
const NARRATIVE_OPENING_SUFFIX = ' photo(s) showed evidence of damage or deterioration.';

/** Per-photo line template fragments — assembled into:
 *  `'Photo N (SEVERITY severity): DAMAGE_LIST'` */
const NARRATIVE_PHOTO_PREFIX = 'Photo ';
const NARRATIVE_PHOTO_OPEN_PAREN = ' (';
const NARRATIVE_PHOTO_SEVERITY_SUFFIX = ' severity): ';

/** Damage-types summary template fragments — assembled into:
 *  `'In total, the following damage types were identified: TYPES_LIST.'` */
const NARRATIVE_TYPES_SUMMARY_PREFIX = 'In total, the following damage types were identified: ';
const NARRATIVE_TYPES_SUMMARY_SUFFIX = '.';

/** Build the opening paragraph: total photos analyzed + photos showing damage. */
function buildNarrativeOpening(totalPhotos: number, withDamage: number): string {
  return `${NARRATIVE_OPENING_PREFIX}${totalPhotos}${NARRATIVE_OPENING_INFIX}${withDamage}${NARRATIVE_OPENING_SUFFIX}`;
}

export function generateNarrativeFindings(damageAnalysis: DamageAnalysisSection): string {
  if (!damageAnalysis || damageAnalysis.totalPhotosAnalyzed === 0) {
    return NARRATIVE_NO_PHOTOS;
  }

  const paragraphs: string[] = [
    buildNarrativeOpening(damageAnalysis.totalPhotosAnalyzed, damageAnalysis.photosWithDamage),
  ];

  // Per-photo findings
  for (let i = 0; i < damageAnalysis.photos.length; i++) {
    const photo = damageAnalysis.photos[i];
    if (photo.damages.length === 0 && photo.overallSeverity === SEVERITY_NONE) continue;

    const damageList = photo.damages.map(formatDamageEntry).join(NARRATIVE_DAMAGE_SEPARATOR);
    paragraphs.push(`${NARRATIVE_PHOTO_PREFIX}${i + 1}${NARRATIVE_PHOTO_OPEN_PAREN}${photo.overallSeverity}${NARRATIVE_PHOTO_SEVERITY_SUFFIX}${damageList || photo.aiSummary}`);
  }

  // Summary of damage types
  if (damageAnalysis.damageTypes.length > 0) {
    paragraphs.push(`${NARRATIVE_TYPES_SUMMARY_PREFIX}${formatDamageTypesSummary(damageAnalysis.damageTypes)}${NARRATIVE_TYPES_SUMMARY_SUFFIX}`);
  }

  return paragraphs.join(NARRATIVE_PARAGRAPH_SEPARATOR);
}

// ─── Storm-summary helpers / constants ──────────────────────────────
/** Canonical event-type strings — hoisted so the four call sites
 *  that compare against them all read from one source. */
const EVENT_TYPE_HAIL = 'Hail';
const EVENT_TYPE_TORNADO = 'Tornado';

/** Magnitude format suffixes for hail (`'1.5" hail'`) + wind (`'70 mph winds'`). */
const MAGNITUDE_HAIL_SUFFIX = '" hail';
const MAGNITUDE_WIND_SUFFIX = ' mph winds';

/** Storm-event description template fragments — assembled into:
 *  `'EVENT_TYPE event N.N miles from property'`. */
const STORM_EVENT_DESC_INFIX = ' event ';
const STORM_EVENT_DESC_SUFFIX = ' miles from property';

/** Claim-potential tier values — used by `buildStormSummarySection` to
 *  represent and compare the calculated claim-potential level. Hoisted
 *  so the same string isn't typed at 8+ comparison sites. */
const CLAIM_POTENTIAL_NONE = 'none' as const;
const CLAIM_POTENTIAL_LOW = 'low' as const;
const CLAIM_POTENTIAL_MEDIUM = 'medium' as const;
const CLAIM_POTENTIAL_HIGH = 'high' as const;

/** Synthetic damage entries pushed when the user reports wind/hail/general
 *  damage but the AI didn't pick up the same number of instances. Hoisted
 *  so call-site argument lists stay readable. */
const SYNTHETIC_PREFIX_WIND = 'manual-wind';
const SYNTHETIC_PREFIX_HAIL = 'manual-hail';
const SYNTHETIC_PREFIX_GENERAL = 'manual-general';
const SYNTHETIC_TYPE_WIND_DAMAGE = 'wind_damage';
const SYNTHETIC_TYPE_HAIL_DAMAGE = 'hail_damage';
const SYNTHETIC_TYPE_CRACKED_SHINGLES = 'cracked_shingles';
const SYNTHETIC_LABEL_WIND_REPORTED = 'Wind Damage (reported)';
const SYNTHETIC_LABEL_HAIL_REPORTED = 'Hail Damage (reported)';
const SYNTHETIC_LABEL_GENERAL_REPORTED = 'General Damage (reported)';
const SYNTHETIC_DESC_WIND_REPORTED = 'User-reported wind damage';
const SYNTHETIC_DESC_HAIL_REPORTED = 'User-reported hail damage';
const SYNTHETIC_DESC_GENERAL_REPORTED = 'User-reported general damage';

/** True when the event is wind-class (thunderstorm wind, high wind,
 *  strong wind, hurricane, tropical storm) OR a tornado. */
function isWindOrTornadoEvent(e: StormEvent): boolean {
  return e.event_type.includes(EVENT_TYPE_WIND_INFIX) || e.event_type === EVENT_TYPE_TORNADO;
}

/** Damage-keyword sets for the AI-vision claim-boost heuristics. */
const AI_HAIL_KEYWORDS = ['hail', 'impact', 'bruise', 'strike', 'dent'] as const;
const AI_WIND_KEYWORDS = ['wind', 'lifted', 'missing', 'torn', 'blown'] as const;

/** Format a storm's distance for the description line — accepts a possibly
 *  missing value and renders `?` for unknown. */
function formatStormDistance(distanceMiles: number | undefined | null): string {
  if (typeof distanceMiles !== 'number' || !Number.isFinite(distanceMiles)) return '?';
  return distanceMiles.toFixed(1);
}

/** True when the damage analysis severity is high or critical (used to
 *  decide whether AI evidence escalates a 'medium' claim to 'high'). */
function isHighOrCritical(severity: string | undefined): boolean {
  return severity === 'high' || severity === 'critical';
}

/**
 * Find the most recent storm event of a given type
 */
function findMostRecentStorm(
  events: StormEvent[] | undefined,
  type: 'hail' | 'wind'
): MostRecentStorm | undefined {
  if (!events || events.length === 0) return undefined;
  const filtered = events.filter(e => {
    if (type === 'hail') return e.event_type === EVENT_TYPE_HAIL;
    return isWindOrTornadoEvent(e);
  });

  if (filtered.length === 0) return undefined;

  // The upstream storm-history-service.ts sorts by date desc before
  // returning, so [0] is the most recent. Documented here so a future
  // refactor of the upstream pipeline knows to preserve this invariant.
  const mostRecent = filtered[0];

  let magnitude = '';
  if (type === 'hail' && mostRecent.hail_size_inches) {
    magnitude = `${mostRecent.hail_size_inches}${MAGNITUDE_HAIL_SUFFIX}`;
  } else if (type === 'wind' && mostRecent.wind_speed_mph) {
    magnitude = `${mostRecent.wind_speed_mph}${MAGNITUDE_WIND_SUFFIX}`;
  } else {
    magnitude = mostRecent.event_type;
  }

  return {
    date: mostRecent.date,
    type,
    magnitude,
    distanceMiles: mostRecent.distance_miles || 0,
    description: `${mostRecent.event_type}${STORM_EVENT_DESC_INFIX}${formatStormDistance(mostRecent.distance_miles)}${STORM_EVENT_DESC_SUFFIX}`,
    event: mostRecent,
  };
}

/**
 * Build storm summary section from full storm report
 */
export function buildStormSummarySection(
  stormReport: StormReport,
  damageAnalysis?: DamageAnalysisSection,
  damageCounts?: { windDamaged: number; hailDamaged: number; generalDamaged: number }
): StormSummarySection {
  const mostRecentHail = findMostRecentStorm(stormReport.events, 'hail');
  const mostRecentWind = findMostRecentStorm(stormReport.events, 'wind');

  // Build events by year summary. Defensive against a legacy storm report
  // row that lacks events_by_year (predates the field's introduction).
  const eventsByYear: Record<number, { hail: number; wind: number; total: number }> = {};
  for (const [yearStr, events] of Object.entries(stormReport.events_by_year || {})) {
    const year = parseInt(yearStr, 10);
    const hail = events.filter(e => e.event_type === EVENT_TYPE_HAIL).length;
    const wind = events.filter(isWindOrTornadoEvent).length;
    eventsByYear[year] = { hail, wind, total: events.length };
  }

  // Start with storm service claim potential, then boost based on user-reported damage
  let claimPotential = stormReport.summary.insurance_claim_potential;

  if (damageCounts && ((damageCounts.windDamaged || 0) > 0 || (damageCounts.hailDamaged || 0) > 0)) {
    // User confirmed wind/hail damage — boost claim potential if storms exist in the area
    if (claimPotential === CLAIM_POTENTIAL_NONE && stormReport.summary.total_events > 0) {
      claimPotential = CLAIM_POTENTIAL_MEDIUM; // Storms exist + user-reported damage = claimable
    } else if (claimPotential === CLAIM_POTENTIAL_LOW) {
      claimPotential = CLAIM_POTENTIAL_MEDIUM; // Boost from low since user confirmed damage
    }
  }

  // Boost claim potential when AI vision detects hail/impact/wind damage types
  // (NOAA data can be incomplete — AI photo evidence should elevate claim potential)
  if (damageAnalysis && claimPotential !== CLAIM_POTENTIAL_HIGH) {
    const aiDamageTypes = damageAnalysis.damageTypes.map(dt => dt.type.toLowerCase());

    const hasAIHailDamage = aiDamageTypes.some(t => AI_HAIL_KEYWORDS.some(k => t.includes(k)));
    const hasAIWindDamage = aiDamageTypes.some(t => AI_WIND_KEYWORDS.some(k => t.includes(k)));
    const hasHighSeverity = isHighOrCritical(damageAnalysis.overallSeverity);

    if (hasAIHailDamage || hasAIWindDamage) {
      if (claimPotential === CLAIM_POTENTIAL_NONE && stormReport.summary.total_events > 0) {
        claimPotential = CLAIM_POTENTIAL_MEDIUM; // AI detected storm damage + storms in area
      } else if (claimPotential === CLAIM_POTENTIAL_LOW) {
        claimPotential = CLAIM_POTENTIAL_MEDIUM;
      } else if (claimPotential === CLAIM_POTENTIAL_MEDIUM && hasHighSeverity) {
        claimPotential = CLAIM_POTENTIAL_HIGH; // AI confirms severe storm damage
      }
    }
  }

  return {
    yearsAnalyzed: stormReport.years_covered,
    searchRadiusMiles: stormReport.search_radius_miles,
    totalEvents: stormReport.summary.total_events,
    hailEvents: stormReport.summary.hail_events,
    windEvents: stormReport.summary.wind_events,
    tornadoEvents: stormReport.summary.tornado_events,
    largestHailInches: stormReport.summary.largest_hail_inches,
    highestWindMph: stormReport.summary.highest_wind_mph,
    mostRecentHailStorm: mostRecentHail,
    mostRecentWindStorm: mostRecentWind,
    riskLevel: stormReport.risk_assessment.overall_risk,
    // `?? 0` so a legitimate score of 0 isn't replaced by 0 (no-op),
    // but null/undefined scores from older rows still default. Prevents
    // a future change to non-zero default from being shadowed by `||`.
    riskScore: stormReport.risk_score?.overall_score ?? 0,
    claimPotential,
    recommendedDateOfLoss: enhanceDateOfLossRecommendation(stormReport, damageAnalysis, damageCounts),
    eventsByYear,
  };
}

// ─── Damage-analysis helpers (hoisted out of `buildDamageAnalysisSection`) ──
/** Worst-first severity ordering — used to pick the headline severity
 *  for an aggregated damage-type bucket. */
const DAMAGE_SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

/** Numeric severity ranks for the photo-level overall comparison. */
const OVERALL_SEVERITY_RANKS: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
/** Reverse map (rank → severity name) so the rank-to-name lookup
 *  doesn't iterate the entries on every photo-set assembly. */
const OVERALL_SEVERITY_BY_RANK: ReadonlyMap<number, string> = new Map(
  Object.entries(OVERALL_SEVERITY_RANKS).map(([k, v]) => [v, k]),
);

/** Cap on the number of damage-type names listed in the AI summary. */
const MAX_DAMAGE_TYPES_IN_AI_SUMMARY = 3;

/** AI-summary fallback strings — extracted so the wording can be
 *  tuned/i18n'd in one place. */
const AI_SUMMARY_NO_PHOTOS = 'No photos analyzed.';
/** AI summary template fragments — assembled into:
 *  `'Analyzed N photo(s). No significant damage detected.'`  OR
 *  `'Analyzed N photo(s). Found M type(s) of damage including X, Y. Overall severity: high.'` */
const AI_SUMMARY_ANALYZED_PREFIX = 'Analyzed ';
/** Nouns pluralized per count via `pluralizeCount` (e.g. "1 photo" / "2 types"). */
const AI_SUMMARY_PHOTO_NOUN = 'photo';
const AI_SUMMARY_TYPE_NOUN = 'type';
const AI_SUMMARY_NO_DAMAGE_SUFFIX = '. No significant damage detected.';
const AI_SUMMARY_FOUND_PREFIX = '. Found ';
const AI_SUMMARY_OF_DAMAGE_INFIX = ' of damage including ';
const AI_SUMMARY_SEVERITY_INFIX = '. Overall severity: ';
const AI_SUMMARY_PERIOD = '.';
const AI_SUMMARY_DAMAGE_LIST_JOINER = ', ';

/**
 * Build damage analysis section from AI analysis results
 */
export function buildDamageAnalysisSection(
  photos: AnalyzedPhoto[],
  roofAge: RoofAgeEstimation | null = null
): DamageAnalysisSection {
  const photosWithDamage = photos.filter(
    p => p.damages.length > 0 || p.overallSeverity !== SEVERITY_NONE
  );

  // Aggregate damage types
  const damageTypeMap = new Map<string, { count: number; severities: string[] }>();
  for (const photo of photos) {
    for (const damage of photo.damages) {
      const existing = damageTypeMap.get(damage.type);
      if (existing) {
        existing.count++;
        existing.severities.push(damage.severity);
      } else {
        damageTypeMap.set(damage.type, {
          count: 1,
          severities: [damage.severity],
        });
      }
    }
  }

  const damageTypes = Array.from(damageTypeMap.entries()).map(([type, data]) => {
    // Determine overall severity for this damage type — first match wins
    // because DAMAGE_SEVERITY_ORDER is sorted worst-first.
    const worstSeverity = DAMAGE_SEVERITY_ORDER.find(s => data.severities.includes(s)) || WORST_SEVERITY_FALLBACK;
    return {
      type,
      count: data.count,
      severity: worstSeverity,
    };
  });

  // Determine overall severity by ranking each photo's overallSeverity
  // and picking the highest-rank value. Manual reduce instead of Math.max
  // spread so 10k photos don't risk a "max call stack size exceeded".
  let maxSeverity = 0;
  for (const p of photos) {
    const rank = OVERALL_SEVERITY_RANKS[p.overallSeverity] || 0;
    if (rank > maxSeverity) maxSeverity = rank;
  }
  const overallSeverity = (
    OVERALL_SEVERITY_BY_RANK.get(maxSeverity) || SEVERITY_NONE
  ) as DamageAnalysisSection['overallSeverity'];

  // Generate AI summary
  let aiSummary = '';
  if (photos.length === 0) {
    aiSummary = AI_SUMMARY_NO_PHOTOS;
  } else if (photosWithDamage.length === 0) {
    aiSummary = `${AI_SUMMARY_ANALYZED_PREFIX}${pluralizeCount(photos.length, AI_SUMMARY_PHOTO_NOUN)}${AI_SUMMARY_NO_DAMAGE_SUFFIX}`;
  } else {
    const damageList = damageTypes
      .slice(0, MAX_DAMAGE_TYPES_IN_AI_SUMMARY)
      .map(d => d.type.replace(UNDERSCORE_TO_SPACE_RE, ' '))
      .join(AI_SUMMARY_DAMAGE_LIST_JOINER);
    aiSummary = `${AI_SUMMARY_ANALYZED_PREFIX}${pluralizeCount(photos.length, AI_SUMMARY_PHOTO_NOUN)}${AI_SUMMARY_FOUND_PREFIX}${pluralizeCount(damageTypes.length, AI_SUMMARY_TYPE_NOUN)}${AI_SUMMARY_OF_DAMAGE_INFIX}${damageList}${AI_SUMMARY_SEVERITY_INFIX}${overallSeverity}${AI_SUMMARY_PERIOD}`;
  }

  return {
    totalPhotosAnalyzed: photos.length,
    photosWithDamage: photosWithDamage.length,
    overallSeverity,
    roofAge,
    damageTypes,
    photos,
    aiSummary,
  };
}

// ─── Repair-estimate note constants (hoisted out of `buildRepairEstimateSection`) ──
const NO_REPAIRS_NOTE = 'No repairs recommended based on current analysis.';
const PRICING_AVERAGES_NOTE = 'Estimates are based on 2024-2025 industry averages.';
const PRICING_VARIES_NOTE = 'Final pricing may vary based on material availability and site conditions.';
/** Markup-multiplier note template fragments — assembles to
 *  `'Pricing includes Nx markup for overhead and profit.'` */
const PRICING_MARKUP_PREFIX = 'Pricing includes ';
const PRICING_MARKUP_SUFFIX = 'x markup for overhead and profit.';

/**
 * Build repair estimate section from pricing summary
 */
export function buildRepairEstimateSection(
  pricingSummary: RepairEstimateSummary,
  additionalNotes: string[] = []
): RepairEstimateSection {
  const notes = [...additionalNotes];

  if (pricingSummary.lineItems.length === 0) {
    notes.push(NO_REPAIRS_NOTE);
  } else {
    notes.push(`${PRICING_MARKUP_PREFIX}${pricingSummary.multiplier}${PRICING_MARKUP_SUFFIX}`);
    notes.push(PRICING_AVERAGES_NOTE);
    notes.push(PRICING_VARIES_NOTE);
  }

  return {
    lineItems: pricingSummary.lineItems,
    subtotal: pricingSummary.subtotalBase,
    multiplierApplied: pricingSummary.multiplier,
    total: pricingSummary.subtotalFinal,
    notes,
  };
}

// ─── Report-creation constants ─────────────────────────────────────────
const REPORT_ID_PREFIX = 'rr';
const REPORT_VERSION = '3.1';
const DEFAULT_REPORT_TYPES: ReportType[] = ['inspection', 'measurement', 'storm'];

/** Length of the random tail in fallback report ids. */
const REPORT_ID_RANDOM_TAIL_LEN = 6;
/** Joiner between the prefix / timestamp / random segments of a fallback id. */
const REPORT_ID_SEPARATOR = '-';
/** Radix used to compress the timestamp + random segments into base-36
 *  (0-9, a-z) so the fallback id stays compact and url-safe. */
const REPORT_ID_BASE36_RADIX = 36;
/** Index where `Math.random().toString(36)` payload starts (after `'0.'`). */
const REPORT_ID_RANDOM_OFFSET = 2;
/** Default empty inspector-notes string when the caller didn't supply one. */
const DEFAULT_INSPECTOR_NOTES = '';
/** Inclusive lower bound for `params.reportTypes` to be considered non-empty
 *  and override the `DEFAULT_REPORT_TYPES` fallback. */
const REPORT_TYPES_MIN_LEN = 0;
/** Fallback data-quality value when `STORM_DATA_QUALITY_MAP` lookup misses. */
const STORM_DATA_QUALITY_FALLBACK: ComprehensiveRoofReport['dataQuality'] = 'degraded';

/**
 * Generate a unique report ID. Prefers `crypto.randomUUID()` when available
 * (Node 19+ / modern browsers) for stronger uniqueness; falls back to a
 * timestamp + Math.random tail otherwise.
 */
function generateReportId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${REPORT_ID_PREFIX}${REPORT_ID_SEPARATOR}${crypto.randomUUID()}`;
  }
  const timestamp = Date.now().toString(REPORT_ID_BASE36_RADIX);
  const random = Math.random()
    .toString(REPORT_ID_BASE36_RADIX)
    .substring(REPORT_ID_RANDOM_OFFSET, REPORT_ID_RANDOM_OFFSET + REPORT_ID_RANDOM_TAIL_LEN);
  return `${REPORT_ID_PREFIX}${REPORT_ID_SEPARATOR}${timestamp}${REPORT_ID_SEPARATOR}${random}`;
}

/** Map storm-level data-quality enum → report-level data-quality enum.
 *  Each key matches a value the storm service emits via `data_quality`;
 *  values mirror the union in `ComprehensiveRoofReport['dataQuality']`. */
const STORM_DATA_QUALITY_VERIFIED: ComprehensiveRoofReport['dataQuality'] = 'verified';
const STORM_DATA_QUALITY_PARTIAL: ComprehensiveRoofReport['dataQuality'] = 'partial';
const STORM_DATA_QUALITY_DEGRADED: ComprehensiveRoofReport['dataQuality'] = 'degraded';
const STORM_DATA_QUALITY_MAP: Record<string, ComprehensiveRoofReport['dataQuality']> = {
  verified: STORM_DATA_QUALITY_VERIFIED,
  partial: STORM_DATA_QUALITY_PARTIAL,
  degraded: STORM_DATA_QUALITY_DEGRADED,
};

/** Map a `StormReport.data_quality` to the report-level data quality.
 *  Unknown values fall through to `'degraded'` — same as the prior ladder. */
function mapStormDataQualityToReport(
  storm: StormReport['data_quality'],
): ComprehensiveRoofReport['dataQuality'] {
  return STORM_DATA_QUALITY_MAP[storm as string] || STORM_DATA_QUALITY_FALLBACK;
}

// ─── Defensive normalisation of pipeline inputs ────────────────────────────
// `createComprehensiveReport` is the merge point for several optional pipeline
// stages. In real runs one or more of those stages can be skipped (storm-only
// path, no inspection photos, no repair estimate) or can return a partial
// object (legacy DB row, geocode-only storm shell). The helpers below coerce
// those missing/partial inputs into the minimal well-formed shapes the section
// builders expect — WITHOUT altering values for already-complete inputs.

/** Empty repair estimate used when the inspection step produced none. */
const EMPTY_REPAIR_ESTIMATE: RepairEstimateSummary = {
  lineItems: [],
  subtotalBase: 0,
  subtotalFinal: 0,
  multiplier: 1,
} as unknown as RepairEstimateSummary;

/** Coerce a possibly-missing/partial repair estimate into a well-formed one.
 *  A complete estimate is returned unchanged. */
function normalizeRepairEstimate(
  estimate: RepairEstimateSummary | null | undefined,
): RepairEstimateSummary {
  if (!estimate) return EMPTY_REPAIR_ESTIMATE;
  return {
    lineItems: Array.isArray(estimate.lineItems) ? estimate.lineItems : [],
    subtotalBase: Number.isFinite(estimate.subtotalBase) ? estimate.subtotalBase : 0,
    subtotalFinal: Number.isFinite(estimate.subtotalFinal) ? estimate.subtotalFinal : 0,
    multiplier: Number.isFinite(estimate.multiplier) ? estimate.multiplier : 1,
  } as RepairEstimateSummary;
}

/** Coerce a possibly-missing analyzed-photos list into a real array. */
function normalizeAnalyzedPhotos(
  photos: AnalyzedPhoto[] | null | undefined,
): AnalyzedPhoto[] {
  return Array.isArray(photos) ? photos : [];
}

/** Coerce a possibly-missing/partial storm report into one whose nested
 *  objects (`summary`, `risk_assessment`, `events*`, `data_sources`) are all
 *  present, so the section builders never dereference `undefined`. A complete
 *  storm report flows through with its existing values intact. */
function normalizeStormReport(storm: StormReport | null | undefined): StormReport {
  const s = (storm || {}) as Partial<StormReport>;
  const summary = (s.summary || {}) as Partial<StormReport['summary']>;
  const riskAssessment = (s.risk_assessment || {}) as Partial<StormReport['risk_assessment']>;
  const safeNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  return {
    ...(s as StormReport),
    years_covered: safeNum(s.years_covered),
    search_radius_miles: safeNum(s.search_radius_miles),
    events: Array.isArray(s.events) ? s.events : [],
    significant_events: Array.isArray(s.significant_events) ? s.significant_events : [],
    events_by_year: s.events_by_year || {},
    summary: {
      total_events: safeNum(summary.total_events),
      hail_events: safeNum(summary.hail_events),
      wind_events: safeNum(summary.wind_events),
      tornado_events: safeNum(summary.tornado_events),
      largest_hail_inches: summary.largest_hail_inches,
      highest_wind_mph: summary.highest_wind_mph,
      insurance_claim_potential: summary.insurance_claim_potential || CLAIM_POTENTIAL_NONE,
      hail_size_distribution: summary.hail_size_distribution,
    },
    risk_assessment: {
      hail_risk: riskAssessment.hail_risk || 'low',
      wind_risk: riskAssessment.wind_risk || 'low',
      overall_risk: riskAssessment.overall_risk || 'low',
      risk_factors: Array.isArray(riskAssessment.risk_factors) ? riskAssessment.risk_factors : [],
      recommendations: Array.isArray(riskAssessment.recommendations) ? riskAssessment.recommendations : [],
    },
    data_sources: Array.isArray(s.data_sources) ? s.data_sources : [],
  } as StormReport;
}

/**
 * Create a comprehensive roof report from all components
 */
export function createComprehensiveReport(params: {
  property: {
    address: string;
    city: string;
    state: string;
    zip?: string;
    latitude: number;
    longitude: number;
  };
  stormReport: StormReport;
  analyzedPhotos: AnalyzedPhoto[];
  repairEstimate: RepairEstimateSummary;
  roofAge?: RoofAgeEstimation | null;
  crmLink?: {
    leadId?: string;
    jobId?: string;
    projectId?: string;
  };
  // Enhanced v2 fields. The two JSONB-shaped fields (replacementOptions
  // / measurements) match the loose `unknown[]` / `Record<string, unknown>`
  // declared on ComprehensiveRoofReport so callers can pass values
  // round-tripped from the DB without re-typing them.
  roofDetails?: ComprehensiveRoofReport['roofDetails'];
  damageCounts?: ComprehensiveRoofReport['damageCounts'];
  replacementOptions?: ComprehensiveRoofReport['replacementOptions'];
  measurements?: ComprehensiveRoofReport['measurements'];
  inspectorNotes?: string;
  // v3: Report type system
  reportTypes?: ReportType[];
  reportTemplate?: ReportTemplate;
  /** Per-report override of the template's default visual style. */
  reportVisualStyle?: ReportVisualStyle;
  stormEnhanced?: EnhancedStormData;
  measurementReport?: MeasurementReportSection;
  // v3.2: Inspector condition rating (1-100) — anchors the AI condition score
  inspectorRating?: number;
}): ComprehensiveRoofReport {
  const { property, roofAge, crmLink } = params;

  // Defensively normalise the three primary pipeline inputs. Any of them can be
  // missing (storm-only path, no photos, no estimate) or partial (legacy DB
  // row / geocode-only storm shell). Normalisation is a no-op for already
  // well-formed inputs, so the happy path is unchanged.
  const stormReport = normalizeStormReport(params.stormReport);
  const analyzedPhotos = normalizeAnalyzedPhotos(params.analyzedPhotos);
  const repairEstimate = normalizeRepairEstimate(params.repairEstimate);

  // Build sections first to avoid duplicate calls and enable cross-referencing
  const damageAnalysisSection = buildDamageAnalysisSection(analyzedPhotos, roofAge);
  const rci = calculateRoofConditionIndex(damageAnalysisSection, roofAge || null, params.damageCounts, params.roofDetails?.type, params.inspectorRating);

  const reportObj: ComprehensiveRoofReport = {
    id: generateReportId(),
    generatedAt: new Date().toISOString(),
    version: REPORT_VERSION,

    property,
    crmLink,

    stormHistory: buildStormSummarySection(stormReport, damageAnalysisSection, params.damageCounts),
    damageAnalysis: damageAnalysisSection,
    repairEstimate: buildRepairEstimateSection(repairEstimate),

    // Enhanced v2 fields
    roofDetails: params.roofDetails,
    damageCounts: params.damageCounts,
    replacementOptions: params.replacementOptions,
    measurements: params.measurements,

    // v3: Report type system. Use the supplied array when non-empty,
    // otherwise fall back to DEFAULT_REPORT_TYPES so legacy callers
    // that don't pass `reportTypes` still get a sensible report.
    reportTypes: params.reportTypes && params.reportTypes.length > REPORT_TYPES_MIN_LEN
      ? [...params.reportTypes]  // defensive copy so caller can mutate without affecting the report
      : [...DEFAULT_REPORT_TYPES],
    reportTemplate: params.reportTemplate,
    reportVisualStyle: params.reportVisualStyle,
    stormEnhanced: params.stormEnhanced,
    measurementReport: params.measurementReport,

    inspectorNotes: params.inspectorNotes || DEFAULT_INSPECTOR_NOTES,

    // v3.1: Roof Condition Index and summaries
    roofConditionIndex: rci,

    dataQuality: mapStormDataQualityToReport(stormReport.data_quality),
    dataSources: stormReport.data_sources,
  };

  // Generate executive summary and narrative findings from the complete report
  reportObj.executiveSummary = generateExecutiveSummary(reportObj);
  reportObj.narrativeFindings = generateNarrativeFindings(damageAnalysisSection);

  return reportObj;
}

/**
 * Severity color tokens (Tailwind palette aliases).
 * Hoisted to module scope so the maps aren't reallocated on every call.
 *
 * Vocabulary mirrors the `SEVERITY_HEX` table in
 * `server/src/lib/branded-report-html.ts` so a "severe" chip in the
 * HTML report and the same chip in the in-app UI use identical colors.
 */
export const SEVERITY_COLORS: Readonly<Record<string, string>> = Object.freeze({
  none: '#22c55e',      // green-500
  cosmetic: '#22c55e',  // green-500 (no real damage)
  advisory: '#3b82f6',  // blue-500 (informational)
  minor: '#84cc16',     // lime-500
  low: '#84cc16',       // lime-500
  moderate: '#eab308',  // yellow-500
  medium: '#eab308',    // yellow-500
  elevated: '#f59e0b',  // amber-500
  high: '#f97316',      // orange-500
  severe: '#dc2626',    // red-600
  critical: '#ef4444',  // red-500
  extreme: '#991b1b',   // red-800
});

const SEVERITY_COLOR_DEFAULT = '#eab308'; // medium / yellow-500

export const RISK_COLORS: Readonly<Record<string, string>> = Object.freeze({
  low: '#22c55e',
  medium: '#eab308',
  high: '#ef4444',
  none: '#22c55e',
});

const RISK_COLOR_DEFAULT = '#eab308'; // medium / yellow-500

/** Severity color mapping for UI. Trim + lowercase before lookup so legacy
 *  `'High '` / `'HIGH'` / `' high'` values still hit the right color. */
export function getSeverityColor(severity: string): string {
  const key = (severity || '').trim().toLowerCase();
  return SEVERITY_COLORS[key] || SEVERITY_COLOR_DEFAULT;
}

/** Risk level color mapping for UI. Trim + lowercase before lookup. */
export function getRiskColor(risk: string): string {
  const key = (risk || '').trim().toLowerCase();
  return RISK_COLORS[key] || RISK_COLOR_DEFAULT;
}
