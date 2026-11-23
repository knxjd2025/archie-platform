/**
 * Claude Report Narrator — Generates professional inspector-quality narrative findings
 * from raw AI damage detection data using Claude Sonnet.
 *
 * Also generates executive summaries that read like a HAAG-certified inspector wrote them.
 */

import type {
  AnalyzedPhoto,
  DamageAnalysisSection,
  StormSummarySection,
  NarrativeFinding,
  FindingSeverity,
} from './comprehensive-roof-report.js';
import { sanitizePromptText } from './prompt-sanitize.js';
import { callerFor, describeModelError, plainDashes, type ModelOptions } from './model-call.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NarratorInput {
  analyzedPhotos: AnalyzedPhoto[];
  damageAnalysis: DamageAnalysisSection;
  stormHistory?: StormSummarySection;
  roofDetails?: {
    type?: string;
    squares?: number;
    pitch?: string;
    stories?: number;
    material?: string;
    age_years?: number;
  };
  inspectorNotes?: string;
}

interface NarratorOutput {
  findings: NarrativeFinding[];
  executiveSummary: string;
}

// ─── Logging / formatting constants ────────────────────────────────────
/** Prefix for every log line emitted by this module. Mirrors the labeler so log filters can scope by module. */
const LOG_PREFIX = '[report-narrator]';
/** Bounded slice length for short error context (e.g. JSON head). */
const ERR_HEAD_LEN_SHORT = 200;
/** Bounded slice length for long error context (e.g. raw API response body). */
const ERR_HEAD_LEN_LONG = 500;
/** Sentinel key for damages that arrived without a `type` field. */
const DEFAULT_DAMAGE_KEY = 'unknown';
/** Worst-severity initial value when no damage has been seen yet. */
const LOWEST_SEVERITY = 'low';
/** Fallback rank when a severity isn't in `SEVERITY_ORDER_WORST_FIRST`.
 *  Equal to the index of `'low'` (3) + 1, so unknown severities sort
 *  *after* `low` rather than mixing in with it. */
const SEVERITY_RANK_FALLBACK = 4;
/** Cap on descriptions stitched into a fallback narrative — keeps each
 *  finding readable when 30 photos all describe the same defect. */
const MAX_DESCRIPTIONS_IN_NARRATIVE = 2;

// ─── Prompt-injection / control-char hardening ────────────────────────
// Every user- or vision-derived text field interpolated into the Claude
// prompt is first run through `sanitizePromptText` (strips ASCII control
// chars / terminal escapes and caps length) so a malicious inspector note,
// damage description, or vision summary cannot inject control characters or
// blow out the prompt budget. The caps below are generous enough that
// ordinary inspector prose / vision captions pass through untouched.
/** Cap for a free-form inspector note. */
const SANITIZE_NOTES_MAX = 4000;
/** Cap for a single vision-derived AI photo summary. */
const SANITIZE_AI_SUMMARY_MAX = 2000;
/** Cap for a single damage description / caption. */
const SANITIZE_DESCRIPTION_MAX = 1000;
/** Cap for a damage type/label token (used as a grouping key + display label). */
const SANITIZE_DAMAGE_KEY_MAX = 120;
/** Cap for a short roof-detail string (material / type / pitch). */
const SANITIZE_ROOF_FIELD_MAX = 120;

/** Strip control chars + length-cap an optional untrusted string for prompt
 *  interpolation. Non-string / empty inputs collapse to `''` (same as the
 *  underlying `sanitizePromptText`). */
function sanitizeField(text: string | undefined | null, maxLen: number): string {
  return sanitizePromptText(typeof text === 'string' ? text : '', maxLen);
}

