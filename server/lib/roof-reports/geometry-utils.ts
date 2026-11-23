/**
 * Geometry utilities for roof measurement calculations
 * Uses Google Maps spherical geometry when available, Turf.js as accurate fallback
 */

import { polygon as turfPolygon, lineString as turfLineString, point as turfPoint } from '@turf/helpers';
import turfArea from '@turf/area';
import turfLength from '@turf/length';
import turfSimplify from '@turf/simplify';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

// Type definitions for Google Maps geometry functions
declare global {
  interface Window {
    google?: {
      maps: {
        LatLng: new (lat: number, lng: number) => google.maps.LatLng;
        geometry: {
          spherical: {
            computeArea: (path: google.maps.LatLng[]) => number;
            computeDistanceBetween: (from: google.maps.LatLng, to: google.maps.LatLng) => number;
          };
        };
      };
    };
  }
}

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export interface RoofSegment {
  id: string;
  vertices: LatLngLiteral[];
  areaSqFt: number;
  source: 'solar-api' | 'user-drawn' | 'auto-outline' | 'auto-facet' | 'ai-vision';
  pitchRatio?: string;
  pitch?: string;           // e.g. "6:12" — per-segment pitch override
  adjustedAreaSqFt?: number; // pitch-adjusted 3D area
  azimuth?: string;
  azimuthDegrees?: number;
  label?: string;
  color?: string;            // for auto-facet visual differentiation
}

export type EdgeType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'drip-edge' | 'flashing' | 'other';

export interface RoofEdge {
  id: string;
  vertices: LatLngLiteral[];
  lengthFt: number;
  edgeType: EdgeType;
  source: 'user-drawn' | 'auto-detected';
}

export type MarkerType = 'vent' | 'skylight' | 'chimney' | 'pipe-boot' | 'satellite-dish' | 'hvac' | 'custom';

export interface RoofMarker {
  id: string;
  position: LatLngLiteral;
  markerType: MarkerType;
  label?: string;
  source: 'user-drawn';
}

export interface DistanceMeasurement {
  id: string;
  from: LatLngLiteral;
  to: LatLngLiteral;
  distanceFt: number;
}

export interface RoofEdgeLengthsSummary {
  ridgeLengthFt: number;
  hipLengthFt: number;
  valleyLengthFt: number;
  eaveLengthFt: number;
  rakeLengthFt: number;
  dripEdgeLengthFt: number;
  flashingLengthFt: number;
  otherLengthFt: number;
}

// Edge lengths calculated from satellite data (no "other" field)
export interface RoofEdgeLengths {
  ridgeLengthFt: number;
  hipLengthFt: number;
  valleyLengthFt: number;
  eaveLengthFt: number;
  rakeLengthFt: number;
  dripEdgeLengthFt: number;
  flashingLengthFt: number;
}

export interface RoofMeasurements {
  totalSquareFeet: number;
  totalSquares: number;
  segments: RoofSegment[];
  dataSource: 'google-solar-api' | 'manual' | 'hybrid';
  center: LatLngLiteral;
}

// ─── Logging ─────────────────────────────────────────────────────────
/** Console-warn message when `window.google.maps.geometry` is unavailable
 *  (Maps SDK didn't load) — falls back to the Turf.js calculation path. */
const MSG_GOOGLE_GEOMETRY_MISSING = 'Google Maps geometry library not loaded';

// ─── Unit-conversion constants ─────────────────────────────────────────
/** International conversion factor — one square meter = 10.7639 sq ft. */
const SQ_M_TO_SQ_FT = 10.7639;
/** Square feet per "roofing square" — industry-standard 100 sqft block. */
const SQ_FT_PER_ROOFING_SQUARE = 100;
/** Decimal precision used when displaying squares to the user (1 decimal). */
const SQUARES_DECIMAL_MULTIPLIER = 10;

/**
 * Convert square meters to square feet
 */
export function sqMetersToSqFeet(sqMeters: number): number {
  return sqMeters * SQ_M_TO_SQ_FT;
}

/**
 * Convert square feet to roofing squares (1 square = 100 sq ft)
 */
