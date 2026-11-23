/**
 * NOAA SWDI (Severe Weather Data Inventory) API Service
 * Fetches real historical storm event data from NOAA's REST API.
 *
 * Endpoints used:
 *   - nx3hail: NEXRAD Level-3 Hail Signatures (radar-detected hail)
 *   - plsr: Preliminary Local Storm Reports — REMOVED from SWDI web services
 *     (2026-07); querying it now 500s. Ground-truth Local Storm Reports come
 *     from the IEM source (see storm-history-service.ts). fetchPLSREvents is
 *     kept only for API compatibility and is no longer called.
 *
 * API docs: https://www.ncdc.noaa.gov/swdiws/
 * No API token required. Spatial filter is `bbox` (center/radius is IGNORED by
 * SWDI). Max date range is 744 hours (31 days) per query — we chunk at 30 days.
 *
 * Uses NCEI domain (primary) with NCDC fallback for migration resilience.
 */

import type { StormEvent } from './storm-history-service.js';
import { fetchWithDomainFallback } from './fetch-with-retry.js';

/** Data source detail returned alongside events for monitoring */
export interface DataSourceDetail {
  name: string;
  status: 'success' | 'failed' | 'empty' | 'timeout';
  event_count: number;
  response_time_ms: number;
}

// NCEI (new) primary, NCDC (legacy) fallback
const SWDI_BASES = [
  'https://www.ncei.noaa.gov/swdiws/csv',
  'https://www.ncdc.noaa.gov/swdiws/csv',
];

const RETRY_OPTIONS = {
  maxRetries: 2,
  baseDelayMs: 1500,
  maxDelayMs: 8000,
  timeoutMs: 15000,
};

const FETCH_HEADERS = {
  'User-Agent': 'RoofReportAI/2.0',
};

// ─── Source labels (single source of truth — match across success/empty/failed) ─
const SWDI_SOURCE_NAME = 'NOAA SWDI (Storm Reports + NEXRAD Hail)';
const PLSR_DATA_SOURCE = 'NOAA SWDI - Preliminary Local Storm Reports';
const NX3HAIL_DATA_SOURCE = 'NOAA SWDI - NEXRAD Hail Signatures';

// ─── Geometry / unit constants ─────────────────────────────────────────
const EARTH_RADIUS_MILES = 3959;
const KNOTS_TO_MPH = 1.151;

// ─── Domain-specific magic-number constants ────────────────────────────
/** SWDI sometimes encodes hail size as inches × 100. Anything ≥10 is "raw". */
const HAIL_HUNDREDTHS_THRESHOLD = 10;
/** NX3HAIL records below 0.5" aren't roofing-relevant (HAAG functional threshold). */
const MIN_HAIL_SIZE_INCHES = 0.5;
/** PLSR remarks occasionally contain typos like "12.00 IN" hail; reject anything
 *  larger than the documented record (8.0" Vivian, SD, 2010) plus a buffer. */
const MAX_HAIL_INCHES_REASONABLE = 9.0;
/** Years before 2001 indicate parse failure; SWDI history is mostly post-2000 anyway. */
const MIN_VALID_YEAR = 2000;

// ─── PLSR remark parsers (hoisted out of `classifyPLSREvent`) ──────────
// `\bIN\b` so we don't match "INCHES IN PUBLIC" / "RAIN".
const PLSR_HAIL_SIZE_RE = /([\d.]+)\s*IN\b/;
const PLSR_HAIL_DOT_RE = /HAIL[.\s]*([\d.]+)/;
const PLSR_WIND_SPEED_RE = /([\d]+)\s*(?:MPH|KT)\b/;
const BOM = '﻿';

// ─── ZTIME column parsing offsets (PLSR + NX3HAIL share the same format) ──
const ZTIME_YEAR_START = 0;
const ZTIME_YEAR_END = 4;
const ZTIME_MONTH_START = 4;
const ZTIME_MONTH_END = 6;
const ZTIME_DAY_START = 6;
const ZTIME_DAY_END = 8;

