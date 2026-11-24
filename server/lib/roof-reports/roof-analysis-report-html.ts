/**
 * Roof Analysis Report HTML Generator
 * Generates a printable/exportable report from analysis results.
 * Uses same patterns as export-utils.ts (generateCompanyHeader, exportToPDF).
 *
 * Now includes:
 * - Storm history section (most recent hail/wind + 3-year summary)
 * - Damage analysis with labeled photos
 * - Repair estimate with line items
 */
import type { RoofAnalysisRecord } from './old-types.js';
import type { ComprehensiveRoofReport, AnalyzedPhoto, RoofAgeEstimation, ReportType, ReportTemplate, EnhancedStormData, StormSummarySection, RoofConditionIndex } from './comprehensive-roof-report.js';
import { getTemplateConfig, type ReportTemplateConfig } from './report-templates.js';
import { getGoogleFontUrl, getCssFontFamily } from './fonts.js';
import { formatCurrency, formatUnit } from './roof-repair-pricing.js';
import { escapeHtml } from './escape-html.js';
import { PLATFORM_NAME } from './platform.js';
import { motionStyles, motionRuntime } from './report-motion.js';
import { nonceAttr, safeColor as safeHexColor, safeUrl as safeLinkUrl, safeHttpUrl, safeImageSrc } from './html-safety.js';
import { normalizeReportNumbers } from './report-normalize.js';

const FEATURE_COLORS: Record<string, string> = {
  solar_panel: '#F59E0B',
  green_roof: '#22C55E',
  damage_region: '#EF4444',
  material_zone: '#3B82F6',
  skylight: '#A855F7',
  vent: '#6B7280',
  chimney: '#D97706',
  other: '#8B5CF6',
};

// ─── Brand color defaults (must match measurement-report-html.ts) ──────
const DEFAULT_BRAND_PRIMARY = '#ea580c';
const DEFAULT_BRAND_SECONDARY = '#1e40af';
/** Fallback dot color when a feature has no `color` and an unknown `type`. */
const DEFAULT_FEATURE_DOT_COLOR = '#888';
const MS_PER_SECOND = 1000;

// ─── Display constants ────────────────────────────────────────────────
/** Plain hyphen placeholder rendered when a numeric/string value is missing. */
const EMPTY_VALUE_PLACEHOLDER = '-';
/** Locale used by every `Date.toLocaleDateString()` call in this module. */
const DATE_LOCALE = 'en-US';
/** Unit suffix appended by `formatSqft` to area values. */
const SQFT_UNIT_SUFFIX = ' sqft';
/** Suffix used by `formatConfidence` after the rounded integer. */
const PERCENT_SUFFIX = '%';
/** Separator between contact-line items in the footer (HTML-encoded middle-dot). */
const FOOTER_CONTACT_SEPARATOR = '  &middot;  ';

// ─── Summary-row labels ──────────────────────────────────────────────
const LABEL_SOLAR_PANELS = 'Solar Panels';
const LABEL_GREEN_ROOF = 'Green Roof';
const LABEL_PRIMARY_MATERIAL = 'Primary Material';
const LABEL_DAMAGE_ZONES = 'Damage Zones';
const LABEL_TOTAL_ANALYZED_AREA = 'Total Analyzed Area';
const FEATURE_STATUS_DETECTED = 'Detected';
const CONFIDENCE_SUFFIX = ' confidence';

// ─── Underscore→space regex used to humanise feature-type slugs. ─────
const UNDERSCORE_TO_SPACE_RE = /_/g;

// ─── Roof-analysis report header / property-info constants ──────────
/** Report heading (`<h1>`). */
const MSG_ANALYSIS_REPORT_TITLE = 'Roof Analysis Report';
/** Analysis-type discriminant emitted by satellite imagery analysis. */
const ANALYSIS_TYPE_SATELLITE = 'satellite';
/** Display strings for the two analysis types. */
const MSG_SATELLITE_ANALYSIS_TYPE = 'Satellite Imagery Analysis';
const MSG_PHOTO_ANALYSIS_TYPE = 'Photo Analysis';
/** Property-info row labels. */
const LABEL_ADDRESS = 'Address';
const LABEL_COORDINATES = 'Coordinates';
const LABEL_PROVIDER = 'Provider';
const LABEL_STATUS = 'Status';
const LABEL_PROCESSING_TIME = 'Processing Time';
/** Fallback rendered when `model_provider` is absent. */
const PROVIDER_FALLBACK = 'N/A';
/** Decimal precision for the processing-time row (e.g. "12.4 seconds"). */
const PROCESSING_TIME_DECIMALS = 1;
const SECONDS_SUFFIX = ' seconds';
/** Satellite-image alt text + caption. */
const MSG_SATELLITE_IMAGE_ALT = 'Satellite image';
const MSG_SATELLITE_IMAGERY_SOURCE = 'Satellite imagery source';

// ─── Comprehensive-report title helpers ──────────────────────────────
/** Per-template report titles for the comprehensive HTML output. */
const TEMPLATE_TITLE_MAP: Record<string, string> = {
  insurance: 'Insurance Claim Inspection Report',
  homeowner: 'Roof Inspection Summary',
  quick: 'Quick Roof Assessment',
  full: 'Comprehensive Roof Analysis Report',
};
/** Title used when all 3 report types are selected and no template overrides it. */
const MSG_COMPREHENSIVE_REPORT_TITLE = 'Comprehensive Roof Analysis Report';
/** Single-type fallback titles. */
const MSG_AI_INSPECTION_REPORT_TITLE = 'AI Inspection Report';
const MSG_MEASUREMENT_REPORT_TITLE = 'Roof Measurement Report';
const MSG_STORM_REPORT_TITLE = 'Storm & Weather Report';
/** Counts used by the title-fallback ternary. */
const ALL_REPORT_TYPES_COUNT = 3;
const SINGLE_REPORT_TYPE_COUNT = 1;
/** Display names for `ReportType` values used in the multi-type title build. */
const REPORT_TYPE_DISPLAY_NAMES: Record<string, string> = {
  inspection: 'Inspection',
  measurement: 'Measurement',
  storm: 'Storm',
};
/** Multi-type title template parts (`'Roof Inspection & Storm Report'`). */
const MULTI_TYPE_TITLE_PREFIX = 'Roof ';
const MULTI_TYPE_TITLE_SUFFIX = ' Report';
const MULTI_TYPE_SEPARATOR = ' & ';

// ─── Property-section verdict + roof-detail constants ────────────────
/** Inverse of severity → display-friendly condition score (0-100). */
const SEVERITY_TO_CONDITION_SCORE: Record<string, number> = {
  none: 95, low: 80, medium: 60, high: 35, critical: 15,
};
/** Default condition score when severity isn't in the map. */
const CONDITION_SCORE_DEFAULT = 50;

/** Verdict tier — drives the colored "GOOD/FAIR/RISKY/POOR/FAILED" badge.
 *  Sorted descending; first row whose `minScore` is met wins. */
interface VerdictTier {
  minScore: number;
  label: string;
  subtext: string;
  scoreColor: string;
  bg: string;
  border: string;
  textColor: string;
}
const VERDICT_TIERS: ReadonlyArray<VerdictTier> = [
  { minScore: 80, label: 'GOOD',   subtext: 'Roof in good condition',  scoreColor: '#22c55e', bg: '#f0fdf4', border: '#86efac', textColor: '#166534' },
  { minScore: 60, label: 'FAIR',   subtext: 'Monitor &amp; maintain',  scoreColor: '#eab308', bg: '#fefce8', border: '#fde047', textColor: '#854d0e' },
  { minScore: 40, label: 'RISKY',  subtext: 'Repairs recommended',     scoreColor: '#f97316', bg: '#fff7ed', border: '#fdba74', textColor: '#9a3412' },
  { minScore: 20, label: 'POOR',   subtext: 'Major repairs needed',    scoreColor: '#ef4444', bg: '#fef2f2', border: '#ef4444', textColor: '#991b1b' },
  { minScore: 0,  label: 'FAILED', subtext: 'Replacement required',    scoreColor: '#ef4444', bg: '#fef2f2', border: '#ef4444', textColor: '#991b1b' },
];

/** Roof-detail row labels (Material/Size/Pitch/Stories/Age). */
const LABEL_DETAIL_MATERIAL = 'Material:';
const LABEL_DETAIL_SIZE = 'Size:';
const LABEL_DETAIL_PITCH = 'Pitch:';
const LABEL_DETAIL_STORIES = 'Stories:';
const LABEL_DETAIL_EST_AGE = 'Est. Age:';
/** Suffix appended after a numeric `squares` value. */
const SQUARES_SUFFIX = ' Squares';
/** Suffix appended after a numeric `years` value. */
const YEARS_SUFFIX = ' years';
/** Prefix used to indicate an estimated value (`~12 years`). */
const ESTIMATE_PREFIX = '~';

/** Section headings. */
const HEADING_PROPERTY_INFO = 'Property Information';
const HEADING_OVERALL_CONDITION = 'Overall Condition';

// ─── Inspector-notes / storm-history headings + risk colors ─────────
const LABEL_INSPECTOR_NOTES = 'Inspector Notes';
const LABEL_STORM_HISTORY_PREFIX = 'Storm History';
const MILE_RADIUS_SUFFIX = '-Mile Radius';
/** Generic neutral border used for section underlines + table cell borders. */
const BORDER_COLOR_NEUTRAL = '#e5e7eb';

/** Shared risk-level color palette (red/amber/green tier) — used for both
 *  the storm `riskLevel` and the `claimPotential` lozenge. Replaces two
 *  identical 3-clause inline ternaries. */
const RISK_LEVEL_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
};
const RISK_LEVEL_COLOR_DEFAULT = '#22c55e';

/** Recent-hail-storm card color block. */
const STORM_HAIL_CARD_COLORS = {
  bg: '#fef3c7',
  labelColor: '#92400e',
  valueColor: '#78350f',
  border: '#f59e0b',
  distanceColor: '#a16207',
} as const;

/** Recent-wind-storm card color block. */
const STORM_WIND_CARD_COLORS = {
  bg: '#dbeafe',
  labelColor: '#1e40af',
  valueColor: '#1e3a8a',
  border: '#3b82f6',
  distanceColor: '#2563eb',
} as const;

/** Recommended Date of Loss banner color block. */
const STORM_DOL_COLORS = {
  bg: '#fef3c7',
  border: '#f59e0b',
  labelColor: '#92400e',
  dateColor: '#78350f',
  eventColor: '#92400e',
  reasonColor: '#a16207',
} as const;

/** Conditional tornado-event-count stat-card colors (when count > 0). */
const STORM_TORNADO_ALERT_BG = '#fee2e2';
const STORM_TORNADO_ALERT_COLOR = '#dc2626';

// ─── Damage Analysis section UI strings + severity tables ───────────
/** Empty-state messaging for the no-photos-uploaded case. */
const MSG_NO_PHOTOS_UPLOADED = 'No photos were uploaded for damage analysis.';
const MSG_UPLOAD_PHOTOS_HINT = 'Upload roof photos to receive AI-powered damage detection and severity scoring.';
/** Damage-analysis summary card labels. */
const LABEL_PHOTOS_ANALYZED = 'Photos Analyzed';
const LABEL_WITH_DAMAGE = 'With Damage';
const LABEL_OVERALL_SEVERITY = 'Overall Severity';
/** Action label prefix on a structured-finding repair-action line. */
const LABEL_ACTION_PREFIX = 'Action:';
/** Photos-with-damage stat card text color (red emphasis). */
const STAT_PHOTOS_WITH_DAMAGE_COLOR = '#ef4444';

/** Severity → finding/bounding-box border color (table-driven; replaces
 *  two parallel inline 4-clause ternaries, one in `findingCards` fallback,
 *  one in the bounding-box overlay builder). */
const SEVERITY_BORDER_COLORS_FALLBACK: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
};
const SEVERITY_BORDER_COLOR_FALLBACK_DEFAULT = '#22c55e';

/** Severity → fallback finding-card badge label (table-driven; replaces
 *  inline 4-clause ternary). Used only by the structured-findings fallback
 *  branch where the original ladder mapped 'medium' → 'MODERATE' (not its
 *  uppercased name). */
const SEVERITY_BADGE_LABELS_FALLBACK: Record<string, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MODERATE',
};
const SEVERITY_BADGE_LABEL_FALLBACK_DEFAULT = 'MINOR';

// ─── Company header strings + SVG score-ring constants ──────────────
/** Prefix on the contractor license-number line of the company header. */
const LABEL_LICENSE_PREFIX = 'License #';
/** Visual separator placed between phone / email / website on the contact line. */
const CONTACT_SEPARATOR = '  &middot;  ';
/** Logo sizing constraints in the company header (when a logo is supplied). */
const COMPANY_LOGO_MAX_HEIGHT_PX = 60;
const COMPANY_LOGO_MAX_WIDTH_PX = 160;
/** Score-ring SVG geometry (used by buildPropertySection's condition ring). */
const SCORE_RING_VIEWBOX = '0 0 100 100';
const SCORE_RING_CX = 50;
const SCORE_RING_CY = 50;
const SCORE_RING_RADIUS = 45;
const SCORE_RING_STROKE_WIDTH = 8;
/** Circumference = 2π·radius. Computed once at module load so a future
 *  RADIUS tweak doesn't require hand-rounding the magic 283 / 2.83 pair. */
const SCORE_RING_DASH_TOTAL = 2 * Math.PI * SCORE_RING_RADIUS;
/** Multiplier converting a 0–100 score to its SVG dash length. */
const SCORE_RING_SCORE_TO_DASH = SCORE_RING_DASH_TOTAL / 100;

// ─── Storm-history section UI strings ────────────────────────────────
/** Suffix appended to a distance value (`'1.5 miles away'`). */
const MILES_AWAY_SUFFIX = ' miles away';
/** Decimal precision for storm-distance display. */
const DISTANCE_DECIMALS = 1;
/** Recent-storm card labels. */
const MSG_RECENT_HAIL_LABEL = 'Most Recent Hail Storm';
const MSG_RECENT_WIND_LABEL = 'Most Recent Wind Storm';
/** 4-stat summary card labels. */
const STAT_LABEL_TOTAL_EVENTS = 'Total Events';
const STAT_LABEL_HAIL_EVENTS = 'Hail Events';
const STAT_LABEL_WIND_EVENTS = 'Wind Events';
const STAT_LABEL_TORNADOES = 'Tornadoes';
/** Risk-row labels. */
const RISK_LABEL_RISK_LEVEL = 'Risk Level';
const RISK_LABEL_CLAIM_POTENTIAL = 'Claim Potential';
const RISK_LABEL_LARGEST_HAIL = 'Largest Hail';
const RISK_LABEL_HIGHEST_WIND = 'Highest Wind';
/** Risk-score prefix (`'Score: 65/100'`). */
const RISK_SCORE_PREFIX = 'Score: ';
const RISK_SCORE_DENOMINATOR = '/100';
/** Year-table column headers. */
const YEAR_TABLE_LABEL_YEAR = 'Year';
const YEAR_TABLE_LABEL_HAIL = 'Hail';
const YEAR_TABLE_LABEL_WIND = 'Wind';
const YEAR_TABLE_LABEL_TOTAL = 'Total';
/** Recommended Date of Loss label. */
const MSG_RECOMMENDED_DOL_LABEL = 'Recommended Date of Loss (Insurance Claim)';
/** Suffixes for hail (inches double-quote) + wind (mph). */
const INCHES_DOUBLE_QUOTE_SUFFIX = '"';
const MPH_SUFFIX = ' mph';

// ─── buildRoofAgeSection constants ───────────────────────────────────
/** Material-condition → display colors (bg + text). Hoisted from inline. */
const ROOF_AGE_CONDITION_COLORS: Record<string, { bg: string; text: string }> = {
  excellent: { bg: '#dcfce7', text: '#166534' },
  good:      { bg: '#dbeafe', text: '#1e40af' },
  fair:      { bg: '#fef9c3', text: '#854d0e' },
  poor:      { bg: '#fed7aa', text: '#c2410c' },
  critical:  { bg: '#fecaca', text: '#b91c1c' },
};

/** Confidence-level → display colors (bg + text). Hoisted from inline. */
const ROOF_AGE_CONFIDENCE_COLORS: Record<string, { bg: string; text: string }> = {
  high:   { bg: '#dcfce7', text: '#166534' },
  medium: { bg: '#fef9c3', text: '#854d0e' },
  low:    { bg: '#f3f4f6', text: '#6b7280' },
};

/** Section heading + per-card labels in the AI roof-age block. */
const LABEL_AI_ROOF_ANALYSIS = 'AI Roof Analysis';
const LABEL_ESTIMATED_AGE = 'Estimated Age';
const LABEL_MATERIAL = 'Material';
const LABEL_CONDITION = 'Condition';
const LABEL_AGE_INDICATORS = 'Age Indicators';

// ─── buildInspectorNotesSection constants ────────────────────────────
/** Newline regex used to convert plain-text line breaks to `<br>`. */
const NEWLINE_RE = /\n/g;
/** HTML break tag used by the notes formatter. */
const HTML_LINE_BREAK = '<br>';
/** Substrings that flip the inspector-notes panel to its red/urgent style. */
const URGENT_NOTE_KEYWORDS: readonly string[] = [
  'not repairable',
  'must be replaced',
  'replacement required',
  'failed',
  'critical',
  'immediate',
];

// ─── buildEnhancedStormSection constants ─────────────────────────────
/** Cap on narratives rendered in the event-narratives block. */
const MAX_NARRATIVES_DISPLAYED = 5;
/** Truncation point for each narrative preview (chars). */
const NARRATIVE_PREVIEW_MAX_CHARS = 500;
/** Cap on NOAA event-page reference rows. */
const MAX_NOAA_REFS_DISPLAYED = 8;
/** Cumulative-exposure tier color (text color only — no bg). */
const EXPOSURE_TIER_COLORS: Record<string, string> = {
  extreme: '#ef4444',
  high:    '#f97316',
};
const EXPOSURE_TIER_COLOR_DEFAULT = '#eab308';
/** Section / card labels for the enhanced storm block. */
const LABEL_EVENT_NARRATIVES = 'Event Narratives (NOAA/NWS Reports)';
const LABEL_PROPERTY_STORM_PROFILE = 'Property Storm Profile';
const LABEL_NOAA_REFS = 'NOAA Storm Event References';
const LABEL_WORST_STORM_YEAR = 'Worst Storm Year';
const LABEL_AVG_EVENTS_YEAR = 'Avg Events/Year';
const LABEL_STORM_FREE_YEARS = 'Storm-Free Years';
const LABEL_CUMULATIVE_EXPOSURE = 'Cumulative Exposure';
const LABEL_FULL_COUNTY_DB = 'Full County Storm Database';
/** Helper text under the NOAA-references heading. */
const MSG_NOAA_REF_HELPER = 'These official NOAA records can support insurance claims.';
/** Empty-state for when no narratives are available. */
const MSG_NO_NARRATIVES = 'No detailed storm narratives available from NOAA/NWS for this area.';
/** Fallbacks for when profile data is missing. */
const EXPOSURE_FALLBACK_LABEL = 'Unknown';
const WORST_YEAR_FALLBACK = '-';
const PROFILE_DECIMALS = 1;

