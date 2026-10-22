/**
 * Google Solar API roof measurements for proposals.
 *
 * Geocodes the address, calls buildingInsights:findClosest, and returns roof
 * area in squares plus an installed (+waste) figure. The rule: billable
 * squares = measured squares + 15% (waste, starter, hip/ridge, cut-in).
 *
 * Env: GOOGLE_MAPS_API_KEY (Geocoding + Solar API enabled); see google-key.ts.
 */

import { googleMapsKey } from './google-key.js';

const SQM_TO_SQFT = 10.7639;
const WASTE_FACTOR = 0.15;

export interface RoofMeasurements {
  measuredSquares: number;
  billableSquares: number;
  roofAreaSqFt: number;
  averagePitch: string;     // e.g. "9:12"
  segments: number;
  imageryDate: string;      // "Apr 2016"
  wastePct: number;
  latitude: number;
  longitude: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'google-solar-api';
}

/** Plain `fetch()` has no timeout — a hung Google response would hold a rep at the door indefinitely. */
const SOLAR_TIMEOUT_MS = 15000;

function degToPitch(deg: number): string {
  const rise = Math.tan((deg * Math.PI) / 180) * 12;
  return `${Math.round(rise)}:12`;
}

async function geocode(address: string, key: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(SOLAR_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data: any = await res.json();
  const loc = data?.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

/**
 * Fetch roof measurements for an address (or known coordinates). Returns null
 * if the key is missing or Solar has no building data for the location.
 */
export async function fetchRoofMeasurements(
  address: string,
  coords?: { lat: number; lng: number },
): Promise<RoofMeasurements | null> {
  const key = googleMapsKey();
  if (!key) return null;

  let point = coords || null;
  if (!point) {
    if (!address || address.trim().length < 8) return null;
    point = await geocode(address, key);
  }
  if (!point) return null;

  const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest');
  url.searchParams.set('location.latitude', String(point.lat));
  url.searchParams.set('location.longitude', String(point.lng));
  url.searchParams.set('requiredQuality', 'MEDIUM');
  url.searchParams.set('key', key);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(SOLAR_TIMEOUT_MS) });
  if (!res.ok) return null;
  const data: any = await res.json();
  const sp = data?.solarPotential;
  if (!sp?.wholeRoofStats) return null;

  const segs: any[] = sp.roofSegmentStats || [];
  const areaSqFt = sp.wholeRoofStats.areaMeters2 * SQM_TO_SQFT;
  const measuredSquares = Math.round((areaSqFt / 100) * 10) / 10;
  const billableSquares = Math.round(measuredSquares * (1 + WASTE_FACTOR) * 10) / 10;

  const totalArea = segs.reduce((s, x) => s + (x.stats?.areaMeters2 || 0), 0) || 1;
  const avgPitchDeg = segs.reduce((s, x) => s + (x.pitchDegrees || 0) * ((x.stats?.areaMeters2 || 0) / totalArea), 0);

  const d = data.imageryDate;
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const imageryDate = d ? `${months[d.month] || ''} ${d.year}`.trim() : 'Unknown';

  return {
    measuredSquares,
    billableSquares,
    roofAreaSqFt: Math.round(areaSqFt),
    averagePitch: segs.length ? degToPitch(avgPitchDeg) : 'n/a',
    segments: segs.length,
    imageryDate,
    wastePct: Math.round(WASTE_FACTOR * 100),
    latitude: point.lat,
    longitude: point.lng,
    confidence: data.imageryQuality === 'HIGH' ? 'high' : data.imageryQuality === 'LOW' ? 'low' : 'medium',
    source: 'google-solar-api',
  };
}

/** Static-map satellite tile of the property as a data URI (for the hero). */
export async function fetchSatelliteDataUri(lat: number, lng: number): Promise<string | null> {
  const key = googleMapsKey();
  if (!key) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('center', `${lat},${lng}`);
  url.searchParams.set('zoom', '20');
  url.searchParams.set('size', '640x360');
  url.searchParams.set('scale', '2');
  url.searchParams.set('maptype', 'satellite');
  url.searchParams.set('key', key);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(SOLAR_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
