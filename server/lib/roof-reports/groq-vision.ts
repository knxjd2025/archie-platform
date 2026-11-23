/**
 * Groq Vision API Integration for Roofing Damage Analysis
 * Uses the Llama 4 vision models on Groq for fast image analysis
 */

import {
  DAMAGE_TYPES,
  ROOFING_MATERIALS,
  type DamageType,
  type DamageCategory,
} from './damage-knowledge-base.js';
import { isSafeFetchUrl } from './url-safety.js';
import { safeFetch } from './safe-fetch.js';
import { ROOF_REPORT_MODELS, VISION_PROVIDER_LABELS } from './models.js';

// Groq API configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─── Vision-call defaults shared by all three providers ────────────────
const DEFAULT_MAX_TOKENS = 4096;
/** Low temperature → consistent JSON output across runs. */
const DEFAULT_VISION_TEMPERATURE = 0.1;
/** Fallback when the upstream image host doesn't send a Content-Type header. */
const DEFAULT_IMAGE_MIME = 'image/jpeg';
/** Header Google's REST API reads the key from. */
const GOOGLE_KEY_HEADER = 'x-goog-api-key';

// ─── Provider model defaults (single source of truth for fallback chain) ─
const GEMINI_VISION_MODEL: string = ROOF_REPORT_MODELS.visionFallback.id;
const HAIKU_VISION_MODEL: string = ROOF_REPORT_MODELS.visionLastResort.id;

/** Regex used by Gemini + Haiku paths to split a `data:` URL into mime + base64. */
const DATA_URL_PARSE_RE = /^data:([^;]+);base64,(.+)$/;

/** Standard error thrown when a `data:` URL fails to parse. */
const INVALID_DATA_URL_ERR = 'Invalid base64 data URL format';

/** Common JSON-output response-format object passed to Groq vision. */
const JSON_OBJECT_RESPONSE_FORMAT = { type: 'json_object' as const };

/** `Bearer <token>` prefix for the `Authorization` header. */
const BEARER_PREFIX = 'Bearer ';

/** Content-Type header for JSON request bodies. */
const CONTENT_TYPE_JSON = 'application/json';

/** Default user-message prompt used by `reanalyzeWithHints` calls. */
const REANALYZE_USER_PROMPT = 'Re-analyze this roof image with the inspector hints provided. Look extra carefully for the reported damage types.';

/** Reduced max-tokens budget for `correlateMultiImageFindings` +
 *  `quickDamageCheck` — both produce short JSON outputs (correlation
 *  narrative + cross-photo patterns; or quick severity bucket). */
const QUICK_MAX_TOKENS = 1024;
/** Slightly more deterministic temperature for the cross-image correlation pass. */
const CORRELATE_TEMPERATURE = 0.2;
/** Damage-count threshold above which `quickDamageCheck` recommends the
 *  full deep analysis. 3+ damages signals "this needs the real model". */
const QUICK_CHECK_DETAILED_THRESHOLD = 3;

/** Default user-message prompt used by every Groq-vision call. */
const DEFAULT_USER_PROMPT = 'Please analyze this roof image for damage. Provide a comprehensive assessment following the JSON format specified.';

/** Additional analysis instructions appended to Gemini + Haiku system prompts. */
const ADDITIONAL_VISION_INSTRUCTIONS = `## Additional Instructions for This Analysis:
- Include HAAG condition ratings (Good/Fair/Poor) for each damage item as "haag_condition"
- Provide an "estimated_age" field with years, confidence, and indicators
- Be thorough — report ALL potential damage, even with lower confidence

Return ONLY valid JSON matching the format above.`;

/** Parse a `data:<mime>;base64,<payload>` URL — returns `null` for malformed input. */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const matches = dataUrl.match(DATA_URL_PARSE_RE);
  if (!matches) return null;
  return { mimeType: matches[1], data: matches[2] };
}

/** Read `error.message` safely from an unknown reject value. */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build a uniform `RoofAnalysisResult` for any provider failure path.
 * Centralizes the shape so adding a new field doesn't require updating
 * three near-identical catch blocks (Groq / Gemini / Haiku).
 */
function failedAnalysisResult(
  provider: string,
  model: string,
  processingTime: number,
  errorMessage: string,
): RoofAnalysisResult {
  return {
    success: false,
    image_quality: 'poor',
    roof_material: null,
    damages_detected: [],
    overall_condition: 'poor',
    overall_severity_score: 0,
    insurance_claim_recommended: false,
    summary: `${provider} analysis failed: ${errorMessage}`,
    detailed_findings: '',
    recommendations: [`Unable to analyze with ${provider}. Please try again.`],
    raw_analysis: errorMessage,
    model_used: model,
    processing_time_ms: processingTime,
  };
}

// Available vision models on Groq (updated 2025)
// Only the two Llama 4 vision models are used; the older ones are retired.
export const GROQ_VISION_MODELS = {
  // Llama 4 Scout - 17B active params, 16 experts, ~460 tokens/s
  LLAMA4_SCOUT: ROOF_REPORT_MODELS.vision.id,
  // Llama 4 Maverick - 17B active params, 128 experts, highest quality
  LLAMA4_MAVERICK: ROOF_REPORT_MODELS.visionAlternative.id,
} as const;

export type GroqVisionModel = typeof GROQ_VISION_MODELS[keyof typeof GROQ_VISION_MODELS];

export interface DamageDetection {
  damage_type_id: string;
  damage_name: string;
  category: DamageCategory;
  confidence: number; // 0-100
  severity: 'minor' | 'moderate' | 'severe' | 'critical';
  location_description: string;
  visual_evidence: string[];
  haag_compliant: boolean;
  insurance_claim_worthy: boolean;
  repair_recommendation: string;
  estimated_urgency: 'immediate' | 'soon' | 'monitor' | 'cosmetic';
}

export interface RoofAnalysisResult {
  success: boolean;
  image_quality: 'excellent' | 'good' | 'fair' | 'poor';
  roof_material: {
    type: string;
    confidence: number;
    characteristics: string[];
  } | null;
  damages_detected: DamageDetection[];
  overall_condition: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  overall_severity_score: number; // 0-100
  insurance_claim_recommended: boolean;
  summary: string;
  detailed_findings: string;
  recommendations: string[];
  photo_quality_tips?: string[];
  raw_analysis?: string;
  model_used: string;
  processing_time_ms: number;
}

export interface AnalysisOptions {
  model?: GroqVisionModel;
  include_haag_assessment?: boolean;
  focus_areas?: DamageCategory[];
  max_tokens?: number;
  temperature?: number;
  /** Wizard-supplied roof squares — used to bound plausibility checks. */
  roofSquares?: number;
  /** Wizard-supplied measurement context. If absent, any AI-claimed numeric measurements are flagged as hallucinations. */
  hasMeasurementContext?: boolean;
  /**
   * The inspector's spoken/typed description of THIS specific photo (e.g. from a
   * mobile voice note). Injected into the prompt as a strong hint about what to
   * look for — but the model is still told to only report damage it can see.
   */
  inspectorPhotoNote?: string;
}

/**
 * Build the prompt suffix that injects an inspector's per-photo description.
 * Returns '' when no note is present so existing behavior is unchanged.
 */
function buildPhotoNoteSuffix(note?: string): string {
  const trimmed = note?.trim();
  if (!trimmed) return '';
  return `\n\nThe field inspector verbally described THIS specific photo as: "${trimmed}"\nUse this as a strong hint about what to look for and where in the image, but only report damage you can actually see — do not invent damage that isn't visible just because it was mentioned.`;
}

/**
 * Numeric fields that the AI must NOT invent. If they appear in output but were
 * not in the input wizard context, they get stripped and logged as hallucinations.
 */
const NUMERIC_HALLUCINATION_FIELDS = ['affected_area_sqft', 'measured_length_ft', 'measured_width_ft'] as const;

export interface VisionAnomaly {
  kind: 'hallucinated_measurement' | 'severity_out_of_range' | 'area_implausible' | 'age_implausible';
  field: string;
  value: unknown;
  context?: string;
}

/**
 * Sanitize a vision result: strip hallucinated numeric measurements and apply
 * plausibility caps. Returns the cleaned result plus a list of anomalies.
 */