// ─── buildDamageAnalysisSection constants ────────────────────────────
/** Lower index = worse severity. Used by the damage-table sort. */
const DAMAGE_SEVERITY_SORT_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};
const DAMAGE_SEVERITY_SORT_FALLBACK = 4;

/** Severity → bg/text/border colors for the structured-finding cards. */
const FINDING_SEVERITY_COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: '#fef2f2', text: '#991b1b', border: '#ef4444' },
  high:     { bg: '#fff7ed', text: '#9a3412', border: '#f97316' },
  moderate: { bg: '#fefce8', text: '#854d0e', border: '#eab308' },
  minor:    { bg: '#f0fdf4', text: '#166534', border: '#22c55e' },
  advisory: { bg: '#f9fafb', text: '#374151', border: '#6b7280' },
  cosmetic: { bg: '#f9fafb', text: '#374151', border: '#9ca3af' },
};

/** Short recommendation phrase per severity (shown in the table cell). */
const RECOMMENDATION_BY_SEVERITY: Record<string, string> = {
  critical: 'Immediate repair needed',
  high:     'Repair within 30 days',
  medium:   'Schedule repair',
  low:      'Monitor condition',
};
const RECOMMENDATION_FALLBACK = 'Monitor condition';

/** Longer recommendation phrase per severity (shown in the card body). */
const RECOMMENDATION_BY_SEVERITY_LONG: Record<string, string> = {
  critical: 'Immediate repair or replacement needed.',
  high:     'Repair within 30 days recommended.',
  medium:   'Schedule repair at next maintenance window.',
  low:      'Monitor during regular inspections.',
};
const RECOMMENDATION_LONG_FALLBACK = 'Monitor during regular inspections.';

/** Section + table headings. */
const LABEL_INSPECTION_FINDINGS = 'Inspection Findings';
const LABEL_DAMAGE_INVENTORY = 'Damage Inventory';
const LABEL_DAMAGE_TYPE = 'Damage Type';
const LABEL_DAMAGE_COUNT = 'Count';
const LABEL_DAMAGE_SEVERITY_COL = 'Severity';
const LABEL_DAMAGE_RECOMMENDATION = 'Recommendation';

/** Per-finding "Insurance claim applicable" annotation. */
const MSG_INSURANCE_CLAIM_APPLICABLE = 'Insurance claim applicable';

/** Photo-card display constants. */
const MAX_PHOTO_DAMAGES_DISPLAYED = 3;
const LOCATION_FALLBACK = 'Roof';
const MSG_NO_DAMAGE_DETECTED_PHOTO = 'No damage detected';

// ─── Photo-card overlay constants ────────────────────────────────────
/** Severity → flat hex color (used for chip backgrounds, no border/text variant). */
const LABEL_SEVERITY_COLORS_SIMPLE: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  moderate: '#eab308',
  minor:    '#22c55e',
  advisory: '#6b7280',
  cosmetic: '#9ca3af',
};
const LABEL_SEVERITY_FALLBACK_COLOR = '#6b7280';
/** Claude-label position keyword → inline CSS positioning string. */
const LABEL_POSITION_CSS_MAP: Record<string, string> = {
  'top-left':      'top:8px;left:8px;',
  'top-center':    'top:8px;left:50%;transform:translateX(-50%);',
  'top-right':     'top:8px;right:8px;',
  'center-left':   'top:50%;left:8px;transform:translateY(-50%);',
  'center':        'top:50%;left:50%;transform:translate(-50%,-50%);',
  'center-right':  'top:50%;right:8px;transform:translateY(-50%);',
  'bottom-left':   'bottom:36px;left:8px;',
  'bottom-center': 'bottom:36px;left:50%;transform:translateX(-50%);',
  'bottom-right':  'bottom:36px;right:8px;',
};

/** Photo-card text fragments. */
const PHOTO_NUMBER_PREFIX = 'Photo #';
const CONFIDENCE_BADGE_SUFFIX = '% conf.';
/** Photos shown inside a single finding card before it starts to crowd. */
const MAX_FINDING_PHOTOS = 3;
/** Shown where the AI returned no value, rather than leaking "undefined". */
const NOT_ASSESSED = 'Not assessed';

/** Damage-analysis section headings + fallback messages. */
const LABEL_DAMAGE_ANALYSIS = 'Damage Analysis';
const LABEL_ANALYZED_PHOTOS = 'Analyzed Photos';
const LABEL_AI_SUMMARY = 'AI Summary';
const MSG_AI_SUMMARY_FALLBACK = 'AI damage analysis complete. See detailed findings below.';
const LABEL_REPAIR_ESTIMATE = 'Repair Estimate';
const MSG_NO_REPAIRS_NEEDED = 'No repairs recommended based on current analysis.';
const MSG_UPLOAD_FOR_DETAIL = 'Upload additional photos for more detailed damage assessment.';

/** Repair-estimate table column headers + summary card labels. */
const LABEL_COL_REPAIR_ITEM = 'Repair Item';
const LABEL_COL_QUANTITY = 'Quantity';
const LABEL_COL_UNIT_PRICE = 'Unit Price';
const LABEL_COL_TOTAL = 'Total';
const LABEL_ESTIMATED_TOTAL = 'Estimated Total';
const LABEL_NOTES = 'Notes';
/** Muted text colors used in the empty-state, notes ul, and helper rows. */
const MUTED_TEXT_PRIMARY = '#6b7280';
const MUTED_TEXT_SECONDARY = '#9ca3af';

// ─── Roof-details + Measurement section constants ───────────────────
/** Detail-row labels for the optional measurement-derived rows in
 *  buildRoofDetailsSection. Hoisted from inline literals at the call site. */
const MEASUREMENT_DETAIL_LABELS = {
  ridgeLength: 'Ridge Length',
  hipLength: 'Hip Length',
  valleyLength: 'Valley Length',
  eaveLength: 'Eave Length',
  rakeLength: 'Rake Length',
  perimeter: 'Perimeter',
  facets: 'Facets',
} as const;

/** Lighter neutral border used for detail-row underlines (lighter than
 *  BORDER_COLOR_NEUTRAL, used inside info cards). */
const BORDER_COLOR_LIGHT = '#f3f4f6';
/** Default value text color for detail rows (slate-800). */
const DETAIL_VALUE_COLOR = '#1f2937';

/** Edge-description tooltip text — hoisted from inline `edgeDescriptions`
 *  Record allocated per call inside buildMeasurementSection. */
const EDGE_DESCRIPTIONS: Record<string, string> = {
  ridge: 'Top horizontal edge where two slopes meet',
  hip: 'Angled edge at an external corner',
  valley: 'Angled edge at an internal corner',
  eave: 'Lower edge overhanging the wall',
  rake: 'Sloped edge along a gable end',
  dripEdge: 'Metal flashing along eaves/rakes',
  flashing: 'Metal strips sealing joints',
};

/** Edge-color palette by edge type — hoisted from inline `edgeColors`
 *  Record allocated per call inside buildMeasurementSection. */
const EDGE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  ridge:    { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  hip:      { bg: '#f5f3ff', border: '#ddd6fe', text: '#7c3aed' },
  valley:   { bg: '#ecfeff', border: '#a5f3fc', text: '#0891b2' },
  eave:     { bg: '#ecfdf5', border: '#a7f3d0', text: '#059669' },
  rake:     { bg: '#fffbeb', border: '#fde68a', text: '#d97706' },
  dripEdge: { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' },
  flashing: { bg: '#fdf4ff', border: '#f0abfc', text: '#c026d3' },
};

/** Edge-label table mapping both long-form keys (e.g. 'ridgeLengthFt')
 *  and short-form keys (e.g. 'ridge') to display labels. Hoisted from
 *  inline `edgeLabels` Record allocated per call. */
const EDGE_LABELS: Record<string, string> = {
  ridgeLengthFt: 'Ridge',
  hipLengthFt: 'Hip',
  valleyLengthFt: 'Valley',
  eaveLengthFt: 'Eave',
  rakeLengthFt: 'Rake',
  dripEdgeLengthFt: 'Drip Edge',
  flashingLengthFt: 'Flashing',
  ridge: 'Ridge',
  hip: 'Hip',
  valley: 'Valley',
  eave: 'Eave',
  rake: 'Rake',
  dripEdge: 'Drip Edge',
  flashing: 'Flashing',
};

/** Summary-card color block (4 stat cards in measurement section all
 *  share the same blue palette). */
const STAT_CARD_BG = '#eff6ff';
const STAT_CARD_BORDER = '#dbeafe';
const STAT_CARD_TEXT_COLOR = '#2563eb';

/** Dark heading color used by the inline `<h3>` sub-section headings
 *  (3D Roof Geometry, Roof Segments, Edge Lengths, Material Takeoff). */
const H3_DARK_HEADING_COLOR = '#1f2937';
/** Square-feet suffix used inside the segment + totals rows. */
const SQFT_SUFFIX = ' sqft';
/** Fallback name for an unnamed segment (uses 1-based index). */
const SEGMENT_NAME_PREFIX = 'Segment ';
/** Total-row uppercase label. */
const LABEL_TOTAL_UPPERCASE = 'TOTAL';
/** Zebra-row backgrounds shared by the segment + material takeoff tables. */
const ZEBRA_BG_ODD = '#fafbfc';
const ZEBRA_BG_EVEN = '#fff';
/** Segment-total row text color (deep navy). */
const SEGMENT_TOTAL_ROW_TEXT = '#1e3a5f';
/** Material-takeoff table header-row background (light gray). */
const MATERIAL_TABLE_HEADER_BG = '#f9fafb';

// ─── buildRoofDetailsSection constants ───────────────────────────────
/** Labels for the roof-detail key/value rows. */
const LABEL_SPECS_MATERIAL = 'Material';
const LABEL_SPECS_ROOF_TYPE = 'Roof Type';
const LABEL_SPECS_ROOF_SIZE = 'Roof Size';
const LABEL_SPECS_PITCH = 'Pitch';
const LABEL_SPECS_STORIES = 'Stories';
const LABEL_SPECS_ESTIMATED_AGE = 'Estimated Age';
/** Roof-specifications section heading. */
const LABEL_ROOF_SPECIFICATIONS = 'Roof Specifications';
/** Linear-feet suffix shared by ridge/hip/valley/eave/rake/perimeter rows. */
const LF_SUFFIX = ' LF';
/** Squares suffix (lowercase variant — distinct from `SQUARES_SUFFIX = ' Squares'`). */
const SQUARES_LOWER_SUFFIX = ' squares';
/** Sq-ft area suffix (e.g. `'(3,000 sq ft)'`). */
const SQ_FT_SUFFIX = ' sq ft';

// ─── buildMeasurementSection data-source mapping ─────────────────────
/** dataSource value → display label. */
const DATA_SOURCE_LABELS: Record<string, string> = {
  eagleview:          'EagleView Verified',
  'google-solar-api': 'Google Solar API',
  hybrid:             'Hybrid (API + Manual)',
};
const DATA_SOURCE_LABEL_DEFAULT = 'Manual Entry';
/** dataSource value → display color (text). */
const DATA_SOURCE_COLORS: Record<string, string> = {
  eagleview:          '#059669',
  'google-solar-api': '#2563eb',
  hybrid:             '#7c3aed',
};
const DATA_SOURCE_COLOR_DEFAULT = '#6b7280';
/** dataSource value → display background. */
const DATA_SOURCE_BGS: Record<string, string> = {
  eagleview:          '#ecfdf5',
  'google-solar-api': '#eff6ff',
  hybrid:             '#f5f3ff',
};
const DATA_SOURCE_BG_DEFAULT = '#f3f4f6';
const DATA_SOURCE_PREFIX = 'Data Source: ';

/** Measurement stat-card labels. */
const STAT_LABEL_SQUARES = 'Squares';
const STAT_LABEL_TOTAL_SQ_FT = 'Total Sq Ft';
const STAT_LABEL_AVG_PITCH = 'Avg Pitch';
const STAT_LABEL_WASTE_FACTOR = 'Waste Factor';

/** Measurement-section sub-headings. */
const LABEL_3D_ROOF_GEOMETRY = '3D Roof Geometry';
const LABEL_ROOF_SEGMENTS = 'Roof Segments';
/** Segments table column headers. */
const SEG_COL_SEGMENT = 'Segment';
const SEG_COL_FOOTPRINT = 'Footprint';
const SEG_COL_PITCH = 'Pitch';
const SEG_COL_ADJUSTED = 'Adjusted';
/** Fallback segment name when the user didn't sub-divide the roof. */
const ENTIRE_ROOF_FALLBACK_NAME = 'Entire Roof';

// ─── Edge-lengths + Material-takeoff + Replacement-options constants ─
/** Default colors used when an edge type isn't in `edgeColors`. */
const EDGE_FALLBACK_COLORS = { bg: '#eff6ff', border: '#dbeafe', text: '#2563eb' };
/** Word-boundary regex used by the material-takeoff title-caser. */
const WORD_BOUNDARY_RE = /\b\w/g;

/** Sub-section headings for the measurement section. */
const LABEL_EDGE_LENGTHS = 'Edge Lengths (Linear Feet)';
const LABEL_TOTAL_LINEAR_FOOTAGE = 'Total Linear Footage:';
const LABEL_MATERIAL_TAKEOFF = 'Material Takeoff';
const LABEL_ROOF_MEASUREMENTS = 'Roof Measurements';
/** Material-takeoff table column headers. */
const TAKEOFF_COL_ITEM = 'Item';
const TAKEOFF_COL_QUANTITY = 'Quantity';
const TAKEOFF_COL_UNIT = 'Unit';

/** Replacement-options tier color tiers — bg/border/badge per tier. */
const REPLACEMENT_TIER_COLORS: Record<string, { bg: string; border: string; badge: string }> = {
  good:   { bg: '#f0fdf4', border: '#86efac', badge: '#166534' },
  better: { bg: '#eff6ff', border: '#93c5fd', badge: '#1e40af' },
  best:   { bg: '#fefce8', border: '#fde047', badge: '#854d0e' },
};
/** Glyph rendered next to each feature in the tier feature list. */
const REPLACEMENT_TIER_EMOJI: Record<string, string> = {
  good: '✓',
  better: '★',
  best: '♛',
};
const REPLACEMENT_FEATURE_BULLET_DEFAULT = '•';
/** Banner text on the recommended tier. */
const BADGE_MOST_POPULAR = 'Most Popular';
/** Materials sub-block heading inside each tier card. */
const LABEL_TIER_MATERIALS = 'Materials';
/** "X-year warranty" suffix shown under the tier price. */
const WARRANTY_YEAR_SUFFIX = '-year warranty';
/** Cap on features shown per tier card. */
const MAX_TIER_FEATURES_DISPLAYED = 6;

// ─── Replacement-options + Credentials + CTA + RCI section labels ────
/** Replacement-options section heading + subtitle. */
const LABEL_REPLACEMENT_OPTIONS = 'Replacement Options';
const MSG_REPLACEMENT_OPTIONS_SUBTITLE = 'Compare our roofing system packages. Each includes complete tear-off, installation, cleanup, and warranty.';

/** HTML head + body global tokens used by `generateComprehensiveReportHTML`. */
const META_CHARSET = 'UTF-8';
const META_VIEWPORT_VALUE = 'width=device-width, initial-scale=1.0';
const TITLE_ADDRESS_SEPARATOR = ' - ';
/** Inline style applied to all 3 footer contact links (phone/email/website). */
const FOOTER_LINK_STYLE = 'color:#6b7280;text-decoration:none;';
const TEL_PROTOCOL = 'tel:';
const MAILTO_PROTOCOL = 'mailto:';
/** Page-level body styling. */
const BODY_BG_COLOR = '#f8fafc';
const BODY_PADDING = '20px';

/** Standalone-analysis section headings (Feature Summary table + Detected Features table). */
const LABEL_FEATURE_SUMMARY_HEADING = 'Feature Summary';
const LABEL_DETECTED_FEATURES_HEADING = 'Detected Features';
/** Column headers used by the standalone-analysis Feature Summary table. */
const LABEL_COL_METRIC = 'Metric';
const LABEL_COL_VALUE = 'Value';
const LABEL_COL_DETAIL = 'Detail';
/** Column headers used by the Detected Features table. */
const LABEL_COL_FEATURE = 'Feature';
const LABEL_COL_TYPE = 'Type';
const LABEL_COL_CONFIDENCE = 'Confidence';
const LABEL_COL_AREA = 'Area';
/** "Generated by ... — date" footer prefix on the standalone-analysis page. */
const MSG_GENERATED_BY_PREFIX = 'Generated by ';
/** Em-dash separator between platform name + date in the standalone footer. */
const MSG_GENERATED_BY_DASH = ' - ';

/** Credentials section heading + sub-headings. */
const LABEL_COMPANY_CREDENTIALS = 'Company Credentials';
const LABEL_CERTIFICATIONS = 'Certifications';
const LABEL_WARRANTY_OPTIONS = 'Warranty Options';
const LABEL_INSURANCE_BONDING = 'Insurance &amp; Bonding';

/** CTA section heading + body + fallback. */
const LABEL_CTA_HEADING = 'Ready to Get Started?';
const MSG_CTA_TEAM_FALLBACK = 'Our team';
const MSG_CTA_BODY_SUFFIX = ' is ready to help with your roof. Contact us today for a free consultation and detailed estimate.';
const LABEL_CTA_CALL_PREFIX = 'Call ';
const LABEL_CTA_EMAIL_BUTTON = 'Email Us';

/** RCI section heading. */
const LABEL_RCI_SECTION = 'Roof Condition Index (RCI)';
/** RCI letter-grade → badge bg/text colors. */
const RCI_GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: '#dcfce7', text: '#166534' },
  B: { bg: '#dbeafe', text: '#1e40af' },
  C: { bg: '#fef9c3', text: '#854d0e' },
  D: { bg: '#fed7aa', text: '#c2410c' },
  F: { bg: '#fecaca', text: '#b91c1c' },
};

/** RCI badge prefix + Component Scores sub-heading. */
const LABEL_GRADE_PREFIX = 'Grade ';
const LABEL_COMPONENT_SCORES = 'Component Scores';

// ─── Storm timeline labels ───────────────────────────────────────────
const LABEL_STORM_TIMELINE = 'Storm Timeline';
const STORM_LEGEND_HAIL = 'Hail';
const STORM_LEGEND_WIND = 'Wind';
const LABEL_DATE_OF_LOSS_FLAG = 'DATE OF LOSS';
const EVENTS_COUNT_SUFFIX = ' events';