/** Source-name shorthand stamped onto every emitted `StormEvent`. */
const SOURCE_NOAA = 'NOAA' as const;

/** Hail-size rounding precision used by NX3HAIL: 2 decimals (1/100 inch). */
const NX3HAIL_ROUND_PRECISION = 100;

/** Lat/Lng formatting: SWDI URL builder expects 4 decimals of precision. */
const SWDI_COORDINATE_DECIMALS = 4;

/** Knots indicator inside a PLSR remark (e.g. "55 KT"). */
const KNOTS_INDICATOR = 'KT';

// ─── Canonical StormEvent.event_type constants ───────────────────────
/** Hail event — single source of truth for the 6 emit/compare sites. */
const EVENT_TYPE_HAIL: StormEvent['event_type'] = 'Hail';
/** Tornado event. */
const EVENT_TYPE_TORNADO: StormEvent['event_type'] = 'Tornado';
/** Hurricane event. */
const EVENT_TYPE_HURRICANE: StormEvent['event_type'] = 'Hurricane';
/** Tropical Storm event. */
const EVENT_TYPE_TROPICAL_STORM: StormEvent['event_type'] = 'Tropical Storm';
/** Thunderstorm Wind event — also used as the catch-all default. */
const EVENT_TYPE_THUNDERSTORM_WIND: StormEvent['event_type'] = 'Thunderstorm Wind';

/** `magnitude_unit` field values stamped onto emitted events. */
const MAG_UNIT_INCH: StormEvent['magnitude_unit'] = 'inch';
const MAG_UNIT_MPH: StormEvent['magnitude_unit'] = 'mph';

/** ID prefix for PLSR-sourced StormEvents (`plsr-<ztime>-<idx>`). */
const PLSR_ID_PREFIX = 'plsr-';
/** ID prefix for NX3HAIL-sourced StormEvents (`nx3hail-<ztime>-<idx>`). */
const NX3HAIL_ID_PREFIX = 'nx3hail-';

/** Log prefix for every line emitted by the SWDI module. */
const LOG_PREFIX_SWDI = 'SWDI:';

/** `DataSourceDetail.status` values — kept aligned across PLSR/NX3HAIL/multi paths. */
const STATUS_SUCCESS: DataSourceDetail['status'] = 'success';
const STATUS_FAILED: DataSourceDetail['status'] = 'failed';
const STATUS_EMPTY: DataSourceDetail['status'] = 'empty';

/** `Promise.allSettled` discriminant for fulfilled results. */
const PROMISE_STATUS_FULFILLED = 'fulfilled' as const;

/** Lat/Lng rounding precision used for `deduplicateEvents` keys.
 *  10 = 0.1° resolution, ≈ 7-mile granularity at mid-latitudes. */
const DEDUP_LOC_PRECISION = 10;

/** Comment-line prefixes the CSV parser skips. */
const CSV_COMMENT_PREFIXES: readonly string[] = ['#', '--'];

/** Remarks-keyword substrings recognised in PLSR `REMARKS` text. */
const REMARK_KEYWORD_HAIL = 'HAIL';
const REMARK_KEYWORD_TORNADO = 'TORNADO';
const REMARK_KEYWORD_FUNNEL = 'FUNNEL';
const REMARK_KEYWORD_HURRICANE = 'HURRICANE';
const REMARK_KEYWORD_TROPICAL_STORM = 'TROPICAL STORM';
const REMARK_KEYWORD_WIND = 'WIND';
const REMARK_KEYWORD_TSTM_WND = 'TSTM WND';
const REMARK_KEYWORD_GUST = 'GUST';