// ─── Regex constants (hoisted so they aren't recompiled per call) ──────
/** Strip markdown fences from an LLM response. */
const MARKDOWN_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)```/g;
/** Greedy match for the outermost JSON object inside a response. */
const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;
/** Replace underscores with spaces — used in `damage_type` → "Damage Type" titles. */
const UNDERSCORE_REGEX = /_/g;
/** Word-boundary regex used to title-case each first letter. */
const WORD_BOUNDARY_REGEX = /\b\w/g;

/** Narrow `unknown` to a printable error message — replaces the unsafe
 *  `(error as Error).message` cast that we used to scatter at every catch. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Call budgets ─────────────────────────────────────────────────────────────
const MAX_TOKENS_NARRATIVE = 4096;
const MAX_TOKENS_REWRITE = 1024;

/** JSON-parse error templates — assembled in `parseClaudeJSONResponse`. */
const MSG_NO_JSON_FOUND_PREFIX = 'No JSON object found in the model reply. First ';
const MSG_NO_JSON_FOUND_INFIX = ' chars: ';
const MSG_JSON_PARSE_FAILED_PREFIX = 'Model JSON parse failed (';
const MSG_JSON_PARSE_FAILED_INFIX = '). Head: ';

/** Markdown-fence regex replacement reference (`'$1'` = first capture group). */
const MARKDOWN_FENCE_CAPTURE_REPLACEMENT = '$1';

/** Finding-id template + fallback title prefix used when Claude omits fields. */
const FINDING_ID_PREFIX = 'finding-';
const FALLBACK_FINDING_TITLE_PREFIX = 'Finding ';

/** Log infix labels for the success + failure paths. */
const LOG_GENERATED_INFIX = ' Generated ';
const LOG_FINDINGS_INFIX = ' finding(s) via ';
const LOG_ELAPSED_INFIX = ' in ';
const LOG_MS_SUFFIX = 'ms';
const LOG_TIMED_OUT_TEXT = 'Timed out / aborted';
const LOG_FAILED_TEXT = 'Failed';
const LOG_AFTER_INFIX = ' after ';
const LOG_AFTER_SUFFIX = 'ms:';

/** AbortError name + abort-substring used to detect a cancelled request. */
const ABORT_ERROR_NAME = 'AbortError';
const ABORT_ERROR_SUBSTRING = 'aborted';

/** Fallback narrative template fragments — assembled into:
 *  `'<descriptions> Found in N location(s) across M photo(s).'`. */
const FALLBACK_FOUND_IN_PREFIX = ' Found in ';
const FALLBACK_LOCATIONS_INFIX = ' location(s) across ';
const FALLBACK_PHOTOS_SUFFIX = ' photo(s).';
const FALLBACK_DESCRIPTIONS_JOINER = ' ';
/** Detected-fallback narrative — used when no description is available. */
const FALLBACK_DETECTED_INFIX = ' detected in ';
const FALLBACK_PROF_RECOMMENDED = ' Professional assessment recommended.';
/** Repair-action template fragments. */
const FALLBACK_REPAIR_PREFIX = 'Address ';
const FALLBACK_REPAIR_SUFFIX = '. Consult a roofing professional for repair options.';

/** Executive-summary condition phrases. */
const EXEC_REQUIRES_IMMEDIATE = 'requires immediate attention';
const EXEC_SHOWS_CONCERN = 'shows areas of concern';
const EXEC_ACCEPTABLE_CONDITION = 'is in generally acceptable condition';
/** Overall-severity tags compared against in the conditionWord ladder. */
const SEVERITY_TAG_CRITICAL = 'critical';
const SEVERITY_TAG_HIGH = 'high';
const SEVERITY_TAG_MEDIUM = 'medium';
/** Executive summary template fragments. */
const EXEC_SUMMARY_PREFIX = 'Inspection of ';
const EXEC_SUMMARY_PHOTOS_INFIX = ' photo(s) identified ';
const EXEC_SUMMARY_TYPES_INFIX = ' type(s) of damage. The roof ';
const EXEC_SUMMARY_SEVERITY_INFIX = ' with an overall severity of ';
const EXEC_SUMMARY_PERIOD = '. ';
const EXEC_SUMMARY_OF_INFIX = ' of ';
const EXEC_SUMMARY_DAMAGE_TAIL = ' photos showed evidence of damage or deterioration.';

/** Regenerate-summary prompt template fragments. */
const SUMMARY_FINDING_LINE_PREFIX = '- ';
const SUMMARY_FINDING_SEVERITY_OPEN = ' (';
const SUMMARY_FINDING_SEVERITY_CLOSE = '): ';
const SUMMARY_FINDINGS_JOINER = '\n';
const SUMMARY_PROMPT_INTRO = 'You are a HAAG-certified roof inspector. Write a 3-5 sentence executive summary for a roof inspection report based on these findings:';
const SUMMARY_ROOF_LABEL = 'Roof: ';
const SUMMARY_ROOF_MATERIAL_SUFFIX = ' material, ';
const SUMMARY_ROOF_SQUARES_SUFFIX = ' squares, ';
const SUMMARY_ROOF_PITCH_SUFFIX = ' pitch';
const SUMMARY_STORM_LABEL = 'Storm history: ';
const SUMMARY_STORM_EVENTS_INFIX = ' events in ';
const SUMMARY_STORM_YEARS_INFIX = ' years, risk level ';
const SUMMARY_PROMPT_TASK = 'The summary should assess overall condition, highlight the most critical findings, and recommend next steps. Write in a professional, authoritative tone.';
const SUMMARY_PROMPT_RETURN_ONLY = 'Return ONLY the executive summary text, no JSON or formatting. Do not use em dashes.';

/** Rewrite-finding prompt template fragments. */
const REWRITE_PROMPT_INTRO = 'You are a HAAG-certified roof inspector. Rewrite the following inspection finding narrative to be more professional and detailed.';
const REWRITE_PROMPT_CURRENT_LABEL = 'Current finding:';
const REWRITE_PROMPT_TITLE_LABEL = 'Title: ';
const REWRITE_PROMPT_SEVERITY_LABEL = 'Severity: ';
const REWRITE_PROMPT_NARRATIVE_LABEL = 'Current narrative: ';
const REWRITE_PROMPT_INSTRUCTION_LABEL = '\nSpecial instruction: ';
const REWRITE_PROMPT_OUTRO = 'Write a 2-4 sentence professional narrative. Return ONLY the rewritten narrative text, no JSON or formatting. Do not use em dashes.';

/** Storm-context section template fragments — assembled into:
 *  `'\nStorm History (3 years, 5-mile radius):\n- Total events: 12 (8 hail, 4 wind)\n...'`. */
const STORM_CTX_HEADING_PREFIX = '\nStorm History (';
const STORM_CTX_HEADING_INFIX = ' years, ';
const STORM_CTX_HEADING_SUFFIX = '-mile radius):';
const STORM_CTX_TOTAL_EVENTS_PREFIX = '\n- Total events: ';
const STORM_CTX_HAIL_OPEN_PAREN = ' (';
const STORM_CTX_HAIL_INFIX = ' hail, ';
const STORM_CTX_WIND_INFIX = ' wind)';
const STORM_CTX_LARGEST_HAIL_PREFIX = '\n- Largest hail: ';
const STORM_CTX_HAIL_QUOTE_SUFFIX = '"';
const STORM_CTX_RISK_LEVEL_PREFIX = '\n- Risk level: ';
const STORM_CTX_RISK_SCORE_OPEN = ' (score: ';
const STORM_CTX_RISK_SCORE_CLOSE = '/100)';
const STORM_CTX_CLAIM_POTENTIAL_PREFIX = '\n- Claim potential: ';
const STORM_CTX_DOL_PREFIX = '\n- Recommended date of loss: ';
const STORM_CTX_DOL_OPEN_PAREN = ' (';
const STORM_CTX_DOL_CLOSE_PAREN = ')';
const STORM_CTX_NA_FALLBACK = 'N/A';

/** Damage-type summary line template fragments — assembled into:
 *  `'- hail damage (3 instance(s), worst severity: high, photos: a, b)'` plus an
 *  optional `\n  Details: ...; ...'` continuation. */
