/**
 * The plain functions behind "Find it from the satellite": no database, no
 * network, nothing paid.
 *
 *   staticMapUrl / assertMapUrl   the one address the picture is fetched from:
 *                                 the Google Static Maps host, over https, the
 *                                 one path, built here from two numbers and a
 *                                 key. Nothing a person typed ever becomes part
 *                                 of it. `assertMapUrl` is the check made again
 *                                 right before the fetch.
 *   validCoordinates              a real latitude and longitude, or nothing.
 *   readSatelliteAnswer           what the model said, accepted only if it is a
 *                                 closed outline of a sane size inside the
 *                                 picture, a bounded number of facets, a known
 *                                 roof type and a confidence in range. Anything
 *                                 else is null. What comes back is a NEW object
 *                                 of named fields: the model's own words (its
 *                                 notes) are never carried on.
 *
 * The estimate (squares and a pitch) is footprint from the outline and the
 * picture's scale, made steeper by the pitch most of the roof is said to have.
 * It is only an estimate, and is told as one.
 */
import { adjustAreaForPitch, sqFeetToSquares, sqMetersToSqFeet } from '../lib/roof-reports/geometry-utils.js';
import { ROOF_PITCH_CHOICES } from '../../shared/roof-reports';

/** The only host the satellite picture may come from. */
export const MAP_HOST = 'maps.googleapis.com';
const MAP_PATH = '/maps/api/staticmap';
const ZOOM = 20;
const SIZE = 640;
const SCALE = 2;
export const IMAGE_WIDTH = SIZE * SCALE;
export const IMAGE_HEIGHT = SIZE * SCALE;

export const MAX_VERTICES = 40;
export const MAX_FACETS = 12;
const MAX_ANSWER_CHARS = 50_000;
/** Smaller than this is not a roof (a shed is about 100 square feet). */
const MIN_FOOTPRINT_SQFT = 150;
/** A roof that fills more of the picture than this is the whole picture, not a roof in it. */
const MAX_SHARE_OF_PICTURE = 0.8;

export const ROOF_TYPES = ['gable', 'hip', 'flat', 'shed', 'mansard', 'gambrel', 'complex'] as const;
export type RoofType = (typeof ROOF_TYPES)[number];
export const DIRECTIONS = ['north', 'south', 'east', 'west', 'northeast', 'southeast', 'northwest', 'southwest'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type Confidence = 'high' | 'medium' | 'low';

export interface Point { x: number; y: number }
export interface Facet { vertices: Point[]; pitch: string; direction: Direction }
export interface RoofFinding { outline: Point[]; facets: Facet[]; roofType: RoofType; confidence: Confidence }
export interface RoofEstimate { squares: number; pitch: string | null }

// ---------------------------------------------------------------- the picture

/** The address of one satellite picture, centred on the place. The key rides in the query and goes nowhere else. */
export function staticMapUrl(lat: number, lng: number, key: string): string {
  const q = new URLSearchParams({
    center: `${lat},${lng}`, zoom: String(ZOOM), size: `${SIZE}x${SIZE}`, scale: String(SCALE), maptype: 'satellite', format: 'jpg', key,
  });
  return `https://${MAP_HOST}${MAP_PATH}?${q.toString()}`;
}

/** Throws unless the address is exactly the map host's static picture. The message never holds the address (it carries a key). */
export function assertMapUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('That is not the map address.'); }
  const clean = url.protocol === 'https:' && url.hostname === MAP_HOST && url.port === '' && url.username === '' && url.password === ''
    && url.pathname === MAP_PATH && url.hash === '' && !raw.includes('\\');
  if (!clean) throw new Error('That is not the map address.');
  return url;
}

/** A latitude and longitude that name a place: finite numbers in range, and not the empty 0,0 of a failed lookup. */
export function validCoordinates(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

/** Metres on the ground for one pixel of the picture (Web Mercator, at this latitude). */
export function metersPerPixel(lat: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** ZOOM / SCALE;
}

/** What the model is asked. It holds no address and nothing about a person: only what to do with the picture. */
export const DETECT_PROMPT = `You are measuring one roof from a satellite picture. The picture is ${IMAGE_WIDTH} by ${IMAGE_HEIGHT} pixels. The building to measure is at its centre, pixel ${IMAGE_WIDTH / 2}, ${IMAGE_HEIGHT / 2}.

Answer with one JSON object and nothing else:
{
  "outline": [{"x": 0, "y": 0}],
  "facets": [{"vertices": [{"x": 0, "y": 0}], "estimatedPitch": "6:12", "direction": "north"}],
  "roofType": "gable",
  "confidence": "high"
}

Rules:
- "outline" traces the outer edge of the main roof, clockwise, one point at every corner, as pixels from the top left corner (0,0). At least 3 points and at most ${MAX_VERTICES}. Do not repeat the first point at the end.
- "facets" lists each flat plane of the roof the same way, at most ${MAX_FACETS}. "estimatedPitch" is one of "flat", "3:12", "4:12", "5:12", "6:12", "7:12", "8:12", "9:12", "10:12", "12:12". "direction" is the way the plane faces: north, south, east, west, northeast, southeast, northwest or southwest.
- "roofType" is one of ${ROOF_TYPES.join(', ')}.
- "confidence" is "high" when the edges are clear, "medium" when trees or shadows hide some of them, "low" when you are unsure.
- If you cannot see a roof, return an outline with no points.`;

// ---------------------------------------------------------------- the answer

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The shoelace area of a polygon, in pixels squared (always positive). */
function areaPx(p: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i]; const b = p[(i + 1) % p.length]; sum += a.x * b.y - b.x * a.y; }
  return Math.abs(sum) / 2;
}