/** SWDI CSV column header names. */
const SWDI_CSV_COL_LAT = 'LAT';
const SWDI_CSV_COL_LON = 'LON';
const SWDI_CSV_COL_REMARKS = 'REMARKS';
const SWDI_CSV_COL_EVENT = 'EVENT';
const SWDI_CSV_COL_MAG = 'MAG';
const SWDI_CSV_COL_ZTIME = 'ZTIME';
const SWDI_CSV_COL_STATE = 'STATE';
const SWDI_CSV_COL_COUNTY = 'COUNTY';
const SWDI_CSV_COL_CITY = 'CITY';
const SWDI_CSV_COL_MAXSIZE = 'MAXSIZE';
const SWDI_CSV_COL_SEVPROB = 'SEVPROB';

/** SWDI URL path segments. */
const SWDI_PATH_PLSR = '/plsr/';
const SWDI_PATH_NX3HAIL = '/nx3hail/';
const SWDI_DATE_RANGE_INFIX = ':';

/** NX3HAIL event narrative template fragments — assembled into:
 *  `'Radar-detected hail signature. Max estimated size: 1.50". Severe probability: 75%.'` */
const NX3HAIL_NARRATIVE_PREFIX = 'Radar-detected hail signature. Max estimated size: ';
const NX3HAIL_NARRATIVE_INFIX = '". Severe probability: ';
const NX3HAIL_NARRATIVE_SUFFIX = '%.';
/** MAXSIZE display precision in the narrative (`1.50` not `1.5`). */
const NX3HAIL_MAXSIZE_DECIMALS = 2;

/** Console.warn log prefixes — distinct from `LOG_PREFIX_SWDI` (info-tier). */
const LOG_WARN_PLSR_API = 'SWDI PLSR API returned ';
const LOG_WARN_PLSR_FETCH_FAILED = 'SWDI PLSR fetch failed (all retries/domains exhausted):';
const LOG_WARN_NX3HAIL_API = 'SWDI NX3HAIL API returned ';
const LOG_WARN_NX3HAIL_FETCH_FAILED = 'SWDI NX3HAIL fetch failed (all retries/domains exhausted):';

/** Info log message fragments. */
const LOG_INFO_FETCHING_PREFIX = ' Fetching ';
const LOG_INFO_FETCHING_CHUNKS = ' date-chunk(s) for ';
const LOG_INFO_RADIUS_PREFIX = ' radius=';
const LOG_INFO_RADIUS_SUFFIX = 'mi';
const LOG_INFO_GOT_PREFIX = ' Got ';
const LOG_INFO_GOT_INFIX_EVENTS_FROM = ' events from ';
const LOG_INFO_GOT_INFIX_SUCCESSFUL = ' successful API calls in ';
const LOG_INFO_GOT_SUFFIX_MS = 'ms';
const LOG_INFO_LATLNG_SEPARATOR = ',';

/** Narrow `unknown` to a printable error message — replaces inline
 *  `error instanceof Error ? (error as Error).message : error` ternary
 *  in the catch blocks. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parse a 4/2/2-char date out of a `ZTIME` column. Returns `{year, month, day}`,
 * substituting current year / month=1 / day=1 for any un-parseable component
 * (matches the inline `|| 1` fallback used by both PLSR and NX3HAIL paths).
 */
export function parseZTimeComponents(ztime: string): { year: number; month: number; day: number } {
  // SWDI ZTIME comes in two shapes depending on product:
  //   • ISO 8601  — `2025-05-02T22:33:54Z` (nx3hail radar signatures)
  //   • Packed     — `YYYYMMDDHHMI`        (legacy PLSR)
  // Detect ISO (has a `-` or `T`) and parse by field; otherwise slice the
  // fixed packed offsets. The old code always sliced packed offsets, which
  // turned an ISO ztime's `-0`/`2-` slices into a wrong month/day.
  if (ztime.includes('-') || ztime.includes('T')) {
    const m = ztime.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
    }
  }
  const year = parseInt(ztime.substring(ZTIME_YEAR_START, ZTIME_YEAR_END), 10) || new Date().getFullYear();
  const month = parseInt(ztime.substring(ZTIME_MONTH_START, ZTIME_MONTH_END), 10) || 1;
  const day = parseInt(ztime.substring(ZTIME_DAY_START, ZTIME_DAY_END), 10) || 1;
  return { year, month, day };
}