// ─── Insurance-claim section labels + steps ──────────────────────────
const LABEL_INSURANCE_CLAIM_SUPPORT = 'Insurance Claim Support';
const LABEL_RECOMMENDED_DATE_OF_LOSS_BLOCK = 'Recommended Date of Loss';
/** Numbered steps shown to a homeowner pursuing an insurance claim. */
const INSURANCE_CLAIM_STEPS: readonly string[] = [
  'Document all damage with dated photographs (included in this report)',
  'Contact your insurance company to file a claim',
  'Provide this report and the recommended date of loss to your adjuster',
  'Request a professional on-site inspection from a licensed adjuster',
  'Obtain repair/replacement estimates from licensed contractors',
  'Keep all documentation and correspondence for your records',
];
/** Estimated repair cost label + supporting findings + filing steps. */
const LABEL_ESTIMATED_REPAIR_COST_BLOCK = 'Estimated Repair Cost';
const LABEL_CLAIM_FINDINGS = 'Claim-Supporting Damage Findings';
const LABEL_SUGGESTED_FILING_STEPS = 'Suggested Filing Steps';

// ─── Executive-summary section constants ────────────────────────────
/** Section heading shown next to the conditional badge. */
const LABEL_EXECUTIVE_SUMMARY = 'Executive Summary';

/** RCI-score → executive-summary badge tier. First row whose `minScore`
 *  is met wins (descending order). Replaces the inline if/else ladder. */
interface ExecSummaryTier {
  minScore: number;
  badgeText: string;
  badgeBg: string;
  badgeColor: string;
  summaryBg: string;
  summaryBorder: string;
  summaryTextColor: string;
}
const EXEC_SUMMARY_TIERS: ReadonlyArray<ExecSummaryTier> = [
  { minScore: 75, badgeText: 'GOOD CONDITION',       badgeBg: '#dcfce7', badgeColor: '#166534', summaryBg: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)', summaryBorder: '#86efac', summaryTextColor: '#1e3a5f' },
  { minScore: 50, badgeText: 'MAINTENANCE NEEDED',   badgeBg: '#fef9c3', badgeColor: '#854d0e', summaryBg: 'linear-gradient(135deg, #fefce8, #fef9c3)', summaryBorder: '#fde047', summaryTextColor: '#713f12' },
  { minScore: 30, badgeText: 'REPAIRS REQUIRED',     badgeBg: '#fed7aa', badgeColor: '#c2410c', summaryBg: 'linear-gradient(135deg, #fff7ed, #ffedd5)', summaryBorder: '#fb923c', summaryTextColor: '#7c2d12' },
  { minScore: 0,  badgeText: 'REPLACEMENT REQUIRED', badgeBg: '#fecaca', badgeColor: '#991b1b', summaryBg: 'linear-gradient(135deg, #fef2f2, #fee2e2)', summaryBorder: '#f87171', summaryTextColor: '#7f1d1d' },
];
/** Severity-fallback styling when no RCI is available. */
const EXEC_SUMMARY_SEVERE_BADGE_BG = '#fecaca';
const EXEC_SUMMARY_SEVERE_BADGE_COLOR = '#991b1b';
const EXEC_SUMMARY_SEVERE_BG = 'linear-gradient(135deg, #fef2f2, #fee2e2)';
const EXEC_SUMMARY_SEVERE_BORDER = '#f87171';
const EXEC_SUMMARY_SEVERE_TEXT = '#7f1d1d';
const BADGE_REPLACEMENT_REQUIRED = 'REPLACEMENT REQUIRED';
const BADGE_REPAIRS_NEEDED = 'REPAIRS NEEDED';
/** Default summary bg/border when no RCI and no critical/high severity. */
const EXEC_SUMMARY_DEFAULT_BG = 'linear-gradient(135deg, #f0f9ff, #eff6ff)';
const EXEC_SUMMARY_DEFAULT_BORDER = '#93c5fd';
const EXEC_SUMMARY_DEFAULT_TEXT = '#1e3a5f';

/** Severity → bg/text colors used by the inline severity helper. Hoisted
 *  from the function body so the table isn't reallocated per call. */
const INLINE_SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  none:     { bg: '#dcfce7', text: '#166534' },
  low:      { bg: '#ecfccb', text: '#3f6212' },
  medium:   { bg: '#fef9c3', text: '#854d0e' },
  high:     { bg: '#fed7aa', text: '#c2410c' },
  critical: { bg: '#fecaca', text: '#b91c1c' },
};

// Shared long-date format options — matches the wizard's display format
// and keeps the two HTML generators (analysis + comprehensive) in sync.
const LONG_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
};

/** Format a date for the report header (e.g. "May 15, 2025"). */
function formatLongDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString(DATE_LOCALE, LONG_DATE_FORMAT_OPTIONS);
  }
  return date.toLocaleDateString(DATE_LOCALE, LONG_DATE_FORMAT_OPTIONS);
}

// Allow only `#abc` / `#abcdef` / `#abcdef00` (with alpha) hex colors when
// interpolating a tenant-supplied `feature.color` into an inline `style`
// attribute. Falls back to the default dot color otherwise — defends
// against `style="background:url(javascript:...)"`-style payloads even
// though browsers reject those.
function safeColor(raw: unknown, fallback: string): string {
  return safeHexColor(raw, fallback);
}

/** Allow only http, https, mailto and tel links into `src`/`href` attributes. */
function safeUrl(raw: unknown): string {
  return safeLinkUrl(raw);
}

/** Format a square-footage number with locale grouping + " sqft" suffix. */
function formatSqft(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EMPTY_VALUE_PLACEHOLDER;
  return `${Math.round(n).toLocaleString()}${SQFT_UNIT_SUFFIX}`;
}

/** Format a confidence percentage; rounds to integer and falls back to "-" for non-numbers. */
function formatConfidence(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return EMPTY_VALUE_PLACEHOLDER;
  return `${Math.round(n)}${PERCENT_SUFFIX}`;
}

export function generateRoofAnalysisReportHTML(
  analysis: RoofAnalysisRecord,
  companyHeader?: string,
  brandColors?: { brandPrimaryColor?: string; brandSecondaryColor?: string; companyName?: string; companyPhone?: string; companyEmail?: string; internalView?: boolean },
): string {
  // Confidence is an internal signal, never a customer-facing one.
  const internalView = brandColors?.internalView === true;
  const features = analysis.detected_features || [];
  const summary = (analysis.feature_summary || {}) as Record<string, any>;
  const dateStr = formatLongDate(analysis.created_at);

  const summaryRows: string[] = [];
  if (summary.solar_panel_count > 0) {
    summaryRows.push(row(LABEL_SOLAR_PANELS, String(summary.solar_panel_count), summary.solar_panel_area_sqft ? formatSqft(summary.solar_panel_area_sqft) : ''));
  }
  if (summary.green_roof_detected) {
    summaryRows.push(row(LABEL_GREEN_ROOF, FEATURE_STATUS_DETECTED, summary.green_roof_area_sqft ? formatSqft(summary.green_roof_area_sqft) : ''));
  }
  if (summary.primary_material) {
    summaryRows.push(row(LABEL_PRIMARY_MATERIAL, escapeHtml(summary.primary_material), internalView && summary.material_confidence ? `${formatConfidence(summary.material_confidence)}${CONFIDENCE_SUFFIX}` : ''));
  }
  if (summary.damage_regions_count > 0) {
    summaryRows.push(row(LABEL_DAMAGE_ZONES, String(summary.damage_regions_count), ''));
  }
  if (summary.total_analyzed_area_sqft) {
    summaryRows.push(row(LABEL_TOTAL_ANALYZED_AREA, formatSqft(summary.total_analyzed_area_sqft), ''));
  }

  const brandPrimary = safeColor(brandColors?.brandPrimaryColor, DEFAULT_BRAND_PRIMARY);
  const brandSecondary = safeColor(brandColors?.brandSecondaryColor, DEFAULT_BRAND_SECONDARY);

  // Footer contact info
  const footerParts: string[] = [];
  if (brandColors?.companyName) footerParts.push(`<strong>${escapeHtml(brandColors.companyName)}</strong>`);
  if (brandColors?.companyPhone) footerParts.push(escapeHtml(brandColors.companyPhone));
  if (brandColors?.companyEmail) footerParts.push(escapeHtml(brandColors.companyEmail));
  const footerContact = footerParts.length > 0
    ? `<div style="margin-bottom:4px;">${footerParts.join(FOOTER_CONTACT_SEPARATOR)}</div>`
    : '';

  const featureRows = features.map((f: { label?: string; type?: string; color?: string; confidence?: number; area_sqft?: number }) => {
    // Validate the feature color — `f.color` is tenant-provided and goes
    // straight into an inline `style` attribute. Limit to hex.
    const dotColor = safeColor(
      f.color,
      FEATURE_COLORS[f.type || ''] || DEFAULT_FEATURE_DOT_COLOR,
    );
    const labelHtml = escapeHtml(f.label || '');
    const typeHtml = escapeHtml((f.type || '').replace(UNDERSCORE_TO_SPACE_RE, ' '));
    return `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dotColor};margin-right:6px;"></span>
        ${labelHtml}
      </td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${typeHtml}</td>
      ${internalView ? `<td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${formatConfidence(f.confidence)}</td>` : ''}
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${f.area_sqft ? formatSqft(f.area_sqft) : EMPTY_VALUE_PLACEHOLDER}</td>
    </tr>
  `;
  }).join('');

  // Standalone header when no companyHeader provided
  const headerBlock = companyHeader
    ? companyHeader
    : `<div style="width:100%;height:8px;background:${brandPrimary};margin-bottom:16px;"></div>`;

  return `
    <div style="max-width:800px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
      ${headerBlock}

      <div style="text-align:center;margin-bottom:32px;">
        <h1 style="font-size:24px;font-weight:700;margin:0 0 4px;color:${brandSecondary};">${MSG_ANALYSIS_REPORT_TITLE}</h1>
        <p style="color:#6b7280;font-size:14px;margin:0;">
          ${analysis.analysis_type === ANALYSIS_TYPE_SATELLITE ? MSG_SATELLITE_ANALYSIS_TYPE : MSG_PHOTO_ANALYSIS_TYPE}
          - ${dateStr}
        </p>
      </div>

      <!-- Property Info -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;border-left:4px solid ${brandPrimary};padding-left:12px;">
        ${analysis.address ? `<tr><td style="padding:4px 0 4px 12px;color:#6b7280;width:140px;">${LABEL_ADDRESS}</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(analysis.address)}</td></tr>` : ''}
        ${analysis.latitude ? `<tr><td style="padding:4px 0 4px 12px;color:#6b7280;">${LABEL_COORDINATES}</td><td style="padding:4px 0;">${escapeHtml(String(analysis.latitude))}, ${escapeHtml(String(analysis.longitude))}</td></tr>` : ''}
        <tr><td style="padding:4px 0 4px 12px;color:#6b7280;">${LABEL_PROVIDER}</td><td style="padding:4px 0;">${escapeHtml(analysis.model_provider || PROVIDER_FALLBACK)}</td></tr>
        <tr><td style="padding:4px 0 4px 12px;color:#6b7280;">${LABEL_STATUS}</td><td style="padding:4px 0;text-transform:capitalize;">${escapeHtml(String(analysis.status || ''))}</td></tr>
        ${analysis.processing_time_ms ? `<tr><td style="padding:4px 0 4px 12px;color:#6b7280;">${LABEL_PROCESSING_TIME}</td><td style="padding:4px 0;">${(analysis.processing_time_ms / MS_PER_SECOND).toFixed(PROCESSING_TIME_DECIMALS)}${SECONDS_SUFFIX}</td></tr>` : ''}
      </table>

      ${(() => {
        const safeImage = safeUrl(analysis.satellite_image_url);
        return safeImage ? `
        <div style="margin-bottom:24px;text-align:center;">
          <img src="${escapeHtml(safeImage)}" alt="${MSG_SATELLITE_IMAGE_ALT}" loading="lazy" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb;" />
          <p style="font-size:11px;color:#9ca3af;margin-top:4px;">${MSG_SATELLITE_IMAGERY_SOURCE}</p>
        </div>
      ` : '';
      })()}

      <!-- Summary -->
      ${summaryRows.length > 0 ? `
        <h2 style="font-size:16px;font-weight:700;margin:24px 0 12px;color:${brandSecondary};border-bottom:2px solid #e5e7eb;padding-bottom:6px;">${LABEL_FEATURE_SUMMARY_HEADING}</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;">
          <tr style="background:${brandSecondary};color:#fff;">
            <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_COL_METRIC}</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_COL_VALUE}</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_COL_DETAIL}</th>
          </tr>
          ${summaryRows.join('')}
        </table>
      ` : ''}

      <!-- Detected Features -->
      ${features.length > 0 ? `
        <h2 style="font-size:16px;font-weight:700;margin:24px 0 12px;color:${brandSecondary};border-bottom:2px solid #e5e7eb;padding-bottom:6px;">${LABEL_DETECTED_FEATURES_HEADING} (${features.length})</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;">
          <tr style="background:${brandSecondary};color:#fff;">
            <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_COL_FEATURE}</th>
            <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_COL_TYPE}</th>
            ${internalView ? `<th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_COL_CONFIDENCE}</th>` : ''}
            <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_COL_AREA}</th>
          </tr>
          ${featureRows}
        </table>
      ` : ''}

      <!-- Footer -->
      <div style="margin-top:40px;padding-top:16px;border-top:2px solid ${brandPrimary};text-align:center;font-size:12px;color:#9ca3af;">
        ${footerContact}
        ${MSG_GENERATED_BY_PREFIX}${escapeHtml(PLATFORM_NAME)}${MSG_GENERATED_BY_DASH}${dateStr}
      </div>
    </div>
  `;
}

