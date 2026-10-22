/**
 * Groq Vision API Integration for Roofing Damage Analysis
 * Uses LLaVA and Llama 3.2 Vision models for fast image analysis
 */

import {
  DAMAGE_TYPES,
  ROOFING_MATERIALS,
  type DamageType,
  type DamageCategory,
} from './damage-knowledge-base.js';
import { assertSafeExternalUrl } from './safe-fetch-url.js';

// Groq API configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Hard ceilings so a single slow/hung call can never stall report generation.
// (A report-desk request that hangs here sits in 'generating' forever.)
const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.VISION_IMAGE_TIMEOUT_MS || 20_000);
const VISION_API_TIMEOUT_MS = Number(process.env.VISION_API_TIMEOUT_MS || 45_000);

/** fetch() that always rejects after `ms` instead of hanging indefinitely. */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a promise or reject after `ms` (for SDK calls that take no AbortSignal). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// Available vision models on Groq (updated 2025)
// Note: Llama 3.2 vision models were deprecated, use Llama 4 models
export const GROQ_VISION_MODELS = {
  // Llama 4 Scout - 17B active params, 16 experts, ~460 tokens/s
  LLAMA4_SCOUT: 'meta-llama/llama-4-scout-17b-16e-instruct',
  // Llama 4 Maverick - 17B active params, 128 experts, highest quality
  LLAMA4_MAVERICK: 'meta-llama/llama-4-maverick-17b-128e-instruct',
  // RETIRED on Groq — kept only so old env values fail loudly rather than
  // silently selecting a model that no longer exists. Do not use.
  LLAVA: 'llava-v1.5-7b-4096-preview',
  LLAMA_VISION: 'llama-3.2-11b-vision-preview',
  LLAMA_VISION_90B: 'llama-3.2-90b-vision-preview',
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
- Debris accumulation: Leaves, branches on surface`;

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

  if (options.include_haag_assessment) {
    prompt += `

## HAAG Insurance Assessment:
- Hail damage: Random dent pattern, soft spots when pressed, granule displacement in impact area
- Wind damage: Creased shingles, lifted tabs, missing shingles in consistent pattern
- Distinguish storm damage from normal wear (storm = sudden, concentrated; wear = gradual, uniform)`;
  }

  prompt += `

## Response Format (JSON):
{
  "image_quality": "excellent|good|fair|poor",
  "roof_material": {
    "type": "asphalt_shingle|metal|tile|slate|wood_shake|flat_membrane|other",
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
      "type_id": "MUST be one of: missing_shingles, cracked_shingles, curled_shingles, hail_damage, granule_loss, flashing_damage, chimney_flashing_damage, valley_damage, pipe_boot_cracked, ridge_cap_damage, vent_damage, skylight_damage, decking_damage, gutter_damage, fascia_damage, active_leak, wind_damage",
      "name": "What the damage is",
      "category": "hail|wind|water|age_wear|structural|flashing|biological|debris",
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

CRITICAL: every "type_id" MUST come from the list above — those ids drive the
repair pricing, and an id outside the list produces a $0 estimate. Pick the
closest one; use the "name" field for the specific wording.

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

  // This is our own server fetching a URL that ultimately traces back to a
  // rep's pasted "extra photo URL" — reject anything that resolves to our
  // own internal network before making the request.
  await assertSafeExternalUrl(imageUrl);

  // A browser-like User-Agent + retry: R2's CDN (Cloudflare) intermittently rejects
  // the default Node/undici fetch under rapid bursts ("fetch failed"), so retry a
  // couple of times with a short backoff.
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchWithTimeout(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BRN-ReportDesk/1.0)', Accept: 'image/*' },
      }, IMAGE_FETCH_TIMEOUT_MS);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (error: any) {
      lastErr = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  console.error('[groq-vision] Failed to convert image to base64:', lastErr?.message);
  throw lastErr;
}

/**
 * Preferred vision model first, then the cheaper one. If a model is retired or
 * not enabled on the account, Groq answers 404/400 for EVERY image — which
 * silently turned whole reports into "no damage detected". Trying the next model
 * keeps the feature working instead of failing the entire inspection.
 */
export function visionModelChain(preferred?: string): string[] {
  const first = preferred || process.env.GROQ_REPORT_MODEL || GROQ_VISION_MODELS.LLAMA4_MAVERICK;
  return [...new Set([first, GROQ_VISION_MODELS.LLAMA4_MAVERICK, GROQ_VISION_MODELS.LLAMA4_SCOUT])];
}

/** A model-availability failure (as opposed to a bad image, rate limit or outage). */
export function isModelUnavailable(message: string): boolean {
  const m = String(message || '');
  // Rate limits and server errors are transient — retrying on another model just
  // burns quota, so never treat those as "this model is unusable".
  if (/\b(429|5\d{2})\b/.test(m)) return false;
  // "400 when fetching image from URL" is the PHOTO failing, not the model — it
  // fails identically everywhere, so don't walk the chain over it.
  if (/fetching image/i.test(m)) return false;
  return (
    /model[\s\S]{0,40}?(not[ _]?found|does not exist|decommissioned|deprecated|unavailable|invalid)/i.test(m) ||
    /\bmodel_(not_found|decommissioned)\b/i.test(m) ||
    /\b(404|400)\b/.test(m)
  );
}

/**
 * Should we try the next model? Broader than isModelUnavailable: a model that
 * answers but won't produce parseable JSON is just as useless for a report, and
 * treating that as fatal meant one chatty model emptied the whole inspection.
 * A bad photo still fails everywhere, so those stop the walk.
 */
export function isRetryableModelFailure(message: string): boolean {
  return isModelUnavailable(message) || /could not parse|empty response|response format/i.test(String(message || ''));
}

// ---- fal.ai router (primary) -------------------------------------------------
// Groq's account here has no access to any Llama 4 vision model (404
// model_not_found for every image), so damage analysis runs through fal.ai's
// OpenAI-compatible router instead. Default is the flagship Qwen3-VL — a
// purpose-built vision model, and cheap on input ($0.21/M) — with Llama 4
// Maverick as the fallback. Override with REPORT_VISION_MODEL.
const FAL_ROUTER_URL = 'https://fal.run/openrouter/router/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const REPORT_VISION_MODEL = 'qwen/qwen3-vl-235b-a22b-instruct';
export const REPORT_VISION_FALLBACK = 'meta-llama/llama-4-maverick';

export type VisionProvider = 'fal' | 'openrouter';

const falKey = (): string | undefined => process.env.FAL_AI_API_KEY || process.env.FAL_KEY;

/**
 * Every provider/model combination worth trying, best first. Two reports came
 * back "no damage detected" because a single hardcoded model id 404'd on the
 * account, so nothing is assumed here — if one combination isn't available the
 * next is tried, and the logs name whichever one worked.
 */
export function visionAttempts(preferred?: string): Array<{ provider: VisionProvider; model: string }> {
  const models = [preferred, process.env.REPORT_VISION_MODEL, REPORT_VISION_MODEL, REPORT_VISION_FALLBACK]
    .filter((m): m is string => !!m)
    .filter((m, i, all) => all.indexOf(m) === i);
  const providers: VisionProvider[] = [];
  if (falKey()) providers.push('fal');
  if (process.env.OPENROUTER_API_KEY) providers.push('openrouter');
  return providers.flatMap((provider) => models.map((model) => ({ provider, model })));
}
export function falVisionConfigured(): boolean {
  return !!(falKey() || process.env.OPENROUTER_API_KEY);
}

/**
 * Analyze one image through the fal.ai router. Public image URLs are passed
 * straight through — no base64 round-trip — which is both faster and avoids the
 * payload limits that base64 hits.
 */
export async function analyzeRoofImageViaFal(
  imageUrl: string,
  options: AnalysisOptions & { provider?: VisionProvider } = {},
): Promise<RoofAnalysisResult> {
  const startTime = Date.now();
  const model = (options.model as string) || process.env.REPORT_VISION_MODEL || REPORT_VISION_MODEL;
  const fk = falKey();
  const provider: VisionProvider = options.provider || (fk ? 'fal' : 'openrouter');
  const url = provider === 'fal' ? FAL_ROUTER_URL : OPENROUTER_URL;
  // fal authenticates with `Key <token>`, OpenRouter with a bearer token.
  const auth = provider === 'fal' ? `Key ${fk}` : `Bearer ${process.env.OPENROUTER_API_KEY}`;

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'X-Title': 'Best Roofing Now Reports' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: options.max_tokens || 2400,
        messages: [
          { role: 'system', content: buildSystemPrompt(options) },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Please analyze this roof image for damage. Provide a comprehensive assessment following the JSON format specified.' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    }, VISION_API_TIMEOUT_MS);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Vision API error: ${res.status} - ${body.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    if (!raw) throw new Error('Vision API returned an empty response');

    const result = parseAnalysisResponse(raw, `${provider}:${model}`, Date.now() - startTime);
    result.raw_analysis = raw;
    return result;
  } catch (error: any) {
    console.error(`[vision:${provider}] Analysis failed (model=${model}):`, error?.message || error);
    return {
      success: false,
      image_quality: 'poor',
      roof_material: null,
      damages_detected: [],
      overall_condition: 'poor',
      overall_severity_score: 0,
      insurance_claim_recommended: false,
      summary: `Analysis failed: ${error?.message || error}`,
      detailed_findings: '',
      recommendations: ['Unable to analyze image.'],
      model_used: model,
      processing_time_ms: Date.now() - startTime,
    };
  }
}

/**
 * Analyze a roof image. Prefers the fal.ai router (Qwen3-VL, then Llama 4
 * Maverick); falls back to Groq only if fal isn't configured or fails.
 */
export async function analyzeRoofImage(
  imageUrl: string,
  apiKey: string,
  options: AnalysisOptions = {}
): Promise<RoofAnalysisResult> {
  let last: RoofAnalysisResult | null = null;
  for (const attempt of visionAttempts(options.model as string | undefined)) {
    const r = await analyzeRoofImageViaFal(imageUrl, { ...options, provider: attempt.provider, model: attempt.model as any });
    if (r.success) return r;
    last = r;
    // A bad photo fails on every provider — only keep walking when the MODEL
    // is the problem (that's what silently emptied every past report).
    if (!isRetryableModelFailure(r.summary || '')) return r;
    console.warn(`[vision] ${attempt.provider}:${attempt.model} unusable, trying next`);
  }
  if (apiKey) return analyzeRoofImageViaGroq(imageUrl, apiKey, options);
  return last || analyzeRoofImageViaFal(imageUrl, options);
}

/** Groq path (kept as a secondary provider). */
export async function analyzeRoofImageViaGroq(
  imageUrl: string,
  apiKey: string,
  options: AnalysisOptions = {}
): Promise<RoofAnalysisResult> {
  const chain = visionModelChain(options.model);
  let last: RoofAnalysisResult | null = null;
  for (const model of chain) {
    const result = await analyzeRoofImageWithModel(imageUrl, apiKey, { ...options, model: model as GroqVisionModel });
    if (result.success) return result;
    last = result;
    // Only walk the chain for "this model isn't usable" — not for a bad image.
    if (!isModelUnavailable(result.summary || '')) break;
    console.warn(`[groq-vision] ${model} unusable, trying next model`);
  }
  return last as RoofAnalysisResult;
}

async function analyzeRoofImageWithModel(
  imageUrl: string,
  apiKey: string,
  options: AnalysisOptions = {}
): Promise<RoofAnalysisResult> {
  const startTime = Date.now();
  // Maverick is natively multimodal (128 experts) where Scout's vision is still
  // preview, and damage accuracy is the whole point — it drives the estimate and
  // what a customer is told. The cost difference is ~1¢ vs ~0.3¢ per report, so
  // quality wins easily here. Override with GROQ_REPORT_MODEL.
  const model = options.model || process.env.GROQ_REPORT_MODEL || GROQ_VISION_MODELS.LLAMA4_MAVERICK;

  if (!apiKey) {
    throw new Error('Groq API key is required');
  }

  const systemPrompt = buildSystemPrompt(options);

  try {
    // Convert image URL to base64 for Groq Vision API
    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    const fetchResponse = await fetchWithTimeout(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
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
                text: 'Please analyze this roof image for damage. Provide a comprehensive assessment following the JSON format specified.',
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
        max_tokens: options.max_tokens || 4096,
        temperature: options.temperature || 0.1, // Low temperature for consistent analysis
      }),
    }, VISION_API_TIMEOUT_MS);
    const response = fetchResponse as any;

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
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    // Log it: this used to be swallowed, so every image silently came back
    // "Unable to analyze" with no clue why.
    console.error(`[groq-vision] Analysis failed (model=${model}):`, error?.message || error);
    return {
      success: false,
      image_quality: 'poor',
      roof_material: null,
      damages_detected: [],
      overall_condition: 'poor',
      overall_severity_score: 0,
      insurance_claim_recommended: false,
      summary: `Analysis failed: ${error.message}`,
      detailed_findings: '',
      recommendations: ['Unable to analyze image. Please try again with a clearer image.'],
      raw_analysis: error.message,
      model_used: model,
      processing_time_ms: processingTime,
    };
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
  geminiApiKey: string
): Promise<RoofAnalysisResult> {
  const startTime = Date.now();
  // gemini-3.5-flash is not a real model id; the current vision-capable Flash model is 2.5.
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

  try {
    // Convert image URL to base64
    // Debug:('[gemini-vision] Converting image to base64 for Gemini...');
    const base64ImageUrl = await imageUrlToBase64(imageUrl);

    // Extract base64 data and mime type from data URL
    const matches = base64ImageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 data URL format');
    }
    const [, mimeType, base64Data] = matches;

    const prompt = `You are an expert roofing inspection AI using HAAG Engineering standards. Analyze this roof image and identify ALL visible damage, wear, or issues.

HAAG CONDITION RATING SYSTEM:
- Good (G): No significant damage, minor cosmetic issues only
- Fair (F): Moderate wear/damage, repairs recommended within 3-6 months
- Poor (P): Significant damage, replacement or immediate repair recommended

IMPORTANT: Look carefully at every part of the image. Report ANY potential damage, even if you're not 100% certain. Use HAAG G/F/P terminology for condition ratings.

Analyze and return JSON:
{
  "image_quality": "excellent|good|fair|poor",
  "roof_material": {
    "type": "asphalt_shingle|metal|tile|slate|wood_shake|flat_membrane|other",
    "confidence": 0-100,
    "characteristics": ["what identifies this material"]
  },
  "estimated_age": {
    "years": 0-50,
    "confidence": "low|medium|high",
    "indicators": ["age signs you observe"]
  },
  "damages": [
    {
      "type_id": "damage_type",
      "name": "damage description",
      "category": "hail|wind|water|age_wear|structural|flashing|biological|debris",
      "confidence": 0-100,
      "severity": "minor|moderate|severe|critical",
      "haag_condition": "good|fair|poor",
      "location": "where in the image",
      "evidence": ["what you see"],
      "insurance_worthy": true|false,
      "repair_urgency": "immediate|soon|monitor|cosmetic"
    }
  ],
  "overall_condition": "excellent|good|fair|poor|critical",
  "haag_overall_grade": "good|fair|poor",
  "severity_score": 0-100,
  "claim_recommended": true|false,
  "summary": "brief assessment using HAAG terminology",
  "recommendations": ["suggested actions with timeframes"]
}

Look for: missing shingles, granule loss, curling, cracks, lifted edges, stains, moss/algae, damaged flashing, holes, sagging.
Return ONLY valid JSON.`;

    // Dynamic import to avoid bundling issues
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const result = await withTimeout(ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Data,
                mimeType,
              },
            },
          ],
        },
      ],
    }), VISION_API_TIMEOUT_MS, 'gemini-vision') as any;

    const responseText = result?.text || '';
    const processingTime = Date.now() - startTime;

    // Debug:('[gemini-vision] Response received, processing time:', processingTime, 'ms');

    // Parse the response
    const parsed = parseAnalysisResponse(responseText, model, processingTime);
    parsed.raw_analysis = responseText;

    return parsed;
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error('[gemini-vision] Analysis failed:', error.message);
    return {
      success: false,
      image_quality: 'poor',
      roof_material: null,
      damages_detected: [],
      overall_condition: 'poor',
      overall_severity_score: 0,
      insurance_claim_recommended: false,
      summary: `Gemini analysis failed: ${error.message}`,
      detailed_findings: '',
      recommendations: ['Unable to analyze with Gemini. Please try again.'],
      raw_analysis: error.message,
      model_used: model,
      processing_time_ms: processingTime,
    };
  }
}