/** Format `Y/M/D` integers into the canonical `YYYY-MM-DD` date string. */
function formatDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Approx. miles per degree of latitude (constant); longitude scales by cos(lat). */
const MILES_PER_DEGREE_LAT = 69;

/**
 * Build the SWDI URL spatial query.
 *
 * NOTE (2026-07 API change): SWDI web services IGNORE the `?center=lng,lat&radius=`
 * form — passing it returns the ENTIRE nationwide dataset (verified: radius=5 and
 * radius=15 return byte-identical bodies). The only spatial filter SWDI honors is
 * `?bbox=west,south,east,north`. We derive a bounding box from the requested
 * center + radius (miles → degrees, longitude corrected by latitude).
 */
export function buildSwdiQuery(lng: number, lat: number, radiusMiles: number): string {
  const dLat = radiusMiles / MILES_PER_DEGREE_LAT;
  const cosLat = Math.max(Math.cos(lat * DEG_TO_RAD), 0.01); // guard near the poles
  const dLng = radiusMiles / (MILES_PER_DEGREE_LAT * cosLat);
  const west = (lng - dLng).toFixed(SWDI_COORDINATE_DECIMALS);
  const south = (lat - dLat).toFixed(SWDI_COORDINATE_DECIMALS);
  const east = (lng + dLng).toFixed(SWDI_COORDINATE_DECIMALS);
  const north = (lat + dLat).toFixed(SWDI_COORDINATE_DECIMALS);
  return `?bbox=${west},${south},${east},${north}`;
}

/**
 * SWDI sometimes encodes hail size as inches × 100 (e.g. 100 = 1.00") to avoid
 * decimal handling. Detect that case and divide back down.
 */
function parseHailMagnitude(mag: number): number {
  return mag >= HAIL_HUNDREDTHS_THRESHOLD ? mag / 100 : mag;
}

/**
 * Simple concurrency limiter to prevent overloading NOAA APIs during 10-year fetches.
 * Runs up to `limit` promises concurrently.
 */
async function pLimitAll<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

const MAX_CONCURRENT_SWDI_REQUESTS = 4;

/** Date-component zero-pad target width (`'03'` not `'3'`). */
const DATE_PAD_WIDTH = 2;
/** Date-component pad character. */
const DATE_PAD_CHAR = '0';
/** Conversion factor degrees → radians (hoisted out of the per-call Haversine). */
const DEG_TO_RAD = Math.PI / 180;

/** Format a Date as YYYYMMDD (GMT) for the SWDI API */
function formatSWDIDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(DATE_PAD_WIDTH, DATE_PAD_CHAR);
  const day = String(d.getUTCDate()).padStart(DATE_PAD_WIDTH, DATE_PAD_CHAR);
  return `${y}${m}${day}`;
}

/** Calculate distance between two coordinates in miles (Haversine) */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Max SWDI query window. NOTE (2026-07 API change): SWDI now enforces a maximum
 * date range of 744 hours (31 days) per request — a longer range 500s with
 * "maximum date range currently allowed is 744 hours". We chunk at 30 days for
 * a safety margin under that cap.
 */
const SWDI_MAX_CHUNK_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Split a date range into ≤30-day chunks (SWDI's 744-hour per-query cap). */
export function splitIntoChunks(startDate: Date, endDate: Date): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  let current = new Date(startDate);

  while (current < endDate) {
    const chunkEnd = new Date(current.getTime() + SWDI_MAX_CHUNK_DAYS * MS_PER_DAY);
    chunks.push({
      start: new Date(current),
      end: chunkEnd > endDate ? new Date(endDate) : chunkEnd,
    });
    current = new Date(chunkEnd);
  }

  return chunks;
}

/**
 * Parse a CSV string into an array of row objects.
 * Handles quoted fields and strips header/footer lines from SWDI responses.
 */
const HEADER_LINE_RE = /^[A-Z_]/i;

