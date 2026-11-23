/**
 * Enhanced Vision Analysis - Deep Image Analysis for Roofing
 * Provides comprehensive, detailed analysis of roof images
 */

import {
  analyzeRoofImage,
  analyzeMultipleImages,
  combineAnalysisResults,
  GROQ_VISION_MODELS,
  type RoofAnalysisResult,
  type DamageDetection,
  type AnalysisOptions,
} from './groq-vision.js';
import { DAMAGE_TYPES, ROOFING_MATERIALS } from './damage-knowledge-base.js';
import { groqChat } from './groq-chat.js';
import { ROOF_REPORT_MODELS } from './models.js';

// ─── Tuning constants ────────────────────────────────────────────────────
/** Cap multi-image analysis — keeps Groq token spend predictable. */
const MAX_ANALYZED_IMAGES = 10;
/** Use a slightly-deterministic temperature for structured JSON enrichment. */
const ENHANCEMENT_TEMPERATURE = 0.2;

/** Per-damage-point area estimate when AI doesn't return a measurement. */
const SQFT_PER_DAMAGE_POINT = 25;
/** Divisor that normalises 0–100 severity scores into a 0–2 area multiplier. */
const SEVERITY_AREA_DIVISOR = 50;

// ─── Repair-vs-replace thresholds (multi-image roll-up) ──────────────────
const FULL_REPLACEMENT_DAMAGE_PCT = 40;
const PARTIAL_REPLACEMENT_DAMAGE_PCT = 25;
const CRITICAL_DAMAGE_COUNT_FOR_FULL = 2;
const CRITICAL_DAMAGE_COUNT_FOR_PARTIAL = 1;

/** Components the inspector is expected to capture for "complete" coverage. */
const EXPECTED_ROOF_COMPONENTS = [
  'shingles', 'ridge', 'flashing', 'valleys',
  'vents', 'gutters', 'eaves', 'fascia',
] as const;

/** Image-quality → 0-100 clarity score for the analysis-quality block.
 *  Ladder hoisted out of the inline ternary so the four-level mapping
 *  can be tweaked without re-reading the JSX. */
const IMAGE_CLARITY_SCORES: Record<string, number> = {
  excellent: 95,
  good: 80,
  fair: 60,
  poor: 40,
};
const DEFAULT_IMAGE_CLARITY_SCORE = 40;

function imageClarityScore(quality: string): number {
  return IMAGE_CLARITY_SCORES[quality] ?? DEFAULT_IMAGE_CLARITY_SCORE;
}

/** Default values used when the AI's enhancement JSON is missing or
 *  malformed — kept here so the success and fallback shapes can't drift. */
const DEFAULT_AGE_ASSESSMENT_YEARS = 15;
const DEFAULT_REMAINING_LIFESPAN_YEARS = 10;
const DEFAULT_COVERAGE_COMPLETENESS = 70;

/** Claim-worthiness scores: 75 if the base vision result already
 *  recommended a claim, 25 otherwise. The 50-point gap signals
 *  "strong/weak" without being binary. */
const CLAIM_SCORE_RECOMMENDED = 75;
const CLAIM_SCORE_NOT_RECOMMENDED = 25;

/** Default lighting/angle assessment when the AI didn't supply one. */
const DEFAULT_LIGHTING_QUALITY: 'optimal' | 'acceptable' | 'challenging' | 'poor' = 'acceptable';
const DEFAULT_ANGLE_ASSESSMENT: 'ideal' | 'acceptable' | 'suboptimal' | 'poor' = 'acceptable';

/** Indent width for the JSON payload included in the enhancement prompt. */
const PROMPT_JSON_INDENT = 2;

// ─── Single-image repair-vs-replace thresholds (analyzeRepairVsReplace) ──
// Distinct from FULL_REPLACEMENT_DAMAGE_PCT / PARTIAL_REPLACEMENT_DAMAGE_PCT
// above (those govern multi-image roll-up; these govern per-image).
/** Per-image damage % above which the recommendation is `partial_replacement`. */
const SINGLE_IMG_PARTIAL_REPLACEMENT_DAMAGE_PCT = 20;
/** Severe-issue count at which `partial_replacement` is forced (single-image). */
const SINGLE_IMG_PARTIAL_REPLACEMENT_SEVERE_COUNT = 3;
/** Damage % above which spot-repair is no longer viable (single-image). */
const SINGLE_IMG_REPAIR_VIABLE_DAMAGE_PCT = 30;

// ─── Default scope sizes / confidences used by the fallback enhancement block. */
/** Default replacement size when caller doesn't supply `roofSquares`. */
const DEFAULT_SCOPE_SQUARES = 25;
/** Confidence value used when `damages_detected` is empty (no per-damage data). */
const NO_DAMAGES_CONFIDENCE = 80;

/** Repair-vs-replace recommendation type — recurring across multiple helpers. */
type RepairReplaceRecommendation = 'repair' | 'partial_replacement' | 'full_replacement';

// ─── Multi-image roll-up constants ───────────────────────────────────
/** Cap on the "most critical issues" list shown in the combined report. */
const MAX_CRITICAL_DAMAGES_DISPLAYED = 5;
/** Cap on the strongest-claim-factors list rendered in the insurance summary. */
const MAX_STRONGEST_CLAIM_FACTORS = 5;
/** Worst-first severity ordering for multi-image critical-damage sorting.
 *  Hoisted from the inline `Array.sort` comparator so the table isn't
 *  reallocated on every multi-image roll-up. */
