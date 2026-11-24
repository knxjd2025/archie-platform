/**
 * Storm History Service
 * Fetches historical storm data (hail, wind, severe weather) for property locations.
 * Uses multiple real NOAA data sources — NO synthetic/estimated data.
 *
 * Data sources:
 *   1. NOAA SWDI (Storm Reports + NEXRAD Hail) — primary
 *   2. Iowa Environmental Mesonet (IEM) Local Storm Reports — secondary
 *
 * When no events are found from any source, the report honestly states
 * "no significant storm events found" rather than generating fake data.
 */

import { fetchSWDIStormEvents, deduplicateEvents, type DataSourceDetail } from './swdi-api-service.js';
import { createDeadline } from './deadline.js';
import { fetchIEMLSREvents } from './iem-api-service.js';
import { sanitizeUrl } from './safe-url.js';

// ─── 10-Level Hail Size Scale with HAAG Engineering References ───────
export const HAIL_SIZE_SCALE = [
  { level: 1,  min: 0.50, max: 0.74, label: 'Pea',         color: '#93c5fd', damageRating: 'Minimal',       haagRef: 'Below functional damage threshold' },
  { level: 2,  min: 0.75, max: 0.99, label: 'Penny/Dime',  color: '#60a5fa', damageRating: 'Minor',         haagRef: 'Possible granule loss on aged shingles' },
  { level: 3,  min: 1.00, max: 1.24, label: 'Quarter',     color: '#3b82f6', damageRating: 'Moderate',      haagRef: 'Functional damage likely - bruising, granule displacement' },
  { level: 4,  min: 1.25, max: 1.49, label: 'Half Dollar', color: '#2563eb', damageRating: 'Significant',   haagRef: 'Fractures and cracks in shingle mat' },
  { level: 5,  min: 1.50, max: 1.74, label: 'Golf Ball',   color: '#f59e0b', damageRating: 'Severe',        haagRef: 'Open fractures, exposed fiberglass mat' },
  { level: 6,  min: 1.75, max: 1.99, label: 'Lime',        color: '#f97316', damageRating: 'Very Severe',   haagRef: 'Mat tears, sealant failure, potential leaks' },
  { level: 7,  min: 2.00, max: 2.49, label: 'Tennis Ball',  color: '#ef4444', damageRating: 'Major',         haagRef: 'Penetration of shingle layers possible' },
  { level: 8,  min: 2.50, max: 2.74, label: 'Baseball',    color: '#dc2626', damageRating: 'Catastrophic',  haagRef: 'Full penetration of roofing system likely' },
  { level: 9,  min: 2.75, max: 2.99, label: 'Tea Cup',     color: '#b91c1c', damageRating: 'Extreme',       haagRef: 'Structural deck compromise' },
  { level: 10, min: 3.00, max: 99,   label: 'Softball+',   color: '#7f1d1d', damageRating: 'Catastrophic+', haagRef: 'Total roof system replacement required' },
] as const;

export type HailSizeLevel = typeof HAIL_SIZE_SCALE[number];

/** Minimum hail size that maps to any HAIL_SIZE_SCALE tier (0.5" = pea). */
const MIN_HAIL_SIZE_INCHES = 0.5;

/**
 * Get the hail size level for a given size in inches.
 * Returns undefined if size is below the minimum threshold (0.5") or non-finite
 * (defensive guard against junk arriving from upstream JSON columns).
 */
export function getHailSizeLevel(sizeInches: number): HailSizeLevel | undefined {
  if (!Number.isFinite(sizeInches) || sizeInches < MIN_HAIL_SIZE_INCHES) return undefined;
  return HAIL_SIZE_SCALE.find(l => sizeInches >= l.min && sizeInches <= l.max)
    || HAIL_SIZE_SCALE[HAIL_SIZE_SCALE.length - 1]; // 3"+ fallback
}

// Storm event types we care about for roofing
export const RELEVANT_STORM_TYPES = [
  'Hail',
  'Thunderstorm Wind',
  'High Wind',
  'Strong Wind',
  'Tornado',
  'Hurricane',
  'Tropical Storm',
] as const;

export type StormType = typeof RELEVANT_STORM_TYPES[number];

/** Three-bucket risk grading used by `assessRisk` and consumers. */
export type RiskLevel = 'high' | 'medium' | 'low';

// ─── Risk-assessment thresholds ────────────────────────────────────────
// Large hail = anything that can functionally damage asphalt shingles.
// HAAG functional-damage threshold sits around 1" / quarter-sized.
const LARGE_HAIL_INCHES = 1.0;
// "High wind" for roofing purposes — sustained winds at or above 60 mph
// will lift shingle tabs and break sealant bonds on most asphalt systems.
const HIGH_WIND_MPH = 60;
// 3+ large-hail (or 60+ mph wind) events in the search window → "high" risk.
const HIGH_RISK_LARGE_HAIL_COUNT = 3;
const HIGH_RISK_HIGH_WIND_COUNT = 3;
// Medium-risk threshold (any storm type counts toward this rung).
const MEDIUM_RISK_EVENT_COUNT = 5;

// ─── Numeric risk-score constants (used by `computeRiskScores`) ────────
/** Hard cap on numeric risk scores. 100 is impossible because no US
 *  location experiences damaging storms every single day; max realistic
 *  is ~85-90 in extreme hail corridors like the OKC region. */
const MAX_RISK_SCORE = 95;

/** Milliseconds in 365 days — used for the "recent events" recency window. */
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/** Larger hail thresholds (HAAG-aligned). LARGE_HAIL_INCHES (1.0") sits
 *  at the functional-damage threshold; the next two tiers drive the
 *  max-size and severity bonuses in the score. */
const VERY_LARGE_HAIL_INCHES = 1.5;
const EXTREME_HAIL_INCHES = 2.0;

/** Wind tiers used by the scoring function. */
const MODERATE_WIND_MPH = 50;
const SEVERE_WIND_MPH = 75;
const EXTREME_WIND_MPH = 100;

/** Per-component point caps for the scoring function. */
const HAIL_FREQUENCY_MAX_PTS = 25;
const HAIL_SEVERITY_MAX_PTS = 30;
const HAIL_MAX_SIZE_MAX_PTS = 20;
const HAIL_RECENCY_MAX_PTS = 15;
const WIND_FREQUENCY_MAX_PTS = 25;
const WIND_SEVERITY_MAX_PTS = 30;
const WIND_MAX_SPEED_MAX_PTS = 20;
const WIND_RECENCY_MAX_PTS = 15;

/** Tornado bonus added to the wind score (capped). */
const TORNADO_BONUS_PER_EVENT = 5;
const TORNADO_BONUS_MAX = 10;

/** Frequency-curve constant (logarithmic). */
const FREQUENCY_LOG_MULTIPLIER = 15;

/** Risk-factor / recommendation fallback strings — extracted so a future
 *  i18n pass has one place to translate from. */
const NO_RISK_FACTORS_MSG = 'No significant storm risk factors identified';
const DEFAULT_RECOMMENDATION_MAINTENANCE = 'Continue regular roof maintenance';

// ─── generateStormReport defaults / thresholds ────────────────────────
/** Default lookback window (years) when the caller doesn't specify. */
const DEFAULT_GENERATE_YEARS_BACK = 3;
/** Default search radius (miles) when the caller doesn't specify. */
const DEFAULT_GENERATE_SEARCH_RADIUS = 5;

/** Claim-potential thresholds — separate from the scoring thresholds
 *  above because the claim-potential decision uses a tighter cutoff for
 *  the "high" tier (1.5" hail / 70 mph wind). */
const CLAIM_HIGH_HAIL_INCHES = 1.5;
const CLAIM_HIGH_WIND_MPH = 70;

/** Minimum lookback (years) before the report includes a `property_profile` block. */
const PROPERTY_PROFILE_MIN_YEARS = 5;

/** Source-detail messages used in the dataSources list. */
const MSG_NO_DATA_SOURCES = 'All NOAA data sources unavailable';
const MSG_NO_EVENTS_SUFFIX = '(No Events Found)';
const MSG_NO_EVENTS_NOAA = `NOAA ${MSG_NO_EVENTS_SUFFIX}`;

// ─── Event-type constants (used by `assessRisk`) ─────────────────────
const EVENT_TYPE_HAIL = 'Hail';
const EVENT_TYPE_TORNADO = 'Tornado';
const EVENT_TYPE_WIND_INFIX = 'Wind';

// ─── Risk-level enum constants ───────────────────────────────────────
const RISK_HIGH: RiskLevel = 'high';
const RISK_MEDIUM: RiskLevel = 'medium';
const RISK_LOW: RiskLevel = 'low';