export function sqFeetToSquares(sqFeet: number): number {
  return Math.round(sqFeet / SQ_FT_PER_ROOFING_SQUARE * SQUARES_DECIMAL_MULTIPLIER) / SQUARES_DECIMAL_MULTIPLIER;
}

// =============================================
// Pitch-Adjusted Area Calculations
// =============================================

/**
 * Common roof pitches from 1:12 to 24:12
 */
export const COMMON_PITCHES = [
  '1:12', '2:12', '3:12', '4:12', '5:12', '6:12',
  '7:12', '8:12', '9:12', '10:12', '11:12', '12:12',
  '14:12', '16:12', '18:12', '21:12', '24:12',
];

// ─── Pitch parsing constants ──────────────────────────────────────────
/** Separator in pitch strings (`'6:12'` → rise:run). */
const PITCH_SEPARATOR = ':';
/** Standard run for pitch normalisation — `:12` is the universal roofing convention. */
const PITCH_RUN_BASE = 12;

/**
 * Parse a pitch string (e.g. "6:12") to the numeric rise value
 */
export function parsePitch(pitch: string): number {
  if (!pitch) return 0;
  const parts = pitch.split(PITCH_SEPARATOR);
  if (parts.length !== 2) return 0;
  const rise = parseFloat(parts[0]);
  const run = parseFloat(parts[1]);
  if (isNaN(rise) || isNaN(run) || run === 0) return 0;
  const normalized = rise / run * PITCH_RUN_BASE; // Normalize to :12 basis
  return normalized < 0 ? 0 : normalized;
}

/**
 * Calculate the pitch multiplier for converting flat/footprint area to true 3D roof area.
 * Formula: 1 / cos(atan(rise / 12))
 * e.g. 6:12 → 1.118, 12:12 → 1.414 (45° = sqrt(2))
 */
export function pitchFactor(pitch: string): number {
  const rise = parsePitch(pitch);
  if (rise <= 0) return 1;
  return 1 / Math.cos(Math.atan(rise / PITCH_RUN_BASE));
}

/**
 * Adjust a flat/footprint area to true 3D roof area using pitch
 */
export function adjustAreaForPitch(areaSqFt: number, pitch: string): number {
  return areaSqFt * pitchFactor(pitch);
}

// ─── Pitch-color tier table ───────────────────────────────────────────
/** Upper bound of each pitch tier for color-coding (rise component, :12 basis). */
const PITCH_LOW_MAX = 4;
const PITCH_MED_MAX = 8;
const PITCH_STEEP_MAX = 12;

interface PitchColorTier {
  maxRise: number; // max rise (inclusive); Infinity for the catch-all
  fill: string;
  stroke: string;
  label: string;
}

/** Pitch-tier color palette. Hoisted from `getPitchColor` so the 4-row
 *  table isn't reallocated on every call and so a future palette change
 *  (e.g. WCAG-AA contrast updates) is one edit. */
const PITCH_COLOR_TIERS: ReadonlyArray<PitchColorTier> = [
  { maxRise: PITCH_LOW_MAX,   fill: 'rgba(59, 130, 246, 0.2)', stroke: '#3b82f6', label: 'Low' },
  { maxRise: PITCH_MED_MAX,   fill: 'rgba(34, 197, 94, 0.2)',  stroke: '#22c55e', label: 'Medium' },
  { maxRise: PITCH_STEEP_MAX, fill: 'rgba(249, 115, 22, 0.2)', stroke: '#f97316', label: 'Steep' },
  { maxRise: Infinity,        fill: 'rgba(168, 85, 247, 0.2)', stroke: '#a855f7', label: 'Very Steep' },
];

/**
 * Get a pitch-based color for visual coding of roof segments.
 * Low pitch = blue, medium = green, steep = orange, very steep = purple.
 */
export function getPitchColor(pitch: string): { fill: string; stroke: string; label: string } {
  const rise = parsePitch(pitch);
  // First tier whose `maxRise` is ≥ rise wins (table is sorted ascending).
  const tier = PITCH_COLOR_TIERS.find(t => rise <= t.maxRise) ?? PITCH_COLOR_TIERS[PITCH_COLOR_TIERS.length - 1];
  return { fill: tier.fill, stroke: tier.stroke, label: tier.label };
}