const SEVERITY_SORT_ORDER_FULL: Record<string, number> = {
  critical: 0, severe: 1, moderate: 2, minor: 3,
};
/** Multiplier used to convert a 0..1 fraction into a 0..100 percentage. */
const PERCENT_MULTIPLIER = 100;

// ─── Final-recommendation action / urgency enums ─────────────────────
const ACTION_FULL_REPLACEMENT = 'full_replacement' as const;
const ACTION_PARTIAL_REPLACEMENT = 'partial_replacement' as const;
const ACTION_REPAIR = 'repair' as const;
const ACTION_MONITOR = 'monitor' as const;
const URGENCY_IMMEDIATE = 'immediate' as const;
const URGENCY_WITHIN_30_DAYS = 'within_30_days' as const;
const URGENCY_WITHIN_90_DAYS = 'within_90_days' as const;
const URGENCY_ANNUAL = 'annual_monitoring' as const;

// ─── Component-assessment messages (generateDefaultComponentAssessment) ─
const MSG_NO_SIGNIFICANT_DAMAGE = 'No significant damage';
const MSG_FLASHING_INTACT = 'Appears intact';
const MSG_FLASHING_ISSUES_DETECTED = 'Flashing issues detected';
/** Template prefix for missing-component documentation gaps. */
const MISSING_DOC_PREFIX = 'Missing ';
const MISSING_DOC_SUFFIX = ' documentation';

// ─── calculateOverallConfidence — image-quality → confidence map ─────
/** Distinct from the `IMAGE_CLARITY_SCORES` table above (used for the
 *  analysis-quality block) — the confidence map uses a slightly higher
 *  fair-quality value (65 vs 60) to weight overall confidence less
 *  pessimistically when the inspector got an OK photo of a complex roof. */
const IMAGE_QUALITY_CONFIDENCE_SCORES: Record<string, number> = {
  excellent: 95,
  good: 80,
  fair: 65,
  poor: 40,
};

// ─── Default-fallback enhancement constants ──────────────────────────
const DEFAULT_FALLBACK_CLARITY_SCORE = 70;
const DEFAULT_FALLBACK_COVERAGE = 60;

// ─── detectWeatherPatterns + getAnalysisRecommendations ─────────────
/** Damage-category enums used by the weather-pattern detector. */
const DAMAGE_CATEGORY_HAIL = 'hail';
const DAMAGE_CATEGORY_WIND = 'wind';
const DAMAGE_CATEGORY_WATER = 'water';
/** Placeholder direction returned when a hail/wind pattern is detected
 *  but the directional analysis hasn't been performed yet. */
const MSG_ANALYSIS_REQUIRED = 'Analysis required';
/** Location-description keywords that, when present, indicate ice-dam risk. */
const ICE_DAM_LOCATION_KEYWORDS: readonly string[] = ['eave', 'edge'];

/** Image-quality tier compared by `getAnalysisRecommendations`. */
const IMG_QUALITY_EXCELLENT = 'excellent';

/** Damage categories that count as "shingle damage" for component assessment. */
const SHINGLE_DAMAGE_CATEGORIES: readonly string[] = ['hail', 'wind', 'age_wear'];
/** Component condition tiers used in `generateDefaultComponentAssessment`. */
const COMPONENT_CONDITION_FAILED = 'failed';
const COMPONENT_CONDITION_POOR = 'poor';
const COMPONENT_CONDITION_FAIR = 'fair';
const COMPONENT_CONDITION_GOOD = 'good';
/** Severity values that escalate the shingle component condition. */
const SEVERITY_CRITICAL = 'critical';
const SEVERITY_SEVERE = 'severe';

/** Default age-assessment fields when full assessment isn't available. */
const DEFAULT_WEAR_PATTERN = 'uniform';
const DEFAULT_MAINTENANCE_INDICATOR = 'average';

/** Roof component name labels for the shingles row. */
const COMPONENT_NAME_SHINGLES = 'shingles';
/** Roof component name label for the flashing row. */
const COMPONENT_NAME_FLASHING = 'flashing';
/** Damage-category enum value for flashing-specific damages. */
const DAMAGE_CATEGORY_FLASHING = 'flashing';
/** Severity values that count as "minor" in the replacement-recommendation
 *  logic — anything that's NOT minor escalates the recommendation. */
const SEVERITY_MINOR = 'minor';
/** Issues-found notes template prefix for the shingle row. */
const MSG_ISSUES_FOUND_SUFFIX = ' issues found';
/** Severities that mark a shingle row as `replacement_recommended: true`. */
const SHINGLE_REPLACEMENT_TRIGGER_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'severe']);

// ─── analyzeRepairVsReplace reasoning templates + recommendations ────
/** Repair-vs-replace recommendation enum values. */
const REPAIR_RECOMMENDATION_FULL = 'full_replacement' as const;
const REPAIR_RECOMMENDATION_PARTIAL = 'partial_replacement' as const;
const REPAIR_RECOMMENDATION_REPAIR = 'repair' as const;

