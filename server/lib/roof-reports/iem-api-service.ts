/**
 * Iowa Environmental Mesonet (IEM) API Service
 * Secondary real NOAA data source for Local Storm Reports (LSR).
 *
 * IEM provides developer-friendly access to NWS Local Storm Reports data,
 * essentially the same underlying data as SWDI PLSR but through more
 * reliable infrastructure at Iowa State University.
 *
 * Endpoint: https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py
 * No API key required. Data available from 2003 to present.
 *
 * Docs: https://mesonet.agron.iastate.edu/request/gis/lsrs.phtml
 */

import type { StormEvent } from './storm-history-service.js';
import type { DataSourceDetail } from './swdi-api-service.js';
import { fetchWithRetry } from './fetch-with-retry.js';

const IEM_BASE = 'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py';

/** Single source of truth for the source-detail `name` field — used in
 * success, empty, failure, and timeout branches so they can never drift. */
const SOURCE_NAME = 'Iowa Environmental Mesonet (IEM) - Local Storm Reports';

/** Prefix for every log line emitted by this module — single source of
 *  truth so a future rename (e.g. `[iem]`) is one edit. */
const LOG_PREFIX = 'IEM:';
/** `DataSourceDetail.status` values — kept here so a typo can't drift
 *  one branch (e.g. 'success' vs 'succeeded') from the others. */
const STATUS_SUCCESS = 'success' as const;
const STATUS_EMPTY = 'empty' as const;
const STATUS_FAILED = 'failed' as const;
const STATUS_TIMEOUT = 'timeout' as const;
/** Substring used to recognise timeout-shaped errors thrown by `fetchWithRetry`. */
const TIMEOUT_ERROR_MARKER = 'timeout';
/** Decimal precision used when serialising bounding-box edges to the IEM
 *  query and when echoing the search-centre into logs. 4dp ≈ 11m, well
 *  below IEM's reporting resolution. */
const BBOX_DECIMALS = 4;
/** Conversion factor degrees → radians, hoisted out of the per-event Haversine. */
const DEG_TO_RAD = Math.PI / 180;
/** IEM accepts CSV via `fmt=csv` — single source of truth for the format token. */
const IEM_FORMAT_CSV = 'csv';
/** Regex used to strip the `.000Z` milliseconds suffix from `Date.toISOString()`. */
const ISO_MS_SUFFIX_RE = /\.\d{3}Z$/;

/** Narrow `unknown` to a printable error message — replaces the unsafe
 *  `(error as Error).message` cast that used to appear at every catch. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** UA string sent on every IEM request — gives IEM ops something to attribute
 *  traffic to and matches SWDI's identifier. */
const IEM_USER_AGENT = 'RoofReportAI/2.0';

/** IEM occasionally encodes hail size as inches × 100 (same convention as SWDI). */
const HAIL_HUNDREDTHS_THRESHOLD = 10;
/** Reject hail-size values larger than the documented record (8.0", Vivian SD). */
const MAX_HAIL_INCHES_REASONABLE = 9.0;
/** Pre-compiled regex literals hoisted out of `parseIEMCSV`. */
const VALID_DATE_RE = /(\d{4})-?(\d{2})-?(\d{2})/;
const HEADER_INDICATOR_RE = /VALID/i;
const BOM = '﻿';

const RETRY_OPTIONS = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 6000,
  timeoutMs: 20000,
};

// ─── Geometry constants ─────────────────────────────────────────────────
const EARTH_RADIUS_MILES = 3959;
const MILES_PER_DEGREE_LATITUDE = 69;
const KNOTS_TO_MPH = 1.151;

// IEM only carries Local Storm Reports back to 2003; reject obvious garbage years.
const MIN_VALID_YEAR = 2000;

// ─── Calendar bounds for date validation ────────────────────────────────
const MIN_MONTH = 1;
const MAX_MONTH = 12;
const MIN_DAY = 1;
const MAX_DAY = 31;

/** Cap on lines scanned when locating the CSV header row. */
const MAX_HEADER_SEARCH_LINES = 5;

