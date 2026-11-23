/**
 * Report Editor Utility Functions
 *
 * Pure functions for report editing operations:
 * - Sorting findings by severity
 * - Duplicating findings
 * - Word counting for text fields
 */
import type { NarrativeFinding, FindingSeverity } from './comprehensive-roof-report.js';

/** Severity rank: lower number = more severe */
export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  minor: 3,
  advisory: 4,
  cosmetic: 5,
};

/** Rank assigned to severities not present in `SEVERITY_RANK` (sorts to bottom). */
const UNRANKED_SEVERITY_RANK = 99;

/** Severity buckets driving `getRepairPrioritySummary`. Hoisted as Sets
 *  for O(1) lookup and so a future tier (e.g. `'extreme'`) is added in
 *  one place instead of touching the inline ternary. */
const URGENT_SEVERITIES = new Set<FindingSeverity>(['critical', 'high']);
const RECOMMENDED_SEVERITIES = new Set<FindingSeverity>(['moderate']);

/** Returns true when a string has non-whitespace content. */
function isFilled(text: string | undefined | null): boolean {
  return !!(text && text.trim().length > 0);
}

/** Multiplier used to convert a 0..1 fraction into a 0..100 percentage. */
const PERCENT_MULTIPLIER = 100;

/** Compute a 0-100 percentage with a divide-by-zero guard. */
function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * PERCENT_MULTIPLIER);
}

/** Whitespace-split regex used by `getWordCount` and any other text splitter. */
const REPORT_WHITESPACE_RE = /\s+/;

/** Random-ID radix and slice bounds — `Math.random().toString(36).slice(2, 8)`
 *  generates a 6-character base-36 string. Hoisted so a future ID-format
 *  change is one constant edit, not three magic numbers. */
const RANDOM_ID_RADIX = 36;
const RANDOM_ID_SLICE_START = 2;
const RANDOM_ID_SLICE_END = 8;

/** Length of `Date.prototype.toISOString()`'s `YYYY-MM-DD` prefix. */
const ISO_DATE_PREFIX_LEN = 10;

/** Suffix appended to a duplicated finding's title (`'Original (Copy)'`). */
const COPY_TITLE_SUFFIX = ' (Copy)';

/** Matches a trailing `" (Copy)"` or `" (Copy N)"` suffix so re-duplicating a
 *  finding increments the counter instead of stacking `"(Copy) (Copy)"`.
 *  Anchored to the end and requires the exact `" (Copy"` token, so a title
 *  like `"Copper Flashing"` is not mistaken for an existing copy. */
const COPY_SUFFIX_RE = / \(Copy(?: (\d+))?\)$/;

/**
 * Compute the next copy title for a duplicated finding:
 *  `"Title"` → `"Title (Copy)"` → `"Title (Copy 2)"` → `"Title (Copy 3)"`.
 * The first duplicate gets a bare `"(Copy)"`; subsequent duplicates increment
 * a numeric counter so the editor never produces `"Title (Copy) (Copy)"`.
 */
export function nextCopyTitle(title: string): string {
  const match = title.match(COPY_SUFFIX_RE);
  if (!match) return `${title}${COPY_TITLE_SUFFIX}`;
  const current = match[1] ? parseInt(match[1], 10) : 1;
  const base = title.slice(0, match.index ?? 0);
  return `${base} (Copy ${current + 1})`;
}

/** Pluralize a count + word — `pluralizeUnit(2, 'year')` → "years". */
function pluralizeUnit(n: number, single: string, plural: string = `${single}s`): string {
  return n === 1 ? single : plural;
}

/** Prefix used by `generateFindingId` (`'finding-{ts}-{rand}'`). */
const FINDING_ID_PREFIX = 'finding-';
/** Separator between the timestamp and random tail in a finding ID. */
const FINDING_ID_SEPARATOR = '-';

