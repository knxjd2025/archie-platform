/**
 * What a person typed into a report, made safe to use: plain functions, no
 * database, no outside calls. A figure that is text becomes zero, a number
 * is held between sane limits, text is trimmed and cut to length. Nothing here
 * throws on odd input, so a report is never refused over a stray value.
 *
 * Used by the generation (./generate.ts) and by the routes (./routes.ts).
 */
import type { MeasurementReportSection } from '../lib/roof-reports/comprehensive-roof-report.js';
import { ROOF_SQUARES_MAX } from '../../shared/roof-reports';

/** The largest roof the form accepts, in squares (100 square feet each). The screen reads the same number. */
export { ROOF_SQUARES_MAX };
const EDGE_KEYS = ['ridge', 'hip', 'valley', 'eave', 'rake', 'dripEdge', 'flashing'] as const;
const DEFAULT_WASTE_PERCENT = 15;
const DATA_SOURCES = ['google-solar-api', 'manual', 'hybrid', 'eagleview'] as const;

/** Text, trimmed and cut to `max`; '' for anything that is not text. */
export function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

const PLAIN_NUMBER = /^\s*-?\d+(\.\d+)?\s*$/;

/** A finite number between min and max, or the fallback. Text that is a plain number counts; any other text does not. */
export function cleanNumber(v: unknown, min: number, max: number, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && PLAIN_NUMBER.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface CleanRoofDetails { type?: string; squares?: number; pitch?: string; stories?: number; material?: string }

/** The roof facts from the form, or undefined when there are none. */
export function cleanRoofDetails(v: unknown): CleanRoofDetails | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const out: CleanRoofDetails = {};
  const material = cleanText(r.material ?? r.type, 80);
  if (material) { out.material = material; out.type = material; }
  const pitch = cleanText(r.pitch, 20);
  if (pitch) out.pitch = pitch;
  if (r.squares !== undefined && r.squares !== null && r.squares !== '') out.squares = cleanNumber(r.squares, 0, ROOF_SQUARES_MAX);
  if (r.stories !== undefined && r.stories !== null && r.stories !== '') out.stories = cleanNumber(r.stories, 1, 10, 1);
  return Object.keys(out).length ? out : undefined;
}

export interface CleanDamageCounts { windDamaged: number; hailDamaged: number; generalDamaged: number }

/** The shingle counts from the form: whole numbers, never below zero. */
export function cleanDamageCounts(v: unknown): CleanDamageCounts | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const count = (x: unknown) => Math.round(cleanNumber(x, 0, 100_000));
  return { windDamaged: count(r.windDamaged), hailDamaged: count(r.hailDamaged), generalDamaged: count(r.generalDamaged) };
}

/** The measurement facts from the form (segments, edge lengths and so on), cleaned. Anything unusable is dropped. */
export function cleanMeasurements(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (r.totalSquareFeet !== undefined) out.totalSquareFeet = cleanNumber(r.totalSquareFeet, 0, 1_000_000);
  if (Array.isArray(r.segments)) {
    out.segments = r.segments.slice(0, 50).filter((s) => s && typeof s === 'object').map((s: any, i) => {
      const footprint = cleanNumber(s.footprintSqFt, 0, 1_000_000);
      return {
        name: cleanText(s.name, 80) || `Section ${i + 1}`,
        footprintSqFt: footprint,
        pitch: cleanText(s.pitch, 20) || 'Unknown',
        adjustedSqFt: cleanNumber(s.adjustedSqFt, 0, 1_000_000) || footprint,
      };
    });
  }
  if (r.edgeLengths && typeof r.edgeLengths === 'object') {
    const e = r.edgeLengths as Record<string, unknown>;
    out.edgeLengths = Object.fromEntries(EDGE_KEYS.map((k) => [k, cleanNumber(e[k], 0, 1_000_000)]));
  }
  if (typeof r.dataSource === 'string' && (DATA_SOURCES as readonly string[]).includes(r.dataSource)) out.dataSource = r.dataSource;
  if (r.averagePitch !== undefined) out.averagePitch = cleanText(r.averagePitch, 20);
  if (r.wastePercentage !== undefined) out.wastePercentage = cleanNumber(r.wastePercentage, 0, 100, DEFAULT_WASTE_PERCENT);
  if (r.materialTakeoff && typeof r.materialTakeoff === 'object' && !Array.isArray(r.materialTakeoff)) {
    // Numbers and short words only: the takeoff is shown on a page.
    out.materialTakeoff = Object.fromEntries(Object.entries(r.materialTakeoff as Record<string, unknown>).slice(0, 60).map(([k, val]) => [
      cleanText(k, 60), typeof val === 'number' ? cleanNumber(val, 0, 1_000_000) : cleanText(val, 120),
    ]).filter(([k]) => k));
  }
  return Object.keys(out).length ? out : undefined;
}

/** The measurement section of a report, from the cleaned figures. Mirrors the old program's rules. */
export function buildMeasurementSection(measurements: Record<string, unknown> | undefined, roofSquares: number | undefined, roofPitch: string | undefined): MeasurementReportSection {
  const m = measurements ?? {};
  const totalSquareFeet = typeof m.totalSquareFeet === 'number' ? m.totalSquareFeet : 0;
  const rawTotalSqFt = totalSquareFeet || (roofSquares ? roofSquares * 100 : 0);
  const rawSquares = roofSquares || (totalSquareFeet ? Math.round((totalSquareFeet / 100) * 10) / 10 : 0);
  const segments = (Array.isArray(m.segments) ? m.segments : []) as MeasurementReportSection['segments'];
  const footprint = segments.reduce((sum, s) => sum + s.footprintSqFt, 0);
  const adjusted = segments.reduce((sum, s) => sum + s.adjustedSqFt, 0);
  const rawEdges = (m.edgeLengths ?? {}) as Record<string, number>;
  const edgeLengths = Object.fromEntries(EDGE_KEYS.map((k) => [k, typeof rawEdges[k] === 'number' ? rawEdges[k] : 0])) as MeasurementReportSection['edgeLengths'];
  return {
    segments,
    totalFootprintSqFt: footprint > 0 ? footprint : rawTotalSqFt,
    totalAdjustedSqFt: adjusted > 0 ? adjusted : rawTotalSqFt,
    totalSquares: rawSquares,
    averagePitch: roofPitch || (typeof m.averagePitch === 'string' && m.averagePitch) || 'Unknown',
    wastePercentage: typeof m.wastePercentage === 'number' && m.wastePercentage > 0 ? m.wastePercentage : DEFAULT_WASTE_PERCENT,
    edgeLengths,
    materialTakeoff: (m.materialTakeoff ?? {}) as Record<string, unknown>,
    dataSource: (m.dataSource as MeasurementReportSection['dataSource']) ?? 'manual',
  };
}