/** Comment-line prefix used by IEM CSV — these rows are skipped. */
const CSV_COMMENT_PREFIX = '#';

/** Storm-event type codes recognised in IEM `TYPECODE` column. */
const TYPECODE_HAIL = 'H';
const TYPECODE_TSTM_WIND_GUST = 'G';
const TYPECODE_TSTM_WIND_DAMAGE = 'D';
const TYPECODE_TORNADO = 'T';
const TYPECODE_NON_TSTM_WIND = 'N';
const TYPECODE_NON_TSTM_WIND_DAMAGE = 'O';
const TYPECODE_MARINE_TSTM_WIND = 'M';

/** `MAG` sentinel returned by IEM when no measured magnitude is available. */
const MAG_NONE_SENTINEL = 'None';

/** Knots indicator substrings in the `TYPETEXT` column. */
const KNOTS_INDICATORS = ['KT', 'KNOT'] as const;

/** Source-name shorthand stamped onto every emitted `StormEvent`. */
const SOURCE_NOAA = 'NOAA' as const;

/** Event-type label substrings recognised in IEM `TYPETEXT` column. */
const TEXT_KEYWORD_HAIL = 'HAIL';
const TEXT_KEYWORD_TSTM_WND = 'TSTM WND';
const TEXT_KEYWORD_THUNDERSTORM_WIND = 'THUNDERSTORM WIND';
const TEXT_KEYWORD_NON_TSTM_WND = 'NON-TSTM WND';
const TEXT_KEYWORD_HIGH_WIND = 'HIGH WIND';
const TEXT_KEYWORD_TORNADO = 'TORNADO';
const TEXT_KEYWORD_HURRICANE = 'HURRICANE';
const TEXT_KEYWORD_TROPICAL = 'TROPICAL';

/** Output `event_type` enum values stamped onto each `StormEvent`. */
const EVENT_TYPE_HAIL: StormEvent['event_type'] = 'Hail';
const EVENT_TYPE_TSTM_WIND: StormEvent['event_type'] = 'Thunderstorm Wind';
const EVENT_TYPE_HIGH_WIND: StormEvent['event_type'] = 'High Wind';
const EVENT_TYPE_TORNADO: StormEvent['event_type'] = 'Tornado';
const EVENT_TYPE_HURRICANE: StormEvent['event_type'] = 'Hurricane';
const EVENT_TYPE_TROPICAL_STORM: StormEvent['event_type'] = 'Tropical Storm';

/** IEM CSV column header names (uppercased — `headers.map(h => h.toUpperCase())`). */
const IEM_CSV_COL_TYPECODE = 'TYPECODE';
const IEM_CSV_COL_TYPETEXT = 'TYPETEXT';
const IEM_CSV_COL_LAT = 'LAT';
const IEM_CSV_COL_LON = 'LON';
const IEM_CSV_COL_VALID = 'VALID';
const IEM_CSV_COL_VALID2 = 'VALID2';
const IEM_CSV_COL_MAG = 'MAG';
const IEM_CSV_COL_STATE = 'STATE';
const IEM_CSV_COL_COUNTY = 'COUNTY';
const IEM_CSV_COL_CITY = 'CITY';
const IEM_CSV_COL_REMARK = 'REMARK';

/** Magnitude unit values stamped onto `StormEvent.magnitude_unit`. */
const MAGNITUDE_UNIT_INCH = 'inch';
const MAGNITUDE_UNIT_MPH = 'mph';

/** Storm-event id prefix for IEM-sourced events. */
const IEM_EVENT_ID_PREFIX = 'iem-';

/** Hundredths divisor for hail-magnitude × 100 normalisation. */
const HAIL_HUNDREDTHS_DIVISOR = 100;

/** Minimum CSV row width below which the row is skipped as malformed. */
const CSV_MIN_VALID_VALUES = 5;

/** Format `Y/M/D` integers into the canonical `YYYY-MM-DD` date string. */
function formatDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** True if the `text` contains any of the knot-indicator substrings. */
function containsKnotsIndicator(text: string): boolean {
  return KNOTS_INDICATORS.some((needle) => text.includes(needle));
}