export function sanitizeVisionResult(
  result: RoofAnalysisResult,
  options: AnalysisOptions = {}
): { result: RoofAnalysisResult; anomalies: VisionAnomaly[] } {
  const anomalies: VisionAnomaly[] = [];
  const hasContext = options.hasMeasurementContext === true;
  const maxArea = options.roofSquares && options.roofSquares > 0 ? options.roofSquares * 100 : Infinity;

  // Severity score plausibility (0-10 scale per spec)
  if (typeof result.overall_severity_score === 'number' && result.overall_severity_score > 10) {
    anomalies.push({ kind: 'severity_out_of_range', field: 'overall_severity_score', value: result.overall_severity_score });
    // Note: groq-vision uses 0-100 internally; we only flag if > 100
    if (result.overall_severity_score > 100) result.overall_severity_score = 100;
  }

  // Walk damages and strip hallucinated measurements + clamp implausible values
  const cleanedDamages = (result.damages_detected || []).map((d: any) => {
    const cleaned: any = { ...d };
    for (const field of NUMERIC_HALLUCINATION_FIELDS) {
      if (cleaned[field] !== undefined && cleaned[field] !== null) {
        if (!hasContext) {
          anomalies.push({ kind: 'hallucinated_measurement', field, value: cleaned[field], context: cleaned.damage_type_id });
          delete cleaned[field];
          continue;
        }
        const num = Number(cleaned[field]);
        if (field === 'affected_area_sqft' && Number.isFinite(num) && num > maxArea) {
          anomalies.push({ kind: 'area_implausible', field, value: num, context: `max=${maxArea}` });
          delete cleaned[field];
        }
      }
    }
    return cleaned;
  });
  result.damages_detected = cleanedDamages;

  return { result, anomalies };
}

/**
 * Best-effort fire-and-forget anomaly logger. Hands the oddities to a sink if
 * one was registered, otherwise does nothing. Never throws, logging is non-fatal.
 */
export async function logVisionAnomalies(anomalies: VisionAnomaly[], context: { imageUrl?: string; reportId?: string } = {}): Promise<void> {
  if (anomalies.length === 0 || !anomalySink) return;
  try {
    await anomalySink(anomalies, context);
  } catch {
    // Logging is non-fatal: a failing sink never affects an analysis.
  }
}

type VisionAnomalySink = (
  anomalies: VisionAnomaly[],
  context: { imageUrl?: string; reportId?: string }
) => Promise<void> | void;

let anomalySink: VisionAnomalySink | null = null;

/**
 * Where flagged oddities go. None by default: this library never opens a
 * database. Archie's own code may register a sink; passing null removes it.
 */
export function setVisionAnomalySink(sink: VisionAnomalySink | null): void {
  anomalySink = sink;
}

/**
 * Build the system prompt for roof damage analysis
 * Optimized for better damage detection with step-by-step reasoning
 */
function buildSystemPrompt(options: AnalysisOptions): string {
  // Simplified damage categories for clearer detection
  const priorityDamages = `
CRITICAL DAMAGES (report immediately):
- Missing shingles: Gaps exposing underlayment or decking
- Holes/punctures: Any penetration through roofing material
- Structural sagging: Visible dips or waves in roof line
- Active leaks: Water stains, wet areas, mold

HIGH PRIORITY DAMAGES:
- Lifted/curled shingles: Edges turning up, broken seal lines
- Cracked shingles: Visible fractures in material
- Granule loss: Bare/shiny spots where protective granules missing
- Damaged flashing: Bent, rusted, or separated metal around vents/chimneys

MODERATE DAMAGES:
- Algae/moss growth: Dark streaks, green patches
- Minor curling: Slight edge lift without exposure
- Wear patterns: Fading, minor erosion
- Debris accumulation: Leaves, branches on surface

PENETRATIONS AND ACCESSORIES (commonly missed):
- Nail pops: Raised nails pushing through shingles
- Pipe boot / vent collar failures: Cracked or deteriorated neoprene boots
- Ridge cap damage: Lifted, missing, or cracked ridge caps
- Valley deterioration: Worn, exposed, or damaged valley areas
- Step flashing vs counter flashing issues
- Fascia board condition: Rot, peeling paint, separation
- Soffit condition: Blocked vents, holes, sagging panels
- Gutter granule accumulation: Key age indicator for shingle roofs
- Skylight seal condition: Cracked seals, condensation, flashing gaps
- Chimney flashing and mortar condition: Separation, cracked mortar joints
- Satellite dish mount penetrations: Unsealed bolt holes

FOR FLAT/LOW-SLOPE ROOFS (TPO, EPDM, PVC, Modified Bitumen, BUR):
- Membrane blistering or bubbling
- Seam separation or heat-weld failure
- Membrane punctures, tears, or cuts
- Ponding water or ponding stains (water pooling areas)
- Membrane shrinkage (pulling away from edges/flashings)
- Surface alligatoring or cracking (BUR/mod-bit)
- Lap adhesion failure
- Exposed or deteriorated insulation
- Drain blockage or improper drainage
- UV degradation/chalking of membrane
- Mechanical damage from foot traffic or equipment
- Flashing termination bar failures`;

  const materialsContext = ROOFING_MATERIALS.slice(0, 5).map(m =>
    `- ${m.name}: ${m.visual_characteristics.slice(0, 2).join(', ')}`
  ).join('\n');

  let prompt = `You are an expert roof inspector. Your job is to FIND AND REPORT ALL DAMAGE in this roof image.

IMPORTANT: Look carefully at EVERY part of the image. Many roof photos contain subtle damage that is easy to miss. Even if damage seems minor, REPORT IT.

## Step-by-Step Analysis Process:
1. SCAN the entire image systematically: top to bottom, left to right
2. IDENTIFY the roofing material (shingles, metal, tile, etc.)
3. LOOK FOR any anomalies: color changes, texture differences, missing pieces, lifted edges
4. ASSESS each finding: Is it damage, wear, or just dirt/shadows?
5. ESTIMATE the roof's age based on overall condition and wear patterns

## What to Look For:
${priorityDamages}

## Common Roofing Materials:
${materialsContext}

## Roof Age Indicators (estimate age in years):
- NEW (0-5 years): Uniform color, crisp edges, full granule coverage
- AGING (5-15 years): Slight fading, minor granule loss, some edge curl
- OLD (15-25 years): Significant fading, noticeable curling, granule wear
- END OF LIFE (25+ years): Severe curling, cracking, bare spots, deterioration`;

  // Always include HAAG assessment — this is a roofing CRM for insurance claims
  prompt += `

## HAAG Insurance Assessment:
- Hail damage: Random dent pattern, soft spots when pressed, granule displacement in impact area
- Wind damage: Creased shingles, lifted tabs, missing shingles in consistent pattern
- Distinguish storm damage from normal wear (storm = sudden, concentrated; wear = gradual, uniform)`;

  // Build valid type_id list from the damage knowledge base
  const validTypeIds = DAMAGE_TYPES.map(dt => dt.id).join(', ');
  prompt += `

## Standard Damage Type IDs:
When identifying damage, use these standard type_id values when applicable:
${validTypeIds}
If the damage does not match any standard type, use a descriptive snake_case id (e.g., "nail_pop", "pipe_boot_failure", "ridge_cap_damage", "valley_deterioration", "skylight_seal_failure").

## Response Format (JSON):
{
  "image_quality": "excellent|good|fair|poor",
  "roof_material": {
    "type": "asphalt_shingle|metal|tile|slate|wood_shake|flat_membrane|tpo|epdm|modified_bitumen|bur|pvc|other",
    "confidence": 0-100,
    "characteristics": ["what you see that identifies this material"]
  },
  "estimated_age": {
    "years": 0-50,
    "confidence": "low|medium|high",
    "indicators": ["granule loss visible", "edges curling", etc.]
  },
  "damages": [
    {
      "type_id": "descriptive_id",
      "name": "What the damage is",
      "category": "hail|wind|water|age_wear|structural|flashing|biological|debris|flat_roof",
      "confidence": 0-100,
      "severity": "minor|moderate|severe|critical",
      "location": "where on the roof (e.g., 'center of image', 'top left corner')",
      "evidence": ["specific visual evidence you see"],
      "insurance_worthy": true|false,
      "repair_urgency": "immediate|soon|monitor|cosmetic"
    }
  ],
  "overall_condition": "excellent|good|fair|poor|critical",
  "severity_score": 0-100,
  "claim_recommended": true|false,
  "summary": "2-3 sentence summary of findings",
  "recommendations": ["what should be done"]
}

CRITICAL: If you see ANY potential damage, include it in the damages array even with lower confidence. It's better to report something uncertain than to miss real damage. An empty damages array should only be returned if the roof genuinely appears undamaged.`;

  return prompt;
}

