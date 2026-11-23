/**
 * report-normalize.ts: make sure every number in a report is a number.
 *
 * A saved report is a JSON column that the editor can write back to, so a field
 * typed `number` can arrive as a string, and a string that is written into a
 * page as if it were a number is markup. Rather than trust each renderer to
 * format every figure with care, the renderers call this once at the top and
 * work only with numbers after that.
 *
 * Rules, applied to the fields named in the shape below and nothing else:
 *  - a finite number stays as it is;
 *  - a string that is a plain number (`"12"`, `"3.5"`) becomes that number;
 *  - anything else (text, objects, NaN, Infinity) becomes 0, so the page shows
 *    a zero rather than somebody's words.
 * A field that is absent stays absent, so "no value" is never turned into 0.
 *
 * Pure module: no imports of anything with side effects, safe in the browser.
 */
import type { ComprehensiveRoofReport } from './comprehensive-roof-report';

/** Marks a numeric leaf in a shape. */
const N = 'n' as const;
type Shape = typeof N | { $each: Shape } | { $values: Shape } | { [key: string]: Shape };

const SHAPE: Record<string, Shape> = {
  property: { latitude: N, longitude: N },
  stormHistory: {
    yearsAnalyzed: N, searchRadiusMiles: N, totalEvents: N, hailEvents: N, windEvents: N, tornadoEvents: N,
    largestHailInches: N, highestWindMph: N, riskScore: N,
    mostRecentHailStorm: { distanceMiles: N },
    mostRecentWindStorm: { distanceMiles: N },
    eventsByYear: { $values: { hail: N, wind: N, total: N } },
  },
  damageAnalysis: {
    totalPhotosAnalyzed: N, photosWithDamage: N,
    roofAge: { estimatedAgeYears: N, expectedLifespanYears: N, remainingLifeYears: N },
    damageTypes: { $each: { count: N } },
    photos: {
      $each: {
        damages: { $each: { confidence: N, boundingBox: { x: N, y: N, width: N, height: N } } },
      },
    },
  },
  repairEstimate: {
    subtotal: N, multiplierApplied: N, total: N,
    lineItems: { $each: { quantity: N, baseCostPerUnit: N, finalCostPerUnit: N, totalBaseCost: N, totalFinalCost: N } },
  },
  roofDetails: { squares: N, stories: N, age_years: N },
  damageCounts: { windDamaged: N, hailDamaged: N, generalDamaged: N },
  measurements: {
    ridgeLength: N, hipLength: N, valleyLength: N, eaveLength: N, rakeLength: N, perimeterLength: N, facetCount: N,
  },
  replacementOptions: {
    $each: {
      total: N, warranty_years: N, subtotal: N, tax: N,
      materials: { $each: { quantity: N, unit_price: N, total: N } },
      labor: { $each: { quantity: N, unit_price: N, total: N } },
      other_costs: { $each: { amount: N } },
    },
  },
  measurementReport: {
    segments: { $each: { footprintSqFt: N, adjustedSqFt: N } },
    totalFootprintSqFt: N, totalAdjustedSqFt: N, totalSquares: N, wastePercentage: N, eagleviewReportId: N,
    edgeLengths: { $values: N },
    pitchTable: { $each: { area: N, percentage: N } },
    gutterMeasurements: { $values: N },
  },
  roofConditionIndex: {
    overallScore: N,
    components: { $each: { weight: N, score: N } },
  },
  stormEnhanced: {
    hailSizeDistribution: { $values: N },
    propertyProfile: {
      total_hail_events: N, total_wind_events: N, avg_events_per_year: N,
      worst_year: { year: N, event_count: N, largest_hail: N },
      storm_free_years: { $each: N },
      repeat_storm_months: { $each: N },
    },
  },
};

const PLAIN_NUMBER = /^\s*-?\d+(\.\d+)?\s*$/;

/** The one rule for a single value. Exported for the renderers that format a lone figure. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && PLAIN_NUMBER.test(value)) return Number(value);
  return 0;
}

function apply(value: unknown, shape: Shape): unknown {
  if (value === undefined || value === null) return value;
  if (shape === N) return toNumber(value);
  if (typeof shape !== 'object') return value;
  if ('$each' in shape) {
    return Array.isArray(value) ? value.map((v) => apply(v, shape.$each as Shape)) : [];
  }
  if ('$values' in shape) {
    if (typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = apply(v, shape.$values as Shape);
    return out;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [k, sub] of Object.entries(shape)) {
    if (k in out) out[k] = apply(out[k], sub as Shape);
  }
  return out;
}

/** A copy of the report in which every numeric field named above holds a number. */
export function normalizeReportNumbers<T extends ComprehensiveRoofReport>(report: T): T {
  const out: Record<string, unknown> = { ...(report as unknown as Record<string, unknown>) };
  for (const [k, shape] of Object.entries(SHAPE)) {
    if (k in out) out[k] = apply(out[k], shape);
  }
  return out as unknown as T;
}