/**
 * IEM occasionally encodes hail size as inches × 100 (e.g. 100 = 1.00", 175 = 1.75")
 * to avoid decimal handling. Detect that case and divide back down.
 */
function parseHailMagnitude(mag: number): number {
  return mag >= HAIL_HUNDREDTHS_THRESHOLD ? mag / HAIL_HUNDREDTHS_DIVISOR : mag;
}

/** Convert lat/lng + radius (miles) to a bounding box */
function toBoundingBox(lat: number, lng: number, radiusMiles: number): {
  north: number; south: number; east: number; west: number;
} {
  const latDelta = radiusMiles / MILES_PER_DEGREE_LATITUDE;
  // Longitude varies by latitude — at higher latitudes a degree of longitude
  // covers fewer miles, so divide by cos(lat) to widen the search box.
  const lngDelta = radiusMiles / (MILES_PER_DEGREE_LATITUDE * Math.cos(lat * DEG_TO_RAD));

  return {
    north: lat + latDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    west: lng - lngDelta,
  };
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

/** Format a Date as ISO timestamp for IEM API (YYYY-MM-DDTHH:MMZ) */
function formatIEMDate(d: Date): string {
  return d.toISOString().replace(ISO_MS_SUFFIX_RE, 'Z');
}

/** Map IEM TYPECODE + TYPETEXT to our StormEvent type */
function mapIEMEventType(typeCode: string, typeText: string): StormEvent['event_type'] | null {
  const code = (typeCode || '').toUpperCase().trim();
  const text = (typeText || '').toUpperCase().trim();

  // IEM TYPECODE values: H=Hail, G=Tstm Wind Gust, D=Tstm Wind Damage,
  // T=Tornado, N=Non-Tstm Wind, O=Non-Tstm Wind Damage, M=Marine Tstm Wind
  if (code === TYPECODE_HAIL || text.includes(TEXT_KEYWORD_HAIL)) return EVENT_TYPE_HAIL;
  if (code === TYPECODE_TSTM_WIND_GUST || code === TYPECODE_TSTM_WIND_DAMAGE || code === TYPECODE_MARINE_TSTM_WIND || text.includes(TEXT_KEYWORD_TSTM_WND) || text.includes(TEXT_KEYWORD_THUNDERSTORM_WIND)) return EVENT_TYPE_TSTM_WIND;
  if (code === TYPECODE_NON_TSTM_WIND || code === TYPECODE_NON_TSTM_WIND_DAMAGE || text.includes(TEXT_KEYWORD_NON_TSTM_WND) || text.includes(TEXT_KEYWORD_HIGH_WIND)) return EVENT_TYPE_HIGH_WIND;
  if (code === TYPECODE_TORNADO || text.includes(TEXT_KEYWORD_TORNADO)) return EVENT_TYPE_TORNADO;
  if (text.includes(TEXT_KEYWORD_HURRICANE)) return EVENT_TYPE_HURRICANE;
  if (text.includes(TEXT_KEYWORD_TROPICAL)) return EVENT_TYPE_TROPICAL_STORM;

  // Skip non-roofing types (flooding, snow, marine, fog, etc.)
  return null;
}

/**
 * Parse IEM LSR CSV response into StormEvent array.
 *
 * IEM CSV columns (typical):
 * VALID,VALID2,LAT,LON,MAG,WFO,TYPECODE,TYPETEXT,CITY,COUNTY,STATE,SOURCE,REMARK
 */
export function parseIEMCSV(csvText: string, propertyLat: number, propertyLng: number): StormEvent[] {
  // External responses are untrusted: IEM (or a degraded fetch path) can hand
  // back a non-string body — `null`/`undefined` from `response.text()` failures,
  // or a parsed object. Guard before any string method so garbage input yields
  // an empty array instead of throwing `csvText.replace is not a function`.
  if (typeof csvText !== 'string' || csvText.length === 0) return [];

  // Accept CRLF + strip leading BOM. IEM serves LF normally but the
  // gunicorn-fronted endpoint occasionally emits CRLF + a UTF-8 BOM in
  // edge-case responses; the prior split-on-LF left trailing `\r` on
  // every column value, which broke `row['LAT']` lookups silently.
  const normalized = csvText.replace(/^﻿/, '').trim();
  const lines = normalized.split(/\r?\n/);
  if (lines.length < 2) return [];

  // Find header line
  let headerIdx = 0;
  for (let i = 0; i < Math.min(MAX_HEADER_SEARCH_LINES, lines.length); i++) {
    if (HEADER_INDICATOR_RE.test(lines[i]) && lines[i].includes(',')) {
      headerIdx = i;
      break;
    }
  }

  const headers = lines[headerIdx].replace(BOM, '').split(',').map(h => h.trim().toUpperCase());
  const events: StormEvent[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(CSV_COMMENT_PREFIX)) continue;

    // Handle CSV with possible quoted fields
    const values = parseCSVLine(line);
    if (values.length < CSV_MIN_VALID_VALUES) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < values.length; j++) {
      row[headers[j]] = values[j];
    }

    const typeCode = row[IEM_CSV_COL_TYPECODE] || '';
    const typeText = row[IEM_CSV_COL_TYPETEXT] || '';
    const eventType = mapIEMEventType(typeCode, typeText);
    if (!eventType) continue; // Skip non-roofing events

    const eventLat = parseFloat(row[IEM_CSV_COL_LAT] || '0');
    const eventLng = parseFloat(row[IEM_CSV_COL_LON] || '0');
    if (!eventLat || !eventLng) continue;

    // Parse date from VALID field (format varies: "YYYY-MM-DD HH:MM" or "YYYYMMDDHHMI")
    const validStr = row[IEM_CSV_COL_VALID] || row[IEM_CSV_COL_VALID2] || '';
    const dateMatch = validStr.match(VALID_DATE_RE);
    if (!dateMatch) continue;

    const year = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    const day = parseInt(dateMatch[3], 10);
    // Skip rows whose date components look corrupt instead of silently
    // landing them on Jan 1 / month 13 / day 99.
    if (!Number.isFinite(year) || year < MIN_VALID_YEAR) continue;
    if (!Number.isFinite(month) || month < MIN_MONTH || month > MAX_MONTH) continue;
    if (!Number.isFinite(day) || day < MIN_DAY || day > MAX_DAY) continue;

    const dateStr = formatDateString(year, month, day);

    // Parse magnitude (IEM sometimes returns 'None' for events without measured magnitude)
    const rawMag = row[IEM_CSV_COL_MAG] || '0';
    const mag = rawMag === MAG_NONE_SENTINEL ? 0 : parseFloat(rawMag);
    if (isNaN(mag)) continue;
    let hailSizeInches: number | undefined;
    let windSpeedMph: number | undefined;

    if (eventType === EVENT_TYPE_HAIL && mag > 0) {
      const parsed = parseHailMagnitude(mag);
      // Skip absurd values (PLSR/IEM occasionally have transcription
      // typos like "120 IN" → 1.2 — but also "1200 IN" → 12 which is
      // physically impossible; cap protects the headline number).
      if (parsed > 0 && parsed <= MAX_HAIL_INCHES_REASONABLE) {
        hailSizeInches = parsed;
      }
    } else if ((eventType === EVENT_TYPE_TSTM_WIND || eventType === EVENT_TYPE_HIGH_WIND) && mag > 0) {
      // IEM reports wind in mph (sometimes knots, check typetext)
      const rawTypeText = (row[IEM_CSV_COL_TYPETEXT] || '').toUpperCase();
      windSpeedMph = containsKnotsIndicator(rawTypeText)
        ? Math.round(mag * KNOTS_TO_MPH)
        : Math.round(mag);
    }

    const distance = haversineDistance(propertyLat, propertyLng, eventLat, eventLng);
    const remark = row[IEM_CSV_COL_REMARK] || '';

    events.push({
      id: `${IEM_EVENT_ID_PREFIX}${dateStr}-${i}`,
      event_type: eventType,
      date: dateStr,
      year,
      month,
      day,
      state: row[IEM_CSV_COL_STATE] || '',
      county: row[IEM_CSV_COL_COUNTY] || '',
      city: row[IEM_CSV_COL_CITY] || undefined,
      latitude: eventLat,
      longitude: eventLng,
      distance_miles: distance,
      magnitude: hailSizeInches || windSpeedMph,
      magnitude_unit: hailSizeInches ? MAGNITUDE_UNIT_INCH : MAGNITUDE_UNIT_MPH,
      hail_size_inches: hailSizeInches,
      wind_speed_mph: windSpeedMph,
      source: SOURCE_NOAA,
      data_source: SOURCE_NAME,
      event_narrative: remark || undefined,
    });
  }

  return events;
}