/** Single-image repair/replace reasoning template fragments. */
const REASONING_FULL_PREFIX = 'With ';
const REASONING_FULL_INFIX = '% damage severity and ';
const REASONING_FULL_SUFFIX = ' critical issues, full replacement is most cost-effective.';
const REASONING_PARTIAL_PREFIX = 'Significant damage (';
const REASONING_PARTIAL_SUFFIX = '%) warrants section replacement rather than spot repairs.';
const REASONING_REPAIR_PREFIX = 'Damage level (';
const REASONING_REPAIR_SUFFIX = '%) is within repairable range. Targeted repairs recommended.';
/** Photo-recommendation strings for the in-app analysis-quality block. */
const REC_HIGHER_RESOLUTION = 'Higher resolution images would improve analysis accuracy';
const REC_INCLUDE_CLOSE_UP = 'Include close-up photos of each damage area';
const REC_MULTIPLE_ANGLES = 'Photos from multiple angles recommended';
const REC_REFERENCE_OBJECTS = 'Include reference objects for scale when possible';

// ─── getRecommendedPhotos location-keyword + baseline constants ──────
const LOCATION_KEYWORD_RIDGE = 'ridge';
const LOCATION_KEYWORD_VALLEY = 'valley';
/** Always-included photo recommendations regardless of damage location. */
const RECOMMENDED_PHOTOS_BASELINE: readonly string[] = [
  'Overall roof view from ground level',
  'Close-ups of each damaged area with ruler for scale',
  'Photos of gutters and downspouts',
];
/** Conditional photo recommendations triggered by missing location keywords. */
const REC_PHOTO_RIDGE = 'Close-up of ridge line';
const REC_PHOTO_VALLEY = 'Valley intersection photos';

// ─── generateInsuranceNextSteps constants ────────────────────────────
const MSG_INSURANCE_NO_CLAIM_WORTHY = 'Damage appears to be wear-related, not covered by most policies';
const INSURANCE_NEXT_STEPS_BASELINE: readonly string[] = [
  'Document all damage with dated photographs',
  'Contact your insurance company to file a claim',
  'Request a professional inspection from a licensed adjuster',
  'Obtain repair/replacement estimates from licensed contractors',
  'Keep all documentation for your records',
];

// ─── generateRecommendationReasoning templates ───────────────────────
/** Reasoning for the `full_replacement` recommendation — interpolates
 *  rounded `damagePercentage` and `criticalCount`. */
const REASONING_FULL_REPLACEMENT = (pct: number, criticalCount: number): string =>
  `With ${pct}% damage severity and ${criticalCount} critical issues, the roof system is compromised beyond economical repair. Full replacement ensures complete protection.`;
/** Reasoning for the `partial_replacement` recommendation. */
const REASONING_PARTIAL_REPLACEMENT = 'Damage is concentrated in specific areas. Section replacement addresses the problems while preserving intact areas.';
/** Reasoning for the `repair` recommendation. */
const REASONING_REPAIR = 'Damage is localized and repairable. Targeted repairs will restore full protection at lower cost than replacement.';
/** Reasoning for the `monitor` (default) recommendation. */
const REASONING_MONITOR = 'Roof is in acceptable condition. Regular monitoring and maintenance recommended.';

// ─── generateScopeDescription templates ──────────────────────────────
/** Scope text for full replacement — interpolates `size` (in squares). */
const SCOPE_FULL_REPLACEMENT = (size: number): string =>
  `Complete tear-off and replacement of approximately ${size} squares of roofing material, including underlayment, flashings, and ventilation.`;
/** Scope text for partial replacement. */
const SCOPE_PARTIAL_REPLACEMENT = 'Replacement of damaged sections (estimated 30-50% of roof area), with tie-in to existing undamaged areas.';
/** Scope text for spot repairs. */
const SCOPE_REPAIR = 'Targeted repairs to damaged shingles, sealant application, and flashing corrections as needed.';
/** Scope text for the monitor (default) action. */
const SCOPE_MONITOR = 'Annual inspection and preventive maintenance.';

export interface DetailedImageAnalysis {
  // Basic analysis from vision model
  vision_analysis: RoofAnalysisResult;

  // Enhanced details
  detailed_measurements: {
    estimated_affected_area_sqft: number;
    estimated_damage_percentage: number;
    number_of_damage_points: number;
  };

  // Component-level analysis
  component_assessment: ComponentAssessment[];

  // Age and wear analysis
  age_assessment: {
    estimated_roof_age_years: number;
    remaining_lifespan_years: number;
    wear_pattern: 'uniform' | 'localized' | 'edge_heavy' | 'valley_heavy';
    maintenance_history_indicator: 'well_maintained' | 'average' | 'neglected';
  };

  // Weather damage patterns
  weather_patterns: {
    hail_pattern_detected: boolean;
    hail_direction?: string;
    wind_pattern_detected: boolean;
    wind_direction?: string;
    water_intrusion_signs: boolean;
    ice_dam_indicators: boolean;
  };

  // Insurance documentation
  insurance_documentation: {
    claim_worthiness_score: number; // 0-100
    documentation_quality: 'excellent' | 'good' | 'fair' | 'poor';
    recommended_additional_photos: string[];
    haag_compliance_notes: string[];
    claim_support_factors: string[];
  };