/**
 * Analyze roof image with automatic fallback
 * Tries Groq first, falls back to Gemini if no damage detected
 */
export async function analyzeRoofImageWithFallback(
  imageUrl: string,
  groqApiKey: string,
  geminiApiKey?: string,
  options: AnalysisOptions = {}
): Promise<RoofAnalysisResult> {
  // First try Groq Vision
  // Debug:('[vision] Analyzing with Groq Vision (primary)...');
  const groqResult = await analyzeRoofImage(imageUrl, groqApiKey, options);

  // If Groq succeeded AND found damage, return it
  if (groqResult.success && groqResult.damages_detected.length > 0) {
    // Debug:('[vision] Groq succeeded with', groqResult.damages_detected.length, 'damages, returning result');
    return groqResult;
  }

  // If no Gemini key available, return Groq result (even if failed)
  if (!geminiApiKey) {
    // Debug:('[vision] No Gemini key available, returning Groq result (success:', groqResult.success, ')');
    return groqResult;
  }

  // If Groq failed or found no damage, try Gemini as fallback
  // Debug:('[vision] Groq', groqResult.success ? 'found no damage' : 'failed', '- trying Gemini fallback...');
  const geminiResult = await analyzeRoofImageWithGemini(imageUrl, geminiApiKey);

  // If Gemini found damage, return combined result
  if (geminiResult.damages_detected.length > 0) {
    // Debug:('[vision] Gemini found', geminiResult.damages_detected.length, 'damages');
    // Mark that this used fallback
    geminiResult.model_used = `${groqResult.model_used} + ${geminiResult.model_used} (fallback)`;
    geminiResult.processing_time_ms = groqResult.processing_time_ms + geminiResult.processing_time_ms;
    return geminiResult;
  }

  // Both found no damage - return Groq result (likely genuinely clean roof)
  // Debug:('[vision] Both providers found no damage - roof appears clean');
  groqResult.summary = 'No visible damage detected. Roof appears to be in good condition.';
  return groqResult;
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
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
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

    // Map damages to our structure
    const damages: DamageDetection[] = (parsed.damages || []).map((d: any) => {
      const damageType = DAMAGE_TYPES.find(dt => dt.id === d.type_id);
      return {
        damage_type_id: d.type_id || 'unknown',
        damage_name: d.name || damageType?.name || 'Unknown Damage',
        category: d.category || damageType?.category || 'unknown',
        confidence: d.confidence || 50,
        severity: d.severity || 'moderate',
        location_description: d.location || 'Unspecified location',
        visual_evidence: d.evidence || [],
        haag_compliant: d.haag_compliant ?? false,
        insurance_claim_worthy: d.insurance_worthy ?? false,
        repair_recommendation: getRepairRecommendation(d.severity, damageType),
        estimated_urgency: d.repair_urgency || damageType?.repair_urgency || 'monitor',
      };
    });

    return {
      success: true,
      image_quality: parsed.image_quality || 'fair',
      roof_material: parsed.roof_material || null,
      damages_detected: damages,
      overall_condition: parsed.overall_condition || 'fair',
      overall_severity_score: parsed.severity_score || calculateSeverityScore(damages),
      insurance_claim_recommended: parsed.claim_recommended ?? damages.some(d => d.insurance_claim_worthy),
      summary: parsed.summary || 'Analysis complete.',
      detailed_findings: parsed.detailed_findings || '',
      recommendations: parsed.recommendations || [],
      model_used: model,
      processing_time_ms: processingTime,
    };
  } catch (parseError: any) {
    // JSON parsing failed - log the error and return failure status
    console.error('[groq-vision] JSON parse failed:', parseError?.message || parseError);
    console.error('[groq-vision] Raw response (first 500 chars):', rawResponse.substring(0, 500));

    return {
      success: false,  // Signal failure so fallback can be triggered
      image_quality: 'fair',
      roof_material: null,
      damages_detected: [],
      overall_condition: 'fair',
      overall_severity_score: 0,
      insurance_claim_recommended: false,
      summary: 'Analysis failed: Could not parse AI response. Trying fallback...',
      detailed_findings: rawResponse,
      recommendations: ['AI response format error - manual review recommended.'],
      raw_analysis: rawResponse,  // Preserve for debugging
      model_used: model,
      processing_time_ms: processingTime,
    };
  }
}