/**
 * Fetch image and convert to base64 data URL
 */
async function imageUrlToBase64(imageUrl: string): Promise<string> {
  // If already a data URL, return as-is
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  // SSRF guard: reject internal/loopback/private/metadata hosts before fetch.
  if (!isSafeFetchUrl(imageUrl)) {
    throw new Error('Unsafe image URL');
  }

  try {
    // SECURITY (H4): safeFetch resolves the host IPs and re-validates every
    // redirect hop, so a public URL can't rebind/redirect to a private target.
    const response = await safeFetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    // Detect content type from response or URL
    const contentType = response.headers.get('content-type') || DEFAULT_IMAGE_MIME;
    return `data:${contentType};base64,${base64}`;
  } catch (error: unknown) {
    console.error('[groq-vision] Failed to convert image to base64:', (error as Error).message);
    throw error;
  }
}

/**
 * Analyze a roof image using Groq Vision API
 */
export async function analyzeRoofImage(
  imageUrl: string,
  apiKey: string,
  options: AnalysisOptions = {}
): Promise<RoofAnalysisResult> {
  const startTime = Date.now();
  const model = options.model || GROQ_VISION_MODELS.LLAMA4_MAVERICK;

  if (!apiKey) {
    throw new Error('Groq API key is required');
  }

  const systemPrompt = buildSystemPrompt(options);

  try {
    // Convert image URL to base64 for Groq Vision API
    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `${BEARER_PREFIX}${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${DEFAULT_USER_PROMPT}${buildPhotoNoteSuffix(options.inspectorPhotoNote)}`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: base64ImageUrl,
                },
              },
            ],
          },
        ],
        max_tokens: options.max_tokens || DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? DEFAULT_VISION_TEMPERATURE,
        response_format: JSON_OBJECT_RESPONSE_FORMAT,
      }),
      // Cap each vision call so one hung photo/inference can't stall its batch
      // and freeze the whole (now background) report pipeline. On timeout the
      // catch below degrades this photo to a failed-analysis stub.
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Groq API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const rawAnalysis = data.choices?.[0]?.message?.content || '';
    const processingTime = Date.now() - startTime;

    // Parse the JSON response
    const result = parseAnalysisResponse(rawAnalysis, model, processingTime);
    result.raw_analysis = rawAnalysis;

    return result;
  } catch (error: unknown) {
    return failedAnalysisResult('Groq', model, Date.now() - startTime, getErrorMessage(error));
  }
}

/**
 * Analyze a roof image from base64 data
 */
export async function analyzeRoofImageBase64(
  base64Data: string,
  mimeType: string,
  apiKey: string,
  options: AnalysisOptions = {}
): Promise<RoofAnalysisResult> {
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  return analyzeRoofImage(dataUrl, apiKey, options);
}

/**
 * Analyze roof image using Gemini Vision API as fallback
 * Uses Google's Gemini 2.0 Flash model for image analysis
 */
export async function analyzeRoofImageWithGemini(
  imageUrl: string,
  geminiApiKey: string,
  inspectorPhotoNote?: string
): Promise<RoofAnalysisResult> {
  const startTime = Date.now();
  const model = GEMINI_VISION_MODEL;

  try {
    // Convert image URL to base64
    // Debug:('[gemini-vision] Converting image to base64 for Gemini...');
    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    // Extract base64 data and mime type from data URL
    const parsed = parseDataUrl(base64ImageUrl);
    if (!parsed) {
      throw new Error(INVALID_DATA_URL_ERR);
    }
    const { mimeType, data: base64Data } = parsed;

    const systemPromptBase = buildSystemPrompt({});
    const prompt = `${systemPromptBase}\n\n${ADDITIONAL_VISION_INSTRUCTIONS}${buildPhotoNoteSuffix(inspectorPhotoNote)}`;

    // Google's REST endpoint, called with fetch: no extra package to bundle.
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          [GOOGLE_KEY_HEADER]: geminiApiKey,
          'Content-Type': CONTENT_TYPE_JSON,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType } }],
            },
          ],
          generationConfig: { responseMimeType: CONTENT_TYPE_JSON },
        }),
      }
    );
    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json().catch(() => ({}));
      throw new Error(`Google API error: ${geminiResponse.status} - ${JSON.stringify(errorData)}`);
    }
    const geminiData = await geminiResponse.json();
    const result = {
      text: (geminiData?.candidates?.[0]?.content?.parts ?? [])
        .map((part: { text?: string }) => part?.text ?? '')
        .join(''),
    };

    const responseText = result.text || '';
    const processingTime = Date.now() - startTime;

    // Debug:('[gemini-vision] Response received, processing time:', processingTime, 'ms');

    // Parse the response
    const parsedResult = parseAnalysisResponse(responseText, model, processingTime);
    parsedResult.raw_analysis = responseText;

    return parsedResult;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error(`[${VISION_PROVIDER_LABELS.google.toLowerCase()}-vision] Analysis failed:`, message);
    return failedAnalysisResult(VISION_PROVIDER_LABELS.google, model, Date.now() - startTime, message);
  }
}

/**
 * Analyze roof image using Claude Haiku 4.5 via Anthropic API
 * Used as cross-validation provider alongside Groq and Gemini
 */
