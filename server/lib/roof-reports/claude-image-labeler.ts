import { downloadReportImage } from './safe-download.js';
import { callerFor, describeModelError, plainDashes, type ModelCaller, type ModelOptions } from './model-call.js';
/**
 * Claude Image Labeler — Analyzes roof photos and generates positioned damage labels.
 *
 * Uses Claude Haiku for fast, cost-effective image labeling. Each photo gets
 * short labels with approximate positions for overlay display in reports.
 */

import type {
  ImageLabel,
  FindingSeverity,
  DamageDetection,
} from './comprehensive-roof-report.js';
import { isSafeFetchUrl } from './url-safety.js';
import { sanitizePromptText } from './prompt-sanitize.js';

// ─── Prompt-injection / control-char hardening ────────────────────────
// The damage `label`/`type` token and `location` interpolated into the
// labeler prompt are vision-derived (untrusted) — a malicious caption /
// detection could embed ASCII control characters (terminal escapes,
// NUL/BEL) or be arbitrarily long to attempt prompt injection or to blow
// out the prompt budget. Each is run through `sanitizePromptText` with a
// generous per-field cap before interpolation. The caps are large enough
// that ordinary short labels / locations pass through untouched, so the
// labels produced for normal inputs do not change.
/** Cap for a damage type/label token (used as the display label in-prompt). */
const SANITIZE_DAMAGE_LABEL_MAX = 120;
/** Cap for a short free-text damage location string. */
const SANITIZE_LOCATION_MAX = 120;

/** Strip control chars + length-cap an optional untrusted string for prompt
 *  interpolation. Non-string / empty inputs collapse to `''` (same as the
 *  underlying `sanitizePromptText`). */
function sanitizeField(text: string | undefined | null, maxLen: number): string {
  return sanitizePromptText(typeof text === 'string' ? text : '', maxLen);
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** One photo to label: an address, or the original bytes. Bytes win when both are given. */
export interface LabelInput {
  photoId: string;
  photoUrl?: string;
  image?: { bytes: Buffer; mediaType: 'image/jpeg' };
  existingDamages: DamageDetection[];
}

export interface LabelOptions extends ModelOptions {
  batchSize?: number;
  /** Fetches a photo address and returns a data URL. Defaults to the safe downloader. */
  downloadImage?: (url: string) => Promise<string>;
}

interface LabelOutput {
  photoId: string;
  labels: ImageLabel[];
}

type LabelPosition = ImageLabel['position'];

const VALID_POSITIONS: LabelPosition[] = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];
/** Set form of VALID_POSITIONS for O(1) membership checks in
 *  normalizePosition (called once per Claude-returned label). */
const VALID_POSITIONS_SET: ReadonlySet<LabelPosition> = new Set(VALID_POSITIONS);

// ─── Logging / formatting constants ────────────────────────────────────
/** Prefix for every log line emitted by this module — single source of
 *  truth so a future rename (e.g. to `[archie-labeler]`) is one edit. */
const LOG_PREFIX = '[report-labeler]';
/** Default label text when Claude returns an empty `text` field. */
const DEFAULT_LABEL_TEXT = 'Damage';
/** Fallback `photoId` used in batch-failure logs when the upstream input
 *  was missing the field for some reason. */
const DEFAULT_PHOTO_ID = 'unknown';
/** Bounded slice length for short error context (e.g. JSON head, response head). */
const ERR_HEAD_LEN_SHORT = 200;
/** Bounded slice length for long error context (e.g. raw API response body). */
const ERR_HEAD_LEN_LONG = 500;