const DAMAGE_LINE_PREFIX = '- ';
const DAMAGE_LINE_OPEN_PAREN = ' (';
const DAMAGE_LINE_CLOSE_PAREN = ')';
const DAMAGE_INSTANCES_INFIX = ' instance(s), worst severity: ';
const DAMAGE_PHOTOS_INFIX = ', photos: ';
const DAMAGE_PHOTOS_JOINER = ', ';
const DAMAGE_DETAILS_PREFIX = '\n  Details: ';
const DAMAGE_DETAILS_JOINER = '; ';
/** Cap on details stitched into the prompt damage-summary — keeps the prompt
 *  bounded when 30 photos all describe the same defect with long captions. */
const MAX_DETAILS_PER_DAMAGE = 3;
/** Replacement when normalising `damage_type` keys for display. Wires through
 *  `UNDERSCORE_REGEX` so the regex is built once at module load. */
const UNDERSCORE_REPLACEMENT = ' ';
/** Joiner for the per-damage-type lines into the final summary block. */
const DAMAGE_TYPE_SUMMARY_JOINER = '\n';
/** AI-summary line template — `'- <photoId>: <aiSummary>'` joined by newlines. */
const AI_SUMMARY_LINE_PREFIX = '- ';
const AI_SUMMARY_ID_SEPARATOR = ': ';
const AI_SUMMARY_LINES_JOINER = '\n';

/** Roof-context section template fragments — assembled into:
 *  `'\nRoof Details:\n- Material: asphalt_shingle\n...'`. */
const ROOF_CTX_HEADING = '\nRoof Details:';
const ROOF_CTX_MATERIAL_LABEL = '\n- Material: ';
const ROOF_CTX_SIZE_LABEL = '\n- Size: ';
const ROOF_CTX_SIZE_SUFFIX = ' squares';
const ROOF_CTX_PITCH_LABEL = '\n- Pitch: ';
const ROOF_CTX_STORIES_LABEL = '\n- Stories: ';
const ROOF_CTX_AGE_LABEL = '\n- Estimated age: ';
const ROOF_CTX_AGE_TILDE = '~';
const ROOF_CTX_AGE_YEARS_SUFFIX = ' years';
const ROOF_CTX_UNKNOWN_FALLBACK = 'Unknown';