  // Repair vs Replace analysis
  repair_replace_analysis: {
    repair_viable: boolean;
    repair_percentage_threshold: number; // If damage > this %, replace recommended
    current_damage_percentage: number;
    recommendation: 'repair' | 'partial_replacement' | 'full_replacement';
    reasoning: string;
  };

  // AI confidence and quality
  analysis_quality: {
    overall_confidence: number;
    image_clarity_score: number;
    coverage_completeness: number;
    lighting_quality: 'optimal' | 'acceptable' | 'challenging' | 'poor';
    angle_assessment: 'ideal' | 'acceptable' | 'suboptimal' | 'poor';
    recommendations_for_better_analysis: string[];
  };
}

export interface ComponentAssessment {
  component: string;
  condition: 'excellent' | 'good' | 'fair' | 'poor' | 'failed';
  damage_present: boolean;
  damage_types: string[];
  notes: string;
  replacement_recommended: boolean;
}

/**
 * Perform deep, comprehensive image analysis
 */
export async function deepImageAnalysis(
  imageUrl: string,
  apiKey: string,
  context?: {
    known_roof_age?: number;
    known_material?: string;
    recent_weather_events?: string[];
    previous_repairs?: string[];
  }
): Promise<DetailedImageAnalysis> {
  // First, get the base vision analysis
  const visionAnalysis = await analyzeRoofImage(imageUrl, apiKey, {
    model: GROQ_VISION_MODELS.LLAMA4_MAVERICK, // Use the best model
    include_haag_assessment: true,
    max_tokens: 4096,
  });

  // Then, enhance with detailed analysis
  const enhancedAnalysis = await enhanceAnalysisWithDetails(
    visionAnalysis,
    imageUrl,
    apiKey,
    context
  );

  return enhancedAnalysis;
}

/**
 * Enhance base analysis with detailed insights
 */
async function enhanceAnalysisWithDetails(
  baseAnalysis: RoofAnalysisResult,
  imageUrl: string,
  apiKey: string,
  context?: {
    known_roof_age?: number;
    known_material?: string;
    recent_weather_events?: string[];
    previous_repairs?: string[];
  }
): Promise<DetailedImageAnalysis> {
  const systemPrompt = `You are an expert roofing analyst providing detailed assessment.
Based on the initial analysis provided, generate comprehensive enhancement data.

Return JSON with these exact fields:
{
  "detailed_measurements": {
    "estimated_affected_area_sqft": number,
    "estimated_damage_percentage": number (0-100),
    "number_of_damage_points": number
  },
  "component_assessment": [
    {
      "component": "string (shingles, flashing, ridge, valleys, vents, gutters, etc.)",
      "condition": "excellent|good|fair|poor|failed",
      "damage_present": boolean,
      "damage_types": ["array of damage types"],
      "notes": "specific observations",
      "replacement_recommended": boolean
    }
  ],
  "age_assessment": {
    "estimated_roof_age_years": number,
    "remaining_lifespan_years": number,
    "wear_pattern": "uniform|localized|edge_heavy|valley_heavy",
    "maintenance_history_indicator": "well_maintained|average|neglected"
  },
  "weather_patterns": {
    "hail_pattern_detected": boolean,
    "hail_direction": "string or null",
    "wind_pattern_detected": boolean,
    "wind_direction": "string or null",
    "water_intrusion_signs": boolean,
    "ice_dam_indicators": boolean
  },
  "insurance_documentation": {
    "claim_worthiness_score": number (0-100),
    "documentation_quality": "excellent|good|fair|poor",
    "recommended_additional_photos": ["array of recommended shots"],
    "haag_compliance_notes": ["array of notes"],
    "claim_support_factors": ["factors supporting claim"]
  },
  "repair_replace_analysis": {
    "repair_viable": boolean,
    "repair_percentage_threshold": number,
    "current_damage_percentage": number,
    "recommendation": "repair|partial_replacement|full_replacement",
    "reasoning": "detailed explanation"
  },
  "analysis_quality": {
    "overall_confidence": number (0-100),
    "image_clarity_score": number (0-100),
    "coverage_completeness": number (0-100),
    "lighting_quality": "optimal|acceptable|challenging|poor",
    "angle_assessment": "ideal|acceptable|suboptimal|poor",
    "recommendations_for_better_analysis": ["array of suggestions"]
  }
}`;

  const userPrompt = `Initial Analysis Results:
${JSON.stringify(baseAnalysis, null, PROMPT_JSON_INDENT)}

${context ? `Additional Context:
- Known roof age: ${context.known_roof_age || 'Unknown'}
- Known material: ${context.known_material || 'Unknown'}
- Recent weather: ${context.recent_weather_events?.join(', ') || 'Unknown'}
- Previous repairs: ${context.previous_repairs?.join(', ') || 'None known'}` : ''}

Please provide detailed enhancement analysis.`;

  const result = await groqChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    apiKey,
    { model: ROOF_REPORT_MODELS.enhancement.id, json_mode: true, temperature: ENHANCEMENT_TEMPERATURE }
  );

  // Loose Partial type — Claude/Llama returns one of the field shapes
  // declared in DetailedImageAnalysis but may omit any of them.
  let enhanced: Partial<DetailedImageAnalysis> = {};
  try {
    enhanced = JSON.parse(result.content);
  } catch (parseErr) {
    // Surface the parse failure so we can iterate on the prompt — was silent.
    console.warn('[enhanced-vision] Enhancement JSON parse failed; using defaults:', (parseErr as Error).message);
    enhanced = getDefaultEnhancedAnalysis(baseAnalysis);
  }

  return {
    vision_analysis: baseAnalysis,
    detailed_measurements: enhanced.detailed_measurements || {
      estimated_affected_area_sqft: estimateAffectedArea(baseAnalysis),
      estimated_damage_percentage: baseAnalysis.overall_severity_score,
      number_of_damage_points: baseAnalysis.damages_detected.length,
    },
    component_assessment: enhanced.component_assessment || generateDefaultComponentAssessment(baseAnalysis),
    age_assessment: enhanced.age_assessment || {
      estimated_roof_age_years: DEFAULT_AGE_ASSESSMENT_YEARS,
      remaining_lifespan_years: DEFAULT_REMAINING_LIFESPAN_YEARS,
      wear_pattern: 'uniform',
      maintenance_history_indicator: 'average',
    },
    weather_patterns: enhanced.weather_patterns || detectWeatherPatterns(baseAnalysis),
    insurance_documentation: enhanced.insurance_documentation || {
      claim_worthiness_score: baseAnalysis.insurance_claim_recommended ? CLAIM_SCORE_RECOMMENDED : CLAIM_SCORE_NOT_RECOMMENDED,
      documentation_quality: baseAnalysis.image_quality,
      recommended_additional_photos: getRecommendedPhotos(baseAnalysis),
      haag_compliance_notes: [],
      claim_support_factors: baseAnalysis.damages_detected
        .filter(d => d.insurance_claim_worthy)
        .map(d => d.damage_name),
    },
    repair_replace_analysis: enhanced.repair_replace_analysis || analyzeRepairVsReplace(baseAnalysis),
    analysis_quality: enhanced.analysis_quality || {
      overall_confidence: calculateOverallConfidence(baseAnalysis),
      image_clarity_score: imageClarityScore(baseAnalysis.image_quality),
      coverage_completeness: DEFAULT_COVERAGE_COMPLETENESS,
      lighting_quality: DEFAULT_LIGHTING_QUALITY,
      angle_assessment: DEFAULT_ANGLE_ASSESSMENT,
      recommendations_for_better_analysis: getAnalysisRecommendations(baseAnalysis),
    },
  };
}

