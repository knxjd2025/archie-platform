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

const RETRY_OPTIONS = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 6000,
  timeoutMs: 20000,
};

/** Convert lat/lng + radius (miles) to a bounding box */
function toBoundingBox(lat: number, lng: number, radiusMiles: number): {
  north: number; south: number; east: number; west: number;
} {
  // Approximate: 1 degree latitude ≈ 69 miles
  const latDelta = radiusMiles / 69;
  // Longitude varies by latitude
  const lngDelta = radiusMiles / (69 * Math.cos(lat * Math.PI / 180));

  return {
    north: lat + latDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    west: lng - lngDelta,
  };
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

/** Format a Date as ISO timestamp for IEM API (YYYY-MM-DDTHH:MMZ) */
function formatIEMDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Map IEM TYPECODE + TYPETEXT to our StormEvent type */
function mapIEMEventType(typeCode: string, typeText: string): StormEvent['event_type'] | null {
  const code = (typeCode || '').toUpperCase().trim();
  const text = (typeText || '').toUpperCase().trim();

  // IEM TYPECODE values: H=Hail, G=Tstm Wind Gust, D=Tstm Wind Damage,
  // T=Tornado, N=Non-Tstm Wind, O=Non-Tstm Wind Damage, M=Marine Tstm Wind
  if (code === 'H' || text.includes('HAIL')) return 'Hail';
  if (code === 'G' || code === 'D' || code === 'M' || text.includes('TSTM WND') || text.includes('THUNDERSTORM WIND')) return 'Thunderstorm Wind';
  if (code === 'N' || code === 'O' || text.includes('NON-TSTM WND') || text.includes('HIGH WIND')) return 'High Wind';
  if (code === 'T' || text.includes('TORNADO')) return 'Tornado';
  if (text.includes('HURRICANE')) return 'Hurricane';
  if (text.includes('TROPICAL')) return 'Tropical Storm';

  // Skip non-roofing types (flooding, snow, marine, fog, etc.)
  return null;
}

/**
 * Parse IEM LSR CSV response into StormEvent array.
 *
 * IEM CSV columns (typical):
 * VALID,VALID2,LAT,LON,MAG,WFO,TYPECODE,TYPETEXT,CITY,COUNTY,STATE,SOURCE,REMARK
 */
function parseIEMCSV(csvText: string, propertyLat: number, propertyLng: number): StormEvent[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  // Find header line
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].toUpperCase().includes('VALID') && lines[i].includes(',')) {
      headerIdx = i;
      break;
    }
  }

  const headers = lines[headerIdx].split(',').map(h => h.trim().toUpperCase());
  const events: StormEvent[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // Handle CSV with possible quoted fields
    const values = parseCSVLine(line);
    if (values.length < 5) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < values.length; j++) {
      row[headers[j]] = values[j];
    }

    const typeCode = row['TYPECODE'] || '';
    const typeText = row['TYPETEXT'] || '';
    const eventType = mapIEMEventType(typeCode, typeText);
    if (!eventType) continue; // Skip non-roofing events

    const eventLat = parseFloat(row['LAT'] || '0');
    const eventLng = parseFloat(row['LON'] || '0');
    if (!eventLat || !eventLng) continue;

    // Parse date from VALID field (format varies: "YYYY-MM-DD HH:MM" or "YYYYMMDDHHMI")
    const validStr = row['VALID'] || row['VALID2'] || '';
    const dateMatch = validStr.match(/(\d{4})-?(\d{2})-?(\d{2})/);
    if (!dateMatch) continue;

    const year = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    const day = parseInt(dateMatch[3], 10);
    if (year < 2000) continue;

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Parse magnitude (IEM sometimes returns 'None' for events without measured magnitude)
    const rawMag = row['MAG'] || '0';
    const mag = rawMag === 'None' ? 0 : parseFloat(rawMag);
    if (isNaN(mag)) continue;
    let hailSizeInches: number | undefined;
    let windSpeedMph: number | undefined;

    if (eventType === 'Hail' && mag > 0) {
      // IEM reports hail in inches
      hailSizeInches = mag >= 10 ? mag / 100 : mag;
    } else if ((eventType === 'Thunderstorm Wind' || eventType === 'High Wind') && mag > 0) {
      // IEM reports wind in mph (sometimes knots, check typetext)
      const rawTypeText = (row['TYPETEXT'] || '').toUpperCase();
      if (rawTypeText.includes('KT') || rawTypeText.includes('KNOT')) {
        windSpeedMph = Math.round(mag * 1.151);
      } else {
        windSpeedMph = Math.round(mag);
      }
    }

    const distance = haversineDistance(propertyLat, propertyLng, eventLat, eventLng);
    const remark = row['REMARK'] || '';

    events.push({
      id: `iem-${dateStr}-${i}`,
      event_type: eventType,
      date: dateStr,
      year,
      month,
      day,
      state: row['STATE'] || '',
      county: row['COUNTY'] || '',
      city: row['CITY'] || undefined,
      latitude: eventLat,
      longitude: eventLng,
      distance_miles: distance,
      magnitude: hailSizeInches || windSpeedMph,
      magnitude_unit: hailSizeInches ? 'inch' : 'mph',
      hail_size_inches: hailSizeInches,
      wind_speed_mph: windSpeedMph,
      source: 'NOAA' as const,
      data_source: 'Iowa Environmental Mesonet (IEM) - Local Storm Reports',
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
  radiusMiles: number
): Promise<{ events: StormEvent[]; sourceDetail: DataSourceDetail }> {
  const overallStart = Date.now();
  const bbox = toBoundingBox(lat, lng, radiusMiles);

  const sts = formatIEMDate(startDate);
  const ets = formatIEMDate(endDate);

  const url = `${IEM_BASE}?fmt=csv&sts=${sts}&ets=${ets}&north=${bbox.north.toFixed(4)}&south=${bbox.south.toFixed(4)}&east=${bbox.east.toFixed(4)}&west=${bbox.west.toFixed(4)}`;

  console.log(`IEM: Fetching LSR data for ${lat.toFixed(4)},${lng.toFixed(4)} radius=${radiusMiles}mi`);

  try {
    const { response } = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': 'RoofReportAI/2.0' } },
      RETRY_OPTIONS
    );

    const responseTimeMs = Date.now() - overallStart;

    if (!response.ok) {
      console.warn(`IEM LSR API returned ${response.status}`);
      return {
        events: [],
        sourceDetail: {
          name: 'Iowa Environmental Mesonet (IEM) - Local Storm Reports',
          status: 'failed',
          event_count: 0,
          response_time_ms: responseTimeMs,
        },
      };
    }

    const csvText = await response.text() as string;
    const events = parseIEMCSV(csvText, lat, lng);

    // Filter by actual distance (bounding box is an approximation)
    const filteredEvents = events.filter(e => (e.distance_miles || 0) <= radiusMiles);

    // Sort by date descending
    filteredEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    console.log(`IEM: Got ${filteredEvents.length} events (${events.length} before distance filter) in ${responseTimeMs}ms`);

    return {
      events: filteredEvents,
      sourceDetail: {
        name: 'Iowa Environmental Mesonet (IEM) - Local Storm Reports',
        status: filteredEvents.length > 0 ? 'success' : 'empty',
        event_count: filteredEvents.length,
        response_time_ms: responseTimeMs,
      },
    };
  } catch (error) {
    const responseTimeMs = Date.now() - overallStart;
    console.warn('IEM LSR fetch failed:', error instanceof Error ? error.message : error);
    return {
      events: [],
      sourceDetail: {
        name: 'Iowa Environmental Mesonet (IEM) - Local Storm Reports',
        status: error instanceof Error && error.message.includes('timeout') ? 'timeout' : 'failed',
        event_count: 0,
        response_time_ms: responseTimeMs,
      },
    };
  }
}