// ─── computeRiskScores point tables ──────────────────────────────────
/** Large-event count cap inside `severityPts` (events past this don't add more points). */
const SCORING_LARGE_EVENTS_CAP = 8;
/** Very-large-event count cap inside `severityPts`. */
const SCORING_VERY_LARGE_EVENTS_CAP = 4;
/** Per-event point value for large-hail / high-wind events. */
const SCORING_LARGE_EVENT_POINTS = 3;
/** Per-event point value for very-large-hail / severe-wind events. */
const SCORING_VERY_LARGE_EVENT_POINTS = 4;
/** Cap on recent-event count (within 1 year) inside the recency component. */
const SCORING_RECENT_EVENTS_CAP = 5;
/** Per-event point value for recent events. */
const SCORING_RECENT_EVENT_POINTS = 3;
/** Max-size / max-speed point tiers (from extreme down to small). */
const SCORING_MAX_PTS_EXTREME = 20;
const SCORING_MAX_PTS_VERY_LARGE = 15;
const SCORING_MAX_PTS_LARGE = 10;
const SCORING_MAX_PTS_MEDIUM = 5;
/** Small-hail size threshold (under quarter-size but visible). */
const SMALL_HAIL_INCHES = 0.75;
/** Overall-score blend weights: dominant risk gets 65%, secondary 35%. */
const OVERALL_DOMINANT_WEIGHT = 0.65;
const OVERALL_SECONDARY_WEIGHT = 0.35;

// ─── recommendDateOfLoss constants ───────────────────────────────────
/** Maximum distance (miles) for an event to be considered as a recommended DOL. */
const DOL_NEARBY_RADIUS_MILES = 10;
/** Hail-size scoring weight — converts inches to a comparable severity score. */
const DOL_HAIL_SCORE_MULTIPLIER = 100;
/** Tornado base severity score (≥ a 70 mph wind, ≥ a 1.5" hail event). */
const DOL_TORNADO_SCORE = 200;
/** Recency multiplier bounds: events from today get 2.0×, events 3+ years old get 1.0×. */
const DOL_RECENCY_MULTIPLIER_MIN = 1.0;
const DOL_RECENCY_MULTIPLIER_MAX = 2.0;
/** Per-year recency decay so that 3 years × 0.33 = 1.0 → recency multiplier hits floor. */
const DOL_RECENCY_DECAY_PER_YEAR = 0.33;

// ─── buildPropertyProfile cumulative-exposure thresholds ─────────────
/** Large-hail counts that classify cumulative exposure: 10+ → extreme, 5+ → high, 2+ → moderate. */
const EXPOSURE_EXTREME_HAIL_COUNT = 10;
const EXPOSURE_HIGH_HAIL_COUNT = 5;
const EXPOSURE_MODERATE_HAIL_COUNT = 2;

// ─── assessRisk message templates ────────────────────────────────────
/** Risk factor message returned when zero storm events were found. */
const MSG_NO_STORMS_RISK_FACTOR = 'No storm events recorded within search radius during report period. This may indicate low storm activity or limited data coverage for this area.';
/** Default recommendation when no risk factors trip. */
const MSG_BASELINE_MAINTENANCE = 'Continue regular roof maintenance and annual inspections';
/** "Tornado activity recorded" risk factor — added when any Tornado event is in the window. */
const MSG_TORNADO_RECORDED = 'Tornado activity recorded in the area';
/** Recommendations grouped by what triggered them. */
const REC_IMPACT_RESISTANT_SHINGLES = 'Consider impact-resistant roofing materials (Class 4 rated)';
const REC_ANNUAL_INSPECTIONS = 'Annual roof inspections are strongly recommended';
const REC_ROOF_TO_WALL_CONNECTIONS = 'Ensure proper roof-to-wall connections';
const REC_WIND_RATED_SHINGLES = 'Consider wind-rated shingles (130+ mph)';
const REC_DOCUMENT_CONDITION = 'Document roof condition with photos annually';
const REC_REVIEW_INSURANCE = 'Review insurance coverage for storm damage';
const REC_KEEP_STORM_RECORDS = 'Keep records of all storm events for insurance claims';
/** Risk-factor templates referencing thresholds defined elsewhere in this file. */
const RISK_FACTOR_LARGE_HAIL = (count: number): string =>
  `${count} large hail events (1"+ diameter) in the past ${DEFAULT_GENERATE_YEARS_BACK} years`;
const RISK_FACTOR_HIGH_WIND = (count: number): string =>
  `${count} high wind events (${HIGH_WIND_MPH}+ mph) in the past ${DEFAULT_GENERATE_YEARS_BACK} years`;

// ─── Geocoding constants ──────────────────────────────────────────────
/** Google Geocoding endpoint — single source of truth for the URL. */
const GOOGLE_GEOCODE_BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
/** Nominatim (OpenStreetMap) free-tier fallback endpoint. */
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/search';
/** UA string sent on Nominatim requests — required by their usage policy. */
const NOMINATIM_USER_AGENT = 'RoofReportAI/1.0';
/** Per-request timeout for outbound geocoding HTTP calls. Prevents the
 *  report-generation pipeline from hanging indefinitely when Google or
 *  Nominatim is slow/unresponsive. 8s is well under upstream caller budgets
 *  and still long enough that healthy responses are never cut short. */
const GEOCODE_FETCH_TIMEOUT_MS = 8000;
/** Google `address_components.types` values for each component we care about. */
const GEOCODE_TYPE_CITY = 'locality';
const GEOCODE_TYPE_STATE = 'administrative_area_level_1';
const GEOCODE_TYPE_COUNTY = 'administrative_area_level_2';
const GEOCODE_TYPE_ZIP = 'postal_code';

// ─── Multi-source fetch constants ─────────────────────────────────────
/** `DataSourceDetail.status` value indicating an upstream fetch failed. */
const STATUS_FAILED = 'failed' as const;
/** `Promise.allSettled` status indicating a fulfilled promise. */
const PROMISE_STATUS_FULFILLED = 'fulfilled' as const;
/** Total number of upstream NOAA data sources we currently aggregate
 *  (SWDI + IEM). Used to decide `data_quality` from per-source statuses. */
const TOTAL_SOURCES = 2;
/** `data_quality` enum values — kept as a closed set so a typo in one
 *  branch can't drift it from the others. */
const DATA_QUALITY_DEGRADED = 'degraded' as const;
const DATA_QUALITY_NO_DATA = 'no_data' as const;
const DATA_QUALITY_PARTIAL = 'partial' as const;
const DATA_QUALITY_VERIFIED = 'verified' as const;
/** Display labels for each NOAA source — referenced from source-detail
 *  rows when a Promise rejects (so the row still has a name). */
const SOURCE_LABEL_SWDI = 'NOAA SWDI (Storm Reports + NEXRAD Hail)';
const SOURCE_LABEL_IEM = 'Iowa Environmental Mesonet (IEM) - Local Storm Reports';
/** Log-line prefix for the multi-source aggregator. */
const MULTI_SOURCE_LOG_PREFIX = 'Multi-source:';

/** Narrow `unknown` to a printable error message — replaces inline
 *  `error instanceof Error ? error.message : String(error)` ternaries. */
function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Max of `getter(item)` across `items`, defaulting to 0 for empty
 *  inputs and treating undefined/null/NaN getter results as 0.
 *  Used in place of `Math.max(...arr)` so a multi-thousand-event
 *  array can't blow the call stack. */