/**
 * Analyze multiple images and create comprehensive report
 */
export async function comprehensiveMultiImageAnalysis(
  imageUrls: string[],
  apiKey: string,
  context?: {
    property_address?: string;
    known_roof_age?: number;
    known_material?: string;
    known_size_squares?: number;
  }
): Promise<{
  individual_analyses: DetailedImageAnalysis[];
  combined_report: {
    overall_condition: string;
    total_damages_found: number;
    unique_damage_types: string[];
    most_critical_issues: DamageDetection[];
    coverage_assessment: {
      areas_documented: string[];
      areas_missing: string[];
      documentation_completeness: number;
    };
    final_recommendation: {
      action: 'repair' | 'partial_replacement' | 'full_replacement' | 'monitor';
      urgency: 'immediate' | 'within_30_days' | 'within_90_days' | 'annual_monitoring';
      reasoning: string;
      estimated_scope: string;
    };
    insurance_summary: {
      total_claim_worthy_damages: number;
      strongest_claim_factors: string[];
      documentation_gaps: string[];
      recommended_next_steps: string[];
    };
  };
}> {
  // Analyze each image in detail
  const individualAnalyses: DetailedImageAnalysis[] = [];

  for (const url of imageUrls.slice(0, MAX_ANALYZED_IMAGES)) {
    const analysis = await deepImageAnalysis(url, apiKey, context);
    individualAnalyses.push(analysis);
  }

  return {
    individual_analyses: individualAnalyses,
    combined_report: buildCombinedReport(individualAnalyses, {
      known_size_squares: context?.known_size_squares,
    }),
  };
}

/** Shape returned by {@link buildCombinedReport} — the multi-image roll-up. */
export interface CombinedRoofReport {
  overall_condition: string;
  total_damages_found: number;
  unique_damage_types: string[];
  most_critical_issues: DamageDetection[];
  coverage_assessment: {
    areas_documented: string[];
    areas_missing: string[];
    documentation_completeness: number;
  };
  final_recommendation: {
    action: 'repair' | 'partial_replacement' | 'full_replacement' | 'monitor';
    urgency: 'immediate' | 'within_30_days' | 'within_90_days' | 'annual_monitoring';
    reasoning: string;
    estimated_scope: string;
  };
  insurance_summary: {
    total_claim_worthy_damages: number;
    strongest_claim_factors: string[];
    documentation_gaps: string[];
    recommended_next_steps: string[];
  };
}

/** Coerce any value to a finite number, falling back to `fallback`.
 *  Guards against NaN / ±Infinity / non-numeric input flowing into averages
 *  and `Math.round`, which would otherwise emit `NaN`/`Infinity` in the
 *  rendered report. */