/**
 * Get repair recommendation based on severity and damage type
 */
function getRepairRecommendation(
  severity: string,
  damageType?: DamageType
): string {
  if (!damageType) {
    switch (severity) {
      case 'critical':
        return 'Immediate professional repair required';
      case 'severe':
        return 'Schedule repair within 1-2 weeks';
      case 'moderate':
        return 'Plan repair within 1-3 months';
      default:
        return 'Monitor and address during next maintenance';
    }
  }

  const severityLevel = damageType.severity_levels.find(s => s.level === severity);
  return severityLevel?.typical_repair || 'Consult with roofing professional';
}

/**
 * Calculate overall severity score from damages
 */
function calculateSeverityScore(damages: DamageDetection[]): number {
  if (damages.length === 0) return 0;

  const severityWeights: Record<string, number> = {
    critical: 100,
    severe: 75,
    moderate: 50,
    minor: 25,
  };

  const weightedSum = damages.reduce((sum, d) => {
    const weight = severityWeights[d.severity] || 50;
    const confidenceFactor = d.confidence / 100;
    return sum + (weight * confidenceFactor);
  }, 0);

  // Normalize to 0-100, with diminishing returns for multiple damages
  const normalized = Math.min(100, weightedSum / Math.sqrt(damages.length));
  return Math.round(normalized);
}