/** Regex to split CSV body on either CRLF or LF line endings. */
const CRLF_OR_LF_RE = /\r?\n/;
/** Regex to strip a leading BOM character from the CSV body. */
const BOM_AT_START_RE = /^﻿/;
/** CSV cell separator. */
const CSV_COMMA_SEPARATOR = ',';
/** Minimum CSV line count before parsing (header + ≥1 data row). */
const CSV_MIN_LINE_COUNT = 2;

export function parseCSV(csvText: string): Record<string, string>[] {
  // Defensive: NOAA SWDI is an external API. A failed upstream read (or a
  // caller passing through an already-parsed body) can hand us a non-string.
  // Coercing/`.replace()`-ing that throws, so bail out to an empty result
  // rather than letting a TypeError escape the pure parser.
  if (typeof csvText !== 'string') return [];

  // Accept Windows line endings (`\r\n`) too — NCEI returns LF but the
  // legacy NCDC fallback occasionally serves CRLF. Strip a leading BOM
  // off the first line so the header row's first column doesn't carry
  // an invisible `﻿` prefix that breaks dictionary lookups.
  const normalized = csvText.replace(BOM_AT_START_RE, '').trim();
  const lines = normalized.split(CRLF_OR_LF_RE).filter(line => line.trim().length > 0);
  if (lines.length < CSV_MIN_LINE_COUNT) return [];

  // SWDI sometimes includes a header comment line starting with a non-alpha char
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // The header row has column names; skip lines that look like metadata
    if (HEADER_LINE_RE.test(trimmed) && trimmed.includes(CSV_COMMA_SEPARATOR)) {
      headerIdx = i;
      break;
    }
  }

  // No line looks like a real CSV header (e.g. an HTML 5xx error page, a WAF
  // block page, or any non-CSV body). Return empty rather than manufacturing
  // pseudo-rows out of `<html>` markup that would poison the downstream
  // row-mappers.
  if (headerIdx === -1) return [];

  const headers = lines[headerIdx].replace(BOM, '').split(CSV_COMMA_SEPARATOR).map(h => h.trim().toUpperCase());
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || CSV_COMMENT_PREFIXES.some(p => line.startsWith(p))) continue;

    // Simple CSV split (SWDI doesn't use quoted commas in data fields)
    const values = line.split(CSV_COMMA_SEPARATOR).map(v => v.trim());
    if (values.length < headers.length - 1) continue; // skip malformed rows

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Classify a PLSR remark into a storm event type
 */
function classifyPLSREvent(remarks: string = ''): { event_type: StormEvent['event_type']; hail_size_inches?: number; wind_speed_mph?: number } {
  const upper = remarks.toUpperCase();

  // Helper: parseFloat that returns undefined for NaN, and rejects values
  // outside the documented physical range (record hail is 8" Vivian SD).
  const parseHailSize = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_HAIL_INCHES_REASONABLE) return undefined;
    return n;
  };

  // Hail — look for "HAIL" keyword and size patterns
  if (upper.includes(REMARK_KEYWORD_HAIL)) {
    const sizeMatch = upper.match(PLSR_HAIL_SIZE_RE);
    const dotMatch = upper.match(PLSR_HAIL_DOT_RE);
    const size = parseHailSize(sizeMatch?.[1]) ?? parseHailSize(dotMatch?.[1]);
    return { event_type: EVENT_TYPE_HAIL, hail_size_inches: size };
  }

  // Tornado
  if (upper.includes(REMARK_KEYWORD_TORNADO) || upper.includes(REMARK_KEYWORD_FUNNEL)) {
    return { event_type: EVENT_TYPE_TORNADO };
  }

  // Hurricane / Tropical Storm
  if (upper.includes(REMARK_KEYWORD_HURRICANE)) return { event_type: EVENT_TYPE_HURRICANE };
  if (upper.includes(REMARK_KEYWORD_TROPICAL_STORM)) return { event_type: EVENT_TYPE_TROPICAL_STORM };

  // Wind — look for "TSTM WND" or "WIND" and speed patterns
  if (upper.includes(REMARK_KEYWORD_WIND) || upper.includes(REMARK_KEYWORD_TSTM_WND) || upper.includes(REMARK_KEYWORD_GUST)) {
    const speedMatch = upper.match(PLSR_WIND_SPEED_RE);
    let speed: number | undefined;
    if (speedMatch) {
      const parsed = parseInt(speedMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        // Convert knots → mph when the original token was KT.
        speed = upper.includes(KNOTS_INDICATOR)
          ? Math.round(parsed * KNOTS_TO_MPH)
          : parsed;
      }
    }
    return { event_type: EVENT_TYPE_THUNDERSTORM_WIND, wind_speed_mph: speed };
  }

  // Default to thunderstorm wind if we can't classify
  return { event_type: EVENT_TYPE_THUNDERSTORM_WIND };
}