/** Minimum capacity for a bounded undo stack — passing 0 or negative is
 *  almost always a bug, clamp upward defensively. */
const UNDO_STACK_MIN_CAP = 1;

/**
 * Generate a unique finding ID. Centralised so `duplicateFinding` and
 * `createFindingFromTemplate` (and any future caller) stay in sync if the
 * format ever changes. Prefers `crypto.randomUUID` for guaranteed
 * uniqueness; falls back to `Date.now()` + random suffix in environments
 * where the Web Crypto API is unavailable (very old polyfills, some
 * test runtimes).
 */
function generateFindingId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${FINDING_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${FINDING_ID_PREFIX}${Date.now()}${FINDING_ID_SEPARATOR}${Math.random().toString(RANDOM_ID_RADIX).slice(RANDOM_ID_SLICE_START, RANDOM_ID_SLICE_END)}`;
}

/** Sort findings by severity (critical first). Does not mutate the input. */
export function sortFindingsBySeverity(findings: NarrativeFinding[]): NarrativeFinding[] {
  return [...findings].sort((a, b) => {
    const rankA = SEVERITY_RANK[a.severity] ?? UNRANKED_SEVERITY_RANK;
    const rankB = SEVERITY_RANK[b.severity] ?? UNRANKED_SEVERITY_RANK;
    return rankA - rankB;
  });
}

/** Create a duplicate of a finding with a new unique ID and "(Copy)" suffix. */
export function duplicateFinding(finding: NarrativeFinding): NarrativeFinding {
  return {
    ...finding,
    id: generateFindingId(),
    title: nextCopyTitle(finding.title),
    relatedPhotoIds: [...finding.relatedPhotoIds],
  };
}

/** Count words in a string. Returns 0 for empty/null/undefined input. */
export function getWordCount(text: string | undefined | null): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(REPORT_WHITESPACE_RE).length;
}

// ─── Finding Delta ───────────────────────────────────────────────────────────

/** Content fields compared by `calculateFindingDelta`, in stable report order.
 *  `id` is intentionally excluded — it's identity, not editable content. */
const FINDING_DELTA_FIELDS: (keyof NarrativeFinding)[] = [
  'title',
  'severity',
  'narrative',
  'repairAction',
  'insuranceRelevant',
  'relatedPhotoIds',
  'sourceDamageTypes',
];

/** Array fields compared by value (contents) rather than reference identity. */
const FINDING_ARRAY_FIELDS = new Set<keyof NarrativeFinding>(['relatedPhotoIds', 'sourceDamageTypes']);

/** Order-sensitive shallow equality; a nullish array is treated as empty. */
function arraysShallowEqual(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

/**
 * Return the list of content fields that differ between two versions of a
 * finding, in stable field order. Arrays are compared by contents (so a
 * re-created array with identical entries is *not* a change) and `id` is
 * ignored. An empty result means the edit was a no-op — callers can use this
 * to skip redundant autosaves / API round-trips and avoid needless re-renders.
 */
export function calculateFindingDelta(
  oldFinding: NarrativeFinding,
  newFinding: NarrativeFinding,
): (keyof NarrativeFinding)[] {
  const changed: (keyof NarrativeFinding)[] = [];
  for (const field of FINDING_DELTA_FIELDS) {
    if (FINDING_ARRAY_FIELDS.has(field)) {
      if (!arraysShallowEqual(
        oldFinding[field] as readonly unknown[] | undefined,
        newFinding[field] as readonly unknown[] | undefined,
      )) {
        changed.push(field);
      }
    } else if (oldFinding[field] !== newFinding[field]) {
      changed.push(field);
    }
  }
  return changed;
}

// ─── Finding Templates ──────────────────────────────────────────────────────

export interface FindingTemplate {
  title: string;
  severity: FindingSeverity;
  narrative: string;
  repairAction: string;
  insuranceRelevant: boolean;
}

/**
 * Pre-filled templates for common roofing damage findings.
 * Exported as `readonly` so consumers can't accidentally mutate the shared array.
 */
export const FINDING_TEMPLATES: readonly FindingTemplate[] = Object.freeze([
  {
    title: 'Hail Impact Damage',
    severity: 'high',
    narrative: 'Multiple hail impact marks observed on shingle surfaces. Impacts have displaced granules and created soft spots that compromise the shingle integrity. Damage pattern is consistent with storm-driven hail.',
    repairAction: 'Replace affected shingles in damaged areas. Full replacement may be warranted if damage exceeds 8 impacts per 10x10 test square.',
    insuranceRelevant: true,
  },
  {
    title: 'Wind-Lifted Shingles',
    severity: 'high',
    narrative: 'Several shingles show evidence of wind uplift with broken seal strips and lifted edges. Exposed nail heads and underlayment are visible in affected areas, creating vulnerability to water intrusion.',
    repairAction: 'Re-seal or replace lifted shingles. Apply roofing cement under lifted edges and re-nail as needed.',
    insuranceRelevant: true,
  },
  {
    title: 'Missing Shingles',
    severity: 'critical',
    narrative: 'One or more shingles are completely missing from the roof surface, leaving underlayment or decking exposed to weather. This represents an immediate risk for water infiltration and further wind damage.',
    repairAction: 'Immediate shingle replacement required. Inspect underlayment for water damage before installing new shingles.',
    insuranceRelevant: true,
  },
  {
    title: 'Granule Loss',
    severity: 'moderate',
    narrative: 'Widespread granule loss observed across shingle surfaces. Bare spots and dark patches indicate UV degradation has progressed beyond normal wear. Granule accumulation noted in gutters and at drip edges.',
    repairAction: 'Monitor closely. Plan for roof replacement within 2-5 years depending on rate of deterioration.',
    insuranceRelevant: false,
  },
  {
    title: 'Flashing Deterioration',
    severity: 'moderate',
    narrative: 'Flashing around penetrations shows signs of rust, separation, or cracked sealant. Gaps between flashing and roof surface may allow water entry during heavy rain or wind-driven precipitation.',
    repairAction: 'Remove old sealant, clean surfaces, and re-seal all flashing points. Replace corroded flashing sections.',
    insuranceRelevant: false,
  },
  {
    title: 'Pipe Boot Failure',
    severity: 'high',
    narrative: 'Rubber boot around plumbing vent pipe is cracked, split, or pulled away from the pipe. This is a common source of active roof leaks and requires prompt attention.',
    repairAction: 'Replace pipe boot with new rubber or metal collar. Apply sealant at base connection.',
    insuranceRelevant: false,
  },
  {
    title: 'Ridge Cap Damage',
    severity: 'moderate',
    narrative: 'Ridge cap shingles show cracking, lifting, or loss of seal. The ridge line is one of the most wind-vulnerable areas of the roof and compromised ridge caps increase risk of wind-driven rain entry.',
    repairAction: 'Replace damaged ridge cap shingles with new high-profile ridge cap material.',
    insuranceRelevant: true,
  },
  {
    title: 'Moss/Algae Growth',
    severity: 'minor',
    narrative: 'Biological growth (moss or algae) observed on shingle surfaces, particularly on north-facing slopes. While cosmetic in early stages, prolonged growth can trap moisture and accelerate shingle deterioration.',
    repairAction: 'Apply zinc-based algae treatment. Consider zinc or copper strips at ridge for prevention.',
    insuranceRelevant: false,
  },
]);

/** Create a blank NarrativeFinding for a "Add Finding" button. Goes through
 *  the same `generateFindingId` path so blank and template-derived findings
 *  share the same uniqueness guarantee. */
export function createBlankFinding(title: string, severity: FindingSeverity): NarrativeFinding {
  return {
    id: generateFindingId(),
    title,
    severity,
    narrative: '',
    repairAction: '',
    insuranceRelevant: false,
    relatedPhotoIds: [],
  };
}

/** Create a NarrativeFinding from a template with a unique ID */
export function createFindingFromTemplate(template: FindingTemplate): NarrativeFinding {
  return {
    id: generateFindingId(),
    title: template.title,
    severity: template.severity,
    narrative: template.narrative,
    repairAction: template.repairAction,
    insuranceRelevant: template.insuranceRelevant,
    relatedPhotoIds: [],
  };
}

// ─── Condition Badge ─────────────────────────────────────────────────────────

export interface ConditionBadge {
  label: string;
  color: string;
  score: number;
}

/**
 * Severity → display badge (label, color, anchor score). Hoisted to module
 * scope so the table isn't reallocated on every call. Uses the legacy
 * "low/medium/none" damage-analysis vocabulary, distinct from the
 * `FindingSeverity` enum (`minor/moderate/cosmetic`).
 */
export const CONDITION_BADGES: Readonly<Record<string, ConditionBadge>> = Object.freeze({
  critical: { label: 'Critical',  color: '#ef4444', score: 15 },
  high:     { label: 'Poor',      color: '#f97316', score: 35 },
  medium:   { label: 'Fair',      color: '#eab308', score: 55 },
  low:      { label: 'Good',      color: '#22c55e', score: 75 },
  none:     { label: 'Excellent', color: '#10b981', score: 100 },
});

const UNKNOWN_CONDITION_BADGE: ConditionBadge = Object.freeze({ label: 'Unknown', color: '#6b7280', score: 50 });

/** Section-completeness item labels shown in the report-completeness checklist. */
const COMPLETENESS_LABEL_EXEC_SUMMARY = 'Executive Summary';
const COMPLETENESS_LABEL_FINDINGS = 'Inspection Findings';
const COMPLETENESS_LABEL_PHOTOS = 'Photo Documentation';
const COMPLETENESS_LABEL_INSPECTOR_NOTES = 'Inspector Notes';
const COMPLETENESS_LABEL_CUSTOMER_INFO = 'Customer Information';
const COMPLETENESS_LABEL_STORM_DATA = 'Storm Data';

/** At-a-glance row labels. */
const GLANCE_LABEL_CONDITION = 'Condition';
const GLANCE_LABEL_DAMAGE_TYPES = 'Damage Types';
const GLANCE_LABEL_PHOTOS_ANALYZED = 'Photos Analyzed';
const GLANCE_LABEL_STORM_EVENTS = 'Storm Events';
const GLANCE_LABEL_ROOF_AGE = 'Roof Age';
const GLANCE_LABEL_ESTIMATE_RANGE = 'Estimate Range';
const GLANCE_LABEL_RECOMMENDATION = 'Recommendation';

/** Singular noun used in the at-a-glance Roof Age row (`'12 years'` / `'1 year'`). */
const GLANCE_YEAR_SINGULAR = 'year';

/** At-a-glance value for a brand-new roof (age exactly 0) — a real value,
 *  distinct from `null` which means the age is unknown and shows no row. */
const GLANCE_ROOF_AGE_NEW = 'New (< 1 year)';

/** Get a visual condition badge from an overall severity string. */
export function getConditionBadge(severity: string): ConditionBadge {
  return CONDITION_BADGES[severity] || UNKNOWN_CONDITION_BADGE;
}

// ─── Finding Stats ───────────────────────────────────────────────────────────

export interface FindingStats {
  critical: number;
  high: number;
  moderate: number;
  minor: number;
  advisory: number;
  cosmetic: number;
  total: number;
  insuranceRelevant: number;
}

/** Get a breakdown of findings by severity and insurance relevance */
export function getFindingStats(findings: NarrativeFinding[]): FindingStats {
  const stats: FindingStats = {
    critical: 0, high: 0, moderate: 0, minor: 0, advisory: 0, cosmetic: 0,
    total: findings.length,
    insuranceRelevant: 0,
  };
  for (const f of findings) {
    if (f.severity in SEVERITY_RANK) {
      // Safe — checked `severity in SEVERITY_RANK` so it's a known FindingSeverity key
      // and FindingStats has a `number` slot for each.
      stats[f.severity] += 1;
    }
    if (f.insuranceRelevant) stats.insuranceRelevant++;
  }
  return stats;
}

/** Filter findings by severity. Returns all if filter is null or empty. */
export function filterFindingsBySeverity(
  findings: NarrativeFinding[],
  severities: FindingSeverity[] | null,
): NarrativeFinding[] {
  if (!severities || severities.length === 0) return [...findings];
  return findings.filter(f => severities.includes(f.severity));
}

/** Count findings that are insurance-relevant */
export function getInsuranceRelevantCount(findings: NarrativeFinding[]): number {
  return findings.filter(f => f.insuranceRelevant).length;
}

// ─── Report Completeness ─────────────────────────────────────────────────────

export interface CompletenessItem {
  key: string;
  label: string;
  complete: boolean;
}

export interface ReportCompleteness {
  percentage: number;
  items: CompletenessItem[];
}

export interface ReportCompletenessInput {
  executiveSummary?: string;
  findings?: NarrativeFinding[];
  photoCount?: number;
  inspectorNotes?: string;
  customerName?: string;
  stormData?: boolean;
}

/** Check how complete a report is based on filled sections */
export function getReportCompleteness(input: ReportCompletenessInput): ReportCompleteness {
  const items: CompletenessItem[] = [
    { key: 'executiveSummary', label: COMPLETENESS_LABEL_EXEC_SUMMARY, complete: isFilled(input.executiveSummary) },
    { key: 'findings', label: COMPLETENESS_LABEL_FINDINGS, complete: !!(input.findings && input.findings.length > 0) },
    { key: 'photos', label: COMPLETENESS_LABEL_PHOTOS, complete: !!(input.photoCount && input.photoCount > 0) },
    { key: 'inspectorNotes', label: COMPLETENESS_LABEL_INSPECTOR_NOTES, complete: isFilled(input.inspectorNotes) },
    { key: 'customerInfo', label: COMPLETENESS_LABEL_CUSTOMER_INFO, complete: isFilled(input.customerName) },
    { key: 'stormData', label: COMPLETENESS_LABEL_STORM_DATA, complete: !!input.stormData },
  ];

  const completedCount = items.filter(i => i.complete).length;
  return { percentage: percentage(completedCount, items.length), items };
}

/** Get character count for narrative text. Returns 0 for null/undefined. */
export function getNarrativeCharCount(text: string | undefined | null): number {
  if (!text) return 0;
  return text.length;
}

// ─── Report At-a-Glance ─────────────────────────────────────────────────────

export interface GlanceItem {
  label: string;
  value: string;
}

export interface AtAGlanceInput {
  damageTypeCount?: number;
  photoCount?: number;
  stormEvents?: number;
  roofAgeYears?: number | null;
  overallSeverity?: string;
  repairEstimateRange?: string;
  recommendedAction?: string;
}

/** Extract key data points for a quick reference summary */
export function getReportAtAGlance(input: AtAGlanceInput): GlanceItem[] {
  const items: GlanceItem[] = [];

  if (input.overallSeverity) {
    const badge = getConditionBadge(input.overallSeverity);
    items.push({ label: GLANCE_LABEL_CONDITION, value: badge.label });
  }
  if (input.damageTypeCount && input.damageTypeCount > 0) {
    items.push({ label: GLANCE_LABEL_DAMAGE_TYPES, value: String(input.damageTypeCount) });
  }
  if (input.photoCount && input.photoCount > 0) {
    items.push({ label: GLANCE_LABEL_PHOTOS_ANALYZED, value: String(input.photoCount) });
  }
  if (input.stormEvents && input.stormEvents > 0) {
    items.push({ label: GLANCE_LABEL_STORM_EVENTS, value: String(input.stormEvents) });
  }
  if (input.roofAgeYears != null && input.roofAgeYears >= 0) {
    // Age 0 is a brand-new roof, not "unknown" (which is `null` → no row).
    const value = input.roofAgeYears === 0
      ? GLANCE_ROOF_AGE_NEW
      : `${input.roofAgeYears} ${pluralizeUnit(input.roofAgeYears, GLANCE_YEAR_SINGULAR)}`;
    items.push({ label: GLANCE_LABEL_ROOF_AGE, value });
  }
  if (input.repairEstimateRange) {
    items.push({ label: GLANCE_LABEL_ESTIMATE_RANGE, value: input.repairEstimateRange });
  }
  if (input.recommendedAction) {
    items.push({ label: GLANCE_LABEL_RECOMMENDATION, value: input.recommendedAction });
  }

  return items;
}

// ─── Undo Stack ──────────────────────────────────────────────────────────────

export interface UndoStack<T> {
  push: (item: T) => void;
  pop: () => T | undefined;
  canUndo: () => boolean;
  clear: () => void;
  size: () => number;
}

/**
 * Create a bounded undo stack. Evicts oldest items when maxSize is exceeded.
 * `maxSize` is clamped to ≥1 — passing 0 or negative would silently
 * never store anything, which is almost always a bug.
 */
export function createUndoStack<T>(maxSize: number): UndoStack<T> {
  // Number.isFinite guards against NaN/Infinity — Math.max(1, NaN)
  // returns NaN, which would let items grow unbounded.
  const cap = Number.isFinite(maxSize)
    ? Math.max(UNDO_STACK_MIN_CAP, Math.floor(maxSize))
    : UNDO_STACK_MIN_CAP;
  const items: T[] = [];

  return {
    push(item: T) {
      items.push(item);
      if (items.length > cap) {
        items.shift();
      }
    },
    pop(): T | undefined {
      return items.pop();
    },
    canUndo(): boolean {
      return items.length > 0;
    },
    clear() {
      items.length = 0;
    },
    size(): number {
      return items.length;
    },
  };
}

// ─── Rewrite Tone Presets ────────────────────────────────────────────────────

export interface TonePreset {
  label: string;
  instruction: string;
}

/** Tone preset labels — hoisted so a future copy / i18n pass touches one place. */
const TONE_LABEL_FORMAL = 'Formal';
const TONE_LABEL_FRIENDLY = 'Friendly';
const TONE_LABEL_TECHNICAL = 'Technical';
const TONE_LABEL_BRIEF = 'Brief';
const TONE_LABEL_INSURANCE = 'Insurance';
const TONE_LABEL_DETAILED = 'Detailed';

/** Pre-built tone instructions for AI narrative rewrites */
export const REWRITE_TONE_PRESETS: readonly TonePreset[] = Object.freeze([
  { label: TONE_LABEL_FORMAL, instruction: 'Rewrite in a formal, professional tone suitable for insurance documentation. Use precise terminology.' },
  { label: TONE_LABEL_FRIENDLY, instruction: 'Rewrite in a warm, approachable tone for homeowners. Avoid jargon, explain technical terms.' },
  { label: TONE_LABEL_TECHNICAL, instruction: 'Rewrite with detailed technical roofing terminology. Include specific measurements and material references.' },
  { label: TONE_LABEL_BRIEF, instruction: 'Condense to 2-3 sentences. Keep only the essential damage description and recommended action.' },
  { label: TONE_LABEL_INSURANCE, instruction: 'Rewrite for insurance adjusters. Reference HAAG standards, include specific damage measurements, and use claim-ready language.' },
  { label: TONE_LABEL_DETAILED, instruction: 'Expand with more detail. Describe the damage location, extent, potential consequences if unrepaired, and urgency level.' },
]);

// ─── Repair Priority Summary ─────────────────────────────────────────────────

export interface RepairPrioritySummary {
  urgent: string[];
  recommended: string[];
  optional: string[];
}

/** Categorize findings into repair priority levels based on severity */
export function getRepairPrioritySummary(findings: NarrativeFinding[]): RepairPrioritySummary {
  const summary: RepairPrioritySummary = { urgent: [], recommended: [], optional: [] };

  for (const f of findings) {
    if (URGENT_SEVERITIES.has(f.severity)) {
      summary.urgent.push(f.title);
    } else if (RECOMMENDED_SEVERITIES.has(f.severity)) {
      summary.recommended.push(f.title);
    } else {
      summary.optional.push(f.title);
    }
  }

  return summary;
}

// ─── Export Filename ─────────────────────────────────────────────────────────

// Hoisted regexes — were being recompiled on every export-filename build.
const FILENAME_INVALID_CHARS = /[^a-z0-9\s-]/g;
const FILENAME_WHITESPACE_RUN = /\s+/g;
const FILENAME_DASH_RUN = /-+/g;
const FILENAME_TRIM_DASHES = /^-+|-+$/g;

/** Default base name for the report-export filename. */
const FILENAME_BASE = 'roof-report';
/** Filename-parts separator (used in `.join()` and as the whitespace replacement). */
const FILENAME_PARTS_SEPARATOR = '-';

/**
 * Generate a sanitized filename for report exports (PDF/HTML).
 * Keeps `[a-z0-9-]` only, collapses runs of `-`, and trims any leading/trailing
 * `-` so the filename is portable across all OS/browser download dialogs.
 */
export function formatReportExportFilename(address?: string, date?: string): string {
  const parts: string[] = [FILENAME_BASE];

  if (address && address.trim()) {
    const sanitized = address
      .toLowerCase()
      .replace(FILENAME_INVALID_CHARS, '')
      .trim()
      .replace(FILENAME_WHITESPACE_RUN, FILENAME_PARTS_SEPARATOR);
    if (sanitized) parts.push(sanitized);
  }

  const dateStr = date || new Date().toISOString().slice(0, ISO_DATE_PREFIX_LEN);
  parts.push(dateStr);

  // Final pass collapses any double-dashes from accidental empty parts and
  // strips leading/trailing dashes for clean filenames like "roof-report-123-main-st-2026-04-24".
  const finalName = parts
    .join(FILENAME_PARTS_SEPARATOR)
    .replace(FILENAME_DASH_RUN, FILENAME_PARTS_SEPARATOR)
    .replace(FILENAME_TRIM_DASHES, '');
  // Defensive guard: an extreme input could trim everything away. Always
  // return at least the base so the download dialog has a valid name.
  return finalName || FILENAME_BASE;
}

const REPORT_ID_DISPLAY_PREFIX = 'RPT';
const REPORT_ID_DISPLAY_LEN = 8;
/** Separator between the `'RPT'` prefix and the truncated id segment. */
const REPORT_ID_DISPLAY_SEPARATOR = '-';
const REPORT_ID_UNKNOWN = `${REPORT_ID_DISPLAY_PREFIX}${REPORT_ID_DISPLAY_SEPARATOR}UNKNOWN`;
/** Strip dashes and underscores from a report ID before formatting it for display. */
const REPORT_ID_NORMALIZE_RE = /[-_]/g;

/** Format a report ID for display (e.g., "RPT-ABC123DE") */
export function formatReportId(id: string | undefined | null): string {
  if (!id) return REPORT_ID_UNKNOWN;
  const clean = id.replace(REPORT_ID_NORMALIZE_RE, '').toUpperCase().slice(0, REPORT_ID_DISPLAY_LEN);
  return clean ? `${REPORT_ID_DISPLAY_PREFIX}${REPORT_ID_DISPLAY_SEPARATOR}${clean}` : REPORT_ID_UNKNOWN;
}