function maxOf<T>(items: ReadonlyArray<T>, getter: (item: T) => number | undefined | null): number {
  let max = 0;
  for (const item of items) {
    const v = getter(item);
    if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

// ─── formatStormReportText constants ─────────────────────────────────
/** Cap on rows rendered in the "Significant Events" markdown list — keeps
 *  the text-format report readable even when 50+ events match. */
const MAX_SIGNIFICANT_EVENTS_DISPLAYED = 10;
/** Markdown heading for the storm-report text output. */
const MD_REPORT_HEADING = '# Storm History Report';
/** Markdown bullet prefix used by every list item. */
const MD_BULLET_PREFIX = '- ';
/** Inches → "<size>\" hail" suffix used in the significant-events list. */
const HAIL_SUFFIX_INCHES = '" hail';
/** mph → "<speed> mph winds" suffix used in the significant-events list. */
const WIND_SUFFIX_MPH = ' mph winds';
/** Note rendered above the body when `data_quality === DATA_QUALITY_DEGRADED`. */
const MD_NOTE_DEGRADED = '> **Note:** NOAA weather data services were unavailable when this report was generated. Try again later for complete results.';
/** Note rendered above the body when `data_quality === DATA_QUALITY_NO_DATA`. */
const MD_NOTE_NO_DATA = '> **Note:** No significant storm events were found in NOAA records for this area during the report period.';

/** Bold-prefixed property meta labels used at the top of the report text. */
const MD_LABEL_PROPERTY = '**Property:** ';
const MD_LABEL_REPORT_PERIOD = '**Report Period:** ';
const MD_REPORT_PERIOD_DATE_INFIX = ' to ';
const MD_REPORT_PERIOD_YEARS_PREFIX = ' (';
const MD_REPORT_PERIOD_YEARS_SUFFIX = ' years)';
const MD_LABEL_SEARCH_RADIUS = '**Search Radius:** ';
const MD_SEARCH_RADIUS_MILES_SUFFIX = ' miles';
const MD_LABEL_DATA_QUALITY = '**Data Quality:** ';

/** Markdown section headings inside the storm-report text. */
const MD_HEADING_SUMMARY = '## Summary';
const MD_HEADING_RISK_ASSESSMENT = '## Risk Assessment';
const MD_HEADING_RISK_FACTORS = '### Risk Factors';
const MD_HEADING_RECOMMENDATIONS = '### Recommendations';
const MD_HEADING_SIGNIFICANT_EVENTS = '## Significant Events';
const MD_HEADING_DATA_SOURCES = '## Data Sources';

/** Bold summary labels used inside the Summary list. */
const MD_LABEL_TOTAL_STORM_EVENTS = '**Total Storm Events:** ';
const MD_LABEL_HAIL_EVENTS = '**Hail Events:** ';
const MD_LABEL_WIND_EVENTS = '**Wind Events:** ';
const MD_LABEL_TORNADO_EVENTS = '**Tornado Events:** ';
const MD_LABEL_LARGEST_HAIL = '**Largest Hail:** ';
const MD_LABEL_HIGHEST_WIND = '**Highest Wind:** ';
const MD_LABEL_INSURANCE_CLAIM_POTENTIAL = '**Insurance Claim Potential:** ';
const MD_INCHES_DOUBLE_QUOTE = '"';
const MD_MPH_SUFFIX = ' mph';

/** Bold risk-assessment labels used inside the Risk Assessment list. */
const MD_LABEL_HAIL_RISK = '**Hail Risk:** ';
const MD_LABEL_WIND_RISK = '**Wind Risk:** ';
const MD_LABEL_OVERALL_RISK = '**Overall Risk:** ';

/** Significant-events row template fragments. */
const MD_EVENT_DATE_PREFIX = '**';
const MD_EVENT_DATE_SUFFIX = ':** ';
const MD_EVENT_DASH_INFIX = ' - ';

/** Data sources row template fragments. */
const MD_DATA_SOURCE_NAME_INFIX = ': ';
const MD_DATA_SOURCE_OPEN_PAREN = ' (';
const MD_DATA_SOURCE_EVENTS_INFIX = ' events, ';
const MD_DATA_SOURCE_TIME_SUFFIX = 'ms)';

/** Recommended-Date-of-Loss recipe — magnitude + reason template fragments. */
const MAGNITUDE_HAIL_SUFFIX_LOCAL = '" hail';
const MAGNITUDE_WIND_SUFFIX_LOCAL = ' mph wind';

/** DOL reason template fragments — assembled into:
 *  `'Largest hail event (1.5" - Quarter) within 1.2 miles'`. */
const REASON_LARGEST_HAIL_PREFIX = 'Largest hail event (';
const REASON_INCHES_QUOTE = '"';
const REASON_LEVEL_INFIX = ' - ';
const REASON_WITHIN_INFIX = ') within ';
const REASON_MILES_SUFFIX = ' miles';
const REASON_DISTANCE_DECIMALS = 1;
const REASON_TORNADO_NEAR_PROPERTY = 'Tornado event near property';
const REASON_HIGHEST_WIND_PREFIX = 'Highest wind event (';
const REASON_MPH_SUFFIX = ' mph';

// ─── getHailSizeDescription constants ────────────────────────────────
/** Minimum hail size we surface a HAAG description for — anything below
 *  the `HAIL_SIZE_SCALE` floor (0.5") returns the pea-size fallback.
 *  Mirrors `MIN_HAIL_SIZE_INCHES` on getHailSizeLevel — kept as a separate
 *  constant so the description threshold can diverge later if needed. */
const MIN_HAIL_DESCRIPTION_INCHES = MIN_HAIL_SIZE_INCHES;
/** Fallback description for sub-threshold or non-finite hail sizes. */
const MSG_PEA_SIZE_FALLBACK = 'Pea size - minimal damage expected';

/** True when the event is hail-class. */
function isHailEvent(e: StormEvent): boolean {
  return e.event_type === 'Hail';
}

/** True when the event is wind-class but NOT a tornado (the storm-summary
 *  buckets tornadoes separately from wind events). */
function isWindOnlyEvent(e: StormEvent): boolean {
  return e.event_type.includes('Wind');
}

/** True when the event is a tornado. */
function isTornadoEvent(e: StormEvent): boolean {
  return e.event_type === 'Tornado';
}

export interface StormEvent {
  id: string;
  event_type: StormType;
  date: string;
  year: number;
  month: number;
  day: number;
  time?: string;

  // Location
  state: string;
  county: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  distance_miles?: number; // Distance from property

  // Storm details
  magnitude?: number;
  magnitude_unit?: string; // 'inch' for hail, 'mph' for wind
  hail_size_inches?: number;
  wind_speed_mph?: number;

  // Damage info
  damage_property?: string;
  damage_crops?: string;
  injuries_direct?: number;
  injuries_indirect?: number;
  deaths_direct?: number;
  deaths_indirect?: number;

  // Narrative
  episode_narrative?: string;
  event_narrative?: string;

  // Source
  source: 'NOAA' | 'NWS';
  data_source?: string;
}

export interface StormReport {
  property_address: string;
  city: string;
  state: string;
  zip?: string;
  latitude: number;
  longitude: number;

  // Report period
  start_date: string;
  end_date: string;
  years_covered: number;

  // Summary statistics
  summary: {
    total_events: number;
    hail_events: number;
    wind_events: number;
    tornado_events: number;
    largest_hail_inches?: number;
    highest_wind_mph?: number;
    total_property_damage?: string;
    insurance_claim_potential: 'high' | 'medium' | 'low' | 'none';
    hail_size_distribution?: Record<number, number>; // count per hail size level (1-10)
  };

  // Events by year
  events_by_year: Record<number, StormEvent[]>;

  // All events sorted by date (most recent first)
  events: StormEvent[];

  // Significant events (large hail, high winds)
  significant_events: StormEvent[];

  // Risk assessment
  risk_assessment: {
    hail_risk: 'high' | 'medium' | 'low';
    wind_risk: 'high' | 'medium' | 'low';
    overall_risk: 'high' | 'medium' | 'low';
    risk_factors: string[];
    recommendations: string[];
  };

  // Numeric risk scores (0-100) — more granular than high/medium/low
  risk_score?: {
    hail_score: number;
    wind_score: number;
    overall_score: number;
  };

  // Date of Loss — for insurance claims
  date_of_loss?: {
    date: string;
    event_id?: string;
    event_type?: string;
    magnitude?: string;
    distance_miles?: number;
    confidence: 'confirmed' | 'recommended' | 'manual';
  };
  recommended_date_of_loss?: {
    date: string;
    event_id: string;
    event_type: string;
    magnitude: string;
    distance_miles?: number;
    reason: string;
  };

  // Property storm profile — for 5+ year reports
  property_profile?: {
    total_hail_events: number;
    total_wind_events: number;
    avg_events_per_year: number;
    worst_year: { year: number; event_count: number; largest_hail?: number };
    storm_free_years: number[];
    repeat_storm_months: number[];
    estimated_cumulative_exposure: 'extreme' | 'high' | 'moderate' | 'low';
  };

  // Data quality indicator
  data_quality: 'verified' | 'no_data' | 'partial' | 'degraded';
  data_source_details: DataSourceDetail[];
  /** True when the request deadline ended the fetch early: the events listed are what had arrived by then. */
  partial?: boolean;

  // Metadata
  generated_at: string;
  data_sources: string[];
  search_radius_miles: number;
}

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formatted_address: string;
  city: string;
  state: string;
  county: string;
  zip?: string;
}

/**
 * Geocode an address to get coordinates
 */
export async function geocodeAddress(
  address: string,
  city: string,
  state: string,
  zip?: string,
  googleApiKey?: string,
  signal?: AbortSignal,
  /**
   * Told once for each paid Google lookup, after it was made (answered or not),
   * and waited for, so the caller can record its cost. A hook that throws is ignored. Never
   * called when there is no Google key, because nothing paid is then called.
   */
  onGoogleLookup?: () => void | Promise<void>,
): Promise<GeocodingResult | null> {
  // Each lookup has its own limit, and also stops at the request-wide deadline.
  const limit = (): AbortSignal => (signal ? AbortSignal.any([AbortSignal.timeout(GEOCODE_FETCH_TIMEOUT_MS), signal]) : AbortSignal.timeout(GEOCODE_FETCH_TIMEOUT_MS));
  const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`.trim();

  // Try Google Geocoding if API key provided
  if (googleApiKey) {
    try {
      let response: Response;
      try {
        response = await fetch(
          `${GOOGLE_GEOCODE_BASE_URL}?address=${encodeURIComponent(fullAddress)}&key=${googleApiKey}`,
          { signal: limit() }
        );
      } finally {
        try { await onGoogleLookup?.(); } catch { /* recording a cost never fails a lookup */ }
      }

      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          const location = result.geometry.location;

          // Extract address components. Type the entries so the `find` callback
          // doesn't need 'any' — Google's geocode API has a stable shape here.
          interface AddressComponent { types: string[]; long_name: string }
          const components: AddressComponent[] = result.address_components;
          const getComponent = (type: string) =>
            components.find((c) => c.types.includes(type))?.long_name || '';

          return {
            latitude: location.lat,
            longitude: location.lng,
            formatted_address: result.formatted_address,
            city: getComponent(GEOCODE_TYPE_CITY) || city,
            state: getComponent(GEOCODE_TYPE_STATE) || state,
            county: getComponent(GEOCODE_TYPE_COUNTY) || '',
            zip: getComponent(GEOCODE_TYPE_ZIP) || zip,
          };
        }
      }
    } catch (error) {
      console.error('Google Geocoding error:', errorMessageOf(error));
    }
  }

  // Fallback to Nominatim (OpenStreetMap)
  try {
    const response = await fetch(
      `${NOMINATIM_BASE_URL}?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`,
      {
        headers: {
          'User-Agent': NOMINATIM_USER_AGENT,
        },
        signal: limit(),
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        const result = data[0];
        return {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
          formatted_address: result.display_name,
          city,
          state,
          county: '',
          zip,
        };
      }
    }
  } catch (error) {
    console.error('Nominatim Geocoding error:', errorMessageOf(error));
  }

  return null;
}

/**
 * Fetch storm events from multiple real NOAA data sources in parallel.
 * Merges and deduplicates results. Returns events and source details.
 */
async function fetchStormEventsMultiSource(
  latitude: number,
  longitude: number,
  startDate: Date,
  endDate: Date,
  radiusMiles: number,
  signal?: AbortSignal,
): Promise<{ events: StormEvent[]; sourceDetails: DataSourceDetail[]; dataQuality: StormReport['data_quality']; partial: boolean }> {
  // Fetch from SWDI and IEM in parallel
  const [swdiResult, iemResult] = await Promise.allSettled([
    fetchSWDIStormEvents(latitude, longitude, startDate, endDate, radiusMiles, signal),
    fetchIEMLSREvents(latitude, longitude, startDate, endDate, radiusMiles, signal),
  ]);

  const allEvents: StormEvent[] = [];
  const sourceDetails: DataSourceDetail[] = [];
  let successSources = 0;
  let failedSources = 0;

  type SettledSource = PromiseSettledResult<{ events: StormEvent[]; sourceDetail: DataSourceDetail }>;
  const processSourceResult = (
    settled: SettledSource,
    sourceName: string,
  ): void => {
    if (settled.status === PROMISE_STATUS_FULFILLED) {
      allEvents.push(...settled.value.events);
      sourceDetails.push(settled.value.sourceDetail);
      if (settled.value.sourceDetail.status !== STATUS_FAILED) {
        successSources++;
      } else {
        failedSources++;
      }
    } else {
      failedSources++;
      sourceDetails.push({
        name: sourceName,
        status: STATUS_FAILED,
        event_count: 0,
        response_time_ms: 0,
      });
      console.error(`${sourceName} fetch rejected:`, errorMessageOf(settled.reason));
    }
  };

  processSourceResult(swdiResult, SOURCE_LABEL_SWDI);
  processSourceResult(iemResult, SOURCE_LABEL_IEM);

  // Deduplicate across sources (same date + type + ~2mi proximity)
  const dedupedEvents = deduplicateEvents(allEvents);

  // Sort by date descending
  dedupedEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Determine data quality
  let dataQuality: StormReport['data_quality'];

  // The deadline may have cut a source off, or both. What arrived is kept and flagged.
  const partial = signal?.aborted === true || sourceDetails.some((d) => d.partial === true);

  if (partial) {
    dataQuality = dedupedEvents.length > 0 ? DATA_QUALITY_PARTIAL : DATA_QUALITY_DEGRADED;
  } else if (failedSources === TOTAL_SOURCES) {
    dataQuality = DATA_QUALITY_DEGRADED;
  } else if (dedupedEvents.length === 0) {
    dataQuality = DATA_QUALITY_NO_DATA;
  } else if (failedSources > 0) {
    dataQuality = DATA_QUALITY_PARTIAL;
  } else {
    dataQuality = DATA_QUALITY_VERIFIED;
  }

  console.log(`${MULTI_SOURCE_LOG_PREFIX} ${dedupedEvents.length} events after dedup (${allEvents.length} raw), quality=${dataQuality}, ${successSources}/${TOTAL_SOURCES} sources OK`);

  return { events: dedupedEvents, sourceDetails, dataQuality, partial };
}

/**
 * Coerce a possibly-malformed numeric metric (hail size, wind speed) to a finite
 * number, falling back to 0 for null/undefined/NaN/±Infinity/non-number junk.
 *
 * `value || 0` is NOT enough on its own: `NaN || 0` is 0 (fine) but
 * `Infinity || 0` is `Infinity`, which would slip past a `>= threshold` check
 * and inflate the risk grade. Non-finite metrics must be treated as "unknown"
 * (0) so they neither count toward nor against the assessment.
 */
function finiteMetric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Safe event_type accessor — non-string types collapse to '' (matches nothing). */
function eventTypeOf(e: unknown): string {
  const t = (e as { event_type?: unknown } | null | undefined)?.event_type;
  return typeof t === 'string' ? t : '';
}

/**
 * Assess risk based on storm history.
 *
 * Pure + defensive: the `events` array is assembled from two network sources
 * (NOAA SWDI + IEM) and rehydrated from JSONB, so individual rows may be
 * malformed — non-finite hail sizes / wind speeds, missing/non-string
 * event_type, or null entries — and the argument itself may not be an array.
 * This function never throws: non-array input and an empty list both yield the
 * safe low/none assessment, non-finite metrics are ignored, malformed entries
 * are skipped, and every returned field is defined and valid.
 *
 * Exported so the hardening can be unit-tested directly (pure, no network).
 */
export function assessRisk(events: StormEvent[]): StormReport['risk_assessment'] {
  // Guard against non-array input (defense at the boundary) and skip null/junk
  // entries so downstream accessors never throw.
  const safeEvents: StormEvent[] = Array.isArray(events)
    ? events.filter((e): e is StormEvent => e != null && typeof e === 'object')
    : [];

  // When no usable events, return low risk with honest messaging
  if (safeEvents.length === 0) {
    return {
      hail_risk: RISK_LOW,
      wind_risk: RISK_LOW,
      overall_risk: RISK_LOW,
      risk_factors: [MSG_NO_STORMS_RISK_FACTOR],
      recommendations: [MSG_BASELINE_MAINTENANCE],
    };
  }

  const hailEvents = safeEvents.filter(e => eventTypeOf(e) === EVENT_TYPE_HAIL);
  const windEvents = safeEvents.filter(e => {
    const type = eventTypeOf(e);
    return type.includes(EVENT_TYPE_WIND_INFIX) || type === EVENT_TYPE_TORNADO;
  });

  // Calculate hail risk (non-finite hail sizes coerced to 0 -> never "large")
  const largeHailCount = hailEvents.filter(e => finiteMetric(e.hail_size_inches) >= LARGE_HAIL_INCHES).length;
  const hailRisk: RiskLevel =
    largeHailCount >= HIGH_RISK_LARGE_HAIL_COUNT ? RISK_HIGH :
    hailEvents.length >= MEDIUM_RISK_EVENT_COUNT ? RISK_MEDIUM : RISK_LOW;

  // Calculate wind risk (non-finite wind speeds coerced to 0 -> never "high")
  const highWindCount = windEvents.filter(e => finiteMetric(e.wind_speed_mph) >= HIGH_WIND_MPH).length;
  const windRisk: RiskLevel =
    highWindCount >= HIGH_RISK_HIGH_WIND_COUNT ? RISK_HIGH :
    windEvents.length >= MEDIUM_RISK_EVENT_COUNT ? RISK_MEDIUM : RISK_LOW;

  // Overall risk
  const overallRisk: RiskLevel =
    hailRisk === RISK_HIGH || windRisk === RISK_HIGH ? RISK_HIGH :
    hailRisk === RISK_MEDIUM || windRisk === RISK_MEDIUM ? RISK_MEDIUM : RISK_LOW;

  // Risk factors
  const riskFactors: string[] = [];
  if (largeHailCount > 0) riskFactors.push(RISK_FACTOR_LARGE_HAIL(largeHailCount));
  if (highWindCount > 0) riskFactors.push(RISK_FACTOR_HIGH_WIND(highWindCount));
  if (safeEvents.some(e => eventTypeOf(e) === EVENT_TYPE_TORNADO)) riskFactors.push(MSG_TORNADO_RECORDED);

  // Recommendations
  const recommendations: string[] = [];
  if (hailRisk === RISK_HIGH) {
    recommendations.push(REC_IMPACT_RESISTANT_SHINGLES);
    recommendations.push(REC_ANNUAL_INSPECTIONS);
  }
  if (windRisk === RISK_HIGH) {
    recommendations.push(REC_ROOF_TO_WALL_CONNECTIONS);
    recommendations.push(REC_WIND_RATED_SHINGLES);
  }
  if (overallRisk === RISK_HIGH) {
    recommendations.push(REC_DOCUMENT_CONDITION);
    recommendations.push(REC_REVIEW_INSURANCE);
  }
  if (overallRisk !== RISK_LOW) {
    recommendations.push(REC_KEEP_STORM_RECORDS);
  }

  return {
    hail_risk: hailRisk,
    wind_risk: windRisk,
    overall_risk: overallRisk,
    risk_factors: riskFactors.length > 0 ? riskFactors : [NO_RISK_FACTORS_MSG],
    recommendations: recommendations.length > 0 ? recommendations : [DEFAULT_RECOMMENDATION_MAINTENANCE],
  };
}

/**
 * Compute numeric risk scores (0-95 max) for more granular assessment.
 *
 * Scoring philosophy:
 * - 100 is impossible — no US location gets damaging storms every day
 * - Max realistic score is ~85-90 for extreme hail corridors (e.g., Tornado Alley)
 * - Scores use diminishing returns so adding more events doesn't linearly inflate
 * - Normalized by years covered so a 10-year report doesn't inflate vs 3-year
 *
 * Calibration benchmarks (3-year window, 25mi radius):
 *   Low risk area (e.g., Portland, OR):       5-15
 *   Moderate area (e.g., Cedar Falls, IA):    20-40
 *   High risk area (e.g., Dallas, TX):        45-65
 *   Extreme hail corridor (e.g., OKC, OK):    65-85
 *   Theoretical max:                          95
 */
function computeRiskScores(
  events: StormEvent[],
  yearsCovered: number = 3
): { hail_score: number; wind_score: number; overall_score: number } {
  const now = Date.now();
  const oneYearAgo = now - MS_PER_YEAR;
  const years = Math.max(1, yearsCovered);

  const hailEvents = events.filter(e => e.event_type === EVENT_TYPE_HAIL);
  const windEvents = events.filter(e => e.event_type.includes(EVENT_TYPE_WIND_INFIX) || e.event_type === EVENT_TYPE_TORNADO);

  // ── Hail score (0-MAX_RISK_SCORE max) ──
  // Frequency: diminishing returns — log curve for event count per year
  const hailPerYear = hailEvents.length / years;
  const hailFrequencyPts = Math.min(HAIL_FREQUENCY_MAX_PTS, Math.round(FREQUENCY_LOG_MULTIPLIER * Math.log2(hailPerYear + 1)));

  // Severity: 1"+ events (functional damage threshold per HAAG)
  const largeHailCount = hailEvents.filter(e => (e.hail_size_inches || 0) >= LARGE_HAIL_INCHES).length;
  const veryLargeCount = hailEvents.filter(e => (e.hail_size_inches || 0) >= VERY_LARGE_HAIL_INCHES).length;
  const severityPts = Math.min(HAIL_SEVERITY_MAX_PTS, Math.round(
    Math.min(largeHailCount, SCORING_LARGE_EVENTS_CAP) * SCORING_LARGE_EVENT_POINTS +
    Math.min(veryLargeCount, SCORING_VERY_LARGE_EVENTS_CAP) * SCORING_VERY_LARGE_EVENT_POINTS
  )); // capped: 8 large + 4 very large

  // Max size: biggest single event
  const largestHail = maxOf(hailEvents, e => e.hail_size_inches);
  const maxSizePts = Math.min(HAIL_MAX_SIZE_MAX_PTS, Math.round(
    largestHail >= EXTREME_HAIL_INCHES ? SCORING_MAX_PTS_EXTREME :
    largestHail >= VERY_LARGE_HAIL_INCHES ? SCORING_MAX_PTS_VERY_LARGE :
    largestHail >= LARGE_HAIL_INCHES ? SCORING_MAX_PTS_LARGE :
    largestHail >= SMALL_HAIL_INCHES ? SCORING_MAX_PTS_MEDIUM : 0
  ));

  // Recency: recent events indicate ongoing exposure
  const recentHail = hailEvents.filter(e => new Date(e.date).getTime() > oneYearAgo).length;
  const recencyPts = Math.min(HAIL_RECENCY_MAX_PTS, Math.round(Math.min(recentHail, SCORING_RECENT_EVENTS_CAP) * SCORING_RECENT_EVENT_POINTS));

  let hailScore = hailFrequencyPts + severityPts + maxSizePts + recencyPts;

  // ── Wind score (0-MAX_RISK_SCORE max) ──
  const windPerYear = windEvents.length / years;
  const windFrequencyPts = Math.min(WIND_FREQUENCY_MAX_PTS, Math.round(FREQUENCY_LOG_MULTIPLIER * Math.log2(windPerYear + 1)));

  const highWindCount = windEvents.filter(e => (e.wind_speed_mph || 0) >= HIGH_WIND_MPH).length;
  const severeWindCount = windEvents.filter(e => (e.wind_speed_mph || 0) >= SEVERE_WIND_MPH).length;
  const windSeverityPts = Math.min(WIND_SEVERITY_MAX_PTS, Math.round(
    Math.min(highWindCount, SCORING_LARGE_EVENTS_CAP) * SCORING_LARGE_EVENT_POINTS +
    Math.min(severeWindCount, SCORING_VERY_LARGE_EVENTS_CAP) * SCORING_VERY_LARGE_EVENT_POINTS
  ));

  const highestWind = maxOf(windEvents, e => e.wind_speed_mph);
  const windMaxPts = Math.min(WIND_MAX_SPEED_MAX_PTS, Math.round(
    highestWind >= EXTREME_WIND_MPH ? SCORING_MAX_PTS_EXTREME :
    highestWind >= SEVERE_WIND_MPH ? SCORING_MAX_PTS_VERY_LARGE :
    highestWind >= HIGH_WIND_MPH ? SCORING_MAX_PTS_LARGE :
    highestWind >= MODERATE_WIND_MPH ? SCORING_MAX_PTS_MEDIUM : 0
  ));

  const recentWind = windEvents.filter(e => new Date(e.date).getTime() > oneYearAgo).length;
  const windRecencyPts = Math.min(WIND_RECENCY_MAX_PTS, Math.round(Math.min(recentWind, SCORING_RECENT_EVENTS_CAP) * SCORING_RECENT_EVENT_POINTS));

  let windScore = windFrequencyPts + windSeverityPts + windMaxPts + windRecencyPts;

  // Tornado bonus (significant but bounded)
  const tornadoEvents = events.filter(e => e.event_type === EVENT_TYPE_TORNADO);
  if (tornadoEvents.length > 0) {
    windScore += Math.min(TORNADO_BONUS_MAX, tornadoEvents.length * TORNADO_BONUS_PER_EVENT);
  }

  // Hard cap — 100% risk is not realistic for any US location
  hailScore = Math.min(MAX_RISK_SCORE, hailScore);
  windScore = Math.min(MAX_RISK_SCORE, windScore);

  // Overall: weighted blend of the two (higher weight to dominant risk)
  const overallScore = Math.min(MAX_RISK_SCORE, Math.round(
    Math.max(hailScore, windScore) * OVERALL_DOMINANT_WEIGHT +
    Math.min(hailScore, windScore) * OVERALL_SECONDARY_WEIGHT
  ));

  return { hail_score: hailScore, wind_score: windScore, overall_score: overallScore };
}

/**
 * Recommend the most likely Date of Loss for insurance claims.
 * Picks the most severe event within 10 miles, preferring recent large hail.
 */
function recommendDateOfLoss(events: StormEvent[]): StormReport['recommended_date_of_loss'] {
  if (events.length === 0) return undefined;

  // Filter to events within DOL_NEARBY_RADIUS_MILES miles
  const nearbyEvents = events.filter(e => (e.distance_miles || 0) <= DOL_NEARBY_RADIUS_MILES);
  if (nearbyEvents.length === 0) return undefined;

  // Score each event: severity * recency
  const now = Date.now();
  const scored = nearbyEvents.map(e => {
    let severity = 0;
    if (e.hail_size_inches) severity = e.hail_size_inches * DOL_HAIL_SCORE_MULTIPLIER;
    if (e.wind_speed_mph) severity = Math.max(severity, e.wind_speed_mph);
    if (e.event_type === EVENT_TYPE_TORNADO) severity = Math.max(severity, DOL_TORNADO_SCORE);

    // Recency: more recent = higher multiplier (1.0 to 2.0 over 3 years)
    const ageMs = now - new Date(e.date).getTime();
    const ageYears = ageMs / MS_PER_YEAR;
    const recencyMultiplier = Math.max(
      DOL_RECENCY_MULTIPLIER_MIN,
      DOL_RECENCY_MULTIPLIER_MAX - ageYears * DOL_RECENCY_DECAY_PER_YEAR,
    );

    return { event: e, score: severity * recencyMultiplier };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === 0) return undefined;

  const e = best.event;
  const magnitude = e.hail_size_inches
    ? `${e.hail_size_inches}${MAGNITUDE_HAIL_SUFFIX_LOCAL}`
    : e.wind_speed_mph
      ? `${e.wind_speed_mph}${MAGNITUDE_WIND_SUFFIX_LOCAL}`
      : e.event_type;

  const level = e.hail_size_inches ? getHailSizeLevel(e.hail_size_inches) : undefined;
  const reason = e.hail_size_inches
    ? `${REASON_LARGEST_HAIL_PREFIX}${e.hail_size_inches}${REASON_INCHES_QUOTE}${level ? `${REASON_LEVEL_INFIX}${level.label}` : ''}${REASON_WITHIN_INFIX}${(e.distance_miles || 0).toFixed(REASON_DISTANCE_DECIMALS)}${REASON_MILES_SUFFIX}`
    : e.event_type === EVENT_TYPE_TORNADO
      ? REASON_TORNADO_NEAR_PROPERTY
      : `${REASON_HIGHEST_WIND_PREFIX}${e.wind_speed_mph}${REASON_MPH_SUFFIX}${REASON_WITHIN_INFIX}${(e.distance_miles || 0).toFixed(REASON_DISTANCE_DECIMALS)}${REASON_MILES_SUFFIX}`;

  return {
    date: e.date,
    event_id: e.id,
    event_type: e.event_type,
    magnitude,
    distance_miles: e.distance_miles,
    reason,
  };
}

/**
 * Build property storm profile for long-term reports (5+ years).
 */
function buildPropertyProfile(
  eventsByYear: Record<number, StormEvent[]>,
  allEvents: StormEvent[]
): StormReport['property_profile'] {
  // Numeric sort, not the lexicographic default — works for 4-digit years
  // anyway, but explicit comparator future-proofs against any year format
  // change.
  const years = Object.keys(eventsByYear).map(Number).sort((a, b) => a - b);
  if (years.length < 2) return undefined;

  const hailEvents = allEvents.filter(e => e.event_type === EVENT_TYPE_HAIL);
  const windEvents = allEvents.filter(e => e.event_type.includes(EVENT_TYPE_WIND_INFIX) || e.event_type === EVENT_TYPE_TORNADO);

  const totalEvents = allEvents.length;
  const avgPerYear = totalEvents / years.length;

  // Find worst year. Explicit type so the `largest_hail: number | undefined`
  // shape is preserved without an `as any` cast.
  let worstYear: { year: number; event_count: number; largest_hail: number | undefined } =
    { year: years[0], event_count: 0, largest_hail: undefined };
  for (const [yearStr, events] of Object.entries(eventsByYear)) {
    const yr = parseInt(yearStr, 10);
    if (events.length > worstYear.event_count) {
      const largestHail = maxOf(events, e => e.hail_size_inches);
      worstYear = { year: yr, event_count: events.length, largest_hail: largestHail || undefined };
    }
  }

  // Storm-free years
  const stormFreeYears = years.filter(yr => (eventsByYear[yr] || []).length === 0);

  // Months with recurring storms (3+ events across all years)
  const monthCounts: Record<number, number> = {};
  for (const event of allEvents) {
    monthCounts[event.month] = (monthCounts[event.month] || 0) + 1;
  }
  const repeatMonths = Object.entries(monthCounts)
    .filter(([, count]) => count >= 3)
    .map(([month]) => parseInt(month, 10));

  // Cumulative exposure
  const largeHailCount = hailEvents.filter(e => (e.hail_size_inches || 0) >= LARGE_HAIL_INCHES).length;
  const exposure: 'extreme' | 'high' | 'moderate' | 'low' =
    largeHailCount >= EXPOSURE_EXTREME_HAIL_COUNT ? 'extreme' :
    largeHailCount >= EXPOSURE_HIGH_HAIL_COUNT ? 'high' :
    largeHailCount >= EXPOSURE_MODERATE_HAIL_COUNT ? 'moderate' : 'low';

  return {
    total_hail_events: hailEvents.length,
    total_wind_events: windEvents.length,
    avg_events_per_year: Math.round(avgPerYear * 10) / 10,
    worst_year: worstYear,
    storm_free_years: stormFreeYears,
    repeat_storm_months: repeatMonths,
    estimated_cumulative_exposure: exposure,
  };
}

/**
 * Compute hail size distribution across the 10-level scale.
 */
function computeHailSizeDistribution(events: StormEvent[]): Record<number, number> {
  const distribution: Record<number, number> = {};
  for (let i = 1; i <= 10; i++) distribution[i] = 0;

  for (const event of events) {
    if (event.hail_size_inches) {
      const level = getHailSizeLevel(event.hail_size_inches);
      if (level) distribution[level.level]++;
    }
  }
  return distribution;
}

/**
 * Generate a comprehensive storm report for a property.
 * Uses real NOAA data from multiple sources. No synthetic/estimated data.
 */
/** The report returned when the deadline passed before the address could even be placed. */
function emptyPartialReport(
  address: string,
  city: string,
  state: string,
  zip: string | undefined,
  yearsBack: number,
  searchRadius: number,
): StormReport {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - yearsBack);
  return {
    property_address: address,
    city,
    state,
    zip,
    latitude: 0,
    longitude: 0,
    start_date: start.toISOString().split('T')[0],
    end_date: end.toISOString().split('T')[0],
    years_covered: yearsBack,
    summary: {
      total_events: 0,
      hail_events: 0,
      wind_events: 0,
      tornado_events: 0,
      insurance_claim_potential: 'none',
      hail_size_distribution: computeHailSizeDistribution([]),
    },
    events_by_year: {},
    events: [],
    significant_events: [],
    risk_assessment: assessRisk([]),
    risk_score: computeRiskScores([], yearsBack),
    data_quality: DATA_QUALITY_DEGRADED,
    data_source_details: [],
    partial: true,
    generated_at: new Date().toISOString(),
    data_sources: [MSG_NO_DATA_SOURCES],
    search_radius_miles: searchRadius,
  };
}

export async function generateStormReport(
  address: string,
  city: string,
  state: string,
  zip?: string,
  options: {
    yearsBack?: number;
    searchRadiusMiles?: number;
    googleApiKey?: string;
    /** Told once for each paid Google geocoding lookup, so its cost can be recorded. */
    onGoogleLookup?: () => void | Promise<void>;
    /** The request-wide deadline. Without one, a 240 second budget applies. When it fires the report is returned with what had arrived, flagged `partial`. */
    signal?: AbortSignal;
  } = {}
): Promise<StormReport> {
  const yearsBack = options.yearsBack || DEFAULT_GENERATE_YEARS_BACK;
  const searchRadius = options.searchRadiusMiles || DEFAULT_GENERATE_SEARCH_RADIUS;
  const signal = options.signal ?? createDeadline();

  // Geocode the address
  const geoResult = await geocodeAddress(address, city, state, zip, options.googleApiKey, signal, options.onGoogleLookup);

  if (!geoResult) {
    // Out of time before the address could be placed: nothing can be searched, and that is not an error.
    if (signal.aborted) return emptyPartialReport(address, city, state, zip, yearsBack, searchRadius);
    throw new Error('Unable to geocode address');
  }

  const { latitude, longitude } = geoResult;

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - yearsBack);

  // Fetch storm events from multiple real NOAA sources
  const { events, sourceDetails, dataQuality, partial } = await fetchStormEventsMultiSource(
    latitude, longitude, startDate, endDate, searchRadius, signal
  );

  // Build data sources list for display
  const dataSources: string[] = [];
  for (const detail of sourceDetails) {
    if (detail.status === 'success') {
      dataSources.push(detail.name);
    } else if (detail.status === 'empty') {
      dataSources.push(`${detail.name} ${MSG_NO_EVENTS_SUFFIX}`);
    }
  }
  if (dataSources.length === 0) {
    if (dataQuality === 'degraded') {
      dataSources.push(MSG_NO_DATA_SOURCES);
    } else {
      dataSources.push(MSG_NO_EVENTS_NOAA);
    }
  }

  // Filter by distance and sort by date
  const filteredEvents = events
    .filter(e => (e.distance_miles || 0) <= searchRadius)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Group events by year
  const eventsByYear: Record<number, StormEvent[]> = {};
  for (let year = new Date().getFullYear() - yearsBack; year <= new Date().getFullYear(); year++) {
    eventsByYear[year] = filteredEvents.filter(e => e.year === year);
  }

  // Calculate summary statistics
  const hailEvents = filteredEvents.filter(isHailEvent);
  const windEvents = filteredEvents.filter(isWindOnlyEvent);
  const tornadoEvents = filteredEvents.filter(isTornadoEvent);

  const largestHail = maxOf(hailEvents, e => e.hail_size_inches);
  const highestWind = maxOf(windEvents, e => e.wind_speed_mph);

  // Determine insurance claim potential
  let claimPotential: 'high' | 'medium' | 'low' | 'none' = 'none';
  if (largestHail >= CLAIM_HIGH_HAIL_INCHES || highestWind >= CLAIM_HIGH_WIND_MPH || tornadoEvents.length > 0) {
    claimPotential = 'high';
  } else if (largestHail >= LARGE_HAIL_INCHES || highestWind >= HIGH_WIND_MPH) {
    claimPotential = 'medium';
  } else if (hailEvents.length > 0 || windEvents.length > 0) {
    claimPotential = 'low';
  }

  // Identify significant events
  const significantEvents = filteredEvents.filter(e =>
    (e.hail_size_inches && e.hail_size_inches >= LARGE_HAIL_INCHES) ||
    (e.wind_speed_mph && e.wind_speed_mph >= HIGH_WIND_MPH) ||
    isTornadoEvent(e)
  );

  // Assess risk
  const riskAssessment = assessRisk(filteredEvents);

  // Compute numeric risk scores (0-100)
  const riskScore = computeRiskScores(filteredEvents, yearsBack);

  // Compute hail size distribution
  const hailSizeDistribution = computeHailSizeDistribution(filteredEvents);

  // Recommend Date of Loss
  const recommendedDOL = recommendDateOfLoss(filteredEvents);

  // Build property profile for PROPERTY_PROFILE_MIN_YEARS+ year reports
  const propertyProfile = yearsBack >= PROPERTY_PROFILE_MIN_YEARS ? buildPropertyProfile(eventsByYear, filteredEvents) : undefined;

  return {
    property_address: address,
    city: geoResult.city,
    state: geoResult.state,
    zip: geoResult.zip,
    latitude,
    longitude,

    start_date: startDate.toISOString().split('T')[0],
    end_date: endDate.toISOString().split('T')[0],
    years_covered: yearsBack,

    summary: {
      total_events: filteredEvents.length,
      hail_events: hailEvents.length,
      wind_events: windEvents.length,
      tornado_events: tornadoEvents.length,
      largest_hail_inches: largestHail > 0 ? largestHail : undefined,
      highest_wind_mph: highestWind > 0 ? highestWind : undefined,
      insurance_claim_potential: claimPotential,
      hail_size_distribution: hailSizeDistribution,
    },

    events_by_year: eventsByYear,
    events: filteredEvents,
    significant_events: significantEvents,
    risk_assessment: riskAssessment,
    risk_score: riskScore,

    recommended_date_of_loss: recommendedDOL,
    property_profile: propertyProfile,

    data_quality: dataQuality,
    data_source_details: sourceDetails,
    ...(partial && { partial: true }),

    generated_at: new Date().toISOString(),
    data_sources: dataSources,
    search_radius_miles: searchRadius,
  };
}

/**
 * Format storm report as text for display
 */
export function formatStormReportText(report: StormReport): string {
  let text = `${MD_REPORT_HEADING}\n\n`;
  text += `${MD_LABEL_PROPERTY}${report.property_address}, ${report.city}, ${report.state}\n`;
  text += `${MD_LABEL_REPORT_PERIOD}${report.start_date}${MD_REPORT_PERIOD_DATE_INFIX}${report.end_date}${MD_REPORT_PERIOD_YEARS_PREFIX}${report.years_covered}${MD_REPORT_PERIOD_YEARS_SUFFIX}\n`;
  text += `${MD_LABEL_SEARCH_RADIUS}${report.search_radius_miles}${MD_SEARCH_RADIUS_MILES_SUFFIX}\n`;
  text += `${MD_LABEL_DATA_QUALITY}${report.data_quality.toUpperCase()}\n\n`;

  if (report.data_quality === DATA_QUALITY_DEGRADED) {
    text += `${MD_NOTE_DEGRADED}\n\n`;
  } else if (report.data_quality === DATA_QUALITY_NO_DATA) {
    text += `${MD_NOTE_NO_DATA}\n\n`;
  }

  text += `${MD_HEADING_SUMMARY}\n`;
  text += `${MD_BULLET_PREFIX}${MD_LABEL_TOTAL_STORM_EVENTS}${report.summary.total_events}\n`;
  text += `${MD_BULLET_PREFIX}${MD_LABEL_HAIL_EVENTS}${report.summary.hail_events}\n`;
  text += `${MD_BULLET_PREFIX}${MD_LABEL_WIND_EVENTS}${report.summary.wind_events}\n`;
  if (report.summary.tornado_events > 0) {
    text += `${MD_BULLET_PREFIX}${MD_LABEL_TORNADO_EVENTS}${report.summary.tornado_events}\n`;
  }
  if (report.summary.largest_hail_inches) {
    text += `${MD_BULLET_PREFIX}${MD_LABEL_LARGEST_HAIL}${report.summary.largest_hail_inches}${MD_INCHES_DOUBLE_QUOTE}\n`;
  }
  if (report.summary.highest_wind_mph) {
    text += `${MD_BULLET_PREFIX}${MD_LABEL_HIGHEST_WIND}${report.summary.highest_wind_mph}${MD_MPH_SUFFIX}\n`;
  }
  text += `${MD_BULLET_PREFIX}${MD_LABEL_INSURANCE_CLAIM_POTENTIAL}${report.summary.insurance_claim_potential.toUpperCase()}\n\n`;

  text += `${MD_HEADING_RISK_ASSESSMENT}\n`;
  text += `${MD_BULLET_PREFIX}${MD_LABEL_HAIL_RISK}${report.risk_assessment.hail_risk.toUpperCase()}\n`;
  text += `${MD_BULLET_PREFIX}${MD_LABEL_WIND_RISK}${report.risk_assessment.wind_risk.toUpperCase()}\n`;
  text += `${MD_BULLET_PREFIX}${MD_LABEL_OVERALL_RISK}${report.risk_assessment.overall_risk.toUpperCase()}\n\n`;

  text += `${MD_HEADING_RISK_FACTORS}\n`;
  for (const factor of report.risk_assessment.risk_factors) {
    text += `${MD_BULLET_PREFIX}${factor}\n`;
  }
  text += `\n`;

  text += `${MD_HEADING_RECOMMENDATIONS}\n`;
  for (const rec of report.risk_assessment.recommendations) {
    text += `${MD_BULLET_PREFIX}${rec}\n`;
  }
  text += `\n`;

  if (report.significant_events.length > 0) {
    text += `${MD_HEADING_SIGNIFICANT_EVENTS}\n`;
    for (const event of report.significant_events.slice(0, MAX_SIGNIFICANT_EVENTS_DISPLAYED)) {
      text += `${MD_BULLET_PREFIX}${MD_EVENT_DATE_PREFIX}${event.date}${MD_EVENT_DATE_SUFFIX}${event.event_type}`;
      if (event.hail_size_inches) {
        text += `${MD_EVENT_DASH_INFIX}${event.hail_size_inches}${HAIL_SUFFIX_INCHES}`;
      }
      if (event.wind_speed_mph) {
        text += `${MD_EVENT_DASH_INFIX}${event.wind_speed_mph}${WIND_SUFFIX_MPH}`;
      }
      text += `\n`;
    }
  }

  text += `\n${MD_HEADING_DATA_SOURCES}\n`;
  for (const detail of report.data_source_details) {
    text += `${MD_BULLET_PREFIX}${detail.name}${MD_DATA_SOURCE_NAME_INFIX}${detail.status}${MD_DATA_SOURCE_OPEN_PAREN}${detail.event_count}${MD_DATA_SOURCE_EVENTS_INFIX}${detail.response_time_ms}${MD_DATA_SOURCE_TIME_SUFFIX}\n`;
  }

  return text;
}

/**
 * Get hail size description for insurance purposes
 */
export function getHailSizeDescription(sizeInches: number): string {
  if (!Number.isFinite(sizeInches) || sizeInches < MIN_HAIL_DESCRIPTION_INCHES) {
    return MSG_PEA_SIZE_FALLBACK;
  }
  // Source from the same HAAG-referenced scale that powers the report
  // colour chips so we don't have two independent descriptions to keep
  // in sync (the prior ladder had drifted from the scale's labels).
  const level = getHailSizeLevel(sizeInches);
  if (!level) return MSG_PEA_SIZE_FALLBACK;
  return `${level.label} size - ${level.damageRating} (${level.haagRef})`;
}

// Wind damage scale — hoisted to module scope mirrors the hail scale.
// Each row's `mph` is the lower bound; we walk the scale and pick the
// last row whose lower bound is ≤ the input speed.
const WIND_DAMAGE_SCALE: ReadonlyArray<{ mph: number; label: string; description: string }> = [
  { mph: 0,   label: 'Light',        description: 'minimal risk to properly installed roofing' },
  { mph: 40,  label: 'Moderate',     description: 'possible loose shingle lifting' },
  { mph: 50,  label: 'Strong',       description: 'shingle damage possible' },
  { mph: 60,  label: 'Very Strong',  description: 'shingle blow-off likely' },
  { mph: 70,  label: 'Severe',       description: 'significant roof damage expected' },
  { mph: 80,  label: 'Extreme',      description: 'major structural damage possible' },
  { mph: 100, label: 'Catastrophic', description: 'widespread destruction likely' },
];

/**
 * Get wind damage potential description
 */
export function getWindDamageDescription(speedMph: number): string {
  const safeSpeed = Number.isFinite(speedMph) ? speedMph : 0;
  // Walk the scale from the top down so the largest matching threshold
  // wins. The previous if-ladder achieved this implicitly; the data-driven
  // form keeps the thresholds and copy in one place.
  for (let i = WIND_DAMAGE_SCALE.length - 1; i >= 0; i--) {
    const row = WIND_DAMAGE_SCALE[i];
    if (safeSpeed >= row.mph) {
      return `${row.label} - ${row.description}`;
    }
  }
  return `${WIND_DAMAGE_SCALE[0].label} - ${WIND_DAMAGE_SCALE[0].description}`;
}

// ─── Enhanced Storm Data for Standalone Storm Reports ─────────────────────────

/** Caps for the URL list sizes — keeps the report concise + the
 *  share-link payload small. */
const MAX_NOAA_EVENT_PAGE_URLS = 20;
const MAX_NEXRAD_RADAR_URLS = 10;

/** NOAA Storm Events Database URL bases. */
const NOAA_EVENT_DETAILS_URL_BASE = 'https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=';
const NOAA_STORM_EVENTS_LIST_URL = 'https://www.ncdc.noaa.gov/stormevents/listevents.jsp';

/** IEM NEXRAD radar archive URL components. The path is
 *  `${BASE}/${yyyy}/${mm}/${dd}${PATH_INFIX}${yyyy}${mm}${dd}${PNG_SUFFIX}`. */
const IEM_NEXRAD_URL_BASE = 'https://mesonet.agron.iastate.edu/archive/data';
const IEM_NEXRAD_PATH_INFIX = '/GIS/ridge/USCOMP/n0q_';
const IEM_NEXRAD_PNG_SUFFIX = '.png';

/** NEXRAD radar caption template fragments. */
const NEXRAD_CAPTION_PREFIX = 'NEXRAD Composite - ';
const NEXRAD_DATE_LOCALE = 'en-US';
const NEXRAD_DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
const NEXRAD_HAIL_INCHES_SUFFIX = '"';
const NEXRAD_WIND_MPH_SUFFIX = 'mph';

/** Regex for stripping a trailing `' COUNTY'` suffix on county names. */
const NOAA_COUNTY_SUFFIX_RE = / COUNTY$/i;
/** Regex for stripping dashes from ISO dates → `'YYYYMMDD'`. */
const NOAA_DATE_DASH_RE = /-/g;

/** Static NOAA listevents.jsp query params (independent of inputs). */
const NOAA_LISTEVENTS_STATIC_PARAMS = {
  eventType: 'ALL',
  hailfilter: '0.00',
  tornfilter: '0',
  windfilter: '000',
  sort: 'DT',
  submitbutton: 'Search',
  staession: '999',
} as const;

import type { EnhancedStormData } from './comprehensive-roof-report.js';

/**
 * Build NOAA Storm Events Database URL for a specific county/state/date range.
 */
export function buildNOAAStormEventsUrl(
  state: string,
  county: string,
  startDate: string,
  endDate: string
): string {
  // Trim + normalise inputs so a payload with stray spaces or a
  // capitalised "County" suffix doesn't drift through to the URL.
  const stateUpper = state.trim().toUpperCase();
  const countyUpper = county.trim().toUpperCase().replace(NOAA_COUNTY_SUFFIX_RE, '');
  const beginDate = startDate.replace(NOAA_DATE_DASH_RE, '');
  const endDateFmt = endDate.replace(NOAA_DATE_DASH_RE, '');
  // URLSearchParams keeps the long query string readable and handles
  // proper encoding for any value (the old form encodeURIComponent'd
  // each piece manually).
  const params = new URLSearchParams({
    ...NOAA_LISTEVENTS_STATIC_PARAMS,
    beginDate_mm: beginDate.slice(4, 6),
    beginDate_dd: beginDate.slice(6, 8),
    beginDate_yyyy: beginDate.slice(0, 4),
    endDate_mm: endDateFmt.slice(4, 6),
    endDate_dd: endDateFmt.slice(6, 8),
    endDate_yyyy: endDateFmt.slice(0, 4),
    county: countyUpper,
    state: stateUpper,
  });
  return `${NOAA_STORM_EVENTS_LIST_URL}?${params.toString()}`;
}

/**
 * Build NEXRAD Radar Archive URL from IEM for a specific date/location.
 */
export function buildNEXRADArchiveUrl(
  date: string,
  latitude: number,
  longitude: number
): string {
  // Use IEM RIDGE composite archive. Guard malformed dates so we don't
  // generate a URL containing `NaN` segments — IEM serves a 404 image
  // for those, which leaves an ugly broken link in the report.
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    return ''; // Caller should `if (url)` before rendering.
  }
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${IEM_NEXRAD_URL_BASE}/${yyyy}/${mm}/${dd}${IEM_NEXRAD_PATH_INFIX}${yyyy}${mm}${dd}${IEM_NEXRAD_PNG_SUFFIX}`;
}

/**
 * Build enhanced storm data from a StormReport for standalone storm reports.
 * Extracts NOAA URLs, radar imagery links, narratives, and property profile.
 *
 * Handles edge cases:
 * - Empty or undefined significant_events / events arrays
 * - Missing county on first event (tries all events, then falls back)
 * - Missing hail_size_distribution in summary
 */
export function buildEnhancedStormData(stormReport: StormReport): EnhancedStormData {
  // Guard: significant_events may be undefined or empty
  const significantEvents = Array.isArray(stormReport.significant_events)
    ? stormReport.significant_events
    : [];

  // Guard: events may be empty (no storm events found at all)
  const allEvents = Array.isArray(stormReport.events)
    ? stormReport.events
    : [];

  // Build NOAA event page URLs for significant events.
  // Defense-in-depth: pass each URL through sanitizeUrl so only http/https/
  // relative URLs survive — a tainted event.id can never yield a
  // javascript:/data: link rendered in a shared report.
  const noaaEventPageUrls = significantEvents
    .slice(0, MAX_NOAA_EVENT_PAGE_URLS)
    .map(event => ({
      eventId: event.id,
      url: sanitizeUrl(`${NOAA_EVENT_DETAILS_URL_BASE}${event.id}`),
      date: event.date,
      type: event.event_type,
    }));

  // Build NEXRAD radar archive URLs for significant event dates
  const uniqueDates = new Set<string>();
  const nexradRadarImageUrls: EnhancedStormData['nexradRadarImageUrls'] = [];
  for (const event of significantEvents.slice(0, MAX_NEXRAD_RADAR_URLS)) {
    const dateKey = event.date?.split('T')[0];
    if (!dateKey || uniqueDates.has(dateKey)) continue;
    uniqueDates.add(dateKey);
    nexradRadarImageUrls.push({
      date: event.date,
      // Defense-in-depth: sanitize the coordinate/date-derived radar URL.
      // A malformed date already yields "" from the builder; sanitizeUrl keeps
      // it "" and guarantees only http/https survive.
      url: sanitizeUrl(buildNEXRADArchiveUrl(event.date, stormReport.latitude, stormReport.longitude)),
      caption: `${NEXRAD_CAPTION_PREFIX}${new Date(event.date).toLocaleDateString(NEXRAD_DATE_LOCALE, NEXRAD_DATE_OPTIONS)} (${event.event_type}${event.hail_size_inches ? ` ${event.hail_size_inches}${NEXRAD_HAIL_INCHES_SUFFIX}` : ''}${event.wind_speed_mph ? ` ${event.wind_speed_mph}${NEXRAD_WIND_MPH_SUFFIX}` : ''})`,
    });
  }

  // County storm database URL — try significant events first, then all events
  // Guard against county being undefined on any individual event
  const county = significantEvents.find(e => e.county)?.county
    || allEvents.find(e => e.county)?.county
    || '';
  const stateCode = stormReport.state;
  // Defense-in-depth: sanitize the county/state-derived database URL too.
  const countyStormDatabaseUrl = county && stateCode
    ? sanitizeUrl(buildNOAAStormEventsUrl(stateCode, county, stormReport.start_date, stormReport.end_date))
    : '';

  // Extract narratives from events (guard against empty events array)
  const narratives: EnhancedStormData['narratives'] = [];
  for (const event of allEvents) {
    if (event.episode_narrative || event.event_narrative) {
      narratives.push({
        eventId: event.id,
        narrative: event.event_narrative || event.episode_narrative || '',
        date: event.date,
        type: event.event_type,
      });
    }
  }

  // Guard: hail_size_distribution may not exist on summary
  const hailSizeDistribution = stormReport.summary?.hail_size_distribution || {};

  return {
    noaaEventPageUrls,
    nexradRadarImageUrls,
    countyStormDatabaseUrl,
    narratives,
    propertyProfile: stormReport.property_profile || null,
    hailSizeDistribution,
  };
}