function toFinite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * PURE merge/normalize: roll an array of per-image DetailedImageAnalysis
 * objects up into the combined-report shape (averaged damage %, coverage
 * completeness, critical-issue list, claim factors, final recommendation).
 *
 * Hardened against malformed input: null/undefined sub-results are skipped,
 * missing nested arrays/objects are treated as empty, and all numeric
 * outputs are coerced to finite values (never NaN/Infinity, never throws).
 * For well-formed input the output is byte-for-byte identical to the prior
 * inline implementation.
 */
export function buildCombinedReport(
  individualAnalyses: DetailedImageAnalysis[],
  options?: { known_size_squares?: number }
): CombinedRoofReport {
  // Skip null/undefined/non-object sub-results up front so every downstream
  // access is safe without per-field optional chaining.
  const analyses = (Array.isArray(individualAnalyses) ? individualAnalyses : [])
    .filter((a): a is DetailedImageAnalysis => !!a && typeof a === 'object');

  // Combine vision analyses (combineAnalysisResults is pure). Normalize each
  // vision result so `damages_detected` is always an array — combineAnalysisResults
  // iterates it directly and would throw on a missing/non-array field.
  const visionResults = analyses
    .map(a => a.vision_analysis)
    .filter((v): v is RoofAnalysisResult => !!v && typeof v === 'object')
    .map(v => (Array.isArray(v.damages_detected) ? v : { ...v, damages_detected: [] }));
  const combinedVision = combineAnalysisResults(visionResults);

  // Generate comprehensive report
  const allDamages = visionResults.flatMap(v => v.damages_detected);
  const uniqueDamageTypes = [...new Set(allDamages.map(d => d.damage_name))];
  const criticalDamages = allDamages
    .filter(d => d.severity === 'critical' || d.severity === 'severe')
    .sort((a, b) => SEVERITY_SORT_ORDER_FULL[a.severity] - SEVERITY_SORT_ORDER_FULL[b.severity])
    .slice(0, MAX_CRITICAL_DAMAGES_DISPLAYED);

  // Assess coverage
  const documentedComponents = new Set<string>();
  for (const analysis of analyses) {
    const components = Array.isArray(analysis.component_assessment)
      ? analysis.component_assessment
      : [];
    for (const component of components) {
      if (component && typeof component.component === 'string') {
        documentedComponents.add(component.component);
      }
    }
  }

  const missingComponents = EXPECTED_ROOF_COMPONENTS.filter(c => !documentedComponents.has(c));

  // Determine final recommendation. Coerce each per-image damage % to a
  // finite number, and guard the divide-by-zero when there are no analyses.
  const damageTotal = analyses.reduce(
    (sum, a) => sum + toFinite(a.detailed_measurements?.estimated_damage_percentage),
    0
  );
  const avgDamagePercentage = analyses.length > 0 ? damageTotal / analyses.length : 0;

  let finalAction: 'repair' | 'partial_replacement' | 'full_replacement' | 'monitor';
  let urgency: 'immediate' | 'within_30_days' | 'within_90_days' | 'annual_monitoring';

  if (criticalDamages.length >= CRITICAL_DAMAGE_COUNT_FOR_FULL || avgDamagePercentage > FULL_REPLACEMENT_DAMAGE_PCT) {
    finalAction = ACTION_FULL_REPLACEMENT;
    urgency = URGENCY_IMMEDIATE;
  } else if (criticalDamages.length >= CRITICAL_DAMAGE_COUNT_FOR_PARTIAL || avgDamagePercentage > PARTIAL_REPLACEMENT_DAMAGE_PCT) {
    finalAction = ACTION_PARTIAL_REPLACEMENT;
    urgency = URGENCY_WITHIN_30_DAYS;
  } else if (allDamages.length > 0) {
    finalAction = ACTION_REPAIR;
    urgency = URGENCY_WITHIN_90_DAYS;
  } else {
    finalAction = ACTION_MONITOR;
    urgency = URGENCY_ANNUAL;
  }

  return {
    overall_condition: combinedVision.overall_condition,
    total_damages_found: allDamages.length,
    unique_damage_types: uniqueDamageTypes,
    most_critical_issues: criticalDamages,
    coverage_assessment: {
      areas_documented: Array.from(documentedComponents),
      areas_missing: [...missingComponents],
      documentation_completeness: Math.round((documentedComponents.size / EXPECTED_ROOF_COMPONENTS.length) * PERCENT_MULTIPLIER),
    },
    final_recommendation: {
      action: finalAction,
      urgency,
      reasoning: generateRecommendationReasoning(finalAction, avgDamagePercentage, criticalDamages.length),
      estimated_scope: generateScopeDescription(finalAction, options?.known_size_squares),
    },
    insurance_summary: {
      total_claim_worthy_damages: allDamages.filter(d => d.insurance_claim_worthy).length,
      strongest_claim_factors: allDamages
        .filter(d => d.insurance_claim_worthy)
        .slice(0, MAX_STRONGEST_CLAIM_FACTORS)
        .map(d => `${d.damage_name} - ${d.severity}`),
      documentation_gaps: missingComponents.map(c => `${MISSING_DOC_PREFIX}${c}${MISSING_DOC_SUFFIX}`),
      recommended_next_steps: generateInsuranceNextSteps(allDamages),
    },
  };
}

// Helper functions