export async function analyzeRoofImageWithHaiku(
  imageUrl: string,
  anthropicApiKey: string,
  inspectorPhotoNote?: string
): Promise<RoofAnalysisResult> {
  const startTime = Date.now();
  const model = HAIKU_VISION_MODEL;

  try {
    // Convert image URL to base64
    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    // Extract base64 data and mime type from data URL
    const parsed = parseDataUrl(base64ImageUrl);
    if (!parsed) {
      throw new Error(INVALID_DATA_URL_ERR);
    }
    const { mimeType, data: base64Data } = parsed;

    const systemPromptBase = buildSystemPrompt({});
    const prompt = `${systemPromptBase}\n\n${ADDITIONAL_VISION_INSTRUCTIONS}${buildPhotoNoteSuffix(inspectorPhotoNote)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64Data,
              },
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Anthropic API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const responseText = data.content?.[0]?.text || '';
    const processingTime = Date.now() - startTime;

    const parsedResult = parseAnalysisResponse(responseText, model, processingTime);
    parsedResult.raw_analysis = responseText;

    return parsedResult;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error(`[${VISION_PROVIDER_LABELS.anthropic.toLowerCase()}-vision] Analysis failed:`, message);
    return failedAnalysisResult(VISION_PROVIDER_LABELS.anthropic, model, Date.now() - startTime, message);
  }
}

/**
 * Analyze roof image with automatic fallback and cross-validation
 * Tries Groq first. If Groq finds damage AND additional keys are available,
 * runs Haiku + Gemini in parallel for cross-validation. If Groq fails or finds
 * nothing, falls back to Haiku then Gemini.
 */
export async function analyzeRoofImageWithFallback(
  imageUrl: string,
  groqApiKey: string,
  geminiApiKey?: string,
  options: AnalysisOptions = {},
  anthropicApiKey?: string
): Promise<RoofAnalysisResult> {
  // First try Groq Vision
  const groqResult = await analyzeRoofImage(imageUrl, groqApiKey, options);
  // Post-parse hallucination + plausibility guard
  const { result: _sanitized, anomalies: _groqAnomalies } = sanitizeVisionResult(groqResult, options);
  if (_groqAnomalies.length > 0) {
    void logVisionAnomalies(_groqAnomalies, { imageUrl });
  }

  // If Groq succeeded AND found damage, cross-validate with available providers
  if (groqResult.success && groqResult.damages_detected.length > 0) {
    const crossValidationPromises: Promise<RoofAnalysisResult | null>[] = [];
    const providerNames: string[] = [groqResult.model_used];

    if (geminiApiKey) {
      crossValidationPromises.push(
        analyzeRoofImageWithGemini(imageUrl, geminiApiKey, options.inspectorPhotoNote).catch(() => null)
      );
    }
    if (anthropicApiKey) {
      crossValidationPromises.push(
        analyzeRoofImageWithHaiku(imageUrl, anthropicApiKey, options.inspectorPhotoNote).catch(() => null)
      );
    }

    if (crossValidationPromises.length > 0) {
      const settled = await Promise.allSettled(crossValidationPromises);
      const successfulResults: RoofAnalysisResult[] = [];

      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value && result.value.success && result.value.damages_detected.length > 0) {
          successfulResults.push(result.value);
          providerNames.push(result.value.model_used);
        }
      }

      if (successfulResults.length > 0) {
        // Start with Groq damages, then merge each additional provider
        let mergedDamages = groqResult.damages_detected;
        let totalCrossValidationTime = 0;

        for (const cvResult of successfulResults) {
          mergedDamages = crossValidateDamages(mergedDamages, cvResult.damages_detected);
          totalCrossValidationTime += cvResult.processing_time_ms;
        }

        const providerCount = 1 + successfulResults.length; // Groq + successful cross-validators
        groqResult.damages_detected = mergedDamages;
        groqResult.overall_severity_score = calculateSeverityScore(mergedDamages);
        groqResult.insurance_claim_recommended = mergedDamages.some(d => d.insurance_claim_worthy);
        groqResult.model_used = providerNames.join(' + ') + ' (cross-validated)';
        groqResult.processing_time_ms = groqResult.processing_time_ms + totalCrossValidationTime;
        groqResult.summary = `Cross-validated analysis found ${mergedDamages.length} damage instances across ${providerCount} AI providers. ${groqResult.summary}`;
      }
      // If all cross-validators failed or found nothing, Groq result stands on its own
    }
    return groqResult;
  }

  // If no fallback keys available, return Groq result (even if failed)
  if (!geminiApiKey && !anthropicApiKey) {
    return groqResult;
  }

  // If Groq failed or found no damage, try Haiku first (faster, cheaper), then Gemini
  if (anthropicApiKey) {
    const haikuResult = await analyzeRoofImageWithHaiku(imageUrl, anthropicApiKey, options.inspectorPhotoNote).catch(() => null);
    if (haikuResult && haikuResult.success && haikuResult.damages_detected.length > 0) {
      haikuResult.model_used = `${groqResult.model_used} + ${haikuResult.model_used} (fallback)`;
      haikuResult.processing_time_ms = groqResult.processing_time_ms + haikuResult.processing_time_ms;
      return haikuResult;
    }
  }

  if (geminiApiKey) {
    const geminiResult = await analyzeRoofImageWithGemini(imageUrl, geminiApiKey, options.inspectorPhotoNote);
    if (geminiResult.damages_detected.length > 0) {
      geminiResult.model_used = `${groqResult.model_used} + ${geminiResult.model_used} (fallback)`;
      geminiResult.processing_time_ms = groqResult.processing_time_ms + geminiResult.processing_time_ms;
      return geminiResult;
    }
  }

  // All providers found no damage - return Groq result (likely genuinely clean roof)
  groqResult.summary = 'No visible damage detected. Roof appears to be in good condition.';
  return groqResult;
}

/**
 * Cross-validate and merge damages from two providers.
 * Deduplicates by damage_type_id + similar location, boosts confidence
 * for corroborated items by +15, and takes the highest severity.
 */
function crossValidateDamages(
  primaryDamages: DamageDetection[],
  secondaryDamages: DamageDetection[]
): DamageDetection[] {
  const merged: DamageDetection[] = primaryDamages.map(d => ({ ...d }));

  for (const secondary of secondaryDamages) {
    const matchIdx = merged.findIndex(primary => {
      if (primary.damage_type_id !== secondary.damage_type_id) return false;
      // Check location similarity
      const locA = (primary.location_description ?? '').toLowerCase();
      const locB = (secondary.location_description ?? '').toLowerCase();
      if (locA === locB || locA.includes(locB) || locB.includes(locA)) return true;
      // Check overlapping keywords
      const wordsA = locA.split(COMBINE_WHITESPACE_SPLIT_RE);
      const wordsB = locB.split(COMBINE_WHITESPACE_SPLIT_RE);
      const overlap = wordsA.filter(w => w.length > LOCATION_KEYWORD_MIN_LENGTH && wordsB.includes(w));
      return overlap.length >= LOCATION_KEYWORD_OVERLAP_THRESHOLD;
    });

    if (matchIdx === -1) {
      // New damage found only by secondary provider — add it
      merged.push({ ...secondary });
    } else {
      // Corroborated by both providers — boost confidence, take highest severity
      const existing = merged[matchIdx];
      existing.confidence = Math.min(MAX_CONFIDENCE_SCORE, existing.confidence + CORROBORATION_CONFIDENCE_BOOST);
      if ((SEVERITY_RANK_DESC[secondary.severity] || 0) > (SEVERITY_RANK_DESC[existing.severity] || 0)) {
        existing.severity = secondary.severity;
      }
      // Merge visual evidence
      const newEvidence = (secondary.visual_evidence ?? []).filter(e => !(existing.visual_evidence ?? []).includes(e));
      existing.visual_evidence = [...(existing.visual_evidence ?? []), ...newEvidence].slice(0, MAX_VISUAL_EVIDENCE_ENTRIES);
    }
  }

  return merged;
}

/**
 * Re-analyze an image with inspector hints for targeted damage detection.
 * Builds a modified prompt that focuses on specific damage types the inspector
 * reported, looking for subtle damage that may have been initially missed.
 */
export async function reanalyzeWithHints(
  imageUrl: string,
  groqApiKey: string,
  geminiApiKey: string | undefined,
  hints: { focusDamageTypes: string[]; inspectorNote?: string },
  options?: AnalysisOptions
): Promise<RoofAnalysisResult> {
  const startTime = Date.now();
  const model = options?.model || GROQ_VISION_MODELS.LLAMA4_MAVERICK;
  const basePrompt = buildSystemPrompt(options || {});

  // Insert hint text before the response format section
  const hintSection = `
## Inspector Hints — Focused Re-analysis:
The inspector reported the following damage types: ${hints.focusDamageTypes.join(', ')}.
${hints.inspectorNote ? `Inspector note: "${hints.inspectorNote}"` : ''}
Re-examine the image carefully for subtle impact marks, granule displacement, lifted edges, and any damage that may have been initially missed. Pay special attention to the reported damage types above, but also report any other damage you find.`;

  const promptParts = basePrompt.split('## Response Format');
  const enhancedPrompt = promptParts.length > 1
    ? `${promptParts[0]}${hintSection}\n\n## Response Format${promptParts[1]}`
    : `${basePrompt}\n${hintSection}`;

  try {
    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    const fetchResponse = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `${BEARER_PREFIX}${groqApiKey}`,
        'Content-Type': CONTENT_TYPE_JSON,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: enhancedPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: REANALYZE_USER_PROMPT,
              },
              { type: 'image_url', image_url: { url: base64ImageUrl } },
            ],
          },
        ],
        max_tokens: options?.max_tokens || DEFAULT_MAX_TOKENS,
        temperature: options?.temperature || DEFAULT_VISION_TEMPERATURE,
        response_format: JSON_OBJECT_RESPONSE_FORMAT,
      }),
    });

    if (!fetchResponse.ok) {
      const errorData = await (fetchResponse as any).json().catch(() => ({}));
      throw new Error(`Groq API error: ${fetchResponse.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await (fetchResponse as any).json();
    const rawAnalysis = data.choices?.[0]?.message?.content || '';
    const processingTime = Date.now() - startTime;

    const result = parseAnalysisResponse(rawAnalysis, `${model} (re-analysis with hints)`, processingTime);
    result.raw_analysis = rawAnalysis;

    // If Groq found damages, return
    if (result.success && result.damages_detected.length > 0) {
      return result;
    }

    // Groq found nothing — try Gemini fallback if available
    if (geminiApiKey) {
      const geminiResult = await analyzeRoofImageWithGemini(imageUrl, geminiApiKey);
      if (geminiResult.damages_detected.length > 0) {
        geminiResult.model_used = `${model} + ${geminiResult.model_used} (hint re-analysis fallback)`;
        geminiResult.processing_time_ms = (Date.now() - startTime);
        return geminiResult;
      }
    }

    return result;
  } catch (error: unknown) {
    const processingTime = Date.now() - startTime;
    return {
      success: false,
      image_quality: 'poor',
      roof_material: null,
      damages_detected: [],
      overall_condition: 'poor',
      overall_severity_score: 0,
      insurance_claim_recommended: false,
      summary: `Re-analysis with hints failed: ${(error as Error).message}`,
      detailed_findings: '',
      recommendations: ['Unable to re-analyze image. Please try again.'],
      raw_analysis: (error as Error).message,
      model_used: model,
      processing_time_ms: processingTime,
    };
  }
}

/**
 * Photo category for pre-classification
 */
export type PhotoCategory = 'roof_surface' | 'gutter' | 'flashing' | 'vent' | 'chimney' | 'interior' | 'overview' | 'closeup' | 'other';

/**
 * Classify a roof photo into a category using fast vision model.
 * Useful for pre-sorting photos before detailed analysis.
 */
export async function classifyPhoto(
  imageUrl: string,
  groqApiKey: string
): Promise<{ category: PhotoCategory; confidence: number }> {
  try {
    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    const fetchResponse = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_VISION_MODELS.LLAMA4_SCOUT,
        messages: [
          {
            role: 'system',
            content: `Classify this roofing photo into exactly one category. Return JSON only.

Categories:
- roof_surface: General view of shingles, tiles, or roofing material
- gutter: Gutter, downspout, or drainage system
- flashing: Metal flashing around edges, walls, or penetrations
- vent: Roof vents, pipe boots, exhaust fans
- chimney: Chimney structure, cap, or surrounding area
- interior: Inside the attic, ceiling stains, interior damage
- overview: Wide/aerial shot showing entire roof or large section
- closeup: Extreme close-up of specific damage or detail
- other: Does not fit any category above

Return: { "category": "one_of_above", "confidence": 0-100 }`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Classify this photo.' },
              { type: 'image_url', image_url: { url: base64ImageUrl } },
            ],
          },
        ],
        max_tokens: 256,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!fetchResponse.ok) {
      return { category: 'other', confidence: 0 };
    }

    const data = await (fetchResponse as any).json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    const validCategories: PhotoCategory[] = [
      'roof_surface', 'gutter', 'flashing', 'vent', 'chimney',
      'interior', 'overview', 'closeup', 'other',
    ];
    const category = validCategories.includes(parsed.category) ? parsed.category : 'other';
    const confidence = typeof parsed.confidence === 'number' ? Math.min(100, Math.max(0, parsed.confidence)) : 0;

    return { category, confidence };
  } catch {
    return { category: 'other', confidence: 0 };
  }
}

/**
 * Parse the raw analysis response into structured format
 */
function parseAnalysisResponse(
  rawResponse: string,
  model: string,
  processingTime: number
): RoofAnalysisResult {
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = rawResponse;
    const jsonMatch = rawResponse.match(JSON_CODE_FENCE_RE);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      // Try to find JSON object directly
      const jsonStart = rawResponse.indexOf('{');
      const jsonEnd = rawResponse.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = rawResponse.slice(jsonStart, jsonEnd + 1);
      }
    }

    const parsed = JSON.parse(jsonStr);

    // Validate minimum required structure
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid response structure');
    // Normalize field names — some models return "damages_detected" instead of "damages"
    if (!Array.isArray(parsed.damages)) parsed.damages = parsed.damages_detected || [];
    if (!parsed.damages_detected) parsed.damages_detected = parsed.damages;

    // Map damages to our structure
    const damages: DamageDetection[] = (parsed.damages || []).map((d: any) => {
      const damageType = DAMAGE_TYPES.find(dt => dt.id === d.type_id);
      return {
        damage_type_id: d.type_id || PARSE_DAMAGE_DEFAULT_TYPE_ID,
        damage_name: d.name || damageType?.name || PARSE_DAMAGE_DEFAULT_NAME,
        category: d.category || damageType?.category || PARSE_DAMAGE_DEFAULT_CATEGORY,
        confidence: d.confidence || PARSE_DAMAGE_DEFAULT_CONFIDENCE,
        severity: d.severity || PARSE_DAMAGE_DEFAULT_SEVERITY,
        location_description: d.location || PARSE_DAMAGE_DEFAULT_LOCATION,
        visual_evidence: d.evidence || [],
        haag_compliant: d.haag_compliant ?? false,
        insurance_claim_worthy: d.insurance_worthy ?? false,
        repair_recommendation: getRepairRecommendation(d.severity, damageType),
        estimated_urgency: d.repair_urgency || damageType?.repair_urgency || PARSE_DAMAGE_DEFAULT_URGENCY,
      };
    });

    // Photo quality feedback
    const photoQualityTips: string[] = [];
    const imgQuality = parsed.image_quality || IMG_QUALITY_FAIR;
    if (imgQuality === IMG_QUALITY_POOR) {
      photoQualityTips.push(IMG_QUALITY_TIP_DARK_OR_BLURRY);
      photoQualityTips.push(IMG_QUALITY_TIP_CLOSER);
    } else if (imgQuality === IMG_QUALITY_FAIR) {
      photoQualityTips.push(IMG_QUALITY_TIP_LIGHTING_ANGLE);
    }

    return {
      success: true,
      image_quality: parsed.image_quality || IMG_QUALITY_FAIR,
      roof_material: parsed.roof_material || null,
      damages_detected: damages,
      overall_condition: parsed.overall_condition || IMG_QUALITY_FAIR,
      overall_severity_score: parsed.severity_score || calculateSeverityScore(damages),
      insurance_claim_recommended: parsed.claim_recommended ?? damages.some(d => d.insurance_claim_worthy),
      summary: parsed.summary || PARSE_DEFAULT_SUMMARY,
      detailed_findings: parsed.detailed_findings || '',
      recommendations: parsed.recommendations || [],
      photo_quality_tips: photoQualityTips.length > 0 ? photoQualityTips : undefined,
      model_used: model,
      processing_time_ms: processingTime,
    };
  } catch (parseError: unknown) {
    // JSON parsing failed - log the error and return failure status
    console.error(`${PARSE_LOG_PREFIX}${PARSE_LOG_JSON_FAILED}`, (parseError as any)?.message || parseError);
    console.error(`${PARSE_LOG_PREFIX}${PARSE_LOG_RAW_PREFIX}`, rawResponse.substring(0, PARSE_RAW_PREVIEW_CHARS));

    return {
      success: false,  // Signal failure so fallback can be triggered
      image_quality: IMG_QUALITY_FAIR,
      roof_material: null,
      damages_detected: [],
      overall_condition: IMG_QUALITY_FAIR,
      overall_severity_score: 0,
      insurance_claim_recommended: false,
      summary: PARSE_FAIL_SUMMARY,
      detailed_findings: rawResponse,
      recommendations: [PARSE_FAIL_RECOMMENDATION],
      raw_analysis: rawResponse,  // Preserve for debugging
      model_used: model,
      processing_time_ms: processingTime,
    };
  }
}

/**
 * Get repair recommendation based on severity and damage type
 */
/** Default repair recommendations when the damage-knowledge-base entry
 *  has no `typical_repair` for the given severity. Hoisted so the
 *  language can be tuned (e.g. for tenants with their own SLAs) without
 *  touching the function body. */
const DEFAULT_RECOMMENDATIONS_BY_SEVERITY: Record<string, string> = {
  critical: 'Immediate professional repair required',
  severe: 'Schedule repair within 1-2 weeks',
  moderate: 'Plan repair within 1-3 months',
};
const DEFAULT_RECOMMENDATION_FALLBACK = 'Monitor and address during next maintenance';
const RECOMMENDATION_NO_DAMAGE_TYPE = 'Consult with roofing professional';

function getRepairRecommendation(
  severity: string,
  damageType?: DamageType
): string {
  if (!damageType) {
    return DEFAULT_RECOMMENDATIONS_BY_SEVERITY[severity] || DEFAULT_RECOMMENDATION_FALLBACK;
  }

  const severityLevel = damageType.severity_levels.find(s => s.level === severity);
  return severityLevel?.typical_repair || RECOMMENDATION_NO_DAMAGE_TYPE;
}

/** Severity → numeric weight for the overall-severity score. Hoisted so
 *  the math is consistent across calls and easier to tune in one place. */
const SEVERITY_SCORE_WEIGHTS: Record<string, number> = {
  critical: 100,
  severe: 75,
  moderate: 50,
  minor: 25,
};

/** Fallback weight when a damage's severity isn't in the SEVERITY_SCORE_WEIGHTS map. */
const DEFAULT_SEVERITY_WEIGHT = 50;

/** Maximum severity-score output (clamps the diminishing-returns formula). */
const MAX_SEVERITY_SCORE = 100;

/** Convert a 0-100 confidence integer to a 0-1 multiplier. */
function confidenceFactor(confidencePct: number): number {
  if (!Number.isFinite(confidencePct) || confidencePct <= 0) return 0;
  return Math.min(1, confidencePct / 100);
}

/**
 * Calculate overall severity score from damages
 */
function calculateSeverityScore(damages: DamageDetection[]): number {
  if (damages.length === 0) return 0;

  const weightedSum = damages.reduce((sum, d) => {
    const weight = SEVERITY_SCORE_WEIGHTS[d.severity] || DEFAULT_SEVERITY_WEIGHT;
    return sum + weight * confidenceFactor(d.confidence);
  }, 0);

  // Normalize to 0-MAX, with diminishing returns for multiple damages
  const normalized = Math.min(MAX_SEVERITY_SCORE, weightedSum / Math.sqrt(damages.length));
  return Math.round(normalized);
}

/** Batch settings for `analyzeMultipleImages`. The 3-at-a-time concurrency
 *  matches Groq's per-second rate limit headroom; the inter-batch delay
 *  smooths bursts on long image sets. */
const MULTI_IMAGE_BATCH_SIZE = 3;
const MULTI_IMAGE_BATCH_DELAY_MS = 500;

// ─── combineAnalysisResults constants ────────────────────────────────
/** Hard cap on per-damage confidence (after corroboration boosts). */
const MAX_CONFIDENCE_SCORE = 100;
/** Confidence points added each time a damage is corroborated by another photo. */
const CORROBORATION_CONFIDENCE_BOOST = 15;
/** Cap on `visual_evidence` array length per damage — keeps a deeply-corroborated
 *  damage's evidence list readable in the report. */
const MAX_VISUAL_EVIDENCE_ENTRIES = 8;
/** Minimum location-keyword overlap to consider two damages "in the same area". */
const LOCATION_KEYWORD_OVERLAP_THRESHOLD = 1;
/** Minimum word length for a location keyword to count toward overlap (filters
 *  out short prepositions like 'on', 'at', 'of'). */
const LOCATION_KEYWORD_MIN_LENGTH = 2;
/** Severity rank — higher value = worse. Used to pick the "worst seen" severity
 *  when corroborating a damage across photos. */
const SEVERITY_RANK_DESC: Record<string, number> = {
  critical: 4,
  severe: 3,
  moderate: 2,
  minor: 1,
};
/** Message + fallback strings used by `buildEmptyCombinedResult`. */
const MSG_NO_IMAGES_ANALYZED = 'No images could be analyzed successfully.';
const MSG_PROVIDE_CLEARER_IMAGES = 'Please provide clearer images for analysis.';
const MODEL_USED_FALLBACK = 'unknown';

/** Numeric score per overall_condition tier — used by `combineAnalysisResults`
 *  to compute an average tier across photos. Hoisted to module scope so the
 *  Record isn't reallocated per call. */
const CONDITION_SCORES: Record<string, number> = {
  excellent: 5,
  good: 4,
  fair: 3,
  poor: 2,
  critical: 1,
};
/** Half-step tolerance when matching the avg score back to a tier. */
const CONDITION_MATCH_THRESHOLD = 0.5;
/** Fallback overall_condition when no tier matches within the threshold. */
const OVERALL_CONDITION_DEFAULT = 'fair';

/** Combined-analysis summary template fragments — assembled into:
 *  `'Combined analysis of N images. Found M damage instances.'` */
const COMBINED_SUMMARY_PREFIX = 'Combined analysis of ';
const COMBINED_SUMMARY_INFIX = ' images. Found ';
const COMBINED_SUMMARY_SUFFIX = ' damage instances.';

/** Default `image_quality` value for the aggregate result (heuristic:
 *  combined analyses are generally higher signal than any single photo). */
const COMBINED_IMAGE_QUALITY = 'good';

/** Detailed-findings paragraph separator. */
const DETAILED_FINDINGS_SEPARATOR = '\n\n';

// ─── correlateMultiImageFindings strings ────────────────────────────
/** Minimum successful-photo count needed to attempt cross-photo correlation. */
const CORRELATE_MIN_PHOTOS = 2;
/** Empty result returned when correlation can't run or fails. */
const CORRELATE_EMPTY_RESULT = { correlations: '', crossPhotoPatterns: [] as string[] };
/** Damage-summary line template fragments — each photo renders one block:
 *  `'Photo N (CONDITION condition):\n- DAMAGE_NAME (SEVERITY, CONFIDENCE% confidence) at LOCATION'`. */
const CORRELATE_DAMAGE_LINE_PREFIX = '- ';
const CORRELATE_OPEN_PAREN = ' (';
const CORRELATE_CLOSE_PAREN = ')';
const CORRELATE_SEVERITY_INFIX = ', ';
const CORRELATE_CONFIDENCE_SUFFIX = '% confidence';
const CORRELATE_LOCATION_PREFIX = ' at ';
const CORRELATE_LINE_SEPARATOR = '\n';
const CORRELATE_BLOCK_SEPARATOR = '\n\n';
const CORRELATE_PHOTO_PREFIX = 'Photo ';
const CORRELATE_CONDITION_LABEL_INFIX = ' condition):';

/** System-prompt text for the correlate call. Hoisted so a future prompt
 *  iteration is one constant edit instead of an inline-string hunt. */
const CORRELATE_SYSTEM_PROMPT = `You are an expert roof inspector analyzing findings from multiple photos of the same roof.
Identify patterns and correlations across the photos. Look for:
1. Consistent damage patterns that confirm storm damage (e.g., hail on multiple slopes)
2. Damage progression indicators (worse on one side = directional wind/hail)
3. Corroborating evidence (granule loss in gutters + shingle damage = same cause)
4. Missing documentation gaps (areas not photographed)

Return JSON:
{
  "correlations": "2-4 sentence narrative about cross-photo findings",
  "crossPhotoPatterns": ["pattern 1", "pattern 2", ...],
  "confidence_adjustments": [{"damage_type": "type", "adjustment": "increase|decrease", "reason": "why"}]
}`;

/** User-prompt template fragments. */
const CORRELATE_USER_PROMPT_PREFIX = 'Analyze these findings from ';
const CORRELATE_USER_PROMPT_INFIX = ' photos of the same roof:\n\n';

// ─── analyzeAccessories strings ─────────────────────────────────────
/** Max tokens for the accessories pass — distinct from the broader
 *  vision-analysis pass since this prompt narrows scope to ~10 fixed
 *  accessory types. */
const ACCESSORIES_MAX_TOKENS = 2048;
/** Temperature for the accessories pass — low for deterministic structured output. */
const ACCESSORIES_TEMPERATURE = 0.1;

/** Empty-result returned when the accessories request fails. */
const ACCESSORIES_EMPTY_RESULT: DamageDetection[] = [];

/** System-prompt for the accessories pass. */
const ACCESSORIES_SYSTEM_PROMPT = `You are a roofing inspector focused ONLY on accessories and penetrations.
Ignore shingles and general roof surface. Focus EXCLUSIVELY on:
1. Pipe boots / vent collars — cracked, split, or deteriorated neoprene
2. Ridge caps — lifted, missing, cracked, improperly nailed
3. Skylight seals — cracked caulk, flashing gaps, condensation
4. Chimney flashing — step/counter flashing separation, cracked mortar
5. Nail pops — raised nails pushing through shingles
6. Soffit/fascia — rot, peeling, separation, blocked vents
7. Satellite dish mounts — unsealed bolt holes
8. Roof vents — damaged hoods, missing screens
9. Valley metal — exposed, rusted, or improperly overlapped
10. Gutter conditions — granule buildup, sagging, separation

Return JSON:
{
  "accessories_found": [
    {
      "type_id": "pipe_boot_failure|ridge_cap_damage|skylight_seal_failure|chimney_flashing_damage|nail_pop|soffit_damage|fascia_damage|satellite_mount|vent_damage|valley_deterioration|gutter_damage",
      "name": "description",
      "category": "flashing|structural|debris",
      "confidence": 0-100,
      "severity": "minor|moderate|severe|critical",
      "location": "where in image",
      "evidence": ["what you see"],
      "insurance_worthy": boolean,
      "repair_urgency": "immediate|soon|monitor|cosmetic"
    }
  ]
}
Only return items you actually see. Empty array is valid if no accessories are visible.`;

/** User-prompt text for the accessories pass. */
const ACCESSORIES_USER_PROMPT = 'Examine this roof image for accessory and penetration issues only.';

/** Defaults applied when an accessory row is missing fields. */
const ACCESSORY_DEFAULT_TYPE_ID = 'accessory_issue';
const ACCESSORY_DEFAULT_NAME = 'Accessory Issue';
const ACCESSORY_DEFAULT_CATEGORY = 'flashing';
const ACCESSORY_DEFAULT_CONFIDENCE = 50;
const ACCESSORY_DEFAULT_SEVERITY = 'moderate';
const ACCESSORY_DEFAULT_LOCATION = 'Unspecified';
const ACCESSORY_DEFAULT_URGENCY = 'monitor';
/** Repair-recommendation strings for the immediate / non-immediate cases. */
const ACCESSORY_REPAIR_IMMEDIATE = 'Immediate repair required';
const ACCESSORY_REPAIR_DEFAULT = 'Schedule repair';

// ─── quickDamageCheck severity tiers ────────────────────────────────
/** Severity values that trigger the "severe" bucket in `quickDamageCheck`. */
const QUICK_SEVERE_VALUES: ReadonlySet<string> = new Set(['severe', 'critical']);
/** Severity value that triggers the "moderate" bucket. */
const QUICK_MODERATE_VALUE = 'moderate';
/** Output severity tags returned by `quickDamageCheck`. */
type QuickSeverity = 'none' | 'minor' | 'moderate' | 'severe';
const QUICK_SEVERITY_SEVERE: QuickSeverity = 'severe';
const QUICK_SEVERITY_MODERATE: QuickSeverity = 'moderate';
const QUICK_SEVERITY_MINOR: QuickSeverity = 'minor';
const QUICK_SEVERITY_NONE: QuickSeverity = 'none';

// ─── parseAnalysisResponse strings + defaults ───────────────────────
/** Markdown code-fence regex used to extract JSON from a fenced block. */
const JSON_CODE_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/;

/** Default fallbacks for missing fields on parsed damage rows. */
const PARSE_DAMAGE_DEFAULT_TYPE_ID = 'unknown';
const PARSE_DAMAGE_DEFAULT_NAME = 'Unknown Damage';
const PARSE_DAMAGE_DEFAULT_CATEGORY = 'unknown';
const PARSE_DAMAGE_DEFAULT_CONFIDENCE = 50;
const PARSE_DAMAGE_DEFAULT_SEVERITY = 'moderate';
const PARSE_DAMAGE_DEFAULT_LOCATION = 'Unspecified location';
const PARSE_DAMAGE_DEFAULT_URGENCY = 'monitor';

/** Image-quality buckets + tips. */
const IMG_QUALITY_FAIR = 'fair';
const IMG_QUALITY_POOR = 'poor';
const IMG_QUALITY_TIP_DARK_OR_BLURRY = 'Image is too dark or blurry — retake in better lighting';
const IMG_QUALITY_TIP_CLOSER = 'Move closer to the roof for more detail';
const IMG_QUALITY_TIP_LIGHTING_ANGLE = 'Image could be clearer — try better lighting or a closer angle';

/** Default summary + recommendations when the response is well-formed. */
const PARSE_DEFAULT_SUMMARY = 'Analysis complete.';

/** Failure-path summary + recommendations when JSON parse fails. */
const PARSE_FAIL_SUMMARY = 'Analysis failed: Could not parse AI response. Trying fallback...';
const PARSE_FAIL_RECOMMENDATION = 'AI response format error - manual review recommended.';

/** Console log prefix for parse-error reports. */
const PARSE_LOG_PREFIX = '[groq-vision]';
const PARSE_LOG_JSON_FAILED = ' JSON parse failed:';
const PARSE_LOG_RAW_PREFIX = ' Raw response (first 500 chars):';
const PARSE_RAW_PREVIEW_CHARS = 500;
/** Whitespace split regex used by location-keyword dedup. */
const COMBINE_WHITESPACE_SPLIT_RE = /\s+/;

/**
 * Batch analyze multiple images
 */
export async function analyzeMultipleImages(
  imageUrls: string[],
  apiKey: string,
  options: AnalysisOptions = {}
): Promise<RoofAnalysisResult[]> {
  // Process images in parallel with rate limiting
  const results: RoofAnalysisResult[] = [];

  for (let i = 0; i < imageUrls.length; i += MULTI_IMAGE_BATCH_SIZE) {
    const batch = imageUrls.slice(i, i + MULTI_IMAGE_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(url => analyzeRoofImage(url, apiKey, options))
    );
    results.push(...batchResults);

    // Small delay between batches
    if (i + MULTI_IMAGE_BATCH_SIZE < imageUrls.length) {
      await new Promise(resolve => setTimeout(resolve, MULTI_IMAGE_BATCH_DELAY_MS));
    }
  }

  return results;
}

/**
 * Build the "no images analysed" combined result. Extracted so the
 * empty-state shape stays in sync with the success-state shape.
 */
function buildEmptyCombinedResult(allResults: RoofAnalysisResult[]): RoofAnalysisResult {
  const safeResults = Array.isArray(allResults) ? allResults : [];
  return {
    success: false,
    image_quality: 'poor',
    roof_material: null,
    damages_detected: [],
    overall_condition: 'poor',
    overall_severity_score: 0,
    insurance_claim_recommended: false,
    summary: MSG_NO_IMAGES_ANALYZED,
    detailed_findings: '',
    recommendations: [MSG_PROVIDE_CLEARER_IMAGES],
    model_used: safeResults.find(r => r?.model_used)?.model_used || MODEL_USED_FALLBACK,
    processing_time_ms: sumProcessingTime(safeResults),
  };
}

/** Sum `processing_time_ms` across results, skipping null/partial entries and
 *  non-finite values so a malformed entry can't poison the aggregate. */
function sumProcessingTime(results: RoofAnalysisResult[]): number {
  if (!Array.isArray(results)) return 0;
  return results.reduce((sum, r) => {
    const ms = r?.processing_time_ms;
    return Number.isFinite(ms) ? sum + (ms as number) : sum;
  }, 0);
}

/**
 * Combine results from multiple images into a comprehensive report
 */
export function combineAnalysisResults(results: RoofAnalysisResult[]): RoofAnalysisResult {
  // Harden against malformed input: a non-array (null/undefined/object) or an
  // array containing null/partial entries must not throw. Only truthy entries
  // explicitly marked successful are merged; everything else is skipped.
  const safeResults = Array.isArray(results) ? results.filter(Boolean) : [];
  const successfulResults = safeResults.filter(r => r && r.success === true);

  if (successfulResults.length === 0) {
    return buildEmptyCombinedResult(safeResults);
  }

  // Aggregate damages with fuzzy deduplication
  const allDamages: DamageDetection[] = [];

  for (const result of successfulResults) {
    const damages = Array.isArray(result.damages_detected) ? result.damages_detected : [];
    for (const damage of damages) {
      if (!damage) continue;
      // Fuzzy dedup: same damage_type_id OR same category + similar location
      const existingIdx = allDamages.findIndex(d => {
        // Exact type match
        if (d.damage_type_id === damage.damage_type_id) {
          // Same type — check if location is similar (fuzzy)
          const locA = (d.location_description ?? '').toLowerCase();
          const locB = (damage.location_description ?? '').toLowerCase();
          // Consider same if: exact match, one contains the other, or same general area
          if (locA === locB || locA.includes(locB) || locB.includes(locA)) return true;
          // Check for overlapping keywords (e.g., "north slope" vs "north side")
          const wordsA = locA.split(COMBINE_WHITESPACE_SPLIT_RE);
          const wordsB = locB.split(COMBINE_WHITESPACE_SPLIT_RE);
          const overlap = wordsA.filter(w => w.length > LOCATION_KEYWORD_MIN_LENGTH && wordsB.includes(w));
          if (overlap.length >= LOCATION_KEYWORD_OVERLAP_THRESHOLD) return true;
        }
        // Same category + same type (e.g., "granule_loss" across photos)
        if (d.category === damage.category && d.damage_type_id === damage.damage_type_id) return true;
        return false;
      });

      if (existingIdx === -1) {
        allDamages.push({ ...damage });
      } else {
        // Corroborated across multiple images — boost confidence and take highest severity
        const existing = allDamages[existingIdx];
        existing.confidence = Math.min(MAX_CONFIDENCE_SCORE, existing.confidence + CORROBORATION_CONFIDENCE_BOOST);
        // Take higher severity
        if ((SEVERITY_RANK_DESC[damage.severity] || 0) > (SEVERITY_RANK_DESC[existing.severity] || 0)) {
          existing.severity = damage.severity;
        }
        // Merge visual evidence
        const newEvidence = (damage.visual_evidence ?? []).filter(e => !(existing.visual_evidence ?? []).includes(e));
        existing.visual_evidence = [...(existing.visual_evidence ?? []), ...newEvidence].slice(0, MAX_VISUAL_EVIDENCE_ENTRIES);
      }
    }
  }

  // Determine overall roof material (most common with highest confidence)
  const materials = successfulResults
    .filter(r => r.roof_material)
    .map(r => r.roof_material!);

  const materialVotes = materials.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + m.confidence;
    return acc;
  }, {} as Record<string, number>);

  const topMaterial = Object.entries(materialVotes)
    .sort(([, a], [, b]) => b - a)[0];

  const roofMaterial = topMaterial ? {
    type: topMaterial[0],
    confidence: Math.round(topMaterial[1] / materials.filter(m => m.type === topMaterial[0]).length),
    characteristics: [...new Set(materials.filter(m => m.type === topMaterial[0]).flatMap(m => m.characteristics))],
  } : null;

  // Calculate overall condition. Only results whose overall_condition maps to a
  // known tier contribute to the average — a partial result with a missing or
  // unrecognized condition is skipped so it can't poison the mean with NaN.
  const conditionScores = successfulResults
    .map(r => CONDITION_SCORES[r.overall_condition as string])
    .filter((s): s is number => Number.isFinite(s));
  const avgCondition = conditionScores.length > 0
    ? conditionScores.reduce((sum, s) => sum + s, 0) / conditionScores.length
    : NaN;
  const overallCondition = Object.entries(CONDITION_SCORES)
    .find(([, score]) => Math.abs(score - avgCondition) < CONDITION_MATCH_THRESHOLD)?.[0] as any || OVERALL_CONDITION_DEFAULT;

  // Combine recommendations (skip results lacking a recommendations array).
  const allRecommendations = [...new Set(
    successfulResults.flatMap(r => Array.isArray(r.recommendations) ? r.recommendations : [])
  )];

  // Preserve raw_analysis from the first successful result (for age estimation)
  const rawAnalysis = successfulResults.find(r => r.raw_analysis)?.raw_analysis;

  return {
    success: true,
    image_quality: COMBINED_IMAGE_QUALITY, // Aggregate analysis typically has better quality
    roof_material: roofMaterial,
    damages_detected: allDamages,
    overall_condition: overallCondition,
    overall_severity_score: calculateSeverityScore(allDamages),
    insurance_claim_recommended: allDamages.some(d => d.insurance_claim_worthy),
    summary: `${COMBINED_SUMMARY_PREFIX}${successfulResults.length}${COMBINED_SUMMARY_INFIX}${allDamages.length}${COMBINED_SUMMARY_SUFFIX}`,
    detailed_findings: successfulResults.map(r => r.detailed_findings).filter(Boolean).join(DETAILED_FINDINGS_SEPARATOR),
    recommendations: allRecommendations,
    model_used: successfulResults[0].model_used || MODEL_USED_FALLBACK,
    processing_time_ms: sumProcessingTime(safeResults),
    raw_analysis: rawAnalysis, // Preserve for age estimation
  };
}

/**
 * Correlate findings across multiple images for cross-photo reasoning
 */
export async function correlateMultiImageFindings(
  results: RoofAnalysisResult[],
  apiKey: string
): Promise<{ correlations: string; crossPhotoPatterns: string[] }> {
  const successfulResults = results.filter(r => r.success && r.damages_detected.length > 0);
  if (successfulResults.length < CORRELATE_MIN_PHOTOS) {
    return { ...CORRELATE_EMPTY_RESULT };
  }

  const damageSummaries = successfulResults.map((r, i) => {
    const damages = r.damages_detected.map(d =>
      `${CORRELATE_DAMAGE_LINE_PREFIX}${d.damage_name}${CORRELATE_OPEN_PAREN}${d.severity}${CORRELATE_SEVERITY_INFIX}${d.confidence}${CORRELATE_CONFIDENCE_SUFFIX}${CORRELATE_CLOSE_PAREN}${CORRELATE_LOCATION_PREFIX}${d.location_description}`
    ).join(CORRELATE_LINE_SEPARATOR);
    return `${CORRELATE_PHOTO_PREFIX}${i + 1}${CORRELATE_OPEN_PAREN}${r.overall_condition}${CORRELATE_CONDITION_LABEL_INFIX}${CORRELATE_LINE_SEPARATOR}${damages}`;
  }).join(CORRELATE_BLOCK_SEPARATOR);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `${BEARER_PREFIX}${apiKey}`,
        'Content-Type': CONTENT_TYPE_JSON,
      },
      body: JSON.stringify({
        model: GROQ_VISION_MODELS.LLAMA4_SCOUT,
        messages: [
          {
            role: 'system',
            content: CORRELATE_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: `${CORRELATE_USER_PROMPT_PREFIX}${successfulResults.length}${CORRELATE_USER_PROMPT_INFIX}${damageSummaries}`,
          }
        ],
        max_tokens: QUICK_MAX_TOKENS,
        temperature: CORRELATE_TEMPERATURE,
        response_format: JSON_OBJECT_RESPONSE_FORMAT,
      }),
    });

    if (!response.ok) {
      return { ...CORRELATE_EMPTY_RESULT };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    return {
      correlations: parsed.correlations || '',
      crossPhotoPatterns: parsed.crossPhotoPatterns || parsed.cross_photo_patterns || [],
    };
  } catch {
    return { ...CORRELATE_EMPTY_RESULT };
  }
}

/**
 * Quick damage check - faster analysis for initial screening
 */
export async function quickDamageCheck(
  imageUrl: string,
  apiKey: string
): Promise<{
  has_damage: boolean;
  damage_count: number;
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  needs_detailed_analysis: boolean;
}> {
  const result = await analyzeRoofImage(imageUrl, apiKey, {
    model: GROQ_VISION_MODELS.LLAMA4_SCOUT, // Fast model for quick check
    max_tokens: QUICK_MAX_TOKENS,
  });

  const damageCount = result.damages_detected.length;
  const hasSevere = result.damages_detected.some(d => QUICK_SEVERE_VALUES.has(d.severity));
  const hasModerate = result.damages_detected.some(d => d.severity === QUICK_MODERATE_VALUE);

  return {
    has_damage: damageCount > 0,
    damage_count: damageCount,
    severity: hasSevere ? QUICK_SEVERITY_SEVERE : hasModerate ? QUICK_SEVERITY_MODERATE : damageCount > 0 ? QUICK_SEVERITY_MINOR : QUICK_SEVERITY_NONE,
    needs_detailed_analysis: hasSevere || damageCount >= QUICK_CHECK_DETAILED_THRESHOLD,
  };
}

/**
 * Focused analysis pass for commonly missed roof accessories and penetrations
 */
export async function analyzeAccessories(
  imageUrl: string,
  apiKey: string
): Promise<DamageDetection[]> {
  try {
    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `${BEARER_PREFIX}${apiKey}`,
        'Content-Type': CONTENT_TYPE_JSON,
      },
      body: JSON.stringify({
        model: GROQ_VISION_MODELS.LLAMA4_SCOUT,
        messages: [
          {
            role: 'system',
            content: ACCESSORIES_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: ACCESSORIES_USER_PROMPT },
              { type: 'image_url', image_url: { url: base64ImageUrl } },
            ],
          },
        ],
        max_tokens: ACCESSORIES_MAX_TOKENS,
        temperature: ACCESSORIES_TEMPERATURE,
        response_format: JSON_OBJECT_RESPONSE_FORMAT,
      }),
    });

    if (!response.ok) return [...ACCESSORIES_EMPTY_RESULT];

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const accessories = parsed.accessories_found || [];

    return accessories.map((d: any) => ({
      damage_type_id: d.type_id || ACCESSORY_DEFAULT_TYPE_ID,
      damage_name: d.name || ACCESSORY_DEFAULT_NAME,
      category: d.category || ACCESSORY_DEFAULT_CATEGORY,
      confidence: d.confidence || ACCESSORY_DEFAULT_CONFIDENCE,
      severity: d.severity || ACCESSORY_DEFAULT_SEVERITY,
      location_description: d.location || ACCESSORY_DEFAULT_LOCATION,
      visual_evidence: d.evidence || [],
      haag_compliant: false,
      insurance_claim_worthy: d.insurance_worthy ?? false,
      repair_recommendation: d.repair_urgency === 'immediate' ? ACCESSORY_REPAIR_IMMEDIATE : ACCESSORY_REPAIR_DEFAULT,
      estimated_urgency: d.repair_urgency || ACCESSORY_DEFAULT_URGENCY,
    }));
  } catch {
    return [...ACCESSORIES_EMPTY_RESULT];
  }
}