// ─── Image / URL parsing constants ────────────────────────────────────────
/** MIME-type prefix indicating a returned Content-Type is an actual image. */
const IMAGE_MIME_PREFIX = 'image/';
/** URL prefix indicating an inline data URL. */
const DATA_URL_PREFIX = 'data:';
/** Capture groups: 1 = mime type, 2 = base64 payload. */
const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/;
/** Strip markdown fences from an LLM response (`g` flag for repeated fences). */
const MARKDOWN_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)```/g;
/** Greedy match for the outermost JSON object inside a response. */
const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;
/** Collapse one-or-more whitespace runs to a single dash for position normalisation. */
const WHITESPACE_TO_DASH_REGEX = /\s+/g;

/** Narrow `unknown` to a printable error message — replaces the unsafe
 *  `(error as Error).message` cast that we used to scatter at every catch. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Call budget ──────────────────────────────────────────────────────────────
const MAX_TOKENS_LABEL = 1024;
/** Cap inbound image bytes so a malicious / accidental 1 GB upload doesn't
 *  exhaust process memory while base64-encoding for Claude. 20 MB covers
 *  anything reasonable; phones rarely emit > 12 MB. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// ─── Labeller behaviour constants ───────────────────────────────────────
/** Cap on labels returned per photo — keeps the overlay readable. */
const MAX_LABELS_PER_PHOTO = 5;
/** Concurrency for `labelPhotosWithClaude` batches. */
const DEFAULT_BATCH_SIZE = 5;
/** Pause between batches to stay inside Anthropic's per-minute limit. */
const RATE_LIMIT_DELAY_MS = 500;

// ─── Private-network host detection (SSRF prevention) ─────────────────
/** Localhost hostname literal. */
const LOCALHOST_HOSTNAME = 'localhost';
/** IPv4 + IPv6 loopback addresses. */
const LOOPBACK_IPV4 = '127.0.0.1';
const LOOPBACK_IPV6 = '::1';
/** AWS EC2 metadata service — common SSRF target. */
const AWS_METADATA_IP = '169.254.169.254';
/** IPv4 octet count for the dotted-quad split check. */
const IPV4_OCTET_COUNT = 4;
/** First-octet sentinels for RFC1918 private ranges. */
const PRIVATE_OCTET_10 = 10;
const PRIVATE_OCTET_172 = 172;
const PRIVATE_OCTET_192 = 192;
const PRIVATE_OCTET_169 = 169;
/** Second-octet bounds for the 172.16.0.0/12 range. */
const PRIVATE_172_SECOND_MIN = 16;
const PRIVATE_172_SECOND_MAX = 31;
/** Second-octet sentinels for 192.168.x.x and 169.254.x.x. */
const PRIVATE_192_SECOND = 168;
const PRIVATE_169_SECOND = 254;
/** Render internal hostname suffixes (covers both .render.com + .onrender.com). */
const RENDER_DOMAIN_SUFFIX = '.render.com';
const RENDER_ALT_DOMAIN_SUFFIX = '.onrender.com';
/** Required HTTPS protocol scheme for inbound image URLs. */
const HTTPS_PROTOCOL = 'https:';
/** Hostname-octet separator. */
const HOSTNAME_OCTET_SEPARATOR = '.';

/** SSRF + image-fetch error messages. */
const MSG_INVALID_IMAGE_URL = 'Invalid image URL: must be HTTPS and not point to private/internal hosts';
const MSG_INVALID_DATA_URL = 'Invalid data URL';
const MSG_FETCH_IMAGE_FAILED_PREFIX = 'Failed to fetch image: ';
const MSG_IMAGE_TOO_LARGE_BYTES_PREFIX = 'Image too large: ';
const MSG_IMAGE_TOO_LARGE_BYTES_INFIX = ' bytes (max ';
const MSG_IMAGE_TOO_LARGE_AFTER_FETCH_PREFIX = 'Image too large after fetch: ';
const MSG_IMAGE_TOO_LARGE_SUFFIX = ')';

/** Header field names read from image-fetch responses. */
const HEADER_CONTENT_LENGTH = 'content-length';
const HEADER_CONTENT_TYPE_LOWER = 'content-type';
/** Content-type parameter separator (`;`) — split on this to drop charset/boundary params. */
const CONTENT_TYPE_PARAM_SEPARATOR = ';';
/** Buffer encoding used to convert image bytes → base64. */
const BUFFER_ENCODING_BASE64 = 'base64';

function normalizePosition(pos: string): LabelPosition {
  const lower = (pos || '').toLowerCase().replace(WHITESPACE_TO_DASH_REGEX, '-');
  if (VALID_POSITIONS_SET.has(lower as LabelPosition)) {
    return lower as LabelPosition;
  }
  // Try partial matches
  if (lower.includes('top') && lower.includes('left')) return 'top-left';
  if (lower.includes('top') && lower.includes('right')) return 'top-right';
  if (lower.includes('top')) return 'top-center';
  if (lower.includes('bottom') && lower.includes('left')) return 'bottom-left';
  if (lower.includes('bottom') && lower.includes('right')) return 'bottom-right';
  if (lower.includes('bottom')) return 'bottom-center';
  if (lower.includes('left')) return 'center-left';
  if (lower.includes('right')) return 'center-right';
  return 'center';
}

// Same vocabulary as `mapToFindingSeverity` in claude-report-narrator.ts —
// kept in sync so a label badge and the corresponding finding badge can't
// disagree. Sets are O(1) and self-documenting; trim() handles legacy rows
// where Claude / vision providers emitted ' high ' or ' Severe '.
const LABEL_SEV_CRITICAL = new Set(['critical', 'severe']);
const LABEL_SEV_HIGH = new Set(['high', 'major']);
const LABEL_SEV_MODERATE = new Set(['medium', 'moderate']);
const LABEL_SEV_MINOR = new Set(['low', 'minor']);
const LABEL_SEV_ADVISORY = new Set(['advisory', 'informational']);
const LABEL_SEV_COSMETIC = new Set(['cosmetic', 'none']);

/** Single map lookup avoids the 6-arm if-ladder. Reverse index is built
 *  once at module load. The fallback is `'moderate'` to match the
 *  prior behaviour for unrecognised severities. */
const SEVERITY_MAP_LOOKUP: ReadonlyMap<string, FindingSeverity> = (() => {
  const map = new Map<string, FindingSeverity>();
  for (const k of LABEL_SEV_CRITICAL) map.set(k, 'critical');
  for (const k of LABEL_SEV_HIGH) map.set(k, 'high');
  for (const k of LABEL_SEV_MODERATE) map.set(k, 'moderate');
  for (const k of LABEL_SEV_MINOR) map.set(k, 'minor');
  for (const k of LABEL_SEV_ADVISORY) map.set(k, 'advisory');
  for (const k of LABEL_SEV_COSMETIC) map.set(k, 'cosmetic');
  return map;
})();

function mapSeverity(sev: string): FindingSeverity {
  const lower = (sev || '').trim().toLowerCase();
  return SEVERITY_MAP_LOOKUP.get(lower) || 'moderate';
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildLabelPrompt(existingDamages: DamageDetection[]): string {
  const damageContext = existingDamages.length > 0
    ? `\nPreviously detected damage in this photo:\n${existingDamages.map(d => {
        // `label`/`type` and `location` are vision-derived (untrusted) —
        // sanitize + cap each before it lands in the prompt. `severity` is a
        // constrained enum, so it doesn't need sanitizing.
        const labelToken = sanitizeField(d.label, SANITIZE_DAMAGE_LABEL_MAX)
          || sanitizeField(d.type, SANITIZE_DAMAGE_LABEL_MAX);
        const location = sanitizeField(d.location, SANITIZE_LOCATION_MAX);
        return `- ${labelToken}: ${d.severity} severity${location ? `, at ${location}` : ''}`;
      }).join('\n')}`
    : '\nNo damage was previously detected by other AI models.';

  return `You are a roof inspection photo analyst. Label this roof photo with short damage/feature annotations.

