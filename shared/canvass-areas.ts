/**
 * Drawn canvassing areas and roofing lead filters — the pure half, shared by
 * the map (client) and the Tracerfy routes (server).
 *
 * Tracerfy's Lead Builder takes a geography of zips / city / county / state /
 * radius — never a polygon. So a drawn shape becomes the smallest circle that
 * covers it (centroid + circumradius, in miles) for the pull, and every
 * delivered row is then tested against the real shape so the rep sees which
 * homes are inside what they drew. Rows outside are kept (they were paid for)
 * but marked.
 */

export type LatLng = { lat: number; lng: number };

export type AreaShape =
  | { type: 'polygon'; path: LatLng[] }
  | { type: 'rectangle'; north: number; south: number; east: number; west: number }
  | { type: 'circle'; center: LatLng; radiusMeters: number };

export interface AreaFilters {
  /** One of the ROOFING_PRESETS keys, or 'custom'. */
  preset: string;
  propertyType?: 'SFR' | 'MFH' | 'CONDO' | 'ANY';
  yearBuiltMin?: number | null;
  yearBuiltMax?: number | null;
  valueMin?: number | null;
  valueMax?: number | null;
  ownerOccupied?: boolean | null;   // true = owner-occupied only, false = absentee only, null = either
  highEquity?: boolean;
  freeClear?: boolean;
  yearsOwnedMin?: number | null;
  excludeListed?: boolean;          // drop homes currently on the MLS
  /**
   * Tracerfy has no filter key for roof score, and every delivered row is paid
   * for — so nothing is dropped on it. The area view ranks homes by roof
   * score, best first, so the ones under this line sink to the bottom.
   */
  roofScoreMin?: number | null;
}

export const CURRENT_YEAR = new Date().getFullYear();

/** Roofing-specific starting points; every one can be edited before the pull. */
export const ROOFING_PRESETS: Record<string, { label: string; blurb: string; filters: Omit<AreaFilters, 'preset'> }> = {
  aging_roofs: {
    label: 'Aging roofs',
    blurb: 'Owner-occupied single-family homes built 15+ years ago and not on the market — the roof is due or close.',
    filters: { propertyType: 'SFR', yearBuiltMax: CURRENT_YEAR - 15, ownerOccupied: true, excludeListed: true },
  },
  storm_ready: {
    label: 'Storm-hit, can pay',
    blurb: 'Owner-occupied homes 10+ years old with high equity — the ones an insurance claim or a retail roof gets approved on.',
    filters: { propertyType: 'SFR', yearBuiltMax: CURRENT_YEAR - 10, ownerOccupied: true, highEquity: true, excludeListed: true },
  },
  free_clear: {
    label: 'Paid-off homes',
    blurb: 'No mortgage, long tenure — retail replacement and financing-free buyers.',
    filters: { propertyType: 'SFR', freeClear: true, yearsOwnedMin: 7, excludeListed: true },
  },
  landlords: {
    label: 'Landlords & absentee',
    blurb: 'Absentee owners — one call can cover several roofs; commercial-style, no homeowner at the door.',
    filters: { ownerOccupied: false, yearBuiltMax: CURRENT_YEAR - 12 },
  },
  custom: { label: 'Custom', blurb: 'Start from nothing and set each filter yourself.', filters: { propertyType: 'SFR' } },
};

export function filtersForPreset(preset: string): AreaFilters {
  // Own keys only: 'constructor' read Object's constructor off the map and the
  // area was saved with preset 'constructor' and no filters at all.
  const known = Object.hasOwn(ROOFING_PRESETS, preset);
  const p = known ? ROOFING_PRESETS[preset] : ROOFING_PRESETS.custom;
  return { preset: known ? preset : 'custom', ...p.filters };
}