/**
 * Calculate polygon area using Google Maps geometry library
 * Returns area in square feet
 *
 * @param vertices Array of lat/lng coordinates forming the polygon
 * @returns Area in square feet, or 0 if calculation fails
 */
export function calculatePolygonArea(vertices: LatLngLiteral[]): number {
  if (!vertices || vertices.length < 3) {
    return 0;
  }

  // Check if Google Maps API is loaded
  if (!window.google?.maps?.geometry?.spherical) {
    console.warn(MSG_GOOGLE_GEOMETRY_MISSING);
    return calculatePolygonAreaFallback(vertices);
  }

  try {
    const path = vertices.map(v => new window.google!.maps.LatLng(v.lat, v.lng));
    const sqMeters = window.google.maps.geometry.spherical.computeArea(path);
    return sqMetersToSqFeet(sqMeters);
  } catch (error) {
    console.error('Error calculating polygon area:', error);
    return calculatePolygonAreaFallback(vertices);
  }
}

/**
 * Fallback area calculation using Turf.js geodesic area
 * Accurate anywhere on Earth without Google Maps dependency
 */
function calculatePolygonAreaFallback(vertices: LatLngLiteral[]): number {
  if (vertices.length < 3) return 0;

  try {
    // Turf expects [lng, lat] and closed rings
    const coords = vertices.map(v => [v.lng, v.lat]);
    coords.push(coords[0]); // close the ring
    const poly = turfPolygon([coords]);
    const sqMeters = turfArea(poly);
    return sqMetersToSqFeet(sqMeters);
  } catch {
    return 0;
  }
}

/**
 * Calculate polygon perimeter using Google Maps geometry library
 * Returns perimeter in linear feet
 *
 * @param vertices Array of lat/lng coordinates forming the polygon
 * @returns Perimeter in feet
 */
export function calculatePolygonPerimeter(vertices: LatLngLiteral[]): number {
  if (!vertices || vertices.length < 2) {
    return 0;
  }

  // Check if Google Maps API is loaded
  if (!window.google?.maps?.geometry?.spherical) {
    console.warn('Google Maps geometry library not loaded');
    return calculatePerimeterFallback(vertices);
  }

  try {
    let totalMeters = 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
      const p1 = new window.google!.maps.LatLng(vertices[i].lat, vertices[i].lng);
      const p2 = new window.google!.maps.LatLng(vertices[(i + 1) % n].lat, vertices[(i + 1) % n].lng);
      totalMeters += window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
    }

    // Convert meters to feet
    return totalMeters * 3.28084;
  } catch (error) {
    console.error('Error calculating perimeter:', error);
    return calculatePerimeterFallback(vertices);
  }
}

/**
 * Fallback perimeter calculation using Turf.js geodesic length
 */
function calculatePerimeterFallback(vertices: LatLngLiteral[]): number {
  if (vertices.length < 2) return 0;

  try {
    // Close the ring for perimeter
    const coords = vertices.map(v => [v.lng, v.lat]);
    coords.push(coords[0]);
    const line = turfLineString(coords);
    const km = turfLength(line, { units: 'kilometers' });
    return km * 3280.84; // km to feet
  } catch {
    // Ultimate fallback to haversine
    let total = 0;
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const p1 = vertices[i];
      const p2 = vertices[(i + 1) % n];
      total += haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    }
    return total;
  }
}

/**
 * Calculate distance between two points using Haversine formula
 * @returns Distance in feet
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * Math.PI / 180;
}

/**
 * Convert a rectangle (bounding box) to polygon vertices
 * Useful for Solar API segment display
 */
export function boundingBoxToVertices(
  sw: LatLngLiteral,
  ne: LatLngLiteral
): LatLngLiteral[] {
  return [
    { lat: sw.lat, lng: sw.lng }, // SW
    { lat: sw.lat, lng: ne.lng }, // SE
    { lat: ne.lat, lng: ne.lng }, // NE
    { lat: ne.lat, lng: sw.lng }, // NW
  ];
}

/**
 * Calculate the center point of a polygon
 */