For each notable feature or damage area visible in the image, provide:
1. A short label (3-8 words, e.g., "Hail strike, granule loss", "Cracked pipe boot")
2. The approximate position in the image (one of: top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right)
3. Severity level (critical, high, moderate, minor, advisory, cosmetic)
${damageContext}

Confirm or refine the existing damage detections, and identify any additional damage or features that were missed.

Limit to the 5 most important labels per photo.

## Response Format (JSON only):
{
  "labels": [
    {
      "text": "Short damage label",
      "position": "center-left",
      "severity": "high"
    }
  ]
}

Return ONLY valid JSON. No markdown code fences. Do not use em dashes in any label.`;
}

// ─── URL validation (SSRF prevention) ─────────────────────────────────────────

function isPrivateHost(hostname: string): boolean {
  if (hostname === LOCALHOST_HOSTNAME || hostname === LOOPBACK_IPV4 || hostname === LOOPBACK_IPV6) return true;
  // AWS metadata
  if (hostname === AWS_METADATA_IP) return true;
  // Private IP ranges
  const parts = hostname.split(HOSTNAME_OCTET_SEPARATOR);
  if (parts.length === IPV4_OCTET_COUNT) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    if (first === PRIVATE_OCTET_10) return true;
    if (first === PRIVATE_OCTET_172 && second >= PRIVATE_172_SECOND_MIN && second <= PRIVATE_172_SECOND_MAX) return true;
    if (first === PRIVATE_OCTET_192 && second === PRIVATE_192_SECOND) return true;
    if (first === PRIVATE_OCTET_169 && second === PRIVATE_169_SECOND) return true;
  }
  // Render internal hostnames
  if (hostname.endsWith(RENDER_DOMAIN_SUFFIX) || hostname.endsWith(RENDER_ALT_DOMAIN_SUFFIX)) return true;
  return false;
}

function validateImageUrl(url: string): boolean {
  if (url.startsWith(DATA_URL_PREFIX)) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== HTTPS_PROTOCOL) return false;
    if (isPrivateHost(parsed.hostname)) return false;
    // Secondary defense: centralized SSRF check also blocks alternate IP
    // encodings (decimal/hex/octal) and IPv4-mapped IPv6 forms.
    if (!isSafeFetchUrl(url)) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── The photo, ready to send ─────────────────────────────────────────────────

async function imageFor(
  input: LabelInput,
  download: (url: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<{ base64: string; mediaType: string }> {
  if (input.image) {
    if (input.image.bytes.length === 0 || input.image.bytes.length > MAX_IMAGE_BYTES) throw new Error(MSG_INVALID_DATA_URL);
    return { base64: input.image.bytes.toString(BUFFER_ENCODING_BASE64), mediaType: input.image.mediaType };
  }
  const imageUrl = input.photoUrl ?? '';
  // Validate URL to prevent SSRF
  if (!validateImageUrl(imageUrl)) throw new Error(MSG_INVALID_IMAGE_URL);
  if (imageUrl.startsWith(DATA_URL_PREFIX)) {
    const matches = imageUrl.match(DATA_URL_REGEX);
    if (!matches || !/^image\/(jpeg|png|webp|gif)$/.test(matches[1]) || matches[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error(MSG_INVALID_DATA_URL);
    return { mediaType: matches[1], base64: matches[2] };
  }
  signal?.throwIfAborted();
  const downloaded = await download(imageUrl);
  signal?.throwIfAborted();
  const parts = downloaded.match(DATA_URL_REGEX);
  if (!parts) throw new Error(MSG_INVALID_DATA_URL);
  return { mediaType: parts[1], base64: parts[2] };
}

async function callWithImage(
  prompt: string,
  input: LabelInput,
  call: ModelCaller,
  opts: LabelOptions,
): Promise<string> {
  const image = await imageFor(input, opts.downloadImage ?? downloadReportImage, opts.signal);
  const result = await call({ role: 'labels', prompt, maxTokens: MAX_TOKENS_LABEL, image, signal: opts.signal });
  return result.text;
}

// ─── Main exports ─────────────────────────────────────────────────────────────

interface LabelledPhoto extends LabelOutput {
  /** True when the model produced these labels, false when they came from the existing detections. */
  fromModel: boolean;
}

/** Label one photo. A failure here is quiet: the photo gets labels built from its existing detections. */
async function labelOne(input: LabelInput, call: ModelCaller, opts: LabelOptions): Promise<LabelledPhoto> {
  const startTime = Date.now();

  try {
    const prompt = buildLabelPrompt(input.existingDamages);
    const responseText = await callWithImage(prompt, input, call, opts);
    console.log(`${LOG_PREFIX} Labeled ${input.photoId} in ${Date.now() - startTime}ms`);

    // Strip markdown code fences first, same defence as the narrator.
    const stripped = responseText.replace(MARKDOWN_FENCE_REGEX, '$1');
    const jsonMatch = stripped.match(JSON_OBJECT_REGEX);
    if (!jsonMatch) throw new Error('No JSON found in the label reply.');

    interface RawLabel { text?: string; position?: string; severity?: string; }
    const parsed: { labels?: RawLabel[] } = JSON.parse(jsonMatch[0]);
    const labels: ImageLabel[] = (parsed.labels || []).slice(0, MAX_LABELS_PER_PHOTO).map((l, idx) => ({
      id: `label-${input.photoId}-${idx}`,
      text: plainDashes(l.text || DEFAULT_LABEL_TEXT),
      position: normalizePosition(l.position || ''),
      severity: mapSeverity(l.severity || ''),
      // Don't assume positional correspondence: labels come in the model's order
    }));

    return { photoId: input.photoId, labels, fromModel: true };
  } catch (error: unknown) {
    // A status or a plain word only. The provider's text and the photo address stay out of the log.
    console.error(`${LOG_PREFIX} failed for ${input.photoId} after ${Date.now() - startTime}ms (${describeModelError(error)})`);
    return { photoId: input.photoId, labels: generateFallbackLabels(input.existingDamages), fromModel: false };
  }
}

/**
 * Label photos in parallel batches. Returns the labels by photo id.
 *
 * Non-fatal: with no caller configured, or when not one photo could be
 * labelled by the model, the result is null and the caller carries on without
 * overlays. When only some photos fail, those photos keep labels built from
 * their existing detections.
 */
export async function labelPhotosWithClaude(
  inputs: LabelInput[],
  opts: LabelOptions,
): Promise<Record<string, ImageLabel[]> | null> {
  const call = callerFor(opts);
  if (!call) return null;
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const results: Record<string, ImageLabel[]> = {};

  try {
    let modelLabelled = 0;
    for (let i = 0; i < inputs.length; i += batchSize) {
      // After the request deadline no photo is sent: the rest keep labels built from their existing detections.
      if (opts.signal?.aborted) {
        for (const input of inputs.slice(i)) results[input.photoId] = generateFallbackLabels(input.existingDamages);
        break;
      }
      const batch = inputs.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((input) => labelOne(input, call, opts)));
      for (const r of batchResults) {
        results[r.photoId] = r.labels;
        if (r.fromModel) modelLabelled++;
      }

      // Rate limit delay between batches
      if (i + batchSize < inputs.length) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    if (inputs.length > 0 && modelLabelled === 0) return null;
    if (modelLabelled < inputs.length) {
      console.warn(`${LOG_PREFIX} ${inputs.length - modelLabelled}/${inputs.length} photo(s) used their existing detections`);
    }
    return results;
  } catch (error: unknown) {
    console.error(`${LOG_PREFIX} failed (${describeModelError(error)})`);
    return null;
  }
}

// ─── Fallback labels from existing detections ─────────────────────────────────

function generateFallbackLabels(damages: DamageDetection[]): ImageLabel[] {
  return damages.slice(0, MAX_LABELS_PER_PHOTO).map((d, idx) => ({
    id: `label-fallback-${idx}`,
    text: d.label || d.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    position: normalizePosition(d.location || 'center'),
    severity: mapSeverity(d.severity),
    damageId: d.id,
  }));
}