function estimateAffectedArea(analysis: RoofAnalysisResult): number {
  // Estimate based on number and severity of damages
  const baseArea = analysis.damages_detected.length * SQFT_PER_DAMAGE_POINT;
  const severityMultiplier = analysis.overall_severity_score / SEVERITY_AREA_DIVISOR;
  return Math.round(baseArea * severityMultiplier);
}

function generateDefaultComponentAssessment(analysis: RoofAnalysisResult): ComponentAssessment[] {
  const components: ComponentAssessment[] = [];

  // Assess shingles
  const shingleDamages = analysis.damages_detected.filter(d =>
    SHINGLE_DAMAGE_CATEGORIES.includes(d.category)
  );
  components.push({
    component: COMPONENT_NAME_SHINGLES,
    condition: shingleDamages.some(d => d.severity === SEVERITY_CRITICAL) ? COMPONENT_CONDITION_FAILED :
      shingleDamages.some(d => d.severity === SEVERITY_SEVERE) ? COMPONENT_CONDITION_POOR :
        shingleDamages.length > 0 ? COMPONENT_CONDITION_FAIR : COMPONENT_CONDITION_GOOD,
    damage_present: shingleDamages.length > 0,
    damage_types: shingleDamages.map(d => d.damage_name),
    notes: shingleDamages.length > 0 ? `${shingleDamages.length}${MSG_ISSUES_FOUND_SUFFIX}` : MSG_NO_SIGNIFICANT_DAMAGE,
    replacement_recommended: shingleDamages.some(d => SHINGLE_REPLACEMENT_TRIGGER_SEVERITIES.has(d.severity)),
  });

  // Assess flashing
  const flashingDamages = analysis.damages_detected.filter(d => d.category === DAMAGE_CATEGORY_FLASHING);
  components.push({
    component: COMPONENT_NAME_FLASHING,
    condition: flashingDamages.length > 0 ? COMPONENT_CONDITION_FAIR : COMPONENT_CONDITION_GOOD,
    damage_present: flashingDamages.length > 0,
    damage_types: flashingDamages.map(d => d.damage_name),
    notes: flashingDamages.length > 0 ? MSG_FLASHING_ISSUES_DETECTED : MSG_FLASHING_INTACT,
    replacement_recommended: flashingDamages.some(d => d.severity !== SEVERITY_MINOR),
  });

  return components;
}

function detectWeatherPatterns(analysis: RoofAnalysisResult): DetailedImageAnalysis['weather_patterns'] {
  const hailDamages = analysis.damages_detected.filter(d => d.category === DAMAGE_CATEGORY_HAIL);
  const windDamages = analysis.damages_detected.filter(d => d.category === DAMAGE_CATEGORY_WIND);
  const waterDamages = analysis.damages_detected.filter(d => d.category === DAMAGE_CATEGORY_WATER);

  return {
    hail_pattern_detected: hailDamages.length > 0,
    hail_direction: hailDamages.length > 0 ? MSG_ANALYSIS_REQUIRED : undefined,
    wind_pattern_detected: windDamages.length > 0,
    wind_direction: windDamages.length > 0 ? MSG_ANALYSIS_REQUIRED : undefined,
    water_intrusion_signs: waterDamages.length > 0,
    ice_dam_indicators: waterDamages.some(d => {
      const loc = d.location_description.toLowerCase();
      return ICE_DAM_LOCATION_KEYWORDS.some(k => loc.includes(k));
    }),
  };
}

function analyzeRepairVsReplace(analysis: RoofAnalysisResult): DetailedImageAnalysis['repair_replace_analysis'] {
  const damagePercentage = analysis.overall_severity_score;
  const criticalCount = analysis.damages_detected.filter(d => d.severity === SEVERITY_CRITICAL).length;
  const severeCount = analysis.damages_detected.filter(d => d.severity === SEVERITY_SEVERE).length;

  let recommendation: RepairReplaceRecommendation;
  let reasoning: string;

  if (damagePercentage > FULL_REPLACEMENT_DAMAGE_PCT || criticalCount >= CRITICAL_DAMAGE_COUNT_FOR_FULL) {
    recommendation = REPAIR_RECOMMENDATION_FULL;
    reasoning = `${REASONING_FULL_PREFIX}${damagePercentage}${REASONING_FULL_INFIX}${criticalCount}${REASONING_FULL_SUFFIX}`;
  } else if (damagePercentage > SINGLE_IMG_PARTIAL_REPLACEMENT_DAMAGE_PCT || criticalCount >= CRITICAL_DAMAGE_COUNT_FOR_PARTIAL || severeCount >= SINGLE_IMG_PARTIAL_REPLACEMENT_SEVERE_COUNT) {
    recommendation = REPAIR_RECOMMENDATION_PARTIAL;
    reasoning = `${REASONING_PARTIAL_PREFIX}${damagePercentage}${REASONING_PARTIAL_SUFFIX}`;
  } else {
    recommendation = REPAIR_RECOMMENDATION_REPAIR;
    reasoning = `${REASONING_REPAIR_PREFIX}${damagePercentage}${REASONING_REPAIR_SUFFIX}`;
  }

  return {
    repair_viable: damagePercentage < SINGLE_IMG_REPAIR_VIABLE_DAMAGE_PCT && criticalCount === 0,
    repair_percentage_threshold: SINGLE_IMG_REPAIR_VIABLE_DAMAGE_PCT,
    current_damage_percentage: damagePercentage,
    recommendation,
    reasoning,
  };
}