export function calculatePolygonCenter(vertices: LatLngLiteral[]): LatLngLiteral {
  if (!vertices || vertices.length === 0) {
    return { lat: 0, lng: 0 };
  }

  const sum = vertices.reduce(
    (acc, v) => ({ lat: acc.lat + v.lat, lng: acc.lng + v.lng }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: sum.lat / vertices.length,
    lng: sum.lng / vertices.length
  };
}

/**
 * Format area as a human-readable string
 */
export function formatArea(sqFeet: number): string {
  if (!isFinite(sqFeet) || sqFeet < 0) return '0 sq ft';
  return `${Math.round(sqFeet).toLocaleString()} sq ft`;
}

/**
 * Format as roofing squares
 */
export function formatSquares(sqFeet: number): string {
  const squares = sqFeetToSquares(sqFeet);
  return `${squares} squares`;
}

/**
 * Check if a point is inside a polygon
 * Uses Turf.js boolean-point-in-polygon for accuracy
 */
export function isPointInPolygon(point: LatLngLiteral, polygon: LatLngLiteral[]): boolean {
  if (polygon.length < 3) return false;

  try {
    const pt = turfPoint([point.lng, point.lat]);
    const coords = polygon.map(v => [v.lng, v.lat]);
    coords.push(coords[0]); // close the ring
    const poly = turfPolygon([coords]);
    return booleanPointInPolygon(pt, poly);
  } catch {
    // Fallback to ray casting
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;
      if (((yi > point.lat) !== (yj > point.lat)) &&
          (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
}

/**
 * Generate a unique ID for a segment.
 * Prefers crypto.randomUUID for guaranteed uniqueness; falls back to
 * Date.now() + random suffix in environments without Web Crypto.
 */
export function generateSegmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `segment-${crypto.randomUUID()}`;
  }
  // .substr is deprecated; .slice(2, 11) yields the same 9-char window.
  return `segment-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Calculate distance between two points in feet
 * Uses Google Maps spherical geometry when available
 */
export function calculateDistance(p1: LatLngLiteral, p2: LatLngLiteral): number {
  if (window.google?.maps?.geometry?.spherical) {
    try {
      const a = new window.google.maps.LatLng(p1.lat, p1.lng);
      const b = new window.google.maps.LatLng(p2.lat, p2.lng);
      const meters = window.google.maps.geometry.spherical.computeDistanceBetween(a, b);
      return meters * 3.28084;
    } catch {
      // fall through to haversine
    }
  }
  return haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
}

/**
 * Calculate total length of a polyline (multi-segment edge) in feet
 */
export function calculatePolylineLength(vertices: LatLngLiteral[]): number {
  if (!vertices || vertices.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    total += calculateDistance(vertices[i], vertices[i + 1]);
  }
  return total;
}

/**
 * Format distance as a readable string
 */
export function formatDistance(feet: number): string {
  if (feet < 1) return '0 ft';
  if (feet < 100) return `${feet.toFixed(1)} ft`;
  return `${Math.round(feet).toLocaleString()} ft`;
}

/**
 * Calculate midpoint of a line segment (for label placement)
 */
export function calculateMidpoint(p1: LatLngLiteral, p2: LatLngLiteral): LatLngLiteral {
  return {
    lat: (p1.lat + p2.lat) / 2,
    lng: (p1.lng + p2.lng) / 2,
  };
}

/**
 * Find the nearest existing vertex within a snap threshold
 * Returns the snapped position or null if none within threshold
 */
export function findSnapVertex(
  clickPos: LatLngLiteral,
  existingVertices: LatLngLiteral[],
  thresholdFt: number = 2
): LatLngLiteral | null {
  let nearest: LatLngLiteral | null = null;
  let minDist = Infinity;

  for (const v of existingVertices) {
    const dist = calculateDistance(clickPos, v);
    if (dist < thresholdFt && dist < minDist) {
      minDist = dist;
      nearest = v;
    }
  }

  return nearest;
}

/**
 * Collect all vertices from segments and edges for snap targeting
 */
export function collectAllVertices(
  segments: RoofSegment[],
  edges: RoofEdge[]
): LatLngLiteral[] {
  const vertices: LatLngLiteral[] = [];
  for (const s of segments) {
    vertices.push(...s.vertices);
  }
  for (const e of edges) {
    vertices.push(...e.vertices);
  }
  return vertices;
}

/**
 * Simplify a path using Turf.js (Douglas-Peucker under the hood)
 * For freehand tool - reduces point count while preserving shape
 */
export function simplifyPath(
  vertices: LatLngLiteral[],
  toleranceFt: number = 1
): LatLngLiteral[] {
  if (vertices.length <= 2) return vertices;

  try {
    // Convert tolerance from feet to approximate degrees (~0.000003 degrees per foot at mid-latitudes)
    const toleranceDeg = toleranceFt * 0.000003;
    const coords = vertices.map(v => [v.lng, v.lat] as [number, number]);
    const line = turfLineString(coords);
    const simplified = turfSimplify(line, { tolerance: toleranceDeg, highQuality: true });
    const result = simplified.geometry.coordinates.map(
      (c: number[]) => ({ lat: c[1], lng: c[0] }) as LatLngLiteral
    );
    return result.length >= 2 ? result : vertices;
  } catch {
    // Fallback to manual Douglas-Peucker
    return simplifyPathFallback(vertices, toleranceFt);
  }
}

/**
 * Manual Douglas-Peucker simplification as fallback
 */
function simplifyPathFallback(
  vertices: LatLngLiteral[],
  toleranceFt: number
): LatLngLiteral[] {
  if (vertices.length <= 2) return vertices;

  let maxDist = 0;
  let maxIndex = 0;
  const first = vertices[0];
  const last = vertices[vertices.length - 1];

  for (let i = 1; i < vertices.length - 1; i++) {
    const dist = perpendicularDistance(vertices[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > toleranceFt) {
    const left = simplifyPathFallback(vertices.slice(0, maxIndex + 1), toleranceFt);
    const right = simplifyPathFallback(vertices.slice(maxIndex), toleranceFt);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/**
 * Perpendicular distance from a point to a line segment (in feet)
 */
export function perpendicularDistance(
  point: LatLngLiteral,
  lineStart: LatLngLiteral,
  lineEnd: LatLngLiteral
): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const lineLenSq = dx * dx + dy * dy;

  if (lineLenSq === 0) return calculateDistance(point, lineStart);

  let t = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / lineLenSq;
  t = Math.max(0, Math.min(1, t));

  const proj: LatLngLiteral = {
    lat: lineStart.lat + t * dy,
    lng: lineStart.lng + t * dx,
  };

  return calculateDistance(point, proj);
}

/**
 * Generate edge length summary from drawn edges, grouped by type
 */
export function summarizeEdgeLengths(edges: RoofEdge[]): RoofEdgeLengthsSummary {
  const summary: RoofEdgeLengthsSummary = {
    ridgeLengthFt: 0,
    hipLengthFt: 0,
    valleyLengthFt: 0,
    eaveLengthFt: 0,
    rakeLengthFt: 0,
    dripEdgeLengthFt: 0,
    flashingLengthFt: 0,
    otherLengthFt: 0,
  };

  for (const edge of edges) {
    switch (edge.edgeType) {
      case 'ridge': summary.ridgeLengthFt += edge.lengthFt; break;
      case 'hip': summary.hipLengthFt += edge.lengthFt; break;
      case 'valley': summary.valleyLengthFt += edge.lengthFt; break;
      case 'eave': summary.eaveLengthFt += edge.lengthFt; break;
      case 'rake': summary.rakeLengthFt += edge.lengthFt; break;
      case 'drip-edge': summary.dripEdgeLengthFt += edge.lengthFt; break;
      case 'flashing': summary.flashingLengthFt += edge.lengthFt; break;
      default: summary.otherLengthFt += edge.lengthFt; break;
    }
  }

  return summary;
}

/**
 * Find the nearest polygon edge to a point within a distance threshold.
 * Returns the edge index and distance, or null if none within threshold.
 */
export function findNearestEdge(
  point: LatLngLiteral,
  vertices: LatLngLiteral[],
  thresholdFt: number = 3
): { edgeIndex: number; distance: number } | null {
  if (vertices.length < 2) return null;
  let nearest: { edgeIndex: number; distance: number } | null = null;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dist = perpendicularDistance(point, vertices[i], vertices[j]);
    if (dist < thresholdFt && (!nearest || dist < nearest.distance)) {
      nearest = { edgeIndex: i, distance: dist };
    }
  }
  return nearest;
}

/**
 * Snap a coordinate to the nearest angle increment from a reference point.
 * Works in coordinate space (fine at zoom 20 for single-roof scale).
 * Returns [lng, lat] position snapped to the nearest angle.
 */
export function snapToAngle(
  fromCoord: [number, number],  // [lng, lat]
  toCoord: [number, number],    // [lng, lat]
  angleIncrementDeg: number     // e.g., 90 or 45
): [number, number] {
  const dx = toCoord[0] - fromCoord[0];
  const dy = toCoord[1] - fromCoord[1];
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const snappedAngle = Math.round(angle / angleIncrementDeg) * angleIncrementDeg;
  const snappedRad = snappedAngle * (Math.PI / 180);
  const dist = Math.sqrt(dx * dx + dy * dy);
  return [
    fromCoord[0] + dist * Math.cos(snappedRad),
    fromCoord[1] + dist * Math.sin(snappedRad),
  ];
}

/**
 * Calculate bearing (in degrees 0-360) from one point to another.
 * Uses spherical math for accuracy.
 */
export function calculateBearing(from: LatLngLiteral, to: LatLngLiteral): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = Math.atan2(y, x) * (180 / Math.PI);
  return (bearing + 360) % 360;
}

/**
 * Calculate a destination point given a start, distance, and bearing.
 * @param origin Start point
 * @param distanceMeters Distance in meters
 * @param bearingDeg Bearing in degrees (0 = north, 90 = east)
 * @returns Destination lat/lng
 */
export function destinationPoint(
  origin: LatLngLiteral,
  distanceMeters: number,
  bearingDeg: number
): LatLngLiteral {
  const R = 6371000; // Earth radius in meters
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const brng = toRad(bearingDeg);
  const d = distanceMeters / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * (180 / Math.PI),
    lng: lng2 * (180 / Math.PI),
  };
}

/**
 * Resize a polygon edge to a new length, keeping the midpoint and direction fixed.
 * Returns new positions for both vertices of the edge.
 */
export function resizeEdge(
  vertexA: LatLngLiteral,
  vertexB: LatLngLiteral,
  newLengthFt: number
): { newA: LatLngLiteral; newB: LatLngLiteral } {
  const midpoint = calculateMidpoint(vertexA, vertexB);
  const bearingAtoB = calculateBearing(vertexA, vertexB);
  const bearingBtoA = (bearingAtoB + 180) % 360;
  const halfLengthMeters = (newLengthFt / 3.28084) / 2;

  const newB = destinationPoint(midpoint, halfLengthMeters, bearingAtoB);
  const newA = destinationPoint(midpoint, halfLengthMeters, bearingBtoA);
  return { newA, newB };
}

// =============================================
// Shared Edge Detection helpers
// =============================================

/**
 * Find edges shared between two polygon segments within a distance tolerance.
 * Returns arrays of vertex pairs that form shared edges.
 */
export function findSharedEdges(
  seg1: RoofSegment,
  seg2: RoofSegment,
  toleranceFt: number = 3
): { v1: LatLngLiteral; v2: LatLngLiteral }[] {
  const shared: { v1: LatLngLiteral; v2: LatLngLiteral }[] = [];
  const n1 = seg1.vertices.length;
  const n2 = seg2.vertices.length;

  for (let i = 0; i < n1; i++) {
    const a1 = seg1.vertices[i];
    const a2 = seg1.vertices[(i + 1) % n1];
    for (let j = 0; j < n2; j++) {
      const b1 = seg2.vertices[j];
      const b2 = seg2.vertices[(j + 1) % n2];
      // Check if edge endpoints match (either direction)
      const d11 = calculateDistance(a1, b1);
      const d22 = calculateDistance(a2, b2);
      const d12 = calculateDistance(a1, b2);
      const d21 = calculateDistance(a2, b1);
      if ((d11 < toleranceFt && d22 < toleranceFt) ||
          (d12 < toleranceFt && d21 < toleranceFt)) {
        shared.push({ v1: a1, v2: a2 });
      }
    }
  }
  return shared;
}

/**
 * Estimate the dominant axis of a polygon (the likely ridge direction).
 * Uses the minimum-width bounding rectangle approach:
 * finds the edge direction that, when used as the principal axis, minimises
 * the polygon's width — for most residential buildings this aligns with the
 * long side of the house and therefore the ridge line above it.
 *
 * Returns the angle in degrees (0-180) of the estimated ridge.
 */
export function estimateDominantAxis(polygon: LatLngLiteral[]): number {
  if (polygon.length < 3) return 0;

  const center = polygon.reduce(
    (acc, v) => ({ lat: acc.lat + v.lat, lng: acc.lng + v.lng }),
    { lat: 0, lng: 0 }
  );
  center.lat /= polygon.length;
  center.lng /= polygon.length;
  const cosLat = Math.cos(center.lat * Math.PI / 180);

  // Convert to local planar coords (x = east, y = north) in approximate feet
  const pts = polygon.map(v => ({
    x: (v.lng - center.lng) * cosLat * 364567, // deg to feet approx
    y: (v.lat - center.lat) * 364567,
  }));

  // Candidate angles: every edge direction in the polygon
  const candidateAngles: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    if (dx === 0 && dy === 0) continue;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    // Normalise to 0-180
    angle = ((angle % 180) + 180) % 180;
    candidateAngles.push(angle);
  }

  if (candidateAngles.length === 0) return 0;

  // For each candidate angle, compute the bounding-box width perpendicular to that direction.
  // The angle that gives the smallest perpendicular width is the dominant axis.
  let bestAngle = 0;
  let bestWidth = Infinity;

  for (const angleDeg of candidateAngles) {
    const rad = angleDeg * Math.PI / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    // Project all points onto the perpendicular axis
    let minPerp = Infinity;
    let maxPerp = -Infinity;
    for (const p of pts) {
      const perp = -p.x * sinA + p.y * cosA;
      if (perp < minPerp) minPerp = perp;
      if (perp > maxPerp) maxPerp = perp;
    }
    const width = maxPerp - minPerp;
    if (width < bestWidth) {
      bestWidth = width;
      bestAngle = angleDeg;
    }
  }

  return bestAngle;
}

/**
 * Classify a polygon edge by its orientation relative to the building's
 * dominant axis (estimated ridge direction).
 *
 * For a building perimeter polygon:
 * - Edges parallel to the dominant axis → **eave** (gutter line)
 * - Edges perpendicular to the dominant axis → **rake** (gable end)
 * - Edges at intermediate angles (30°-60° from axis) at concave polygon
 *   corners → **valley**; at convex corners → **hip**
 *
 * When azimuthDegrees is provided (from Solar API segments), uses that as
 * the slope direction for additional context.
 */
export function classifyEdgeByPosition(
  edgeStart: LatLngLiteral,
  edgeEnd: LatLngLiteral,
  polygon: LatLngLiteral[],
  azimuthDegrees?: number
): EdgeType {
  if (polygon.length < 3) return 'other';

  // Calculate the bearing of this edge
  const edgeBearing = calculateBearing(edgeStart, edgeEnd);

  // Determine dominant axis (ridge direction)
  const dominantAxis = estimateDominantAxis(polygon);

  // Angle between edge bearing and dominant axis (0-90 range)
  let angleDiff = Math.abs(edgeBearing - dominantAxis) % 180;
  if (angleDiff > 90) angleDiff = 180 - angleDiff;

  // Check if this edge is at a concave (reflex) or convex corner
  // by looking at the interior angle at each endpoint
  const edgeLength = calculateDistance(edgeStart, edgeEnd);

  // Short diagonal edges (< 25% of average edge length) at intermediate
  // angles are likely hip or valley connections
  const avgEdgeLength = calculatePolygonPerimeter(polygon) / polygon.length;
  const isShortDiagonal = edgeLength < avgEdgeLength * 0.5 && angleDiff > 25 && angleDiff < 65;

  if (isShortDiagonal) {
    // Check concavity at the corner vertex adjacent to this edge
    const edgeIdx = findEdgeIndex(edgeStart, edgeEnd, polygon);
    if (edgeIdx >= 0) {
      const isConcave = isReflex(polygon, edgeIdx);
      return isConcave ? 'valley' : 'hip';
    }
  }

  // Classify by orientation relative to dominant axis
  if (angleDiff <= 25) {
    // Roughly parallel to ridge → eave
    return 'eave';
  } else if (angleDiff >= 65) {
    // Roughly perpendicular to ridge → rake
    return 'rake';
  } else {
    // Intermediate angle — use azimuth if available
    if (azimuthDegrees !== undefined) {
      // If the edge bearing aligns with the slope direction, it's a rake
      let azDiff = Math.abs(edgeBearing - azimuthDegrees) % 180;
      if (azDiff > 90) azDiff = 180 - azDiff;
      return azDiff < 45 ? 'rake' : 'eave';
    }
    // Default: classify shorter edges as rakes, longer as eaves
    return edgeLength < avgEdgeLength ? 'rake' : 'eave';
  }
}

/**
 * Find the index of an edge in the polygon by matching its start point.
 */
function findEdgeIndex(start: LatLngLiteral, end: LatLngLiteral, polygon: LatLngLiteral[]): number {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (calculateDistance(start, polygon[i]) < 1 && calculateDistance(end, polygon[j]) < 1) return i;
    if (calculateDistance(start, polygon[j]) < 1 && calculateDistance(end, polygon[i]) < 1) return i;
  }
  return -1;
}

/**
 * Check if the interior angle at a polygon vertex is reflex (> 180°).
 * A reflex angle indicates a concave/inward corner.
 */
function isReflex(polygon: LatLngLiteral[], edgeIndex: number): boolean {
  const n = polygon.length;
  // Look at the vertex at the end of this edge
  const vIdx = (edgeIndex + 1) % n;
  const prev = polygon[edgeIndex];
  const curr = polygon[vIdx];
  const next = polygon[(vIdx + 1) % n];

  // Cross product of vectors (prev→curr) × (curr→next)
  const dx1 = curr.lng - prev.lng;
  const dy1 = curr.lat - prev.lat;
  const dx2 = next.lng - curr.lng;
  const dy2 = next.lat - curr.lat;

  const cross = dx1 * dy2 - dy1 * dx2;
  // For a CCW polygon, negative cross = reflex; for CW, positive = reflex
  // Determine winding by signed area
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea += polygon[i].lng * polygon[j].lat - polygon[j].lng * polygon[i].lat;
  }
  // signedArea > 0 = CCW, < 0 = CW
  return signedArea > 0 ? cross < 0 : cross > 0;
}

/**
 * Find the nearest point on any polygon edge to a given point.
 * Used for snap-to-edge during drawing.
 *
 * @returns The closest point on an edge and its distance, or null if nothing within threshold.
 */
export function findNearestPointOnEdge(
  point: LatLngLiteral,
  polygonVertices: LatLngLiteral[],
  thresholdFt: number = 5
): { point: LatLngLiteral; distance: number; edgeIndex: number } | null {
  if (polygonVertices.length < 2) return null;

  let best: { point: LatLngLiteral; distance: number; edgeIndex: number } | null = null;
  const n = polygonVertices.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = polygonVertices[i];
    const b = polygonVertices[j];

    // Find closest point on segment [a, b] to the given point
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) continue;

    let t = ((point.lng - a.lng) * dx + (point.lat - a.lat) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const proj: LatLngLiteral = {
      lat: a.lat + t * dy,
      lng: a.lng + t * dx,
    };

    const dist = calculateDistance(point, proj);
    if (dist < thresholdFt && (!best || dist < best.distance)) {
      best = { point: proj, distance: dist, edgeIndex: i };
    }
  }

  return best;
}

/**
 * Calculate slope-adjusted edge length.
 * Horizontal edges (ridge, eave) use 2D length.
 * Sloped edges (hip, valley, rake) are adjusted by the pitch factor.
 */
export function calculateSlopeAdjustedEdgeLength(
  start: LatLngLiteral,
  end: LatLngLiteral,
  edgeType: EdgeType,
  pitch: string
): number {
  const flatLength = calculateDistance(start, end);

  // Ridges and eaves are horizontal — no slope adjustment
  if (edgeType === 'ridge' || edgeType === 'eave' || edgeType === 'drip-edge') {
    return flatLength;
  }

  // Hips, valleys, and rakes follow the slope
  if (edgeType === 'hip' || edgeType === 'valley' || edgeType === 'rake') {
    return flatLength * pitchFactor(pitch);
  }

  return flatLength;
}