/** Tracerfy `filter_overrides` for a set of filters. Only keys Tracerfy documents. */
export function tracerfyOverrides(f: AreaFilters): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (f.propertyType && f.propertyType !== 'ANY') o.property_type = f.propertyType;
  if (f.yearBuiltMin) o.year_built_min = Math.round(f.yearBuiltMin);
  if (f.yearBuiltMax) o.year_built_max = Math.round(f.yearBuiltMax);
  if (f.valueMin) o.value_min = Math.round(f.valueMin);
  if (f.valueMax) o.value_max = Math.round(f.valueMax);
  if (f.ownerOccupied === true) o.owner_occupied = true;
  if (f.ownerOccupied === false) o.absentee_owner = true;
  if (f.highEquity) o.high_equity = true;
  if (f.freeClear) o.free_clear = true;
  if (f.yearsOwnedMin) o.years_owned_min = Math.round(f.yearsOwnedMin);
  if (f.excludeListed) o.mls_active = false;
  return o;
}

// ---------------------------------------------------------------- geometry --

const R_MILES = 3958.8;
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(s));
}

export function shapePath(shape: AreaShape): LatLng[] {
  if (shape.type === 'polygon') return shape.path;
  if (shape.type === 'rectangle') {
    return [
      { lat: shape.north, lng: shape.west }, { lat: shape.north, lng: shape.east },
      { lat: shape.south, lng: shape.east }, { lat: shape.south, lng: shape.west },
    ];
  }
  return [];
}

export function shapeCenter(shape: AreaShape): LatLng {
  if (shape.type === 'circle') return shape.center;
  const path = shapePath(shape);
  const n = Math.max(path.length, 1);
  return { lat: path.reduce((s, p) => s + p.lat, 0) / n, lng: path.reduce((s, p) => s + p.lng, 0) / n };
}

/** The smallest radius (miles) from the centre that covers the whole shape. Never under a tenth of a mile. */
export function coveringRadiusMiles(shape: AreaShape): number {
  if (shape.type === 'circle') return Math.max(shape.radiusMeters / 1609.344, 0.1);
  const c = shapeCenter(shape);
  const r = Math.max(...shapePath(shape).map((p) => haversineMiles(c, p)), 0);
  return Math.max(Math.round(r * 100) / 100, 0.1);
}

/** Tracerfy geography for a drawn shape. */
export function tracerfyGeography(shape: AreaShape): { mode: 'radius'; latitude: number; longitude: number; radius: number } {
  const c = shapeCenter(shape);
  return { mode: 'radius', latitude: Math.round(c.lat * 1e6) / 1e6, longitude: Math.round(c.lng * 1e6) / 1e6, radius: coveringRadiusMiles(shape) };
}

/** Ray casting, good enough for a neighbourhood-sized polygon. */
export function pointInPolygon(pt: LatLng, path: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const xi = path[i].lng, yi = path[i].lat, xj = path[j].lng, yj = path[j].lat;
    const hit = (yi > pt.lat) !== (yj > pt.lat) && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 0) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function pointInShape(pt: LatLng, shape: AreaShape): boolean {
  if (shape.type === 'circle') return haversineMiles(pt, shape.center) * 1609.344 <= shape.radiusMeters;
  if (shape.type === 'rectangle') return pt.lat <= shape.north && pt.lat >= shape.south && pt.lng <= shape.east && pt.lng >= shape.west;
  return shape.path.length >= 3 && pointInPolygon(pt, shape.path);
}

export function isAreaShape(v: any): v is AreaShape {
  if (!v || typeof v !== 'object') return false;
  const num = (x: any) => typeof x === 'number' && Number.isFinite(x);
  const ll = (p: any) => p && num(p.lat) && num(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  if (v.type === 'polygon') return Array.isArray(v.path) && v.path.length >= 3 && v.path.length <= 500 && v.path.every(ll);
  if (v.type === 'rectangle') return [v.north, v.south, v.east, v.west].every(num) && v.north > v.south && v.east > v.west;
  if (v.type === 'circle') return ll(v.center) && num(v.radiusMeters) && v.radiusMeters > 10 && v.radiusMeters < 50000;
  return false;
}

// ------------------------------------------------------------- credits ----

export const CREDIT_USD = 0.02;
export const CREDITS_PER_LEAD_ROW = 5;     // Lead Builder, per delivered row
export const CREDITS_PER_PROPERTY_LOOKUP = 10;
export const MAX_ROWS_PER_PULL = 500;

export const usd = (credits: number) => `$${(credits * CREDIT_USD).toFixed(2)}`;