function row(metric: string, value: string, detail: string): string {
  return `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${metric}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">${value}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${detail}</td>
    </tr>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPREHENSIVE ROOF REPORT HTML GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

interface BrandColors {
  brandPrimaryColor?: string;
  brandSecondaryColor?: string;
  companyName?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyLogo?: string;
  companyWebsite?: string;
  companyAddress?: string;
  companyLicenseNumber?: string;
  certifications?: Array<{ name: string; issuer?: string }>;
  warranties?: Array<{ type: string; years: number; description?: string }>;
  insurance?: Array<{ type: string; provider?: string }>;
  tagline?: string;
  brandFontFamily?: string;
  coverHeroImage?: string;
  customDisclaimer?: string;
  /**
   * Render the internal view. AI confidence scores are shown ONLY when this is
   * true. They are a signal for the inspector about how much to trust the
   * model, and putting a "72% conf." badge on a homeowner's roof photo invites
   * exactly the argument the report exists to avoid. Default is the customer
   * view, so anything that forgets to pass this is safe.
   */
  internalView?: boolean;
}

/**
 * Generate a comprehensive roof report HTML document.
 * Includes storm history, damage analysis with photos, repair estimates,
 * replacement options (Good/Better/Best), and company credentials.
 */
export function generateComprehensiveReportHTML(
  rawReport: ComprehensiveRoofReport,
  brandColors: BrandColors = {},
  options: { nonce?: string; motionBase?: string } = {},
): string {
  // Checked first, so a nonce that is not a plain token fails before any page is built.
  const scriptNonce = nonceAttr(options.nonce);
  // Every figure below is formatted from a number, whatever the saved JSON held.
  const report = normalizeReportNumbers(rawReport);
  const brandPrimary = safeColor(brandColors.brandPrimaryColor, DEFAULT_BRAND_PRIMARY);
  const brandSecondary = safeColor(brandColors.brandSecondaryColor, DEFAULT_BRAND_SECONDARY);
  // Confidence is an internal signal, never a customer-facing one. Default off,
  // so any caller that forgets the flag produces the safe report.
  const internalView = brandColors.internalView === true;
  const fontUrl = getGoogleFontUrl(brandColors.brandFontFamily);
  const cssFontFamily = getCssFontFamily(brandColors.brandFontFamily);
  const dateStr = formatLongDate(report.generatedAt);

  // Build company header
  const companyHeader = buildCompanyHeader(brandColors, brandPrimary);

  // Report type flags (backwards-compatible)
  const reportTypes: ReportType[] = report.reportTypes || ['inspection', 'measurement', 'storm'];
  const hasInspection = reportTypes.includes('inspection');
  const hasMeasurement = reportTypes.includes('measurement');
  const hasStorm = reportTypes.includes('storm');

  // Template-aware section visibility
  const tmpl = getTemplateConfig(report.reportTemplate);

  // Build each section conditionally, respecting both report types AND template config
  const propertySection = tmpl.sections.propertyInfo ? buildPropertySection(report, brandPrimary) : '';
  const roofDetailsSection = tmpl.sections.roofDetails && (hasMeasurement || hasInspection) ? buildRoofDetailsSection(report, brandSecondary) : '';
  const measurementSection = tmpl.sections.measurements && hasMeasurement ? buildMeasurementSection(report, brandSecondary) : '';
  const roofAgeSection = tmpl.sections.roofAge && hasInspection ? buildRoofAgeSection(report.damageAnalysis?.roofAge, internalView) : '';
  const rciSection = tmpl.sections.rci && report.roofConditionIndex ? buildRCISection(report.roofConditionIndex, brandSecondary) : '';
  const executiveSummarySection = tmpl.sections.executiveSummary ? buildExecutiveSummarySection(report, brandSecondary) : '';
  const stormSection = tmpl.sections.stormHistory && hasStorm ? buildStormHistorySection(report.stormHistory, brandSecondary) : '';
  const stormEnhancedSection = tmpl.sections.stormEnhanced && hasStorm && report.stormEnhanced ? buildEnhancedStormSection(report.stormEnhanced, report.stormHistory, brandSecondary) : '';
  const insuranceClaimSection = tmpl.sections.insuranceClaim ? buildInsuranceClaimSection(report, brandSecondary) : '';
  const damageSection = tmpl.sections.damageAnalysis && hasInspection ? buildDamageAnalysisSection(report.damageAnalysis, brandSecondary, tmpl, report.structuredFindings, report.photoLabels, internalView) : '';
  const inspectorNotesSection = tmpl.sections.inspectorNotes ? buildInspectorNotesSection(report.inspectorNotes, brandSecondary) : '';
  const estimateSection = tmpl.sections.repairEstimate && hasInspection ? buildRepairEstimateSection(report.repairEstimate, brandSecondary, brandPrimary) : '';
  const replacementSection = tmpl.sections.replacementOptions && hasInspection ? buildReplacementOptionsSection(report.replacementOptions, brandSecondary, brandPrimary) : '';
  const credentialsSection = tmpl.sections.credentials ? buildCredentialsSection(brandColors, brandSecondary) : '';
  const ctaSection = tmpl.sections.cta ? buildCTASection(brandColors, brandPrimary) : '';

  // Dynamic title — template-specific or report-type based
  const reportTitle = report.reportTemplate && TEMPLATE_TITLE_MAP[report.reportTemplate]
    ? TEMPLATE_TITLE_MAP[report.reportTemplate]
    : reportTypes.length === ALL_REPORT_TYPES_COUNT ? MSG_COMPREHENSIVE_REPORT_TITLE
    : reportTypes.length === SINGLE_REPORT_TYPE_COUNT && hasInspection ? MSG_AI_INSPECTION_REPORT_TITLE
    : reportTypes.length === SINGLE_REPORT_TYPE_COUNT && hasMeasurement ? MSG_MEASUREMENT_REPORT_TITLE
    : reportTypes.length === SINGLE_REPORT_TYPE_COUNT && hasStorm ? MSG_STORM_REPORT_TITLE
    : `${MULTI_TYPE_TITLE_PREFIX}${reportTypes.map(t => REPORT_TYPE_DISPLAY_NAMES[t] || t).join(MULTI_TYPE_SEPARATOR)}${MULTI_TYPE_TITLE_SUFFIX}`;

  // Footer
  const footerParts: string[] = [];
  if (brandColors.companyName) footerParts.push(`<strong>${escapeHtml(brandColors.companyName)}</strong>`);
  if (brandColors.companyPhone) footerParts.push(`<a href="${TEL_PROTOCOL}${escapeHtml(brandColors.companyPhone)}" style="${FOOTER_LINK_STYLE}">${escapeHtml(brandColors.companyPhone)}</a>`);
  if (brandColors.companyEmail) footerParts.push(`<a href="${MAILTO_PROTOCOL}${escapeHtml(brandColors.companyEmail)}" style="${FOOTER_LINK_STYLE}">${escapeHtml(brandColors.companyEmail)}</a>`);
  if (brandColors.companyWebsite) {
    const site = safeUrl(brandColors.companyWebsite);
    footerParts.push(site
      ? `<a href="${escapeHtml(site)}" style="${FOOTER_LINK_STYLE}">${escapeHtml(brandColors.companyWebsite)}</a>`
      : escapeHtml(brandColors.companyWebsite));
  }
  const footerContact = footerParts.length > 0
    ? `<div style="margin-bottom:8px;">${footerParts.join(FOOTER_CONTACT_SEPARATOR)}</div>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="${META_CHARSET}">
  <meta name="viewport" content="${META_VIEWPORT_VALUE}">
  <title>${escapeHtml(reportTitle)}${TITLE_ADDRESS_SEPARATOR}${escapeHtml(report.property.address)}</title>
  ${fontUrl ? `<link href="${fontUrl}" rel="stylesheet">` : ''}
  <style>
    /* ── CSS Custom Properties ─────────────────────────────────── */
    :root {
      --brand-primary: ${brandPrimary};
      --brand-secondary: ${brandSecondary};
      --text-primary: #1f2937;
      --text-secondary: #6b7280;
      --text-muted: #9ca3af;
      --bg-surface: #f9fafb;
      --bg-card: #fff;
      --border-light: #e5e7eb;
      --border-subtle: #f3f4f6;
      --severity-none: #22c55e;
      --severity-low: #84cc16;
      --severity-medium: #eab308;
      --severity-high: #f97316;
      --severity-critical: #ef4444;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
      --shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
      --shadow-elevated: 0 4px 20px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
      --transition-fast: 0.2s ease;
      --transition-smooth: 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* ── Base ──────────────────────────────────────────────────── */
    * { box-sizing: border-box; margin: 0; }
    body { margin: 0; padding: ${BODY_PADDING}; background: ${BODY_BG_COLOR}; }
    img { max-width: 100%; }

    /* ── Animations (respect reduced-motion) ───────────────────── */
    @keyframes fadeSlideUp {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes scaleIn {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes drawCircle {
      from { stroke-dasharray: 0 283; }
    }
    @keyframes growBar {
      from { width: 0; }
    }
    @keyframes countUp {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes pulseGlow {
      0%, 100% { box-shadow: 0 0 0 0 rgba(234,88,12,0.15); }
      50% { box-shadow: 0 0 0 8px rgba(234,88,12,0); }
    }

    /* ── Animated Elements ─────────────────────────────────────── */
    .report-section {
      animation: fadeSlideUp 0.5s var(--transition-smooth) both;
    }
    .report-section:nth-child(2) { animation-delay: 0.05s; }
    .report-section:nth-child(3) { animation-delay: 0.1s; }
    .report-section:nth-child(4) { animation-delay: 0.15s; }
    .report-section:nth-child(5) { animation-delay: 0.2s; }
    .report-section:nth-child(6) { animation-delay: 0.25s; }

    .stat-card {
      animation: scaleIn 0.4s var(--transition-smooth) both;
      transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    }
    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-elevated);
    }

    /* Proportion bars in numeric table columns (data-bar-fill scales L→R). */
    .rbar-cell { display: flex; align-items: center; gap: 8px; }
    .rbar-track { flex: 1; min-width: 40px; max-width: 160px; height: 7px; background: var(--border-subtle); border-radius: 4px; overflow: hidden; }
    .rbar-fill { display: block; height: 100%; border-radius: 4px; background: var(--brand-primary); }
    .rbar-num { min-width: 24px; font-weight: 600; }

    .score-ring circle.score-arc {
      animation: drawCircle 1.2s cubic-bezier(0.4, 0, 0.2, 1) both;
    }

    .progress-bar-fill {
      animation: growBar 0.8s cubic-bezier(0.4, 0, 0.2, 1) both;
    }

    .tier-card {
      transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    }
    .tier-card:hover {
      transform: translateY(-4px);
      box-shadow: var(--shadow-elevated);
    }

    .feature-check {
      display: inline-block; width: 16px; height: 16px; border-radius: 50%;
      text-align: center; line-height: 16px; font-size: 10px; margin-right: 6px; flex-shrink: 0;
    }

    .photo-card {
      transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    }
    .photo-card:hover {
      transform: scale(1.015);
      box-shadow: var(--shadow-elevated);
    }

    .section-header {
      position: relative;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .section-header::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      width: 48px;
      height: 3px;
      background: var(--brand-primary);
      border-radius: 2px;
      transition: width var(--transition-smooth);
    }
    .section-header:hover::after {
      width: 80px;
    }

    .cta-button {
      transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    }
    .cta-button:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .timeline-bar {
      animation: growBar 0.6s cubic-bezier(0.4, 0, 0.2, 1) both;
    }

    .badge-pulse {
      animation: pulseGlow 2s ease-in-out infinite;
    }

    /* ── Responsive ────────────────────────────────────────────── */
    @media (max-width: 640px) {
      body { padding: 12px; }
      .report-container { padding: 0 !important; }
      .stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
      .photo-grid { grid-template-columns: 1fr !important; }
      .tier-grid { flex-direction: column !important; }
      .rci-layout { flex-direction: column !important; align-items: center !important; }
    }

    /* ── Print ─────────────────────────────────────────────────── */
    @media print {
      .page-break { page-break-before: always; }
      .no-print { display: none !important; }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        background: #fff;
        padding: 0;
      }
      .report-section,
      .stat-card,
      .score-ring circle.score-arc,
      .progress-bar-fill,
      .timeline-bar {
        animation: none !important;
        transition: none !important;
      }
      .stat-card:hover,
      .tier-card:hover,
      .photo-card:hover,
      .section-header:hover::after {
        transform: none !important;
        box-shadow: none !important;
      }
      .section-header::after {
        width: 48px !important;
      }
      .photo-card img {
        break-inside: avoid;
      }
    }

    /* ── Reduced Motion ────────────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
    ${motionStyles()}
  </style>
</head>
<body>
  <div class="archie-progress" data-progress-bar></div>
  <div class="report-container" style="max-width:850px;margin:0 auto;font-family:${cssFontFamily};color:var(--text-primary);line-height:1.6;background:var(--bg-card);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:0 0 1px;">
    <div style="padding:32px 32px 0;">
    ${companyHeader}

    ${tmpl.coverStyle === 'hero' ? `
      <div class="report-section" style="background:linear-gradient(135deg, ${brandSecondary}, ${brandSecondary}cc);border-radius:var(--radius-lg);padding:48px 36px;margin-bottom:32px;color:#fff;text-align:center;position:relative;overflow:hidden;">
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%, rgba(255,255,255,0.08) 0%, transparent 70%);pointer-events:none;"></div>
        <h1 style="font-size:clamp(24px, 4vw, 34px);font-weight:800;margin:0 0 8px;color:#fff;letter-spacing:-0.5px;position:relative;">${escapeHtml(reportTitle)}</h1>
        <p style="color:rgba(255,255,255,0.8);font-size:clamp(12px, 2vw, 14px);margin:0 0 4px;position:relative;">
          Prepared ${dateStr} &bull; Report ID: ${escapeHtml(report.id)}
        </p>
        ${brandColors.tagline ? `<p style="color:rgba(255,255,255,0.65);font-size:13px;margin:8px 0 0;font-style:italic;position:relative;">${escapeHtml(brandColors.tagline)}</p>` : ''}
      </div>
    ` : `
      <div class="report-section" style="margin-bottom:32px;">
        <h1 style="font-size:clamp(22px, 4vw, 30px);font-weight:800;margin:0 0 6px;color:var(--brand-secondary);letter-spacing:-0.5px;">${escapeHtml(reportTitle)}</h1>
        <p style="color:var(--text-secondary);font-size:14px;margin:0;">
          Prepared ${dateStr} &bull; Report ID: ${escapeHtml(report.id)}
        </p>
        <div style="width:60px;height:3px;background:var(--brand-primary);margin-top:12px;border-radius:2px;"></div>
      </div>
    `}

    ${executiveSummarySection}
    ${propertySection}
    ${roofDetailsSection}
    ${roofAgeSection}
    ${rciSection}
    ${(() => {
      // Build page-break-separated sections in logical order for combined report:
      // Storm -> Insurance Claim -> Damage + Notes -> Measurements -> Estimates -> Credentials
      const isStandaloneInspection = hasInspection && !hasStorm && !hasMeasurement;
      const sections = isStandaloneInspection
        ? [
            damageSection + inspectorNotesSection,
            estimateSection + replacementSection,
            credentialsSection + ctaSection,
          ]
        : [
            stormSection + stormEnhancedSection,
            insuranceClaimSection,
            damageSection + inspectorNotesSection,
            measurementSection,
            estimateSection + replacementSection,
            credentialsSection + ctaSection,
          ];
      return sections.filter(s => s.trim().length > 0).join('\n    <div class="page-break"></div>\n    ');
    })()}

    ${brandColors.customDisclaimer ? `
      <div class="report-section" style="margin-top:32px;padding:16px 20px;border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-surface);">
        <div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Disclaimer</div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.6;">${escapeHtml(brandColors.customDisclaimer)}</div>
      </div>
    ` : ''}

    <!-- Footer -->
    <div style="margin-top:48px;padding:24px 32px;border-top:3px solid var(--brand-primary);text-align:center;font-size:12px;color:var(--text-muted);background:var(--bg-surface);border-radius:0 0 var(--radius-lg) var(--radius-lg);">
      ${footerContact}
      ${brandColors.tagline ? `<div style="margin-bottom:4px;font-size:11px;font-style:italic;color:#b0b7c3;">${escapeHtml(brandColors.tagline)}</div>` : ''}
      ${brandColors.companyAddress ? `<div style="margin-bottom:4px;font-size:11px;">${escapeHtml(brandColors.companyAddress)}</div>` : ''}
      ${brandColors.companyLicenseNumber ? `<div style="margin-bottom:8px;font-size:11px;">License #${escapeHtml(brandColors.companyLicenseNumber)}</div>` : ''}
      <div style="margin-top:8px;font-size:10px;color:#d1d5db;">Generated by ${PLATFORM_NAME} Roof Report AI - ${dateStr}</div>
      <div style="margin-top:2px;font-size:9px;color:#e5e7eb;">Data sources: ${escapeHtml((report.dataSources || []).join(', ') || 'N/A')}</div>
    </div>
    </div><!-- /padding wrapper -->
  </div>

  <!-- Print button (hidden in print) -->
  <div class="no-print" style="position:fixed;bottom:24px;right:24px;z-index:1000;">
    <button type="button" id="archie-print-report" class="cta-button" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:var(--brand-primary);color:#fff;font-size:14px;font-weight:600;border:none;border-radius:var(--radius-md);cursor:pointer;box-shadow:var(--shadow-elevated);">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      Print Report
    </button>
  </div>
  <script${scriptNonce}>
    (function () {
      var button = document.getElementById('archie-print-report');
      if (button) button.addEventListener('click', function () { window.print(); });
    })();
  </script>
  ${motionRuntime({ nonce: options.nonce, assetBase: options.motionBase })}
</body>
</html>
  `;
}

function buildCompanyHeader(brandColors: BrandColors, brandPrimary: string): string {
  const logoSrc = safeHttpUrl(brandColors.companyLogo);
  if (!brandColors.companyName && !logoSrc) {
    return `<div style="width:100%;height:6px;background:linear-gradient(90deg, ${brandPrimary}, ${brandPrimary}88);margin-bottom:24px;border-radius:4px;"></div>`;
  }

  const contactParts: string[] = [];
  if (brandColors.companyPhone) contactParts.push(`<span>${escapeHtml(brandColors.companyPhone)}</span>`);
  if (brandColors.companyEmail) contactParts.push(`<span>${escapeHtml(brandColors.companyEmail)}</span>`);
  if (brandColors.companyWebsite) contactParts.push(`<span>${escapeHtml(brandColors.companyWebsite)}</span>`);
  const contactLine = contactParts.length > 0
    ? `<div style="font-size:12px;opacity:0.9;margin-top:6px;">${contactParts.join(CONTACT_SEPARATOR)}</div>`
    : '';

  const addressLine = brandColors.companyAddress
    ? `<div style="font-size:11px;opacity:0.8;margin-top:2px;">${escapeHtml(brandColors.companyAddress)}</div>`
    : '';

  const licenseLine = brandColors.companyLicenseNumber
    ? `<div style="font-size:10px;opacity:0.7;margin-top:2px;">${LABEL_LICENSE_PREFIX}${escapeHtml(brandColors.companyLicenseNumber)}</div>`
    : '';

  if (logoSrc) {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;margin-bottom:28px;background:linear-gradient(135deg, ${brandPrimary}, ${brandPrimary}dd);border-radius:12px;color:#fff;">
        <div style="display:flex;align-items:center;gap:16px;">
          <img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(brandColors.companyName || '')}" style="max-height:${COMPANY_LOGO_MAX_HEIGHT_PX}px;max-width:${COMPANY_LOGO_MAX_WIDTH_PX}px;border-radius:6px;" />
          <div>
            ${brandColors.companyName ? `<div style="font-size:22px;font-weight:800;letter-spacing:-0.3px;">${escapeHtml(brandColors.companyName)}</div>` : ''}
            ${brandColors.tagline ? `<div style="font-size:12px;opacity:0.85;font-style:italic;margin-top:2px;">${escapeHtml(brandColors.tagline)}</div>` : ''}
            ${contactLine}
          </div>
        </div>
        <div style="text-align:right;">
          ${addressLine}
          ${licenseLine}
        </div>
      </div>
    `;
  }

  return `
    <div style="padding:20px 24px;margin-bottom:28px;background:linear-gradient(135deg, ${brandPrimary}, ${brandPrimary}dd);border-radius:12px;color:#fff;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-size:24px;font-weight:800;letter-spacing:-0.3px;">${escapeHtml(brandColors.companyName || '')}</div>
          ${brandColors.tagline ? `<div style="font-size:12px;opacity:0.85;font-style:italic;margin-top:2px;">${escapeHtml(brandColors.tagline)}</div>` : ''}
          ${contactLine}
        </div>
        <div style="text-align:right;">
          ${addressLine}
          ${licenseLine}
        </div>
      </div>
    </div>
  `;
}

function buildPropertySection(report: ComprehensiveRoofReport, brandPrimary: string): string {
  const { property, damageAnalysis, roofDetails } = report;

  // Calculate condition score (0-100, inverse of severity)
  const conditionScore = SEVERITY_TO_CONDITION_SCORE[damageAnalysis?.overallSeverity || 'none'] ?? CONDITION_SCORE_DEFAULT;

  // Overall verdict badge — table-driven (no more parallel ternaries).
  const tier = VERDICT_TIERS.find(t => conditionScore >= t.minScore) ?? VERDICT_TIERS[VERDICT_TIERS.length - 1];
  const verdictLabel = tier.label;
  const verdictSubtext = tier.subtext;
  const scoreColor = tier.scoreColor;
  const verdictBg = tier.bg;
  const verdictBorder = tier.border;
  const verdictText = tier.textColor;

  // Roof detail lines
  const roofDetailLines: string[] = [];
  const mat = damageAnalysis?.roofAge?.roofMaterial || roofDetails?.material;
  if (mat) roofDetailLines.push(`<strong>${LABEL_DETAIL_MATERIAL}</strong> ${escapeHtml(String(mat).replace(UNDERSCORE_TO_SPACE_RE, ' '))}`);
  if (roofDetails?.squares) roofDetailLines.push(`<strong>${LABEL_DETAIL_SIZE}</strong> ${escapeHtml(roofDetails.squares)}${SQUARES_SUFFIX}`);
  if (roofDetails?.pitch) roofDetailLines.push(`<strong>${LABEL_DETAIL_PITCH}</strong> ${escapeHtml(roofDetails.pitch)}`);
  if (roofDetails?.stories) roofDetailLines.push(`<strong>${LABEL_DETAIL_STORIES}</strong> ${escapeHtml(roofDetails.stories)}`);
  const ageYrs = damageAnalysis?.roofAge?.estimatedAgeYears || roofDetails?.age_years;
  if (ageYrs) roofDetailLines.push(`<strong>${LABEL_DETAIL_EST_AGE}</strong> ${ESTIMATE_PREFIX}${escapeHtml(ageYrs)}${YEARS_SUFFIX}`);

  return `
    <div class="report-section" data-reveal style="display:flex;gap:20px;margin-bottom:24px;flex-wrap:wrap;">
      <div class="stat-card" style="flex:2;min-width:300px;background:var(--bg-surface);border-radius:var(--radius-md);padding:24px;border-left:4px solid var(--brand-primary);box-shadow:var(--shadow-card);">
        <h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.5px;font-weight:600;">${HEADING_PROPERTY_INFO}</h3>
        <div style="font-size:clamp(16px, 2.5vw, 20px);font-weight:700;margin-bottom:8px;color:var(--text-primary);">${escapeHtml(property.address)}</div>
        <div style="font-size:14px;color:var(--text-secondary);">${escapeHtml(property.city)}, ${escapeHtml(property.state)} ${escapeHtml(property.zip || '')}</div>
        ${roofDetailLines.length > 0 ? `
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-subtle);">
            ${roofDetailLines.map(l => `<div style="font-size:13px;color:var(--text-primary);margin-top:2px;">${l}</div>`).join('')}
          </div>
        ` : ''}
      </div>

      <div class="stat-card" style="flex:1;min-width:180px;background:${verdictBg};border-radius:var(--radius-md);padding:24px;text-align:center;border:2px solid ${verdictBorder};box-shadow:var(--shadow-card);">
        <h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;color:${verdictText};letter-spacing:0.5px;font-weight:600;">${HEADING_OVERALL_CONDITION}</h3>
        <div style="font-size:clamp(28px, 5vw, 36px);font-weight:800;color:${scoreColor};">${verdictLabel}</div>
        <div style="font-size:13px;color:${verdictText};margin-top:8px;font-weight:600;">${verdictSubtext}</div>
        <div style="margin-top:12px;">
          <div class="score-ring" style="position:relative;width:70px;height:70px;margin:0 auto;">
            <svg viewBox="${SCORE_RING_VIEWBOX}" style="width:100%;height:100%;">
              <circle cx="${SCORE_RING_CX}" cy="${SCORE_RING_CY}" r="${SCORE_RING_RADIUS}" fill="none" stroke="${verdictBg}" stroke-width="${SCORE_RING_STROKE_WIDTH}"/>
              <circle class="score-arc" cx="${SCORE_RING_CX}" cy="${SCORE_RING_CY}" r="${SCORE_RING_RADIUS}" fill="none" stroke="${scoreColor}" stroke-width="${SCORE_RING_STROKE_WIDTH}"
                stroke-dasharray="${conditionScore * SCORE_RING_SCORE_TO_DASH} ${SCORE_RING_DASH_TOTAL}"
                stroke-linecap="round"
                transform="rotate(-90 ${SCORE_RING_CX} ${SCORE_RING_CY})"/>
            </svg>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:18px;font-weight:800;color:${scoreColor};"><span data-counter data-to="${conditionScore}">${conditionScore}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildRoofAgeSection(roofAge: RoofAgeEstimation | null | undefined, internalView = false): string {
  if (!roofAge) return '';

  const cond = ROOF_AGE_CONDITION_COLORS[roofAge.materialCondition] || ROOF_AGE_CONDITION_COLORS.fair;
  const conf = ROOF_AGE_CONFIDENCE_COLORS[roofAge.confidence] || ROOF_AGE_CONFIDENCE_COLORS.low;

  // Show a value only when there is one. An empty tile is fine; a tile reading
  // "undefined" or "~null years" in front of a homeowner is not.
  const hasAge = typeof roofAge.estimatedAgeYears === 'number' && Number.isFinite(roofAge.estimatedAgeYears);
  const hasCondition = typeof roofAge.materialCondition === 'string' && roofAge.materialCondition.length > 0;
  if (!hasAge && !hasCondition && !roofAge.roofMaterial) return '';

  const indicators = roofAge.indicators || [];
  const indicatorsHtml = indicators.length > 0
    ? `
      <div style="margin-top:16px;">
        <div style="font-size:11px;text-transform:uppercase;color:#6b7280;font-weight:600;margin-bottom:8px;">${LABEL_AGE_INDICATORS}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${indicators.map(ind => `
            <span style="display:inline-block;padding:4px 8px;background:#f3f4f6;border-radius:4px;font-size:11px;color:#374151;">${escapeHtml(ind)}</span>
          `).join('')}
        </div>
      </div>
    `
    : '';

  return `
    <div style="background:#faf5ff;border:1px solid #d8b4fe;border-radius:8px;padding:20px;margin-bottom:24px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <div style="width:32px;height:32px;background:#a855f7;border-radius:8px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:16px;">🤖</span>
        </div>
        <h3 style="margin:0;font-size:16px;font-weight:700;color:#7c3aed;">${LABEL_AI_ROOF_ANALYSIS}</h3>
      </div>

      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <div style="flex:1;min-width:150px;">
          <div style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">${LABEL_ESTIMATED_AGE}</div>
          <div style="font-size:24px;font-weight:700;color:#581c87;">${hasAge ? `${ESTIMATE_PREFIX}${escapeHtml(roofAge.estimatedAgeYears)}${YEARS_SUFFIX}` : NOT_ASSESSED}</div>
          ${internalView ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:${conf.bg};color:${conf.text};text-transform:uppercase;margin-top:4px;">${escapeHtml(roofAge.confidence)}${CONFIDENCE_SUFFIX}</span>` : ''}
        </div>

        ${roofAge.roofMaterial ? `
          <div style="flex:1;min-width:150px;">
            <div style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">${LABEL_MATERIAL}</div>
            <div style="font-size:18px;font-weight:600;color:#581c87;text-transform:capitalize;">${escapeHtml(String(roofAge.roofMaterial).replace(UNDERSCORE_TO_SPACE_RE, ' '))}</div>
          </div>
        ` : ''}

        <div style="flex:1;min-width:150px;">
          <div style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">${LABEL_CONDITION}</div>
          <span style="display:inline-block;padding:6px 12px;border-radius:6px;font-size:14px;font-weight:600;background:${cond.bg};color:${cond.text};text-transform:uppercase;">${hasCondition ? escapeHtml(roofAge.materialCondition) : NOT_ASSESSED}</span>
        </div>
      </div>

      ${indicatorsHtml}
    </div>
  `;
}

function buildInspectorNotesSection(notes: string | undefined, brandSecondary: string): string {
  if (!notes || notes.trim() === '') return '';

  // Escape HTML first, then convert line breaks to HTML
  const formattedNotes = escapeHtml(notes).replace(NEWLINE_RE, HTML_LINE_BREAK);

  // Detect severity from note content — use red/urgent style for replacement/critical notes
  const lower = notes.toLowerCase();
  const isUrgent = URGENT_NOTE_KEYWORDS.some(k => lower.includes(k));

  const bgColor = isUrgent ? '#fef2f2' : '#f0fdf4';
  const borderColor = isUrgent ? '#ef4444' : '#86efac';
  const iconBg = isUrgent ? '#ef4444' : '#22c55e';
  const textColor = isUrgent ? '#991b1b' : '#166534';
  const borderWidth = isUrgent ? '2px' : '1px';

  return `
    <div data-reveal style="margin-bottom:32px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid ${BORDER_COLOR_NEUTRAL};padding-bottom:8px;">
        ${LABEL_INSPECTOR_NOTES}
      </h2>
      <div style="background:${bgColor};border:${borderWidth} solid ${borderColor};border-radius:8px;padding:20px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="width:32px;height:32px;background:${iconBg};border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#fff;font-size:14px;">${isUrgent ? '⚠' : '📝'}</span>
          </div>
          <div style="flex:1;font-size:14px;color:${textColor};line-height:1.6;font-weight:${isUrgent ? '500' : '400'};">
            ${formattedNotes}
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildStormHistorySection(storm: ComprehensiveRoofReport['stormHistory'], brandSecondary: string): string {
  const riskColor = RISK_LEVEL_COLORS[storm.riskLevel] ?? RISK_LEVEL_COLOR_DEFAULT;
  const claimColor = RISK_LEVEL_COLORS[storm.claimPotential] ?? RISK_LEVEL_COLOR_DEFAULT;

  // Most recent storms
  let recentStormsHtml = '';
  if (storm.mostRecentHailStorm || storm.mostRecentWindStorm) {
    recentStormsHtml = `
      <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">
        ${storm.mostRecentHailStorm ? `
          <div style="flex:1;min-width:200px;background:${STORM_HAIL_CARD_COLORS.bg};border-radius:8px;padding:16px;border-left:4px solid ${STORM_HAIL_CARD_COLORS.border};">
            <div style="font-size:11px;text-transform:uppercase;color:${STORM_HAIL_CARD_COLORS.labelColor};font-weight:600;margin-bottom:4px;">${MSG_RECENT_HAIL_LABEL}</div>
            <div style="font-size:16px;font-weight:700;color:${STORM_HAIL_CARD_COLORS.valueColor};">${escapeHtml(storm.mostRecentHailStorm.magnitude)}</div>
            <div style="font-size:13px;color:${STORM_HAIL_CARD_COLORS.labelColor};">${escapeHtml(storm.mostRecentHailStorm.date)}</div>
            <div style="font-size:11px;color:${STORM_HAIL_CARD_COLORS.distanceColor};margin-top:4px;">${storm.mostRecentHailStorm.distanceMiles.toFixed(DISTANCE_DECIMALS)}${MILES_AWAY_SUFFIX}</div>
          </div>
        ` : ''}
        ${storm.mostRecentWindStorm ? `
          <div style="flex:1;min-width:200px;background:${STORM_WIND_CARD_COLORS.bg};border-radius:8px;padding:16px;border-left:4px solid ${STORM_WIND_CARD_COLORS.border};">
            <div style="font-size:11px;text-transform:uppercase;color:${STORM_WIND_CARD_COLORS.labelColor};font-weight:600;margin-bottom:4px;">${MSG_RECENT_WIND_LABEL}</div>
            <div style="font-size:16px;font-weight:700;color:${STORM_WIND_CARD_COLORS.valueColor};">${escapeHtml(storm.mostRecentWindStorm.magnitude)}</div>
            <div style="font-size:13px;color:${STORM_WIND_CARD_COLORS.labelColor};">${escapeHtml(storm.mostRecentWindStorm.date)}</div>
            <div style="font-size:11px;color:${STORM_WIND_CARD_COLORS.distanceColor};margin-top:4px;">${storm.mostRecentWindStorm.distanceMiles.toFixed(DISTANCE_DECIMALS)}${MILES_AWAY_SUFFIX}</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Summary stats
  const statsHtml = `
    <div class="stat-grid" style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;margin-bottom:20px;">
      <div class="stat-card" style="text-align:center;padding:14px;background:var(--bg-surface);border-radius:var(--radius-sm);box-shadow:var(--shadow-card);">
        <div style="font-size:clamp(18px, 3vw, 22px);font-weight:700;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span data-counter data-to="${storm.totalEvents}">${storm.totalEvents}</span></div>
        <div style="font-size:11px;color:var(--text-secondary);">${STAT_LABEL_TOTAL_EVENTS}</div>
      </div>
      <div class="stat-card" style="text-align:center;padding:14px;background:#fef3c7;border-radius:var(--radius-sm);box-shadow:var(--shadow-card);animation-delay:0.05s;">
        <div style="font-size:clamp(18px, 3vw, 22px);font-weight:700;color:#92400e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span data-counter data-to="${storm.hailEvents}">${storm.hailEvents}</span></div>
        <div style="font-size:11px;color:#92400e;">${STAT_LABEL_HAIL_EVENTS}</div>
      </div>
      <div class="stat-card" style="text-align:center;padding:14px;background:#dbeafe;border-radius:var(--radius-sm);box-shadow:var(--shadow-card);animation-delay:0.1s;">
        <div style="font-size:clamp(18px, 3vw, 22px);font-weight:700;color:#1e40af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span data-counter data-to="${storm.windEvents}">${storm.windEvents}</span></div>
        <div style="font-size:11px;color:#1e40af;">${STAT_LABEL_WIND_EVENTS}</div>
      </div>
      <div class="stat-card" style="text-align:center;padding:14px;background:${storm.tornadoEvents > 0 ? STORM_TORNADO_ALERT_BG : 'var(--bg-surface)'};border-radius:var(--radius-sm);box-shadow:var(--shadow-card);animation-delay:0.15s;">
        <div style="font-size:clamp(18px, 3vw, 22px);font-weight:700;color:${storm.tornadoEvents > 0 ? STORM_TORNADO_ALERT_COLOR : 'var(--text-secondary)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span data-counter data-to="${storm.tornadoEvents}">${storm.tornadoEvents}</span></div>
        <div style="font-size:11px;color:${storm.tornadoEvents > 0 ? STORM_TORNADO_ALERT_COLOR : 'var(--text-secondary)'};">${STAT_LABEL_TORNADOES}</div>
      </div>
    </div>
  `;

  // Events by year table — frequency bar in the total column scaled to the
  // busiest year so storm activity reads at a glance.
  const years = Object.keys(storm.eventsByYear).map(Number).sort((a, b) => b - a);
  const maxYearTotal = years.reduce((mx, y) => {
    const t = Number(storm.eventsByYear[y]?.total) || 0;
    return t > mx ? t : mx;
  }, 0);
  const yearRows = years.map(year => {
    const data = storm.eventsByYear[year];
    const barPct = maxYearTotal > 0 ? Math.round(((Number(data.total) || 0) / maxYearTotal) * 100) : 0;
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">${escapeHtml(year)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${data.hail}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${data.wind}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;"><div class="rbar-cell"><span class="rbar-track"><span class="rbar-fill" data-bar-fill style="width:${barPct}%"></span></span><span class="rbar-num">${data.total}</span></div></td>
      </tr>
    `;
  }).join('');

  // Recommended Date of Loss
  let dolHtml = '';
  if (storm.recommendedDateOfLoss) {
    dolHtml = `
      <div style="background:${STORM_DOL_COLORS.bg};border:1px solid ${STORM_DOL_COLORS.border};border-radius:8px;padding:16px;margin-top:20px;">
        <div style="font-size:12px;text-transform:uppercase;color:${STORM_DOL_COLORS.labelColor};font-weight:600;margin-bottom:8px;">${MSG_RECOMMENDED_DOL_LABEL}</div>
        <div style="font-size:18px;font-weight:700;color:${STORM_DOL_COLORS.dateColor};">${escapeHtml(storm.recommendedDateOfLoss.date)}</div>
        <div style="font-size:13px;color:${STORM_DOL_COLORS.eventColor};margin-top:4px;">${escapeHtml(storm.recommendedDateOfLoss.eventType)} - ${escapeHtml(storm.recommendedDateOfLoss.magnitude)}</div>
        <div style="font-size:12px;color:${STORM_DOL_COLORS.reasonColor};margin-top:8px;font-style:italic;">${escapeHtml(storm.recommendedDateOfLoss.reason)}</div>
      </div>
    `;
  }

  return `
    <div data-reveal style="margin-bottom:32px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid ${BORDER_COLOR_NEUTRAL};padding-bottom:8px;">
        ${LABEL_STORM_HISTORY_PREFIX} (${storm.yearsAnalyzed} Years, ${storm.searchRadiusMiles}${MILE_RADIUS_SUFFIX})
      </h2>

      <!-- Risk Assessment -->
      <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">
        <div style="flex:1;min-width:150px;background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">${RISK_LABEL_RISK_LEVEL}</div>
          <div style="font-size:20px;font-weight:700;text-transform:uppercase;color:${riskColor};">${escapeHtml(storm.riskLevel)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${RISK_SCORE_PREFIX}${storm.riskScore}${RISK_SCORE_DENOMINATOR}</div>
        </div>
        <div style="flex:1;min-width:150px;background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">${RISK_LABEL_CLAIM_POTENTIAL}</div>
          <div style="font-size:20px;font-weight:700;text-transform:uppercase;color:${claimColor};">${escapeHtml(storm.claimPotential)}</div>
        </div>
        ${storm.largestHailInches ? `
          <div style="flex:1;min-width:150px;background:#fef3c7;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:11px;text-transform:uppercase;color:#92400e;margin-bottom:4px;">${RISK_LABEL_LARGEST_HAIL}</div>
            <div style="font-size:20px;font-weight:700;color:#78350f;">${storm.largestHailInches}${INCHES_DOUBLE_QUOTE_SUFFIX}</div>
          </div>
        ` : ''}
        ${storm.highestWindMph ? `
          <div style="flex:1;min-width:150px;background:#dbeafe;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:11px;text-transform:uppercase;color:#1e40af;margin-bottom:4px;">${RISK_LABEL_HIGHEST_WIND}</div>
            <div style="font-size:20px;font-weight:700;color:#1e3a8a;">${storm.highestWindMph}${MPH_SUFFIX}</div>
          </div>
        ` : ''}
      </div>

      ${recentStormsHtml}
      ${statsHtml}

      ${buildStormTimeline(storm, brandSecondary)}

      <!-- Events by Year -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;">
        <tr style="background:${brandSecondary};color:#fff;">
          <th style="padding:10px 12px;text-align:left;font-weight:600;">${YEAR_TABLE_LABEL_YEAR}</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;">${YEAR_TABLE_LABEL_HAIL}</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;">${YEAR_TABLE_LABEL_WIND}</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;">${YEAR_TABLE_LABEL_TOTAL}</th>
        </tr>
        ${yearRows}
      </table>

      ${dolHtml}
    </div>
  `;
}

function buildEnhancedStormSection(
  enhanced: EnhancedStormData,
  stormHistory: StormSummarySection,
  brandSecondary: string
): string {
  if (!enhanced) return '';

  // Narratives
  const narrativesHtml = (enhanced.narratives?.length || 0) > 0
    ? enhanced.narratives.slice(0, MAX_NARRATIVES_DISPLAYED).map(n => `
        <div style="margin-bottom:12px;padding:12px;background:#eff6ff;border-radius:6px;border-left:3px solid #3b82f6;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:600;color:#2563eb;">${escapeHtml(n.type)}</span>
            <span style="font-size:12px;color:#6b7280;">${escapeHtml(n.date)}</span>
          </div>
          <div style="font-size:12px;color:#374151;line-height:1.5;">${escapeHtml(n.narrative.slice(0, NARRATIVE_PREVIEW_MAX_CHARS))}${n.narrative.length > NARRATIVE_PREVIEW_MAX_CHARS ? '...' : ''}</div>
        </div>
      `).join('')
    : `<p style="font-size:12px;color:#9ca3af;font-style:italic;">${MSG_NO_NARRATIVES}</p>`;

  // Property profile
  let profileHtml = '';
  if (enhanced.propertyProfile) {
    const pp = enhanced.propertyProfile;
    profileHtml = `
      <h3 style="font-size:15px;font-weight:700;margin:24px 0 12px;color:${brandSecondary};">${LABEL_PROPERTY_STORM_PROFILE}</h3>
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:12px;margin-bottom:20px;">
        <div style="text-align:center;padding:12px;background:#f3f4f6;border-radius:6px;">
          <div style="font-size:20px;font-weight:700;color:#1f2937;">${escapeHtml(pp.worst_year?.year || WORST_YEAR_FALLBACK)}</div>
          <div style="font-size:11px;color:#6b7280;">${LABEL_WORST_STORM_YEAR}${pp.worst_year ? ` (${escapeHtml(pp.worst_year.event_count)} events)` : ''}</div>
        </div>
        <div style="text-align:center;padding:12px;background:#f3f4f6;border-radius:6px;">
          <div style="font-size:20px;font-weight:700;color:#1f2937;">${(pp.avg_events_per_year ?? 0).toFixed(PROFILE_DECIMALS)}</div>
          <div style="font-size:11px;color:#6b7280;">${LABEL_AVG_EVENTS_YEAR}</div>
        </div>
        <div style="text-align:center;padding:12px;background:#f3f4f6;border-radius:6px;">
          <div style="font-size:20px;font-weight:700;color:#059669;">${pp.storm_free_years?.length ?? 0}</div>
          <div style="font-size:11px;color:#6b7280;">${LABEL_STORM_FREE_YEARS}</div>
        </div>
        <div style="text-align:center;padding:12px;background:#f3f4f6;border-radius:6px;">
          <div style="font-size:20px;font-weight:700;text-transform:uppercase;color:${EXPOSURE_TIER_COLORS[pp.estimated_cumulative_exposure || ''] || EXPOSURE_TIER_COLOR_DEFAULT};">${escapeHtml(pp.estimated_cumulative_exposure || EXPOSURE_FALLBACK_LABEL)}</div>
          <div style="font-size:11px;color:#6b7280;">${LABEL_CUMULATIVE_EXPOSURE}</div>
        </div>
      </div>
    `;
  }

  // NOAA references
  const noaaHtml = (enhanced.noaaEventPageUrls?.length || 0) > 0
    ? `
      <h3 style="font-size:15px;font-weight:700;margin:24px 0 8px;color:${brandSecondary};">${LABEL_NOAA_REFS}</h3>
      <p style="font-size:12px;color:#6b7280;margin-bottom:12px;">${MSG_NOAA_REF_HELPER}</p>
      ${enhanced.noaaEventPageUrls.slice(0, MAX_NOAA_REFS_DISPLAYED).map(ref => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:4px 0;">
          <span style="font-size:12px;font-weight:600;color:#2563eb;">${escapeHtml(ref.date)}</span>
          <span style="font-size:12px;color:#374151;">${escapeHtml(ref.type)}</span>
          <span style="font-size:11px;color:#9ca3af;flex:1;text-align:right;word-break:break-all;">${escapeHtml(ref.url)}</span>
        </div>
      `).join('')}
    `
    : '';

  // County database link
  const countyHtml = enhanced.countyStormDatabaseUrl
    ? `
      <div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;">
        <div style="font-size:13px;font-weight:600;color:#374151;">${LABEL_FULL_COUNTY_DB}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px;word-break:break-all;">${escapeHtml(enhanced.countyStormDatabaseUrl)}</div>
      </div>
    `
    : '';

  return `
    <div data-reveal style="margin-bottom:32px;">
      <h3 style="font-size:15px;font-weight:700;margin:0 0 12px;color:${brandSecondary};">${LABEL_EVENT_NARRATIVES}</h3>
      ${narrativesHtml}
      ${profileHtml}
      ${noaaHtml}
      ${countyHtml}
    </div>
  `;
}

function buildDamageAnalysisSection(damage: ComprehensiveRoofReport['damageAnalysis'], brandSecondary: string, tmpl?: ReportTemplateConfig, structuredFindings?: ComprehensiveRoofReport['structuredFindings'], photoLabels?: ComprehensiveRoofReport['photoLabels'], internalView = false): string {
  if (!damage) return '';

  const severityColor = getSeverityColorInline(damage.overallSeverity || 'none');

  // If no photos were analyzed and no damage types found, show a helpful message
  const totalPhotos = damage.totalPhotosAnalyzed || 0;
  const photosWithDamage = damage.photosWithDamage || 0;

  if (totalPhotos === 0 && (!damage.damageTypes || damage.damageTypes.length === 0)) {
    return `
      <div style="margin-bottom:32px;">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid ${BORDER_COLOR_NEUTRAL};padding-bottom:8px;">
          ${LABEL_DAMAGE_ANALYSIS}
        </h2>
        <div style="background:#f9fafb;border-radius:8px;padding:24px;text-align:center;">
          <div style="font-size:14px;color:#6b7280;">${MSG_NO_PHOTOS_UPLOADED}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:8px;">${MSG_UPLOAD_PHOTOS_HINT}</div>
        </div>
      </div>
    `;
  }

  // Summary
  const summaryHtml = `
    <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap;">
      <div style="flex:1;min-width:140px;background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:20px;font-weight:700;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span data-counter data-to="${totalPhotos}">${totalPhotos}</span></div>
        <div style="font-size:11px;color:#6b7280;">${LABEL_PHOTOS_ANALYZED}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:20px;font-weight:700;color:${STAT_PHOTOS_WITH_DAMAGE_COLOR};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span data-counter data-to="${photosWithDamage}">${photosWithDamage}</span></div>
        <div style="font-size:11px;color:#6b7280;">${LABEL_WITH_DAMAGE}</div>
      </div>
      <div style="flex:1;min-width:140px;background:${severityColor.bg};border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:15px;font-weight:700;text-transform:uppercase;color:${severityColor.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(damage.overallSeverity || 'none')}</div>
        <div style="font-size:11px;color:${severityColor.text};">${LABEL_OVERALL_SEVERITY}</div>
      </div>
    </div>
  `;

  // Damage Inventory (sorted by severity, limited by template)
  let damageTypesHtml = '';
  const maxDamageTypes = tmpl?.maxDamageTypes || 0;
  if (damage.damageTypes.length > 0 && tmpl?.sections?.damageInventory !== false) {
    // Sort by severity: critical > high > medium > low
    let sortedTypes = [...damage.damageTypes].sort((a, b) =>
      (DAMAGE_SEVERITY_SORT_ORDER[a.severity] ?? DAMAGE_SEVERITY_SORT_FALLBACK) -
      (DAMAGE_SEVERITY_SORT_ORDER[b.severity] ?? DAMAGE_SEVERITY_SORT_FALLBACK)
    );
    if (maxDamageTypes > 0) {
      sortedTypes = sortedTypes.slice(0, maxDamageTypes);
    }

    const maxTypeCount = sortedTypes.reduce((mx, dt) => {
      const c = Number(dt.count) || 0;
      return c > mx ? c : mx;
    }, 0);
    const typeRows = sortedTypes.map(dt => {
      const sColor = getSeverityColorInline(dt.severity as any);
      const recommendation = RECOMMENDATION_BY_SEVERITY[dt.severity] || RECOMMENDATION_FALLBACK;
      const countPct = maxTypeCount > 0 ? Math.round(((Number(dt.count) || 0) / maxTypeCount) * 100) : 0;
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-transform:capitalize;">${escapeHtml(String(dt.type).replace(UNDERSCORE_TO_SPACE_RE, ' '))}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;"><div class="rbar-cell"><span class="rbar-track"><span class="rbar-fill" data-bar-fill style="width:${countPct}%;background:${sColor.text}"></span></span><span class="rbar-num">${escapeHtml(dt.count)}</span></div></td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${sColor.bg};color:${sColor.text};text-transform:uppercase;">${escapeHtml(dt.severity)}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#6b7280;">${recommendation}</td>
        </tr>
      `;
    }).join('');

    // Build narrative finding cards — use Claude-enhanced structured findings if available
    let findingCards = '';
    if (structuredFindings && structuredFindings.length > 0) {
      const photoById = new Map((damage.photos || []).map(ph => [ph.id, ph]));
      findingCards = structuredFindings.map(finding => {
        const colors = FINDING_SEVERITY_COLOR_MAP[finding.severity] || FINDING_SEVERITY_COLOR_MAP.moderate;
        const badgeLabel = escapeHtml(String(finding.severity).toUpperCase());

        // The evidence for this finding, beside the finding.
        const evidence = (finding.relatedPhotoIds || [])
          .map(id => photoById.get(id))
          .filter((ph): ph is NonNullable<typeof ph> => Boolean(ph && safeHttpUrl(ph.url)))
          .slice(0, MAX_FINDING_PHOTOS);
        const evidenceHtml = evidence.length > 0
          ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(evidence.length, MAX_FINDING_PHOTOS)}, 1fr);gap:8px;margin-top:12px;">
              ${evidence.map(ph => `<figure style="margin:0;border-radius:6px;overflow:hidden;border:1px solid ${colors.border}33;">
                <img src="${escapeHtml(safeHttpUrl(ph.url))}" alt="${escapeHtml(ph.caption || finding.title)}" style="width:100%;height:150px;object-fit:cover;display:block;" loading="lazy" />
              </figure>`).join('')}
            </div>`
          : '';

        return `
          <div style="background:${colors.bg};border-left:4px solid ${colors.border};border-radius:0 8px 8px 0;padding:16px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-size:15px;font-weight:600;color:${colors.text};">${escapeHtml(finding.title)}</div>
              <span style="background:${colors.border}22;color:${colors.text};padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">${badgeLabel}</span>
            </div>
            <p style="margin:8px 0 0;font-size:13px;color:${colors.text};line-height:1.6;">
              ${escapeHtml(finding.narrative)}
            </p>
            ${finding.repairAction ? `<div style="margin-top:8px;font-size:12px;color:${colors.text};opacity:0.85;"><strong>${LABEL_ACTION_PREFIX}</strong> ${escapeHtml(finding.repairAction)}</div>` : ''}
            ${finding.insuranceRelevant ? `<div style="margin-top:4px;font-size:11px;color:#1e40af;font-weight:600;">${MSG_INSURANCE_CLAIM_APPLICABLE}</div>` : ''}
            ${evidenceHtml}
          </div>
        `;
      }).join('');
    } else {
      // Fallback: build finding cards from damage types (existing behavior)
      findingCards = sortedTypes.map(dt => {
        const sColor = getSeverityColorInline(dt.severity as any);
        // No Claude findings on this report, so match photos by damage type.
        const evidence = (damage.photos || [])
          .filter(ph => (ph.damages || []).some(d => d.type === dt.type))
          .filter(ph => Boolean(safeHttpUrl(ph.url)))
          .slice(0, MAX_FINDING_PHOTOS);
        const evidenceHtml = evidence.length > 0
          ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(evidence.length, MAX_FINDING_PHOTOS)}, 1fr);gap:8px;margin-top:12px;">
              ${evidence.map(ph => `<figure style="margin:0;border-radius:6px;overflow:hidden;border:1px solid ${sColor.text}22;">
                <img src="${escapeHtml(safeHttpUrl(ph.url))}" alt="${escapeHtml(ph.caption || dt.type)}" style="width:100%;height:150px;object-fit:cover;display:block;" loading="lazy" />
              </figure>`).join('')}
            </div>`
          : '';
        const borderColor = SEVERITY_BORDER_COLORS_FALLBACK[dt.severity] ?? SEVERITY_BORDER_COLOR_FALLBACK_DEFAULT;
        const badgeLabel = SEVERITY_BADGE_LABELS_FALLBACK[dt.severity] ?? SEVERITY_BADGE_LABEL_FALLBACK_DEFAULT;
        const recommendation = RECOMMENDATION_BY_SEVERITY_LONG[dt.severity] || RECOMMENDATION_LONG_FALLBACK;
        return `
          <div style="background:${sColor.bg};border-left:4px solid ${borderColor};border-radius:0 8px 8px 0;padding:16px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-size:15px;font-weight:600;color:${sColor.text};text-transform:capitalize;">${escapeHtml(String(dt.type).replace(UNDERSCORE_TO_SPACE_RE, ' '))}</div>
              <span style="background:${borderColor}22;color:${sColor.text};padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">${badgeLabel}</span>
            </div>
            <p style="margin:8px 0 0;font-size:13px;color:${sColor.text};line-height:1.5;">
              ${escapeHtml(dt.count)} instance(s) detected across inspection photos. ${recommendation}
            </p>
            ${evidenceHtml}
          </div>
        `;
      }).join('');
    }

    damageTypesHtml = `
      <h3 class="section-header" style="font-size:16px;font-weight:700;margin:24px 0 16px;color:#1f2937;">${LABEL_INSPECTION_FINDINGS}</h3>
      <div style="display:flex;flex-direction:column;gap:0;margin-bottom:24px;">
        ${findingCards}
      </div>
      <h3 style="font-size:14px;font-weight:600;margin:24px 0 12px;color:#1f2937;">${LABEL_DAMAGE_INVENTORY}</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;">
        <tr style="background:${brandSecondary};color:#fff;">
          <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_DAMAGE_TYPE}</th>
          <th style="padding:8px 12px;text-align:center;font-weight:600;">${LABEL_DAMAGE_COUNT}</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_DAMAGE_SEVERITY_COL}</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;">${LABEL_DAMAGE_RECOMMENDATION}</th>
        </tr>
        ${typeRows}
      </table>
    `;
  }

  // Photo gallery with damage labels (2-column grid with severity + confidence badges)
  let photosHtml = '';
  const maxPhotos = tmpl?.maxPhotos || 0;
  const showPhotoGallery = tmpl?.sections?.photoGallery !== false;
  let photos = damage.photos || [];
  if (maxPhotos > 0) {
    photos = photos.slice(0, maxPhotos);
  }
  if (photos.length > 0 && showPhotoGallery) {
    const photoItems = photos.map((photo, idx) => {
      const pSeverity = getSeverityColorInline(photo.overallSeverity || 'none');
      const topDamage = (photo.damages || [])[0];
      const damageDescriptions = (photo.damages || []).slice(0, MAX_PHOTO_DAMAGES_DISPLAYED).map(d => {
        const location = escapeHtml(d.location || LOCATION_FALLBACK);
        const type = escapeHtml(d.label || d.type);
        const severity = escapeHtml(String(d.severity).toUpperCase());
        return `${location} - ${type} - ${severity}`;
      });
      const damageLabels = damageDescriptions.join('<br>') || MSG_NO_DAMAGE_DETECTED_PHOTO;

      // Build damage annotation overlays — use Claude labels if available, fall back to bounding boxes
      const claudeLabels = photoLabels?.[photo.id] || [];
      let annotationOverlays = '';

      if (claudeLabels.length > 0) {
        annotationOverlays = claudeLabels.map(label => {
          const pos = LABEL_POSITION_CSS_MAP[label.position] || LABEL_POSITION_CSS_MAP['center'];
          const color = LABEL_SEVERITY_COLORS_SIMPLE[label.severity] || LABEL_SEVERITY_FALLBACK_COLOR;
          return `<div style="position:absolute;${pos}z-index:2;pointer-events:none;">
            <span style="display:inline-block;font-size:10px;font-weight:700;color:#fff;background:${color};padding:3px 8px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(label.text)}</span>
          </div>`;
        }).join('');
      } else {
        // Fallback: bounding box annotations from AI analysis
        annotationOverlays = (photo.damages || [])
          .filter(d => d.boundingBox)
          .map(d => {
            const bb = d.boundingBox!;
            const damageColor = SEVERITY_BORDER_COLORS_FALLBACK[d.severity] ?? SEVERITY_BORDER_COLOR_FALLBACK_DEFAULT;
            const bbLabel = escapeHtml(d.label || d.type);
            return `<div style="position:absolute;left:${escapeHtml(bb.x)}%;top:${escapeHtml(bb.y)}%;width:${escapeHtml(bb.width)}%;height:${escapeHtml(bb.height)}%;border:2px solid ${damageColor};border-radius:3px;pointer-events:none;" title="${bbLabel}">
              <span style="position:absolute;top:-16px;left:0;font-size:9px;font-weight:700;color:#fff;background:${damageColor};padding:1px 4px;border-radius:2px;white-space:nowrap;">${bbLabel}</span>
            </div>`;
          }).join('');
      }

      // Build annotation list for below the image (not overlaid)
      const annotationList = claudeLabels.length > 0
        ? claudeLabels.map(label => {
            const color = LABEL_SEVERITY_COLORS_SIMPLE[label.severity] || LABEL_SEVERITY_FALLBACK_COLOR;
            return `<span style="display:inline-block;font-size:10px;font-weight:600;color:#fff;background:${color};padding:2px 7px;border-radius:3px;margin:2px 3px 2px 0;">${escapeHtml(label.text)}</span>`;
          }).join('')
        : '';

      return `
        <div class="photo-card" style="border:1px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden;position:relative;box-shadow:var(--shadow-card);animation:fadeSlideUp 0.4s ease both;animation-delay:${0.1 + idx * 0.05}s;">
          <div style="position:relative;overflow:hidden;">
            ${safeHttpUrl(photo.url) ? `<img src="${escapeHtml(safeHttpUrl(photo.url))}" alt="Photo ${idx + 1}" style="width:100%;height:220px;object-fit:cover;display:block;" loading="lazy" />` : ''}
            <div style="position:absolute;top:8px;left:8px;">
              <span style="display:inline-block;padding:4px 12px;border-radius:var(--radius-sm);font-size:11px;font-weight:700;background:${pSeverity.bg};color:${pSeverity.text};text-transform:uppercase;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">${escapeHtml(photo.overallSeverity)}</span>
            </div>
            ${internalView && topDamage ? `
              <div style="position:absolute;top:8px;right:8px;">
                <span style="display:inline-block;padding:3px 10px;border-radius:var(--radius-sm);font-size:10px;font-weight:600;background:rgba(0,0,0,0.65);color:#fff;backdrop-filter:blur(4px);">${escapeHtml(topDamage.confidence)}${CONFIDENCE_BADGE_SUFFIX}</span>
              </div>
            ` : ''}
            ${photo.photoCategory ? `
              <div style="position:absolute;bottom:8px;left:8px;">
                <span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:9px;font-weight:600;background:rgba(0,0,0,0.55);color:#fff;text-transform:uppercase;backdrop-filter:blur(4px);">${escapeHtml(String(photo.photoCategory).replace(UNDERSCORE_TO_SPACE_RE, ' '))}</span>
              </div>
            ` : ''}
          </div>
          ${annotationList ? `<div style="padding:8px 14px 4px;line-height:1.8;">${annotationList}</div>` : ''}
          <div style="padding:${annotationList ? '4px' : '14px'} 14px 14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:13px;font-weight:700;color:var(--text-primary);">${PHOTO_NUMBER_PREFIX}${idx + 1}</span>
              ${topDamage ? `<span style="font-size:11px;color:var(--text-secondary);">${escapeHtml(topDamage.label || topDamage.type)}</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;line-height:1.5;">${damageLabels}</div>
            <div style="font-size:11px;color:var(--text-muted);font-style:italic;border-top:1px solid var(--border-subtle);padding-top:8px;margin-top:8px;">${escapeHtml(photo.aiSummary || '')}</div>
          </div>
        </div>
      `;
    }).join('');

    photosHtml = `
      <h3 style="font-size:14px;font-weight:600;margin:24px 0 12px;color:var(--text-primary);">${LABEL_ANALYZED_PHOTOS}</h3>
      <div class="photo-grid" style="display:grid;grid-template-columns:repeat(2, 1fr);gap:16px;">
        ${photoItems}
      </div>
    `;
  }

  return `
    <div data-reveal style="margin-bottom:32px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid ${BORDER_COLOR_NEUTRAL};padding-bottom:8px;">
        ${LABEL_DAMAGE_ANALYSIS}
      </h2>

      ${summaryHtml}

      <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="font-size:12px;text-transform:uppercase;color:#6b7280;font-weight:600;margin-bottom:8px;">${LABEL_AI_SUMMARY}</div>
        <div style="font-size:14px;color:#1f2937;">${escapeHtml(damage.aiSummary || MSG_AI_SUMMARY_FALLBACK)}</div>
      </div>

      ${damageTypesHtml}
      ${photosHtml}
    </div>
  `;
}

function buildRepairEstimateSection(
  estimate: ComprehensiveRoofReport['repairEstimate'],
  brandSecondary: string,
  brandPrimary: string
): string {
  if (!estimate || !estimate.lineItems || estimate.lineItems.length === 0) {
    return `
      <div style="margin-bottom:32px;">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid ${BORDER_COLOR_NEUTRAL};padding-bottom:8px;">
          ${LABEL_REPAIR_ESTIMATE}
        </h2>
        <div style="background:#f9fafb;border-radius:8px;padding:24px;text-align:center;">
          <div style="font-size:14px;color:${MUTED_TEXT_PRIMARY};">${MSG_NO_REPAIRS_NEEDED}</div>
          <div style="font-size:12px;color:${MUTED_TEXT_SECONDARY};margin-top:8px;">${MSG_UPLOAD_FOR_DETAIL}</div>
        </div>
      </div>
    `;
  }

  const lineItemRows = estimate.lineItems.map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER_COLOR_NEUTRAL};">${escapeHtml(item.repairName)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER_COLOR_NEUTRAL};text-align:center;">${escapeHtml(item.quantity)} ${escapeHtml(formatUnit(item.unit, item.quantity))}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER_COLOR_NEUTRAL};text-align:right;">${formatCurrency(item.finalCostPerUnit)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER_COLOR_NEUTRAL};text-align:right;font-weight:600;">${formatCurrency(item.totalFinalCost)}</td>
    </tr>
  `).join('');

  const notesHtml = estimate.notes.map(note => `
    <li style="margin-bottom:4px;font-size:12px;color:${MUTED_TEXT_PRIMARY};">${escapeHtml(note)}</li>
  `).join('');

  return `
    <div data-reveal style="margin-bottom:32px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid ${BORDER_COLOR_NEUTRAL};padding-bottom:8px;">
        ${LABEL_REPAIR_ESTIMATE}
      </h2>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;">
        <tr style="background:${brandSecondary};color:#fff;">
          <th style="padding:10px 12px;text-align:left;font-weight:600;">${LABEL_COL_REPAIR_ITEM}</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;">${LABEL_COL_QUANTITY}</th>
          <th style="padding:10px 12px;text-align:right;font-weight:600;">${LABEL_COL_UNIT_PRICE}</th>
          <th style="padding:10px 12px;text-align:right;font-weight:600;">${LABEL_COL_TOTAL}</th>
        </tr>
        ${lineItemRows}
      </table>

      <!-- Total -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:24px;">
        <div style="background:${brandPrimary};color:#fff;padding:16px 24px;border-radius:8px;text-align:right;">
          <div style="font-size:12px;opacity:0.9;margin-bottom:4px;">${LABEL_ESTIMATED_TOTAL}</div>
          <div style="font-size:28px;font-weight:700;"><span data-counter data-to="${Math.round(estimate.total)}" data-prefix="$">${formatCurrency(estimate.total)}</span></div>
        </div>
      </div>

      <!-- Notes -->
      <div style="background:#f9fafb;border-radius:8px;padding:16px;">
        <div style="font-size:12px;text-transform:uppercase;color:${MUTED_TEXT_PRIMARY};font-weight:600;margin-bottom:8px;">${LABEL_NOTES}</div>
        <ul style="margin:0;padding-left:20px;">
          ${notesHtml}
        </ul>
      </div>
    </div>
  `;
}

// ─── Roof Details Section ──────────────────────────────────────────────────────
function buildRoofDetailsSection(report: ComprehensiveRoofReport, brandSecondary: string): string {
  const rd = report.roofDetails;
  const m = report.measurements;
  if (!rd && !m) return '';

  const details: Array<{ label: string; value: string }> = [];
  if (rd?.material) details.push({ label: LABEL_SPECS_MATERIAL, value: escapeHtml(String(rd.material).replace(UNDERSCORE_TO_SPACE_RE, ' ')) });
  if (rd?.type) details.push({ label: LABEL_SPECS_ROOF_TYPE, value: escapeHtml(String(rd.type).replace(UNDERSCORE_TO_SPACE_RE, ' ')) });
  if (rd?.squares) details.push({ label: LABEL_SPECS_ROOF_SIZE, value: `${escapeHtml(rd.squares)}${SQUARES_LOWER_SUFFIX} (${(rd.squares * 100).toLocaleString()}${SQ_FT_SUFFIX})` });
  if (rd?.pitch) details.push({ label: LABEL_SPECS_PITCH, value: escapeHtml(rd.pitch) });
  if (rd?.stories) details.push({ label: LABEL_SPECS_STORIES, value: escapeHtml(String(rd.stories)) });
  if (rd?.age_years) details.push({ label: LABEL_SPECS_ESTIMATED_AGE, value: `${escapeHtml(rd.age_years)}${YEARS_SUFFIX}` });

  // Add measurement data if available
  if (m) {
    if (m.ridgeLength) details.push({ label: MEASUREMENT_DETAIL_LABELS.ridgeLength, value: `${escapeHtml(m.ridgeLength)}${LF_SUFFIX}` });
    if (m.hipLength) details.push({ label: MEASUREMENT_DETAIL_LABELS.hipLength, value: `${escapeHtml(m.hipLength)}${LF_SUFFIX}` });
    if (m.valleyLength) details.push({ label: MEASUREMENT_DETAIL_LABELS.valleyLength, value: `${escapeHtml(m.valleyLength)}${LF_SUFFIX}` });
    if (m.eaveLength) details.push({ label: MEASUREMENT_DETAIL_LABELS.eaveLength, value: `${escapeHtml(m.eaveLength)}${LF_SUFFIX}` });
    if (m.rakeLength) details.push({ label: MEASUREMENT_DETAIL_LABELS.rakeLength, value: `${escapeHtml(m.rakeLength)}${LF_SUFFIX}` });
    if (m.perimeterLength) details.push({ label: MEASUREMENT_DETAIL_LABELS.perimeter, value: `${escapeHtml(m.perimeterLength)}${LF_SUFFIX}` });
    if (m.facetCount) details.push({ label: MEASUREMENT_DETAIL_LABELS.facets, value: escapeHtml(String(m.facetCount)) });
  }

  if (details.length === 0) return '';

  const rows = details.map(d => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid ${BORDER_COLOR_LIGHT};">
      <span style="font-size:13px;color:${MUTED_TEXT_PRIMARY};">${d.label}</span>
      <span style="font-size:13px;font-weight:600;color:${DETAIL_VALUE_COLOR};text-transform:capitalize;">${d.value}</span>
    </div>
  `).join('');

  return `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid ${BORDER_COLOR_NEUTRAL};padding-bottom:8px;">
        ${LABEL_ROOF_SPECIFICATIONS}
      </h2>
      <div style="background:#f9fafb;border-radius:10px;padding:20px;">
        ${rows}
      </div>
    </div>
  `;
}

// ─── Measurement Report Section ──────────────────────────────────────────────
function buildMeasurementSection(report: ComprehensiveRoofReport, brandSecondary: string): string {
  const mr = report.measurementReport;
  if (!mr) return '';

  // Summary cards
  const summaryCards = `
    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <div style="flex:1;min-width:140px;background:${STAT_CARD_BG};border-radius:8px;padding:16px;text-align:center;border:1px solid ${STAT_CARD_BORDER};">
        <div style="font-size:20px;font-weight:800;color:${STAT_CARD_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${mr.totalSquares.toFixed(1)}</div>
        <div style="font-size:11px;color:${MUTED_TEXT_PRIMARY};text-transform:uppercase;font-weight:600;">${STAT_LABEL_SQUARES}</div>
      </div>
      <div style="flex:1;min-width:140px;background:${STAT_CARD_BG};border-radius:8px;padding:16px;text-align:center;border:1px solid ${STAT_CARD_BORDER};">
        <div style="font-size:20px;font-weight:800;color:${STAT_CARD_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${mr.totalFootprintSqFt.toLocaleString()}</div>
        <div style="font-size:11px;color:${MUTED_TEXT_PRIMARY};text-transform:uppercase;font-weight:600;">${STAT_LABEL_TOTAL_SQ_FT}</div>
      </div>
      <div style="flex:1;min-width:140px;background:${STAT_CARD_BG};border-radius:8px;padding:16px;text-align:center;border:1px solid ${STAT_CARD_BORDER};">
        <div style="font-size:20px;font-weight:800;color:${STAT_CARD_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(mr.averagePitch || 'N/A')}</div>
        <div style="font-size:11px;color:${MUTED_TEXT_PRIMARY};text-transform:uppercase;font-weight:600;">${STAT_LABEL_AVG_PITCH}</div>
      </div>
      <div style="flex:1;min-width:140px;background:${STAT_CARD_BG};border-radius:8px;padding:16px;text-align:center;border:1px solid ${STAT_CARD_BORDER};">
        <div style="font-size:20px;font-weight:800;color:${STAT_CARD_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(mr.wastePercentage)}%</div>
        <div style="font-size:11px;color:${MUTED_TEXT_PRIMARY};text-transform:uppercase;font-weight:600;">${STAT_LABEL_WASTE_FACTOR}</div>
      </div>
    </div>
  `;

  // Data source badge — table-driven (no more parallel ternaries).
  const dsKey = mr.dataSource || '';
  const dataSourceLabel = DATA_SOURCE_LABELS[dsKey] || DATA_SOURCE_LABEL_DEFAULT;
  const dsColor = DATA_SOURCE_COLORS[dsKey] || DATA_SOURCE_COLOR_DEFAULT;
  const dsBg = DATA_SOURCE_BGS[dsKey] || DATA_SOURCE_BG_DEFAULT;
  const dataSourceBadge = `<span style="display:inline-block;font-size:11px;font-weight:600;color:${dsColor};background:${dsBg};padding:4px 10px;border-radius:4px;margin-bottom:16px;">${DATA_SOURCE_PREFIX}${dataSourceLabel}</span>`;

  // 3D Roof visualization
  let roof3DBlock = '';
  const roof3DImage = safeImageSrc(report.measurements?.roof3DImage);
  if (roof3DImage) {
    roof3DBlock = `
      <div style="margin-bottom:20px;text-align:center;">
        <h3 style="font-size:15px;font-weight:700;margin:0 0 12px;color:${H3_DARK_HEADING_COLOR};">${LABEL_3D_ROOF_GEOMETRY}</h3>
        <div style="display:inline-block;border:1px solid ${BORDER_COLOR_NEUTRAL};border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <img src="${escapeHtml(roof3DImage)}" alt="3D Roof Model" style="max-width:100%;height:auto;" />
        </div>
      </div>
    `;
  }

  // Segments table
  const displaySegments = mr.segments.length > 0
    ? mr.segments
    : mr.totalFootprintSqFt > 0
      ? [{ name: ENTIRE_ROOF_FALLBACK_NAME, footprintSqFt: mr.totalFootprintSqFt, pitch: mr.averagePitch || '-', adjustedSqFt: mr.totalAdjustedSqFt }]
      : [];

  let segmentsTable = '';
  if (displaySegments.length > 0) {
    const totalFp = displaySegments.reduce((s, seg) => s + (seg.footprintSqFt ?? 0), 0);
    const totalAdj = displaySegments.reduce((s, seg) => s + (seg.adjustedSqFt ?? 0), 0);
    const segRows = displaySegments.map((seg, i) => `
      <tr style="background:${i % 2 === 1 ? ZEBRA_BG_ODD : ZEBRA_BG_EVEN};">
        <td style="padding:8px 12px;font-size:13px;">${escapeHtml(seg.name || `${SEGMENT_NAME_PREFIX}${i + 1}`)}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:right;">${(seg.footprintSqFt ?? 0).toLocaleString()}${SQFT_SUFFIX}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center;">${escapeHtml(seg.pitch || '-')}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:right;">${(seg.adjustedSqFt ?? 0).toLocaleString()}${SQFT_SUFFIX}</td>
      </tr>
    `).join('');

    const totalRow = displaySegments.length > 1 ? `
      <tr style="background:${STAT_CARD_BG};border-top:2px solid ${STAT_CARD_TEXT_COLOR};">
        <td style="padding:8px 12px;font-size:13px;font-weight:700;color:${SEGMENT_TOTAL_ROW_TEXT};">${LABEL_TOTAL_UPPERCASE}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:700;color:${SEGMENT_TOTAL_ROW_TEXT};text-align:right;">${totalFp.toLocaleString()}${SQFT_SUFFIX}</td>
        <td style="padding:8px 12px;text-align:center;">-</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:700;color:${SEGMENT_TOTAL_ROW_TEXT};text-align:right;">${totalAdj.toLocaleString()}${SQFT_SUFFIX}</td>
      </tr>
    ` : '';

    segmentsTable = `
      <h3 style="font-size:15px;font-weight:700;margin:20px 0 8px;color:${H3_DARK_HEADING_COLOR};">${LABEL_ROOF_SEGMENTS}</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid ${BORDER_COLOR_NEUTRAL};border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:${STAT_CARD_TEXT_COLOR};">
            <th style="padding:8px 12px;font-size:11px;color:#fff;text-align:left;text-transform:uppercase;">${SEG_COL_SEGMENT}</th>
            <th style="padding:8px 12px;font-size:11px;color:#fff;text-align:right;text-transform:uppercase;">${SEG_COL_FOOTPRINT}</th>
            <th style="padding:8px 12px;font-size:11px;color:#fff;text-align:center;text-transform:uppercase;">${SEG_COL_PITCH}</th>
            <th style="padding:8px 12px;font-size:11px;color:#fff;text-align:right;text-transform:uppercase;">${SEG_COL_ADJUSTED}</th>
          </tr>
        </thead>
        <tbody>${segRows}${totalRow}</tbody>
      </table>
    `;
  }

  // Edge lengths with color-coded cards
  const edgeEntries = Object.entries(mr.edgeLengths).filter(([, val]) => val > 0);
  let edgeLengthsHtml = '';
  if (edgeEntries.length > 0) {
    const totalLinearFt = edgeEntries.reduce((sum, [, val]) => sum + val, 0);
    const cards = edgeEntries.map(([key, val]) => {
      // Look up short key for color/description (handle both 'ridge' and 'ridgeLengthFt')
      const shortKey = key.replace('LengthFt', '');
      const colors = EDGE_COLORS[shortKey] || EDGE_FALLBACK_COLORS;
      const label = EDGE_LABELS[key] || key.replace(/([A-Z])/g, ' $1').trim();
      const desc = EDGE_DESCRIPTIONS[shortKey] || '';
      return `
      <div style="background:${colors.bg};border-radius:8px;padding:14px 12px;min-width:110px;border:1px solid ${colors.border};text-align:center;">
        <div style="font-size:22px;font-weight:800;color:${colors.text};">${Math.round(val)}'</div>
        <div style="font-size:11px;font-weight:700;color:${colors.text};text-transform:uppercase;margin-top:2px;">${escapeHtml(label)}</div>
        <div style="font-size:9px;color:${MUTED_TEXT_SECONDARY};margin-top:4px;">${escapeHtml(desc)}</div>
      </div>
    `;
    }).join('');
    edgeLengthsHtml = `
      <h3 style="font-size:15px;font-weight:700;margin:20px 0 8px;color:${H3_DARK_HEADING_COLOR};">${LABEL_EDGE_LENGTHS}</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;">${cards}</div>
      <div style="font-size:12px;color:${MUTED_TEXT_PRIMARY};margin-top:4px;">${LABEL_TOTAL_LINEAR_FOOTAGE} <strong style="color:${H3_DARK_HEADING_COLOR};">${Math.round(totalLinearFt)}${LF_SUFFIX}</strong></div>
    `;
  }

  // Material takeoff
  let materialHtml = '';
  const takeoffEntries = Object.entries(mr.materialTakeoff);
  if (takeoffEntries.length > 0) {
    const matRows = takeoffEntries.map(([item, data]: [string, any], i) => {
      let quantity = '-';
      let unit = '';
      if (data == null) { quantity = '-'; }
      else if (typeof data === 'string') { quantity = data; }
      else if (typeof data === 'number') { quantity = data.toLocaleString(); }
      else if (Array.isArray(data)) { quantity = data.join(', '); }
      else if (typeof data === 'object') {
        quantity = String(data.quantity ?? data.value ?? data.amount ?? '-');
        unit = String(data.unit ?? data.uom ?? '');
      }
      return `
        <tr style="background:${i % 2 === 1 ? ZEBRA_BG_ODD : ZEBRA_BG_EVEN};">
          <td style="padding:8px 12px;font-size:13px;">${escapeHtml(item.replace(UNDERSCORE_TO_SPACE_RE, ' ').replace(WORD_BOUNDARY_RE, c => c.toUpperCase()))}</td>
          <td style="padding:8px 12px;font-size:13px;text-align:right;">${escapeHtml(quantity)}</td>
          <td style="padding:8px 12px;font-size:13px;text-align:right;color:${MUTED_TEXT_PRIMARY};">${escapeHtml(unit)}</td>
        </tr>
      `;
    }).join('');

    materialHtml = `
      <h3 style="font-size:15px;font-weight:700;margin:20px 0 8px;color:${H3_DARK_HEADING_COLOR};">${LABEL_MATERIAL_TAKEOFF}</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid ${BORDER_COLOR_NEUTRAL};border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:${MATERIAL_TABLE_HEADER_BG};">
            <th style="padding:8px 12px;font-size:11px;color:${MUTED_TEXT_PRIMARY};text-align:left;text-transform:uppercase;">${TAKEOFF_COL_ITEM}</th>
            <th style="padding:8px 12px;font-size:11px;color:${MUTED_TEXT_PRIMARY};text-align:right;text-transform:uppercase;">${TAKEOFF_COL_QUANTITY}</th>
            <th style="padding:8px 12px;font-size:11px;color:${MUTED_TEXT_PRIMARY};text-align:right;text-transform:uppercase;">${TAKEOFF_COL_UNIT}</th>
          </tr>
        </thead>
        <tbody>${matRows}</tbody>
      </table>
    `;
  }

  return `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid ${BORDER_COLOR_NEUTRAL};padding-bottom:8px;">
        ${LABEL_ROOF_MEASUREMENTS}
      </h2>
      ${summaryCards}
      ${dataSourceBadge}
      ${roof3DBlock}
      ${segmentsTable}
      ${edgeLengthsHtml}
      ${materialHtml}
    </div>
  `;
}

// ─── Replacement Options (Good / Better / Best) ─────────────────────────────
function buildReplacementOptionsSection(
  replacementOptions: any[] | undefined,
  brandSecondary: string,
  brandPrimary: string,
): string {
  if (!replacementOptions || replacementOptions.length === 0) return '';

  const tierCards = replacementOptions.map((tier: any) => {
    const colors = REPLACEMENT_TIER_COLORS[tier.tier] || REPLACEMENT_TIER_COLORS.better;
    const isRecommended = tier.recommended;
    const emoji = REPLACEMENT_TIER_EMOJI[tier.tier] || REPLACEMENT_FEATURE_BULLET_DEFAULT;

    // Feature list
    const featuresHtml = (tier.features || []).slice(0, MAX_TIER_FEATURES_DISPLAYED).map((f: string) => `
      <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;">
        <span class="feature-check" style="background:${colors.badge};color:#fff;">${emoji}</span>
        <span style="font-size:12px;color:#374151;">${escapeHtml(f)}</span>
      </div>
    `).join('');

    // Materials detail
    let materialDetail = '';
    if (tier.materials && tier.materials.length > 0) {
      const mat = tier.materials[0];
      materialDetail = `
        <div style="margin-top:12px;padding:10px;background:#fff;border-radius:6px;border:1px solid ${colors.border};">
          <div style="font-size:11px;text-transform:uppercase;color:#6b7280;font-weight:600;margin-bottom:4px;">${LABEL_TIER_MATERIALS}</div>
          <div style="font-size:13px;font-weight:600;color:#1f2937;">${escapeHtml(mat.description)}</div>
          ${mat.brand ? `<div style="font-size:11px;color:#6b7280;">${escapeHtml(mat.brand)}${mat.details ? ` - ${escapeHtml(mat.details)}` : ''}</div>` : ''}
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">${escapeHtml(mat.quantity)} ${escapeHtml(mat.unit)} × $${(mat.unit_price || 0).toLocaleString()}/SQ</div>
        </div>
      `;
    }

    return `
      <div class="tier-card" style="flex:1;min-width:220px;border:2px solid ${isRecommended ? brandPrimary : colors.border};border-radius:12px;overflow:hidden;${isRecommended ? 'box-shadow:0 4px 20px rgba(0,0,0,0.1);' : ''}">
        ${isRecommended ? `<div style="background:${brandPrimary};color:#fff;text-align:center;padding:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">${BADGE_MOST_POPULAR}</div>` : ''}
        <div style="background:${colors.bg};padding:20px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase;background:${colors.badge};color:#fff;">${escapeHtml(tier.tier)}</span>
          </div>
          <div style="font-size:18px;font-weight:700;color:#1f2937;margin-bottom:2px;">${escapeHtml(tier.name || tier.tier)}</div>
          ${tier.tagline ? `<div style="font-size:12px;color:#6b7280;margin-bottom:12px;">${escapeHtml(tier.tagline)}</div>` : ''}

          <div style="font-size:32px;font-weight:800;color:${isRecommended ? brandPrimary : '#1f2937'};margin-bottom:4px;">
            $${(tier.total || 0).toLocaleString()}
          </div>
          ${tier.warranty_years ? `<div style="font-size:12px;color:#6b7280;">${escapeHtml(tier.warranty_years)}${WARRANTY_YEAR_SUFFIX}</div>` : ''}

          <div style="margin-top:16px;">
            ${featuresHtml}
          </div>

          ${materialDetail}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="margin-bottom:32px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 8px;color:${brandSecondary};border-bottom:2px solid #e5e7eb;padding-bottom:8px;">
        ${LABEL_REPLACEMENT_OPTIONS}
      </h2>
      <p style="font-size:13px;color:var(--text-secondary);margin:8px 0 20px;">${MSG_REPLACEMENT_OPTIONS_SUBTITLE}</p>
      <div class="tier-grid" style="display:flex;gap:16px;flex-wrap:wrap;">
        ${tierCards}
      </div>
    </div>
  `;
}

// ─── Company Credentials Section ─────────────────────────────────────────────
function buildCredentialsSection(brandColors: BrandColors, brandSecondary: string): string {
  const hasCerts = brandColors.certifications && brandColors.certifications.length > 0;
  const hasWarranties = brandColors.warranties && brandColors.warranties.length > 0;
  const hasInsurance = brandColors.insurance && brandColors.insurance.length > 0;

  if (!hasCerts && !hasWarranties && !hasInsurance) return '';

  const certsHtml = hasCerts ? `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">${LABEL_CERTIFICATIONS}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${brandColors.certifications!.map(c => `
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;">
            <span style="font-size:14px;">&#10003;</span>
            <div>
              <div style="font-size:12px;font-weight:600;color:#1e40af;">${escapeHtml(c.name)}</div>
              ${c.issuer ? `<div style="font-size:10px;color:#6b7280;">${escapeHtml(c.issuer)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const warrantiesHtml = hasWarranties ? `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">${LABEL_WARRANTY_OPTIONS}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${brandColors.warranties!.map(w => `
          <div style="padding:8px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;">
            <div style="font-size:12px;font-weight:600;color:#166534;">${escapeHtml(w.type)} - ${escapeHtml(w.years)} Year${Number(w.years) > 1 ? 's' : ''}</div>
            ${w.description ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;">${escapeHtml(w.description)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const insuranceHtml = hasInsurance ? `
    <div>
      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">${LABEL_INSURANCE_BONDING}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${brandColors.insurance!.map(ins => `
          <div style="padding:6px 12px;background:#faf5ff;border:1px solid #d8b4fe;border-radius:6px;">
            <div style="font-size:12px;font-weight:600;color:#7c3aed;">${escapeHtml(ins.type)}</div>
            ${ins.provider ? `<div style="font-size:10px;color:#6b7280;">${escapeHtml(ins.provider)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  return `
    <div style="margin-bottom:32px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid #e5e7eb;padding-bottom:8px;">
        ${LABEL_COMPANY_CREDENTIALS}
      </h2>
      ${certsHtml}
      ${warrantiesHtml}
      ${insuranceHtml}
    </div>
  `;
}

// ─── Call-to-Action Section ──────────────────────────────────────────────────
function buildCTASection(brandColors: BrandColors, brandPrimary: string): string {
  if (!brandColors.companyName && !brandColors.companyPhone) return '';

  const phoneCTA = brandColors.companyPhone
    ? `<a href="tel:${escapeHtml(brandColors.companyPhone)}" class="cta-button" style="display:inline-block;padding:14px 32px;background:var(--brand-primary);color:#fff;font-size:16px;font-weight:700;text-decoration:none;border-radius:var(--radius-md);letter-spacing:0.3px;box-shadow:0 2px 8px rgba(234,88,12,0.3);">${LABEL_CTA_CALL_PREFIX}${escapeHtml(brandColors.companyPhone)}</a>`
    : '';

  const emailCTA = brandColors.companyEmail
    ? `<a href="mailto:${escapeHtml(brandColors.companyEmail)}?subject=Roof%20Report%20Follow-up" class="cta-button" style="display:inline-block;padding:14px 32px;background:#fff;color:var(--brand-primary);font-size:16px;font-weight:700;text-decoration:none;border-radius:var(--radius-md);border:2px solid var(--brand-primary);letter-spacing:0.3px;">${LABEL_CTA_EMAIL_BUTTON}</a>`
    : '';

  return `
    <div style="margin-bottom:32px;text-align:center;padding:32px 24px;background:linear-gradient(135deg, #f9fafb, #f3f4f6);border-radius:12px;border:1px solid #e5e7eb;" class="no-print">
      <h2 style="font-size:22px;font-weight:800;color:#1f2937;margin:0 0 8px;">${LABEL_CTA_HEADING}</h2>
      <p style="font-size:14px;color:#6b7280;margin:0 0 20px;max-width:500px;margin-left:auto;margin-right:auto;">
        ${escapeHtml(brandColors.companyName || MSG_CTA_TEAM_FALLBACK)}${MSG_CTA_BODY_SUFFIX}
      </p>
      <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;">
        ${phoneCTA}
        ${emailCTA}
      </div>
    </div>
  `;
}

// ─── Roof Condition Index (RCI) Section ──────────────────────────────────────
function buildRCISection(rci: RoofConditionIndex, brandSecondary: string): string {
  const gc = RCI_GRADE_COLORS[rci.grade] || RCI_GRADE_COLORS.C;

  const componentBars = rci.components.map((c, i) => {
    const barColor = c.score >= 80 ? 'var(--severity-none)' : c.score >= 60 ? 'var(--severity-medium)' : c.score >= 40 ? 'var(--severity-high)' : 'var(--severity-critical)';
    const barColorRaw = c.score >= 80 ? '#22c55e' : c.score >= 60 ? '#eab308' : c.score >= 40 ? '#f97316' : '#ef4444';
    return `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <div style="width:140px;font-size:12px;color:#374151;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.name)}</div>
        <div style="flex:1;background:var(--border-subtle);border-radius:6px;height:22px;overflow:hidden;">
          <div class="progress-bar-fill" style="width:${c.score}%;background:${barColor};height:100%;border-radius:6px;animation-delay:${0.2 + i * 0.1}s;"></div>
        </div>
        <div style="width:40px;text-align:right;font-size:13px;font-weight:700;color:${barColorRaw};">${c.score}</div>
        <div style="width:20px;font-size:9px;color:var(--text-muted);">(${Math.round(c.weight * 100)}%)</div>
      </div>
    `;
  }).join('');

  return `
    <div class="report-section" style="margin-bottom:28px;">
      <h2 class="section-header" style="font-size:18px;font-weight:700;color:var(--brand-secondary);">
        ${LABEL_RCI_SECTION}
      </h2>
      <div class="rci-layout" style="display:flex;gap:28px;flex-wrap:wrap;">
        <div style="flex:0 0 170px;text-align:center;">
          <div class="score-ring" style="position:relative;width:130px;height:130px;margin:0 auto;">
            <svg viewBox="0 0 100 100" style="width:100%;height:100%;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.1));">
              <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border-light)" stroke-width="10"/>
              <circle class="score-arc" cx="50" cy="50" r="45" fill="none" stroke="${gc.text}" stroke-width="10"
                stroke-dasharray="${rci.overallScore * 2.83} 283"
                stroke-linecap="round"
                transform="rotate(-90 50 50)"/>
            </svg>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);">
              <div style="font-size:clamp(28px, 4vw, 36px);font-weight:800;color:${gc.text};">${rci.overallScore}</div>
            </div>
          </div>
          <div style="margin-top:10px;">
            <span class="badge-pulse" style="display:inline-block;padding:6px 20px;border-radius:var(--radius-sm);font-size:18px;font-weight:800;background:${gc.bg};color:${gc.text};">${LABEL_GRADE_PREFIX}${escapeHtml(rci.grade)}</span>
          </div>
        </div>
        <div style="flex:1;min-width:280px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:14px;text-transform:uppercase;letter-spacing:0.5px;">${LABEL_COMPONENT_SCORES}</div>
          ${componentBars}
        </div>
      </div>
    </div>
  `;
}

// ─── Storm Timeline Visualization ────────────────────────────────────────────
function buildStormTimeline(storm: StormSummarySection, brandSecondary: string): string {
  const years = Object.keys(storm.eventsByYear).map(Number).sort((a, b) => a - b);
  if (years.length === 0) return '';

  const maxEvents = Math.max(...Object.values(storm.eventsByYear).map(y => y.total), 1);
  const dol = storm.recommendedDateOfLoss;

  const timelineItems = years.map((year, i) => {
    const data = storm.eventsByYear[year];
    const isDOLYear = dol && dol.date.includes(String(year));

    return `
      <div style="flex:1;text-align:center;min-width:60px;">
        <div style="height:100px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;">
          ${data.hail > 0 ? `<div class="timeline-bar" style="width:28px;background:linear-gradient(180deg, #fbbf24, #f59e0b);border-radius:4px 4px 0 0;height:${Math.max(4, (data.hail / maxEvents) * 80)}px;animation-delay:${0.1 + i * 0.08}s;" title="${escapeHtml(data.hail)} hail events"></div>` : ''}
          ${data.wind > 0 ? `<div class="timeline-bar" style="width:28px;background:linear-gradient(180deg, #60a5fa, #3b82f6);border-radius:${data.hail > 0 ? '0' : '4px 4px'} 0 0;height:${Math.max(4, (data.wind / maxEvents) * 80)}px;animation-delay:${0.15 + i * 0.08}s;" title="${escapeHtml(data.wind)} wind events"></div>` : ''}
          ${data.total === 0 ? `<div style="width:28px;background:var(--border-light);border-radius:4px;height:4px;"></div>` : ''}
        </div>
        <div style="font-size:11px;font-weight:${isDOLYear ? '800' : '500'};color:${isDOLYear ? 'var(--severity-critical)' : 'var(--text-secondary)'};margin-top:6px;">${escapeHtml(year)}</div>
        <div style="font-size:10px;color:var(--text-muted);">${escapeHtml(data.total)}${EVENTS_COUNT_SUFFIX}</div>
        ${isDOLYear ? `<div style="font-size:9px;color:var(--severity-critical);font-weight:700;letter-spacing:0.5px;">${LABEL_DATE_OF_LOSS_FLAG}</div>` : ''}
      </div>
    `;
  }).join('');

  return `
    <div style="margin:20px 0;">
      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:12px;">${LABEL_STORM_TIMELINE}</div>
      <div style="display:flex;gap:4px;align-items:flex-end;padding:12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
        ${timelineItems}
      </div>
      <div style="display:flex;gap:16px;margin-top:8px;justify-content:center;">
        <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#6b7280;">
          <span style="width:12px;height:12px;background:#f59e0b;border-radius:2px;display:inline-block;"></span> ${STORM_LEGEND_HAIL}
        </div>
        <div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#6b7280;">
          <span style="width:12px;height:12px;background:#3b82f6;border-radius:2px;display:inline-block;"></span> ${STORM_LEGEND_WIND}
        </div>
      </div>
    </div>
  `;
}

// ─── Insurance Claim Support Section ─────────────────────────────────────────
function buildInsuranceClaimSection(report: ComprehensiveRoofReport, brandSecondary: string): string {
  const storm = report.stormHistory;
  const damage = report.damageAnalysis;
  if (!storm || !damage) return '';

  // Only show if there's claim potential
  if (storm.claimPotential === 'none' && !storm.recommendedDateOfLoss) return '';

  const claimWorthyDamages = damage.photos.flatMap(p =>
    p.damages.filter(d => d.severity === 'high' || d.severity === 'critical')
  );

  const totalEstimate = report.repairEstimate?.total || 0;

  const dolSection = storm.recommendedDateOfLoss ? `
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;text-transform:uppercase;color:#92400e;font-weight:700;margin-bottom:6px;">${LABEL_RECOMMENDED_DATE_OF_LOSS_BLOCK}</div>
      <div style="font-size:20px;font-weight:800;color:#78350f;">${escapeHtml(storm.recommendedDateOfLoss.date)}</div>
      <div style="font-size:13px;color:#92400e;margin-top:4px;">${escapeHtml(storm.recommendedDateOfLoss.eventType)} - ${escapeHtml(storm.recommendedDateOfLoss.magnitude)}</div>
      <div style="font-size:12px;color:#a16207;margin-top:8px;font-style:italic;">${escapeHtml(storm.recommendedDateOfLoss.reason)}</div>
    </div>
  ` : '';

  const haagFindings = claimWorthyDamages.map(d =>
    `<li style="margin-bottom:4px;font-size:12px;color:#374151;">${escapeHtml(d.label || d.type.replace(UNDERSCORE_TO_SPACE_RE, ' '))} - ${escapeHtml(d.severity)} severity${d.location ? ` (${escapeHtml(d.location)})` : ''}</li>`
  ).join('');

  const steps = INSURANCE_CLAIM_STEPS.map((s, i) => `
    <div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start;">
      <div style="width:24px;height:24px;background:${brandSecondary};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <span style="color:#fff;font-size:11px;font-weight:700;">${i + 1}</span>
      </div>
      <div style="font-size:13px;color:#374151;padding-top:3px;">${s}</div>
    </div>
  `).join('');

  return `
    <div style="margin-bottom:32px;">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 16px;color:${brandSecondary};border-bottom:2px solid #e5e7eb;padding-bottom:8px;">
        ${LABEL_INSURANCE_CLAIM_SUPPORT}
      </h2>

      ${dolSection}

      <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">
        <div style="flex:1;min-width:150px;background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#ef4444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${claimWorthyDamages.length}</div>
          <div style="font-size:11px;color:#6b7280;">Claim-Worthy Damages</div>
        </div>
        <div style="flex:1;min-width:150px;background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${storm.totalEvents}</div>
          <div style="font-size:11px;color:#6b7280;">Storm Events (${escapeHtml(storm.yearsAnalyzed)}yr)</div>
        </div>
        ${totalEstimate > 0 ? `
          <div style="flex:1;min-width:150px;background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#059669;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">$${totalEstimate.toLocaleString()}</div>
            <div style="font-size:11px;color:#6b7280;">${LABEL_ESTIMATED_REPAIR_COST_BLOCK}</div>
          </div>
        ` : ''}
      </div>

      ${haagFindings ? `
        <div style="margin-bottom:16px;">
          <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">${LABEL_CLAIM_FINDINGS}</div>
          <ul style="margin:0;padding-left:20px;">${haagFindings}</ul>
        </div>
      ` : ''}

      <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:20px;">
        <div style="font-size:13px;font-weight:600;color:#1e40af;margin-bottom:12px;">${LABEL_SUGGESTED_FILING_STEPS}</div>
        ${steps}
      </div>
    </div>
  `;
}

// ─── Executive Summary Section ───────────────────────────────────────────────
function buildExecutiveSummarySection(report: ComprehensiveRoofReport, brandSecondary: string): string {
  if (!report.executiveSummary) return '';

  // Determine condition badge from RCI or overall severity
  const rci = report.roofConditionIndex;
  const severity = report.damageAnalysis?.overallSeverity || 'none';
  let badgeText = '';
  let badgeBg = '';
  let badgeColor = '';
  let summaryBg = '';
  let summaryBorder = '';
  let summaryTextColor = EXEC_SUMMARY_DEFAULT_TEXT;

  if (rci) {
    // Table-driven (no more 4-branch if/else ladder).
    const tier = EXEC_SUMMARY_TIERS.find(t => rci.overallScore >= t.minScore) ?? EXEC_SUMMARY_TIERS[EXEC_SUMMARY_TIERS.length - 1];
    badgeText = tier.badgeText;
    badgeBg = tier.badgeBg;
    badgeColor = tier.badgeColor;
    summaryBg = tier.summaryBg;
    summaryBorder = tier.summaryBorder;
    summaryTextColor = tier.summaryTextColor;
  } else if (severity === 'critical' || severity === 'high') {
    badgeText = severity === 'critical' ? BADGE_REPLACEMENT_REQUIRED : BADGE_REPAIRS_NEEDED;
    badgeBg = EXEC_SUMMARY_SEVERE_BADGE_BG;
    badgeColor = EXEC_SUMMARY_SEVERE_BADGE_COLOR;
    summaryBg = EXEC_SUMMARY_SEVERE_BG;
    summaryBorder = EXEC_SUMMARY_SEVERE_BORDER;
    summaryTextColor = EXEC_SUMMARY_SEVERE_TEXT;
  } else {
    summaryBg = EXEC_SUMMARY_DEFAULT_BG;
    summaryBorder = EXEC_SUMMARY_DEFAULT_BORDER;
  }

  const badgeHtml = badgeText
    ? `<span style="display:inline-block;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;background:${badgeBg};color:${badgeColor};letter-spacing:0.5px;margin-left:12px;">${badgeText}</span>`
    : '';

  return `
    <div class="report-section" style="margin-bottom:28px;background:${summaryBg};border:2px solid ${summaryBorder};border-radius:var(--radius-lg);padding:28px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:-20px;right:-20px;width:120px;height:120px;background:radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%);pointer-events:none;"></div>
      <h2 style="font-size:16px;font-weight:700;margin:0 0 12px;color:${brandSecondary};display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${brandSecondary}" stroke-width="2" stroke-linecap="round"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>
        ${LABEL_EXECUTIVE_SUMMARY}
        ${badgeHtml}
      </h2>
      <div style="font-size:14px;color:${summaryTextColor};line-height:1.8;">${escapeHtml(report.executiveSummary)}</div>
    </div>
  `;
}

function getSeverityColorInline(severity: string): { bg: string; text: string } {
  return INLINE_SEVERITY_COLORS[severity] || INLINE_SEVERITY_COLORS.medium;
}