/**
 * @deprecated NOAA removed the `plsr` product from SWDI web services (2026-07) —
 * calling this now 500s upstream (it returns [] on the non-OK response). Ground-
 * truth Local Storm Reports come from the IEM source in storm-history-service.ts.
 * Kept for API compatibility; not called by fetchSWDIStormEvents.
 *
 * Fetch Preliminary Local Storm Reports from SWDI (with retry and domain fallback)
 */
export async function fetchPLSREvents(
  lat: number,
  lng: number,
  startDate: Date,
  endDate: Date,
  radiusMiles: number
): Promise<StormEvent[]> {
  const start = formatSWDIDate(startDate);
  const end = formatSWDIDate(endDate);
  const path = `${SWDI_PATH_PLSR}${start}${SWDI_DATE_RANGE_INFIX}${end}${buildSwdiQuery(lng, lat, radiusMiles)}`;
  const urls = SWDI_BASES.map(base => `${base}${path}`);

  try {
    const { response } = await fetchWithDomainFallback(
      urls,
      { headers: FETCH_HEADERS },
      RETRY_OPTIONS
    );

    if (!response.ok) {
      console.warn(`${LOG_WARN_PLSR_API}${response.status}`);
      return [];
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);

    return rows.map((row, idx) => {
      const eventLat = parseFloat(row[SWDI_CSV_COL_LAT] || '0');
      const eventLng = parseFloat(row[SWDI_CSV_COL_LON] || '0');
      const remarks = row[SWDI_CSV_COL_REMARKS] || row[SWDI_CSV_COL_EVENT] || '';
      const mag = parseFloat(row[SWDI_CSV_COL_MAG] || '0');
      const classification = classifyPLSREvent(remarks);

      // Parse ZTIME: format YYYYMMDDHHMI
      const ztime = row[SWDI_CSV_COL_ZTIME] || '';
      const { year, month, day } = parseZTimeComponents(ztime);
      const dateStr = formatDateString(year, month, day);

      // If magnitude is present and > 0, use it for hail (in 1/100 inch) or wind (mph)
      if (classification.event_type === EVENT_TYPE_HAIL && mag > 0 && !classification.hail_size_inches) {
        classification.hail_size_inches = parseHailMagnitude(mag);
      }
      if (classification.event_type === EVENT_TYPE_THUNDERSTORM_WIND && mag > 0 && !classification.wind_speed_mph) {
        classification.wind_speed_mph = mag;
      }

      const distance = haversineDistance(lat, lng, eventLat, eventLng);

      return {
        id: `${PLSR_ID_PREFIX}${ztime}-${idx}`,
        event_type: classification.event_type,
        date: dateStr,
        year,
        month,
        day,
        state: row[SWDI_CSV_COL_STATE] || '',
        county: row[SWDI_CSV_COL_COUNTY] || '',
        city: row[SWDI_CSV_COL_CITY] || undefined,
        latitude: eventLat || undefined,
        longitude: eventLng || undefined,
        distance_miles: distance,
        magnitude: classification.hail_size_inches || classification.wind_speed_mph,
        magnitude_unit: classification.hail_size_inches ? MAG_UNIT_INCH : MAG_UNIT_MPH,
        hail_size_inches: classification.hail_size_inches,
        wind_speed_mph: classification.wind_speed_mph,
        source: SOURCE_NOAA,
        data_source: PLSR_DATA_SOURCE,
        event_narrative: remarks || undefined,
      };
    }).filter(e => e.year > MIN_VALID_YEAR); // Sanity filter
  } catch (error) {
    console.warn(LOG_WARN_PLSR_FETCH_FAILED, errorMessage(error));
    return [];
  }
}