/** Narrator main-prompt section headings + fallback messages. */
const NARRATOR_PROMPT_INTRO = 'You are a HAAG-certified roof inspector writing findings for a professional inspection report. Your task is to synthesize AI damage detection results into clear, authoritative narrative findings suitable for homeowners and insurance adjusters.';
const NARRATOR_HEADING_INPUT_DATA = '## Input Data';
const NARRATOR_HEADING_DETECTED_DAMAGE = '## Detected Damage Types:';
const NARRATOR_HEADING_AI_SUMMARIES = '## AI Photo Summaries:';
const NARRATOR_HEADING_INSTRUCTIONS = '## Instructions';
const NARRATOR_HEADING_RESPONSE_FORMAT = '## Response Format (JSON only, no markdown):';
const NARRATOR_LABEL_PHOTOS_ANALYZED = 'Photos analyzed: ';
const NARRATOR_LABEL_PHOTOS_WITH_DAMAGE = 'Photos with damage: ';
const NARRATOR_LABEL_OVERALL_SEVERITY = 'Overall severity: ';
const NARRATOR_LABEL_INSPECTOR_NOTES = '\nInspector Notes: ';
const NARRATOR_FALLBACK_NO_DAMAGE = 'No significant damage detected.';
const NARRATOR_FALLBACK_NO_SUMMARIES = 'No detailed summaries available.';
const NARRATOR_IMPORTANT_FOOTER = 'IMPORTANT: Return ONLY valid JSON. No markdown code fences, no commentary. Do not use em dashes in any text you write; use commas, colons or full stops.';

// Damage types the fallback narrator marks as `insuranceRelevant: true`.
// Expanded vocabulary keeps the rule-based fallback from undercalling claims
// when Claude is offline / unconfigured — flashing failures, granule loss,
// and pipe-boot failures are routine claim line items.
const INSURANCE_RELEVANT_DAMAGE_TYPES = new Set([
  'hail_damage',
  'wind_damage',
  'missing_shingles',
  'structural_damage',
  'flashing_damage',
  'flashing_failure',
  'pipe_boot_failure',
  'ridge_cap_damage',
  'granule_loss',
]);

// Lower index = worse. Used for sorting findings worst-first.
const SEVERITY_ORDER_WORST_FIRST: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

// Higher value = worse. Used to track the worst severity seen for a damage group.
const SEVERITY_RANK_HIGHER_IS_WORSE: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

// ─── Severity mapping ─────────────────────────────────────────────────────────

// Sets are O(1) and the named-constant form makes the mapping table much
// easier to read at a glance than the parallel `if/includes` ladder it
// replaces.
const SEVERITY_CRITICAL = new Set(['critical', 'severe']);
const SEVERITY_HIGH = new Set(['high', 'major']);
const SEVERITY_MODERATE = new Set(['medium', 'moderate']);
const SEVERITY_MINOR = new Set(['low', 'minor']);
const SEVERITY_ADVISORY = new Set(['advisory', 'informational']);
const SEVERITY_COSMETIC = new Set(['cosmetic', 'none']);

/** Single map lookup avoids the 6-arm if-ladder. Built once at
 *  module load. Mirrors the equivalent in claude-image-labeler. */
const SEVERITY_MAP_LOOKUP: ReadonlyMap<string, FindingSeverity> = (() => {
  const map = new Map<string, FindingSeverity>();
  for (const k of SEVERITY_CRITICAL) map.set(k, 'critical');
  for (const k of SEVERITY_HIGH) map.set(k, 'high');
  for (const k of SEVERITY_MODERATE) map.set(k, 'moderate');
  for (const k of SEVERITY_MINOR) map.set(k, 'minor');
  for (const k of SEVERITY_ADVISORY) map.set(k, 'advisory');
  for (const k of SEVERITY_COSMETIC) map.set(k, 'cosmetic');
  return map;
})();

