/**
 * NOAA SWDI (Severe Weather Data Inventory) API Service
 * Fetches real historical storm event data from NOAA's REST API.
 *
 * Endpoints used:
 *   - plsr: Preliminary Local Storm Reports (hail, wind, tornado from NWS field offices)
 *   - nx3hail: NEXRAD Level-3 Hail Signatures (radar-detected hail)
 *
 * API docs: https://www.ncdc.noaa.gov/swdiws/
 * No API token required. Max 1-year date range per query.
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

/** Format a Date as YYYYMMDD (GMT) for the SWDI API */
function formatSWDIDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Calculate distance between two coordinates in miles (Haversine) */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Split a multi-year range into 1-year chunks (SWDI max is 1 year per query) */
function splitIntoYearChunks(startDate: Date, endDate: Date): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  let current = new Date(startDate);

  while (current < endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setUTCFullYear(chunkEnd.getUTCFullYear() + 1);
    if (chunkEnd > endDate) {
      chunks.push({ start: new Date(current), end: new Date(endDate) });
    } else {
      chunks.push({ start: new Date(current), end: chunkEnd });
    }
    current = new Date(chunkEnd);
  }

  return chunks;
}

/**
 * Parse a CSV string into an array of row objects.
 * Handles quoted fields and strips header/footer lines from SWDI responses.
 */
function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n').filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  // SWDI sometimes includes a header comment line starting with a non-alpha char
  let headerIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // The header row has column names; skip lines that look like metadata
    if (trimmed.match(/^[A-Z_]/i) && trimmed.includes(',')) {
      headerIdx = i;
      break;
    }
  }

  const headers = lines[headerIdx].split(',').map(h => h.trim().toUpperCase());
  const rows: Record<string, string>[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('--')) continue;

    // Simple CSV split (SWDI doesn't use quoted commas in data fields)
    const values = line.split(',').map(v => v.trim());
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
function classifyPLSREvent(remarks: string): { event_type: StormEvent['event_type']; hail_size_inches?: number; wind_speed_mph?: number } {
  const upper = (remarks || '').toUpperCase();

  // Hail — look for "HAIL" keyword and size patterns
  if (upper.includes('HAIL')) {
    // Try to extract size like "1.00 IN" or "1.75 INCH" or "HAIL...1.00"
    const sizeMatch = upper.match(/([\d.]+)\s*IN/);
    const dotMatch = upper.match(/HAIL[.\s]*([\d.]+)/);
    let size: number | undefined;
    if (sizeMatch) size = parseFloat(sizeMatch[1]);
    else if (dotMatch) size = parseFloat(dotMatch[1]);
    return { event_type: 'Hail', hail_size_inches: size };
  }

  // Tornado
  if (upper.includes('TORNADO') || upper.includes('FUNNEL')) {
    return { event_type: 'Tornado' };
  }

  // Hurricane / Tropical Storm
  if (upper.includes('HURRICANE')) return { event_type: 'Hurricane' };
  if (upper.includes('TROPICAL STORM')) return { event_type: 'Tropical Storm' };

  // Wind — look for "TSTM WND" or "WIND" and speed patterns
  if (upper.includes('WIND') || upper.includes('TSTM WND') || upper.includes('GUST')) {
    const speedMatch = upper.match(/([\d]+)\s*(?:MPH|KT)/);
    let speed: number | undefined;
    if (speedMatch) speed = parseInt(speedMatch[1], 10);
    // Convert knots to mph if needed
    if (upper.includes('KT') && speed) speed = Math.round(speed * 1.151);
    return { event_type: 'Thunderstorm Wind', wind_speed_mph: speed };
  }

  // Default to thunderstorm wind if we can't classify
  return { event_type: 'Thunderstorm Wind' };
}