function calculateOverallConfidence(analysis: RoofAnalysisResult): number {
  const imageQualityScore = IMAGE_QUALITY_CONFIDENCE_SCORES[analysis.image_quality]
    ?? IMAGE_QUALITY_CONFIDENCE_SCORES.poor;

  const avgDamageConfidence = analysis.damages_detected.length > 0
    ? analysis.damages_detected.reduce((sum, d) => sum + d.confidence, 0) / analysis.damages_detected.length
    : NO_DAMAGES_CONFIDENCE;

  return Math.round((imageQualityScore + avgDamageConfidence) / 2);
}

function getRecommendedPhotos(analysis: RoofAnalysisResult): string[] {
  const recommendations: string[] = [];

  if (!analysis.damages_detected.some(d => d.location_description.includes(LOCATION_KEYWORD_RIDGE))) {
    recommendations.push(REC_PHOTO_RIDGE);
  }
  if (!analysis.damages_detected.some(d => d.location_description.includes(LOCATION_KEYWORD_VALLEY))) {
    recommendations.push(REC_PHOTO_VALLEY);
  }
  recommendations.push(...RECOMMENDED_PHOTOS_BASELINE);

  return recommendations;
}

function getAnalysisRecommendations(analysis: RoofAnalysisResult): string[] {
  const recommendations: string[] = [];

  if (analysis.image_quality !== IMG_QUALITY_EXCELLENT) {
    recommendations.push(REC_HIGHER_RESOLUTION);
  }
  if (analysis.damages_detected.length > 0) {
    recommendations.push(REC_INCLUDE_CLOSE_UP);
  }
  recommendations.push(REC_MULTIPLE_ANGLES);
  recommendations.push(REC_REFERENCE_OBJECTS);

  return recommendations;
}

function getDefaultEnhancedAnalysis(baseAnalysis: RoofAnalysisResult): any {
  return {
    detailed_measurements: {
      estimated_affected_area_sqft: estimateAffectedArea(baseAnalysis),
      estimated_damage_percentage: baseAnalysis.overall_severity_score,
      number_of_damage_points: baseAnalysis.damages_detected.length,
    },
    component_assessment: generateDefaultComponentAssessment(baseAnalysis),
    age_assessment: {
      estimated_roof_age_years: DEFAULT_AGE_ASSESSMENT_YEARS,
      remaining_lifespan_years: DEFAULT_REMAINING_LIFESPAN_YEARS,
      wear_pattern: DEFAULT_WEAR_PATTERN,
      maintenance_history_indicator: DEFAULT_MAINTENANCE_INDICATOR,
    },
    weather_patterns: detectWeatherPatterns(baseAnalysis),
    insurance_documentation: {
      claim_worthiness_score: baseAnalysis.insurance_claim_recommended ? CLAIM_SCORE_RECOMMENDED : CLAIM_SCORE_NOT_RECOMMENDED,
      documentation_quality: baseAnalysis.image_quality,
      recommended_additional_photos: getRecommendedPhotos(baseAnalysis),
      haag_compliance_notes: [],
      claim_support_factors: [],
    },
    repair_replace_analysis: analyzeRepairVsReplace(baseAnalysis),
    analysis_quality: {
      overall_confidence: calculateOverallConfidence(baseAnalysis),
      image_clarity_score: DEFAULT_FALLBACK_CLARITY_SCORE,
      coverage_completeness: DEFAULT_FALLBACK_COVERAGE,
      lighting_quality: DEFAULT_LIGHTING_QUALITY,
      angle_assessment: DEFAULT_ANGLE_ASSESSMENT,
      recommendations_for_better_analysis: getAnalysisRecommendations(baseAnalysis),
    },
  };
}

function generateRecommendationReasoning(
  action: string,
  damagePercentage: number,
  criticalCount: number
): string {
  switch (action) {
    case ACTION_FULL_REPLACEMENT:
      return REASONING_FULL_REPLACEMENT(Math.round(damagePercentage), criticalCount);
    case ACTION_PARTIAL_REPLACEMENT:
      return REASONING_PARTIAL_REPLACEMENT;
    case ACTION_REPAIR:
      return REASONING_REPAIR;
    default:
      return REASONING_MONITOR;
  }
}

function generateScopeDescription(action: string, squares?: number): string {
  const size = squares || DEFAULT_SCOPE_SQUARES;
  switch (action) {
    case ACTION_FULL_REPLACEMENT:
      return SCOPE_FULL_REPLACEMENT(size);
    case ACTION_PARTIAL_REPLACEMENT:
      return SCOPE_PARTIAL_REPLACEMENT;
    case ACTION_REPAIR:
      return SCOPE_REPAIR;
    default:
      return SCOPE_MONITOR;
  }
}

function generateInsuranceNextSteps(damages: DamageDetection[]): string[] {
  const claimWorthy = damages.filter(d => d.insurance_claim_worthy);

  if (claimWorthy.length === 0) {
    return [MSG_INSURANCE_NO_CLAIM_WORTHY];
  }

  return [...INSURANCE_NEXT_STEPS_BASELINE];
}