function mapToFindingSeverity(sev: string): FindingSeverity {
  const lower = (sev || '').trim().toLowerCase();
  return SEVERITY_MAP_LOOKUP.get(lower) || 'moderate';
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

export function buildNarratorPrompt(input: NarratorInput): string {
  const { analyzedPhotos, damageAnalysis, stormHistory, roofDetails, inspectorNotes } = input;

  // Summarize damage detections for Claude. Damage `type`/`label`/`description`
  // are vision-derived (untrusted) — sanitize each before it lands in the
  // prompt so a hostile caption can't inject control chars / override the
  // narrator instructions.
  const damagesByType: Record<string, { count: number; severities: string[]; descriptions: string[]; photoIds: string[] }> = {};

  for (const photo of analyzedPhotos) {
    for (const d of photo.damages) {
      const rawKey = d.type || d.label || DEFAULT_DAMAGE_KEY;
      const key = sanitizeField(rawKey, SANITIZE_DAMAGE_KEY_MAX) || DEFAULT_DAMAGE_KEY;
      if (!damagesByType[key]) {
        damagesByType[key] = { count: 0, severities: [], descriptions: [], photoIds: [] };
      }
      damagesByType[key].count++;
      damagesByType[key].severities.push(d.severity);
      if (d.description) {
        const cleanDescription = sanitizeField(d.description, SANITIZE_DESCRIPTION_MAX);
        if (cleanDescription) damagesByType[key].descriptions.push(cleanDescription);
      }
      if (!damagesByType[key].photoIds.includes(photo.id)) {
        damagesByType[key].photoIds.push(photo.id);
      }
    }
  }

  const damageTypeSummary = Object.entries(damagesByType)
    .map(([type, data]) => {
      const worstSeverity = [...data.severities].sort(
        (a, b) => (SEVERITY_ORDER_WORST_FIRST[a] ?? SEVERITY_RANK_FALLBACK) - (SEVERITY_ORDER_WORST_FIRST[b] ?? SEVERITY_RANK_FALLBACK),
      )[0];
      const typeLabel = type.replace(UNDERSCORE_REGEX, UNDERSCORE_REPLACEMENT);
      const photosList = data.photoIds.join(DAMAGE_PHOTOS_JOINER);
      const detailsTail = data.descriptions.length > 0
        ? `${DAMAGE_DETAILS_PREFIX}${data.descriptions.slice(0, MAX_DETAILS_PER_DAMAGE).join(DAMAGE_DETAILS_JOINER)}`
        : '';
      return `${DAMAGE_LINE_PREFIX}${typeLabel}${DAMAGE_LINE_OPEN_PAREN}${data.count}${DAMAGE_INSTANCES_INFIX}${worstSeverity}${DAMAGE_PHOTOS_INFIX}${photosList}${DAMAGE_LINE_CLOSE_PAREN}${detailsTail}`;
    })
    .join(DAMAGE_TYPE_SUMMARY_JOINER);

  const stormContext = stormHistory
    ? `${STORM_CTX_HEADING_PREFIX}${stormHistory.yearsAnalyzed}${STORM_CTX_HEADING_INFIX}${stormHistory.searchRadiusMiles}${STORM_CTX_HEADING_SUFFIX}${STORM_CTX_TOTAL_EVENTS_PREFIX}${stormHistory.totalEvents}${STORM_CTX_HAIL_OPEN_PAREN}${stormHistory.hailEvents}${STORM_CTX_HAIL_INFIX}${stormHistory.windEvents}${STORM_CTX_WIND_INFIX}${STORM_CTX_LARGEST_HAIL_PREFIX}${stormHistory.largestHailInches || STORM_CTX_NA_FALLBACK}${STORM_CTX_HAIL_QUOTE_SUFFIX}${STORM_CTX_RISK_LEVEL_PREFIX}${stormHistory.riskLevel}${STORM_CTX_RISK_SCORE_OPEN}${stormHistory.riskScore}${STORM_CTX_RISK_SCORE_CLOSE}${STORM_CTX_CLAIM_POTENTIAL_PREFIX}${stormHistory.claimPotential}
${stormHistory.recommendedDateOfLoss ? `${STORM_CTX_DOL_PREFIX.slice(1)}${stormHistory.recommendedDateOfLoss.date}${STORM_CTX_DOL_OPEN_PAREN}${stormHistory.recommendedDateOfLoss.eventType}${STORM_CTX_DOL_CLOSE_PAREN}` : ''}`
    : '';

  // Roof material/type/pitch are user/vision-derived free text — sanitize the
  // string fields. (squares/stories/age_years are numbers and need no strip.)
  const roofMaterial = sanitizeField(roofDetails?.material || roofDetails?.type, SANITIZE_ROOF_FIELD_MAX) || ROOF_CTX_UNKNOWN_FALLBACK;
  const roofPitch = sanitizeField(roofDetails?.pitch, SANITIZE_ROOF_FIELD_MAX) || ROOF_CTX_UNKNOWN_FALLBACK;
  const roofContext = roofDetails
    ? `${ROOF_CTX_HEADING}${ROOF_CTX_MATERIAL_LABEL}${roofMaterial}${ROOF_CTX_SIZE_LABEL}${roofDetails.squares || ROOF_CTX_UNKNOWN_FALLBACK}${ROOF_CTX_SIZE_SUFFIX}${ROOF_CTX_PITCH_LABEL}${roofPitch}${ROOF_CTX_STORIES_LABEL}${roofDetails.stories || ROOF_CTX_UNKNOWN_FALLBACK}${ROOF_CTX_AGE_LABEL}${roofDetails.age_years ? `${ROOF_CTX_AGE_TILDE}${roofDetails.age_years}${ROOF_CTX_AGE_YEARS_SUFFIX}` : ROOF_CTX_UNKNOWN_FALLBACK}`
    : '';

  // Inspector notes are free-form untrusted text — strip control chars + cap.
  const cleanInspectorNotes = sanitizeField(inspectorNotes, SANITIZE_NOTES_MAX);

  return `${NARRATOR_PROMPT_INTRO}

${NARRATOR_HEADING_INPUT_DATA}

${NARRATOR_LABEL_PHOTOS_ANALYZED}${damageAnalysis.totalPhotosAnalyzed}
${NARRATOR_LABEL_PHOTOS_WITH_DAMAGE}${damageAnalysis.photosWithDamage}
${NARRATOR_LABEL_OVERALL_SEVERITY}${damageAnalysis.overallSeverity}
${roofContext}
${stormContext}
${cleanInspectorNotes ? `${NARRATOR_LABEL_INSPECTOR_NOTES}${cleanInspectorNotes}` : ''}

${NARRATOR_HEADING_DETECTED_DAMAGE}
${damageTypeSummary || NARRATOR_FALLBACK_NO_DAMAGE}

${NARRATOR_HEADING_AI_SUMMARIES}
${analyzedPhotos.filter(p => p.aiSummary && p.damages.length > 0).map(p => `${AI_SUMMARY_LINE_PREFIX}${p.id}${AI_SUMMARY_ID_SEPARATOR}${sanitizeField(p.aiSummary, SANITIZE_AI_SUMMARY_MAX)}`).join(AI_SUMMARY_LINES_JOINER) || NARRATOR_FALLBACK_NO_SUMMARIES}

${NARRATOR_HEADING_INSTRUCTIONS}

Group related damage detections into coherent **findings** (typically 3-8 findings per report). Each finding should:
1. Have a clear, descriptive title (e.g., "Hail Damage: Multiple Confirmed Strikes", "Chimney Flashing Failure")
2. Include a 2-4 sentence narrative paragraph explaining:
   - What was found (specific visual evidence)
   - Why it matters (structural implications, leak risk, safety)
   - What should be done (repair recommendation)
3. Reference which photos show the damage
4. Note whether it's relevant to an insurance claim

Also write a 3-5 sentence **executive summary** that synthesizes all findings into a professional assessment of the roof's condition.

${NARRATOR_HEADING_RESPONSE_FORMAT}
{
  "findings": [
    {
      "title": "Finding title",
      "severity": "critical|high|moderate|minor|advisory|cosmetic",
      "narrative": "2-4 sentence professional description...",
      "relatedPhotoIds": ["photo-0", "photo-3"],
      "repairAction": "What needs to be done",
      "insuranceRelevant": true,
      "sourceDamageTypes": ["hail_damage", "granule_loss"]
    }
  ],
  "executiveSummary": "3-5 sentence professional assessment..."
}

${NARRATOR_IMPORTANT_FOOTER}`;
}

// ─── API call ─────────────────────────────────────────────────────────────────

/** One call through the seam. Returns the model's text, or null when no caller is configured. */
async function ask(
  prompt: string,
  role: 'narrative' | 'rewrite',
  maxTokens: number,
  opts: ModelOptions,
): Promise<string | null> {
  const call = callerFor(opts);
  if (!call) return null;
  const result = await call({ role, prompt, maxTokens, signal: opts.signal });
  return result.text;
}

/**
 * Extract a JSON object from a Claude response. Claude sometimes wraps JSON in
 * markdown fences or prefixes it with explanatory text despite instructions —
 * we strip ```json / ``` fences first, then the greedy `{...}` match grabs the
 * longest balanced object payload.
 */
function parseClaudeJSONResponse<T = unknown>(text: string): T {
  // Strip markdown code fences (```json ... ``` or ``` ... ```) so the
  // greedy `{...}` regex below operates on the actual payload, not on a
  // leading ```` ``` ```` that confuses bracket matching.
  const stripped = text.replace(MARKDOWN_FENCE_REGEX, MARKDOWN_FENCE_CAPTURE_REPLACEMENT);
  const match = stripped.match(JSON_OBJECT_REGEX);
  if (!match) {
    throw new Error(
      `${MSG_NO_JSON_FOUND_PREFIX}${ERR_HEAD_LEN_SHORT}${MSG_NO_JSON_FOUND_INFIX}${text.slice(0, ERR_HEAD_LEN_SHORT)}`,
    );
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch (err) {
    const head = match[0].slice(0, ERR_HEAD_LEN_SHORT);
    throw new Error(`${MSG_JSON_PARSE_FAILED_PREFIX}${errorMessage(err)}${MSG_JSON_PARSE_FAILED_INFIX}${head}`);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate professional narrative findings and an executive summary.
 *
 * Non-fatal: any failure (no caller, a provider error, a reply that is not
 * JSON) returns null and logs only a status, never the provider's text. A
 * caller that still wants something to show can use `ruleBasedNarrative`.
 */
export async function generateNarrativeWithClaude(
  input: NarratorInput,
  opts: ModelOptions,
): Promise<NarratorOutput | null> {
  const startTime = Date.now();

  try {
    const prompt = buildNarratorPrompt(input);
    const responseText = await ask(prompt, 'narrative', MAX_TOKENS_NARRATIVE, opts);
    if (responseText === null) return null;

    interface RawFinding {
      title?: string;
      severity?: string;
      narrative?: string;
      relatedPhotoIds?: unknown;
      repairAction?: string;
      insuranceRelevant?: unknown;
      sourceDamageTypes?: unknown;
    }
    const parsed = parseClaudeJSONResponse<{
      findings?: RawFinding[];
      executiveSummary?: string;
    }>(responseText);
    const findings: NarrativeFinding[] = (parsed.findings || []).map((f, idx) => ({
      id: `${FINDING_ID_PREFIX}${idx}`,
      title: plainDashes(f.title || `${FALLBACK_FINDING_TITLE_PREFIX}${idx + 1}`),
      severity: mapToFindingSeverity(f.severity || ''),
      narrative: plainDashes(f.narrative || ''),
      relatedPhotoIds: Array.isArray(f.relatedPhotoIds) ? f.relatedPhotoIds as string[] : [],
      repairAction: plainDashes(f.repairAction || ''),
      insuranceRelevant: Boolean(f.insuranceRelevant),
      sourceDamageTypes: Array.isArray(f.sourceDamageTypes) ? f.sourceDamageTypes as string[] : [],
    }));

    console.log(`${LOG_PREFIX}${LOG_GENERATED_INFIX}${findings.length}${LOG_FINDINGS_INFIX}narrative${LOG_ELAPSED_INFIX}${Date.now() - startTime}${LOG_MS_SUFFIX}`);

    return {
      findings,
      executiveSummary: plainDashes(parsed.executiveSummary || ''),
    };
  } catch (error: unknown) {
    // Only a status or "timed out": a provider's own words never reach a log.
    console.error(`${LOG_PREFIX} failed after ${Date.now() - startTime}ms (${describeModelError(error)})`);
    return null;
  }
}

// ─── Fallback: rule-based findings, for a caller that wants something when the model is unavailable ───

export function ruleBasedNarrative(input: NarratorInput): NarratorOutput {
  const { analyzedPhotos, damageAnalysis } = input;
  const findings: NarrativeFinding[] = [];

  // Group damages by type
  const damageGroups: Record<string, {
    count: number;
    worstSeverity: string;
    photoIds: string[];
    descriptions: string[];
  }> = {};

  for (const photo of analyzedPhotos) {
    for (const d of photo.damages) {
      const key = d.type || DEFAULT_DAMAGE_KEY;
      if (!damageGroups[key]) {
        damageGroups[key] = { count: 0, worstSeverity: LOWEST_SEVERITY, photoIds: [], descriptions: [] };
      }
      damageGroups[key].count++;
      if (!damageGroups[key].photoIds.includes(photo.id)) {
        damageGroups[key].photoIds.push(photo.id);
      }
      if (d.description) damageGroups[key].descriptions.push(d.description);

      if (
        (SEVERITY_RANK_HIGHER_IS_WORSE[d.severity] || 0) >
        (SEVERITY_RANK_HIGHER_IS_WORSE[damageGroups[key].worstSeverity] || 0)
      ) {
        damageGroups[key].worstSeverity = d.severity;
      }
    }
  }

  // Sort by severity (worst first)
  const sortedGroups = Object.entries(damageGroups).sort((a, b) =>
    (SEVERITY_ORDER_WORST_FIRST[a[1].worstSeverity] ?? SEVERITY_RANK_FALLBACK) -
    (SEVERITY_ORDER_WORST_FIRST[b[1].worstSeverity] ?? SEVERITY_RANK_FALLBACK),
  );

  for (const [type, data] of sortedGroups) {
    const label = type.replace(UNDERSCORE_REGEX, ' ').replace(WORD_BOUNDARY_REGEX, c => c.toUpperCase());
    const severity = mapToFindingSeverity(data.worstSeverity);
    const isInsurance = INSURANCE_RELEVANT_DAMAGE_TYPES.has(type);

    findings.push({
      id: `${FINDING_ID_PREFIX}${findings.length}`,
      title: label,
      severity,
      narrative: data.descriptions.length > 0
        ? data.descriptions.slice(0, MAX_DESCRIPTIONS_IN_NARRATIVE).join(FALLBACK_DESCRIPTIONS_JOINER) + `${FALLBACK_FOUND_IN_PREFIX}${data.count}${FALLBACK_LOCATIONS_INFIX}${data.photoIds.length}${FALLBACK_PHOTOS_SUFFIX}`
        : `${label}${FALLBACK_DETECTED_INFIX}${data.count}${FALLBACK_LOCATIONS_INFIX}${data.photoIds.length}${FALLBACK_PHOTOS_SUFFIX}${FALLBACK_PROF_RECOMMENDED}`,
      relatedPhotoIds: data.photoIds,
      repairAction: `${FALLBACK_REPAIR_PREFIX}${label.toLowerCase()}${FALLBACK_REPAIR_SUFFIX}`,
      insuranceRelevant: isInsurance,
      sourceDamageTypes: [type],
    });
  }

  // Simple executive summary
  const severity = damageAnalysis.overallSeverity;
  const totalDamages = damageAnalysis.damageTypes.length;
  const conditionWord = severity === SEVERITY_TAG_CRITICAL || severity === SEVERITY_TAG_HIGH
    ? EXEC_REQUIRES_IMMEDIATE
    : severity === SEVERITY_TAG_MEDIUM
    ? EXEC_SHOWS_CONCERN
    : EXEC_ACCEPTABLE_CONDITION;

  const executiveSummary = `${EXEC_SUMMARY_PREFIX}${damageAnalysis.totalPhotosAnalyzed}${EXEC_SUMMARY_PHOTOS_INFIX}${totalDamages}${EXEC_SUMMARY_TYPES_INFIX}${conditionWord}${EXEC_SUMMARY_SEVERITY_INFIX}${severity}${EXEC_SUMMARY_PERIOD}${damageAnalysis.photosWithDamage}${EXEC_SUMMARY_OF_INFIX}${damageAnalysis.totalPhotosAnalyzed}${EXEC_SUMMARY_DAMAGE_TAIL}`;

  return { findings, executiveSummary };
}

/**
 * Rewrite a single finding narrative using Claude.
 */
export async function rewriteFindingWithClaude(
  finding: NarrativeFinding,
  instruction: string | undefined,
  opts: ModelOptions,
): Promise<string | null> {
  const prompt = `${REWRITE_PROMPT_INTRO}

${REWRITE_PROMPT_CURRENT_LABEL}
${REWRITE_PROMPT_TITLE_LABEL}${finding.title}
${REWRITE_PROMPT_SEVERITY_LABEL}${finding.severity}
${REWRITE_PROMPT_NARRATIVE_LABEL}${finding.narrative}
${instruction ? `${REWRITE_PROMPT_INSTRUCTION_LABEL}${instruction}` : ''}

${REWRITE_PROMPT_OUTRO}`;

  try {
    const responseText = await ask(prompt, 'rewrite', MAX_TOKENS_REWRITE, opts);
    return responseText === null ? null : plainDashes(responseText.trim());
  } catch (error: unknown) {
    console.error(`${LOG_PREFIX} failed (${describeModelError(error)})`);
    return null;
  }
}

/**
 * Regenerate executive summary from current findings using Claude.
 */
export async function regenerateSummaryWithClaude(
  findings: NarrativeFinding[],
  roofDetails: NarratorInput['roofDetails'],
  stormHistory: StormSummarySection | undefined,
  opts: ModelOptions,
): Promise<string | null> {
  const findingsSummary = findings.map(f =>
    `${SUMMARY_FINDING_LINE_PREFIX}${f.title}${SUMMARY_FINDING_SEVERITY_OPEN}${f.severity}${SUMMARY_FINDING_SEVERITY_CLOSE}${f.narrative}`
  ).join(SUMMARY_FINDINGS_JOINER);

  const prompt = `${SUMMARY_PROMPT_INTRO}

${findingsSummary}

${roofDetails ? `${SUMMARY_ROOF_LABEL}${roofDetails.material || ROOF_CTX_UNKNOWN_FALLBACK}${SUMMARY_ROOF_MATERIAL_SUFFIX}${roofDetails.squares || ROOF_CTX_UNKNOWN_FALLBACK}${SUMMARY_ROOF_SQUARES_SUFFIX}${roofDetails.pitch || ROOF_CTX_UNKNOWN_FALLBACK}${SUMMARY_ROOF_PITCH_SUFFIX}` : ''}
${stormHistory ? `${SUMMARY_STORM_LABEL}${stormHistory.totalEvents}${SUMMARY_STORM_EVENTS_INFIX}${stormHistory.yearsAnalyzed}${SUMMARY_STORM_YEARS_INFIX}${stormHistory.riskLevel}` : ''}

${SUMMARY_PROMPT_TASK}

${SUMMARY_PROMPT_RETURN_ONLY}`;

  try {
    const responseText = await ask(prompt, 'rewrite', MAX_TOKENS_REWRITE, opts);
    return responseText === null ? null : plainDashes(responseText.trim());
  } catch (error: unknown) {
    console.error(`${LOG_PREFIX} failed (${describeModelError(error)})`);
    return null;
  }
}