/** Simple CSV line parser that handles quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Fetch Local Storm Reports from Iowa Environmental Mesonet.
 * Returns events and a source detail for monitoring.
 */
export async function fetchIEMLSREvents(
  lat: number,
  lng: number,
  startDate: Date,
  endDate: Date,
  radiusMiles: number,
  signal?: AbortSignal,
): Promise<{ events: StormEvent[]; sourceDetail: DataSourceDetail }> {
  const overallStart = Date.now();
  const bbox = toBoundingBox(lat, lng, radiusMiles);

  const sts = formatIEMDate(startDate);
  const ets = formatIEMDate(endDate);

  // URLSearchParams keeps the query string readable and properly encodes
  // any future parameter that contains `&` or spaces.
  const params = new URLSearchParams({
    fmt: IEM_FORMAT_CSV,
    sts,
    ets,
    north: bbox.north.toFixed(BBOX_DECIMALS),
    south: bbox.south.toFixed(BBOX_DECIMALS),
    east: bbox.east.toFixed(BBOX_DECIMALS),
    west: bbox.west.toFixed(BBOX_DECIMALS),
  });
  const url = `${IEM_BASE}?${params.toString()}`;

  console.log(`${LOG_PREFIX} Fetching LSR data for ${lat.toFixed(BBOX_DECIMALS)},${lng.toFixed(BBOX_DECIMALS)} radius=${radiusMiles}mi`);

  try {
    const { response } = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': IEM_USER_AGENT } },
      { ...RETRY_OPTIONS, signal }
    );

    const responseTimeMs = Date.now() - overallStart;

    if (!response.ok) {
      console.warn(`${LOG_PREFIX} LSR API returned ${response.status}`);
      return {
        events: [],
        sourceDetail: {
          name: SOURCE_NAME,
          status: STATUS_FAILED,
          event_count: 0,
          response_time_ms: responseTimeMs,
        },
      };
    }

    const csvText = await response.text();
    const events = parseIEMCSV(csvText, lat, lng);

    // Filter by actual distance (bounding box is an approximation)
    const filteredEvents = events.filter(e => (e.distance_miles || 0) <= radiusMiles);

    // Sort by date descending
    filteredEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    console.log(`${LOG_PREFIX} Got ${filteredEvents.length} events (${events.length} before distance filter) in ${responseTimeMs}ms`);

    return {
      events: filteredEvents,
      sourceDetail: {
        name: SOURCE_NAME,
        status: filteredEvents.length > 0 ? STATUS_SUCCESS : STATUS_EMPTY,
        event_count: filteredEvents.length,
        response_time_ms: responseTimeMs,
      },
    };
  } catch (error) {
    const responseTimeMs = Date.now() - overallStart;
    const message = errorMessage(error);
    console.warn(`${LOG_PREFIX} LSR fetch failed:`, message);
    return {
      events: [],
      sourceDetail: {
        name: SOURCE_NAME,
        status: signal?.aborted || message.includes(TIMEOUT_ERROR_MARKER) ? STATUS_TIMEOUT : STATUS_FAILED,
        event_count: 0,
        response_time_ms: responseTimeMs,
        ...(signal?.aborted && { partial: true }),
      },
    };
  }
}