const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Do these two segments cross (touching at an end counts only when they are not neighbours, which the caller leaves out)? */
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(a, b, c); const d2 = cross(a, b, d); const d3 = cross(c, d, a); const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Point, q: Point, r: Point) => cross(p, q, r) === 0 && Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

function simple(p: readonly Point[]): boolean {
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const neighbours = j === i + 1 || (i === 0 && j === p.length - 1);
      if (neighbours) continue;
      if (crosses(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) return false;
    }
  }
  return true;
}

/** A list of points inside the picture, 3 to the cap of them, no point twice in a row, a closing copy of the first dropped. Null when it is not that. */
function readPoints(raw: unknown): Point[] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > MAX_VERTICES + 1) return null;
  const out: Point[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const { x, y } = item;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || y < 0 || x > IMAGE_WIDTH || y > IMAGE_HEIGHT) return null;
    out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  const first = out[0]; const last = out[out.length - 1];
  if (out.length > 3 && first.x === last.x && first.y === last.y) out.pop();
  if (out.length < 3 || out.length > MAX_VERTICES) return null;
  for (let i = 0; i < out.length; i++) { const a = out[i]; const b = out[(i + 1) % out.length]; if (a.x === b.x && a.y === b.y) return null; }
  return areaPx(out) > 0 && simple(out) ? out : null;
}

/** "6:12" or "6/12" as "6/12"; "flat" as "flat"; anything else null. */
function readPitch(raw: unknown): string | null {
  if (raw === 'flat') return 'flat';
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2})\s*[:/]\s*12$/.exec(raw.trim());
  if (!m) return null;
  const rise = Number(m[1]);
  return rise >= 1 && rise <= 24 ? `${rise}/12` : null;
}

function readConfidence(raw: unknown): Confidence | null {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw >= 0.75 ? 'high' : raw >= 0.4 ? 'medium' : 'low';
  return null;
}

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```json')) t = t.slice(7); else if (t.startsWith('```')) t = t.slice(3);
  if (t.endsWith('```')) t = t.slice(0, -3);
  return t.trim();
}

/**
 * The model's text as a roof, with the estimate worked out from it, or null for
 * anything that is not exactly what was asked for. `lat` is the place's own
 * latitude (a validated number), which sets the picture's scale.
 */
export function readSatelliteAnswer(raw: unknown, lat: number): { finding: RoofFinding; estimate: RoofEstimate } | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ANSWER_CHARS) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(stripFences(raw)); } catch { return null; }
  if (!isObject(parsed)) return null;

  const outline = readPoints(parsed.outline);
  if (!outline) return null;
  const mpp = metersPerPixel(lat);
  const footprintSqFt = sqMetersToSqFeet(areaPx(outline) * mpp * mpp);
  if (!(footprintSqFt >= MIN_FOOTPRINT_SQFT) || areaPx(outline) > IMAGE_WIDTH * IMAGE_HEIGHT * MAX_SHARE_OF_PICTURE) return null;

  const roofType = (ROOF_TYPES as readonly unknown[]).includes(parsed.roofType) ? (parsed.roofType as RoofType) : null;
  const confidence = readConfidence(parsed.confidence);
  if (!roofType || !confidence) return null;

  const facets: Facet[] = [];
  if (parsed.facets !== undefined) {
    if (!Array.isArray(parsed.facets) || parsed.facets.length > MAX_FACETS) return null;
    for (const f of parsed.facets) {
      if (!isObject(f)) return null;
      const vertices = readPoints(f.vertices);
      const pitch = readPitch(f.estimatedPitch);
      const direction = (DIRECTIONS as readonly unknown[]).includes(f.direction) ? (f.direction as Direction) : null;
      if (!vertices || !pitch || !direction) return null;
      facets.push({ vertices, pitch, direction });
    }
  }

  // The pitch that covers the most roof, among the facets.
  const covered = new Map<string, number>();
  for (const f of facets) covered.set(f.pitch, (covered.get(f.pitch) ?? 0) + areaPx(f.vertices));
  const dominant = [...covered.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  const steep = dominant !== null && dominant !== 'flat' ? dominant : null;
  const roofSqFt = steep ? adjustAreaForPitch(footprintSqFt, steep.replace('/', ':')) : footprintSqFt;
  const squares = sqFeetToSquares(roofSqFt);
  if (!(squares > 0)) return null;

  return {
    finding: { outline, facets, roofType, confidence },
    // A pitch the form has no choice for is left out, never rounded to one it has.
    estimate: { squares, pitch: steep !== null && (ROOF_PITCH_CHOICES as readonly string[]).includes(steep) ? steep : null },
  };
}