/**
 * Fetch NEXRAD Level-3 Hail Signatures from SWDI (with retry and domain fallback)
 */
export async function fetchNX3HailEvents(
  lat: number,
  lng: number,
  startDate: Date,
  endDate: Date,
  radiusMiles: number
): Promise<StormEvent[]> {
  const start = formatSWDIDate(startDate);
  const end = formatSWDIDate(endDate);
  const path = `${SWDI_PATH_NX3HAIL}${start}${SWDI_DATE_RANGE_INFIX}${end}${buildSwdiQuery(lng, lat, radiusMiles)}`;
  const urls = SWDI_BASES.map(base => `${base}${path}`);

  try {
    const { response } = await fetchWithDomainFallback(
      urls,
      { headers: FETCH_HEADERS },
      RETRY_OPTIONS
    );

    if (!response.ok) {
      console.warn(`${LOG_WARN_NX3HAIL_API}${response.status}`);
      return [];
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);

    return rows.map((row, idx) => {
      const eventLat = parseFloat(row[SWDI_CSV_COL_LAT] || '0');
      const eventLng = parseFloat(row[SWDI_CSV_COL_LON] || '0');

      // ZTIME format: YYYYMMDDHHMI
      const ztime = row[SWDI_CSV_COL_ZTIME] || '';
      const { year, month, day } = parseZTimeComponents(ztime);
      const dateStr = formatDateString(year, month, day);

      // MAXSIZE is the max estimated hail size in inches
      const maxSize = parseFloat(row[SWDI_CSV_COL_MAXSIZE] || '0');
      const sevProb = parseFloat(row[SWDI_CSV_COL_SEVPROB] || '0');
      const distance = haversineDistance(lat, lng, eventLat, eventLng);

      // Only include events with a meaningful hail size (>= MIN_HAIL_SIZE_INCHES)
      if (maxSize < MIN_HAIL_SIZE_INCHES) return null;

      return {
        id: `${NX3HAIL_ID_PREFIX}${ztime}-${idx}`,
        event_type: EVENT_TYPE_HAIL,
        date: dateStr,
        year,
        month,
        day,
        state: '',
        county: '',
        latitude: eventLat || undefined,
        longitude: eventLng || undefined,
        distance_miles: distance,
        magnitude: maxSize,
        magnitude_unit: MAG_UNIT_INCH,
        hail_size_inches: Math.round(maxSize * NX3HAIL_ROUND_PRECISION) / NX3HAIL_ROUND_PRECISION,
        source: SOURCE_NOAA,
        data_source: NX3HAIL_DATA_SOURCE,
        event_narrative: `${NX3HAIL_NARRATIVE_PREFIX}${maxSize.toFixed(NX3HAIL_MAXSIZE_DECIMALS)}${NX3HAIL_NARRATIVE_INFIX}${sevProb}${NX3HAIL_NARRATIVE_SUFFIX}`,
      };
    }).filter(Boolean) as StormEvent[];
  } catch (error) {
    console.warn(LOG_WARN_NX3HAIL_FETCH_FAILED, errorMessage(error));
    return [];
  }
}

/**
 * Fetch storm events across multiple years from SWDI.
 * Splits into 1-year chunks (API max) and fetches in parallel.
 * Combines PLSR (storm reports) and NX3HAIL (radar hail) data.
 *
 * Returns events and a source detail for monitoring.
 */