/**
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
  const path = `/plsr/${start}:${end}?center=${lng.toFixed(4)},${lat.toFixed(4)}&radius=${radiusMiles}`;
  const urls = SWDI_BASES.map(base => `${base}${path}`);

  try {
    const { response } = await fetchWithDomainFallback(
      urls,
      { headers: FETCH_HEADERS },
      RETRY_OPTIONS
    );

    if (!response.ok) {
      console.warn(`SWDI PLSR API returned ${response.status}`);
      return [];
    }

    const csvText = await response.text() as string;
    const rows = parseCSV(csvText);

    return rows.map((row, idx) => {
      const eventLat = parseFloat(row['LAT'] || '0');
      const eventLng = parseFloat(row['LON'] || '0');
      const remarks = row['REMARKS'] || row['EVENT'] || '';
      const mag = parseFloat(row['MAG'] || '0');
      const classification = classifyPLSREvent(remarks);

      // Parse ZTIME: format YYYYMMDDHHMI
      const ztime = row['ZTIME'] || '';
      const year = parseInt(ztime.substring(0, 4), 10) || new Date().getFullYear();
      const month = parseInt(ztime.substring(4, 6), 10) || 1;
      const day = parseInt(ztime.substring(6, 8), 10) || 1;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // If magnitude is present and > 0, use it for hail (in 1/100 inch) or wind (mph)
      if (classification.event_type === 'Hail' && mag > 0 && !classification.hail_size_inches) {
        classification.hail_size_inches = mag >= 10 ? mag / 100 : mag; // Handle 100ths vs inches
      }
      if (classification.event_type === 'Thunderstorm Wind' && mag > 0 && !classification.wind_speed_mph) {
        classification.wind_speed_mph = mag;
      }

      const distance = haversineDistance(lat, lng, eventLat, eventLng);

      return {
        id: `plsr-${ztime}-${idx}`,
        event_type: classification.event_type,
        date: dateStr,
        year,
        month,
        day,
        state: row['STATE'] || '',
        county: row['COUNTY'] || '',
        city: row['CITY'] || undefined,
        latitude: eventLat || undefined,
        longitude: eventLng || undefined,
        distance_miles: distance,
        magnitude: classification.hail_size_inches || classification.wind_speed_mph,
        magnitude_unit: classification.hail_size_inches ? 'inch' : 'mph',
        hail_size_inches: classification.hail_size_inches,
        wind_speed_mph: classification.wind_speed_mph,
        source: 'NOAA' as const,
        data_source: 'NOAA SWDI - Preliminary Local Storm Reports',
        event_narrative: remarks || undefined,
      };
    }).filter(e => e.year > 2000); // Sanity filter
  } catch (error) {
    console.warn('SWDI PLSR fetch failed (all retries/domains exhausted):', error instanceof Error ? error.message : error);
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
  const path = `/nx3hail/${start}:${end}?center=${lng.toFixed(4)},${lat.toFixed(4)}&radius=${radiusMiles}`;
  const urls = SWDI_BASES.map(base => `${base}${path}`);

  try {
    const { response } = await fetchWithDomainFallback(
      urls,
      { headers: FETCH_HEADERS },
      RETRY_OPTIONS
    );

    if (!response.ok) {
      console.warn(`SWDI NX3HAIL API returned ${response.status}`);
      return [];
    }

    const csvText = await response.text() as string;
    const rows = parseCSV(csvText);

    return rows.map((row, idx) => {
      const eventLat = parseFloat(row['LAT'] || '0');
      const eventLng = parseFloat(row['LON'] || '0');

      // ZTIME format: YYYYMMDDHHMI
      const ztime = row['ZTIME'] || '';
      const year = parseInt(ztime.substring(0, 4), 10) || new Date().getFullYear();
      const month = parseInt(ztime.substring(4, 6), 10) || 1;
      const day = parseInt(ztime.substring(6, 8), 10) || 1;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // MAXSIZE is the max estimated hail size in inches
      const maxSize = parseFloat(row['MAXSIZE'] || '0');
      const sevProb = parseFloat(row['SEVPROB'] || '0');
      const distance = haversineDistance(lat, lng, eventLat, eventLng);

      // Only include events with a meaningful hail size (>= 0.5 inches)
      if (maxSize < 0.5) return null;

      return {
        id: `nx3hail-${ztime}-${idx}`,
        event_type: 'Hail' as const,
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
        magnitude_unit: 'inch',
        hail_size_inches: Math.round(maxSize * 100) / 100,
        source: 'NOAA' as const,
        data_source: 'NOAA SWDI - NEXRAD Hail Signatures',
        event_narrative: `Radar-detected hail signature. Max estimated size: ${maxSize.toFixed(2)}". Severe probability: ${sevProb}%.`,
      };
    }).filter(Boolean) as StormEvent[];
  } catch (error) {
    console.warn('SWDI NX3HAIL fetch failed (all retries/domains exhausted):', error instanceof Error ? error.message : error);
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
  const chunks = splitIntoYearChunks(startDate, endDate);

  console.log(`SWDI: Fetching ${chunks.length} year-chunk(s) for ${lat.toFixed(4)},${lng.toFixed(4)} radius=${radiusMiles}mi`);

  // Fetch PLSR and NX3HAIL for each chunk with concurrency limit
  // (10 years = 20 requests; cap at 4 concurrent to avoid NOAA rate limits)
  const tasks = chunks.flatMap(chunk => [
    () => fetchPLSREvents(lat, lng, chunk.start, chunk.end, radiusMiles),
    () => fetchNX3HailEvents(lat, lng, chunk.start, chunk.end, radiusMiles),
  ]);

  const results = await pLimitAll(tasks, MAX_CONCURRENT_SWDI_REQUESTS);

  const events: StormEvent[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.length > 0) {
        events.push(...result.value);
      }
      successCount++;
    } else {
      failCount++;
    }
  }

  const responseTimeMs = Date.now() - overallStart;
  console.log(`SWDI: Got ${events.length} events from ${successCount}/${results.length} successful API calls in ${responseTimeMs}ms`);

  // Deduplicate events that are very close in time and location
  const deduped = deduplicateEvents(events);

  const sortedEvents = deduped.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Determine source status
  let status: DataSourceDetail['status'];
  if (failCount === results.length) {
    status = 'failed';
  } else if (sortedEvents.length === 0) {
    status = 'empty';
  } else {
    status = 'success';
  }

  return {
    events: sortedEvents,
    sourceDetail: {
      name: 'NOAA SWDI (Storm Reports + NEXRAD Hail)',
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
    const latRound = Math.round((event.latitude || 0) * 10) / 10;
    const lngRound = Math.round((event.longitude || 0) * 10) / 10;
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