/**
 * Batch analyze multiple images
 */
export async function analyzeMultipleImages(
  imageUrls: string[],
  apiKey: string,
  options: AnalysisOptions = {},
  budget: { deadline?: number } = {},
): Promise<RoofAnalysisResult[]> {
  const results: RoofAnalysisResult[] = [];
  // The whole report must finish inside the serverless function's 300s limit.
  // Three-at-a-time meant 8 photos took three sequential rounds of up to 45s
  // each, which blew the budget and left the row stuck "running" forever.
  const batchSize = Math.max(1, Number(process.env.VISION_BATCH_SIZE) || 12);

  // Real jobs carry 100 photos, so the run can no longer be assumed to fit.
  // Stop starting NEW rounds once the deadline is close and return what was
  // analysed: a report built on 60 of 99 photos is useful and honest, a
  // report that hangs past 300s is neither. The caller reports the shortfall.
  const deadline = budget.deadline ?? Infinity;

  for (let i = 0; i < imageUrls.length; i += batchSize) {
    if (Date.now() >= deadline) {
      console.warn(`[vision] time budget reached — analysed ${results.length} of ${imageUrls.length} photos`);
      break;
    }
    const batch = imageUrls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(url => analyzeRoofImage(url, apiKey, options))
    );
    results.push(...batchResults);

    // Small delay between batches
    if (i + batchSize < imageUrls.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Combine results from multiple images into a comprehensive report
 */
export function combineAnalysisResults(results: RoofAnalysisResult[]): RoofAnalysisResult {
  const successfulResults = results.filter(r => r.success);

  if (successfulResults.length === 0) {
    return {
      success: false,
      image_quality: 'poor',
      roof_material: null,
      damages_detected: [],
      overall_condition: 'poor',
      overall_severity_score: 0,
      insurance_claim_recommended: false,
      summary: 'No images could be analyzed successfully.',
      detailed_findings: '',
      recommendations: ['Please provide clearer images for analysis.'],
      model_used: results[0]?.model_used || 'unknown',
      processing_time_ms: results.reduce((sum, r) => sum + r.processing_time_ms, 0),
    };
  }

  // Aggregate damages, deduplicating similar findings
  const allDamages: DamageDetection[] = [];
  const seenDamages = new Set<string>();

  for (const result of successfulResults) {
    for (const damage of result.damages_detected) {
      const key = `${damage.damage_type_id}-${damage.location_description}`;
      if (!seenDamages.has(key)) {
        seenDamages.add(key);
        allDamages.push(damage);
      } else {
        // Update confidence if we see the same damage in multiple images
        const existing = allDamages.find(d =>
          d.damage_type_id === damage.damage_type_id &&
          d.location_description === damage.location_description
        );
        if (existing) {
          existing.confidence = Math.min(100, existing.confidence + 10);
        }
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

  // Calculate overall condition
  const conditions = successfulResults.map(r => r.overall_condition);
  const conditionScores: Record<string, number> = {
    excellent: 5,
    good: 4,
    fair: 3,
    poor: 2,
    critical: 1,
  };
  const avgCondition = conditions.reduce((sum, c) => sum + conditionScores[c], 0) / conditions.length;
  const overallCondition = Object.entries(conditionScores)
    .find(([, score]) => Math.abs(score - avgCondition) < 0.5)?.[0] as any || 'fair';

  // Combine recommendations
  const allRecommendations = [...new Set(successfulResults.flatMap(r => r.recommendations))];

  // Preserve raw_analysis from the first successful result (for age estimation)
  const rawAnalysis = successfulResults.find(r => r.raw_analysis)?.raw_analysis;

  return {
    success: true,
    image_quality: 'good', // Aggregate analysis typically has better quality
    roof_material: roofMaterial,
    damages_detected: allDamages,
    overall_condition: overallCondition,
    overall_severity_score: calculateSeverityScore(allDamages),
    insurance_claim_recommended: allDamages.some(d => d.insurance_claim_worthy),
    summary: `Combined analysis of ${successfulResults.length} images. Found ${allDamages.length} damage instances.`,
    detailed_findings: successfulResults.map(r => r.detailed_findings).filter(Boolean).join('\n\n'),
    recommendations: allRecommendations,
    model_used: successfulResults[0].model_used,
    processing_time_ms: results.reduce((sum, r) => sum + r.processing_time_ms, 0),
    raw_analysis: rawAnalysis, // Preserve for age estimation
  };
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
    // Scout, not LLaVA: the LLaVA/Llama-3.2 preview models are retired on Groq
    // and would fail outright. Scout is the cheap/fast one for a triage pass.
    model: GROQ_VISION_MODELS.LLAMA4_SCOUT,
    max_tokens: 1024,
  });

  const damageCount = result.damages_detected.length;
  const hasSevere = result.damages_detected.some(d =>
    d.severity === 'severe' || d.severity === 'critical'
  );
  const hasModerate = result.damages_detected.some(d => d.severity === 'moderate');

  return {
    has_damage: damageCount > 0,
    damage_count: damageCount,
    severity: hasSevere ? 'severe' : hasModerate ? 'moderate' : damageCount > 0 ? 'minor' : 'none',
    needs_detailed_analysis: hasSevere || damageCount >= 3,
  };
}