export async function fetchSWDIStormEvents(
  lat: number,
  lng: number,
  startDate: Date,
  endDate: Date,
  radiusMiles: number = 25
): Promise<{ events: StormEvent[]; sourceDetail: DataSourceDetail }> {
  const overallStart = Date.now();
  const chunks = splitIntoChunks(startDate, endDate);

  console.log(`${LOG_PREFIX_SWDI}${LOG_INFO_FETCHING_PREFIX}${chunks.length}${LOG_INFO_FETCHING_CHUNKS}${lat.toFixed(SWDI_COORDINATE_DECIMALS)}${LOG_INFO_LATLNG_SEPARATOR}${lng.toFixed(SWDI_COORDINATE_DECIMALS)}${LOG_INFO_RADIUS_PREFIX}${radiusMiles}${LOG_INFO_RADIUS_SUFFIX}`);

  // Fetch NX3HAIL (radar hail) for each chunk with a concurrency limit to avoid
  // NOAA rate limits. NOTE (2026-07 API change): the `plsr` product was removed
  // from SWDI web services ("Acceptable values are: [nx3structure, nx3hail,
  // nx3meso, nx3mda, nx3tvs, nldn, ...]") — querying it 500s. Ground-truth Local
  // Storm Reports (hail/wind/tornado) now come from the IEM source in
  // storm-history-service.ts, which is why IEM is the coordinated secondary.
  const tasks = chunks.map(chunk =>
    () => fetchNX3HailEvents(lat, lng, chunk.start, chunk.end, radiusMiles),
  );

  const results = await pLimitAll(tasks, MAX_CONCURRENT_SWDI_REQUESTS);

  const events: StormEvent[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.status === PROMISE_STATUS_FULFILLED) {
      if (result.value.length > 0) {
        events.push(...result.value);
      }
      successCount++;
    } else {
      failCount++;
    }
  }

  const responseTimeMs = Date.now() - overallStart;
  console.log(`${LOG_PREFIX_SWDI}${LOG_INFO_GOT_PREFIX}${events.length}${LOG_INFO_GOT_INFIX_EVENTS_FROM}${successCount}/${results.length}${LOG_INFO_GOT_INFIX_SUCCESSFUL}${responseTimeMs}${LOG_INFO_GOT_SUFFIX_MS}`);

  // Deduplicate events that are very close in time and location
  const deduped = deduplicateEvents(events);

  const sortedEvents = deduped.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Determine source status
  let status: DataSourceDetail['status'];
  if (failCount === results.length) {
    status = STATUS_FAILED;
  } else if (sortedEvents.length === 0) {
    status = STATUS_EMPTY;
  } else {
    status = STATUS_SUCCESS;
  }

  return {
    events: sortedEvents,
    sourceDetail: {
      name: SWDI_SOURCE_NAME,
      status,
      event_count: sortedEvents.length,
      response_time_ms: responseTimeMs,
    },
  };
}

/**
 * Remove duplicate events (same date, same type, within 2 miles of each other).
 * PLSR and NX3HAIL may report the same hail event.
 */
export function deduplicateEvents(events: StormEvent[]): StormEvent[] {
  const seen = new Map<string, StormEvent>();

  for (const event of events) {
    // Create a rough dedup key: date + type + rounded location
    const latRound = Math.round((event.latitude || 0) * DEDUP_LOC_PRECISION) / DEDUP_LOC_PRECISION;
    const lngRound = Math.round((event.longitude || 0) * DEDUP_LOC_PRECISION) / DEDUP_LOC_PRECISION;
    const key = `${event.date}-${event.event_type}-${latRound}-${lngRound}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, event);
    } else {
      // Keep the one with more detail (larger magnitude or has narrative)
      const existingMag = existing.hail_size_inches || existing.wind_speed_mph || 0;
      const newMag = event.hail_size_inches || event.wind_speed_mph || 0;
      if (newMag > existingMag || (!existing.event_narrative && event.event_narrative)) {
        seen.set(key, event);
      }
    }
  }

  return Array.from(seen.values());
}
