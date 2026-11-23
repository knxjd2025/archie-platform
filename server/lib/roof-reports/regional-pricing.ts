/**
 * Regional Pricing Adjustments for Roofing
 * Based on BLS construction cost indices by region.
 * National average = 1.0
 */

export interface RegionalFactor {
  factor: number;
  region: string;
  notes?: string;
}

type StateAbbrev = string;

const REGIONAL_FACTORS: Record<StateAbbrev, RegionalFactor> = {
  // Northeast (1.15-1.30) — higher labor costs, union density, strict building codes
  CT: { factor: 1.22, region: 'Northeast', notes: 'High labor costs, strict building codes' },
  MA: { factor: 1.25, region: 'Northeast', notes: 'High labor and material costs, coastal exposure' },
  ME: { factor: 1.15, region: 'Northeast', notes: 'Seasonal constraints, moderate labor costs' },
  NH: { factor: 1.16, region: 'Northeast', notes: 'Moderate labor costs, harsh winters' },
  NJ: { factor: 1.24, region: 'Northeast', notes: 'High labor costs, dense urban areas' },
  NY: { factor: 1.30, region: 'Northeast', notes: 'Highest labor costs in region, NYC metro premium' },
  PA: { factor: 1.18, region: 'Northeast', notes: 'Moderate-high labor, varies by metro area' },
  RI: { factor: 1.20, region: 'Northeast', notes: 'High labor costs, coastal exposure' },
  VT: { factor: 1.15, region: 'Northeast', notes: 'Rural premium, seasonal constraints' },

  // Southeast (0.85-0.95) — lower labor costs, baseline market
  AL: { factor: 0.85, region: 'Southeast', notes: 'Lower labor costs, storm-prone' },
  AR: { factor: 0.86, region: 'Southeast', notes: 'Low cost of living, moderate storm exposure' },
  FL: { factor: 0.95, region: 'Southeast', notes: 'Hurricane codes increase material costs' },
  GA: { factor: 0.90, region: 'Southeast', notes: 'Growing market, moderate costs' },
  KY: { factor: 0.88, region: 'Southeast', notes: 'Low labor costs, moderate weather exposure' },
  LA: { factor: 0.90, region: 'Southeast', notes: 'Hurricane zone, higher insurance costs' },
  MS: { factor: 0.85, region: 'Southeast', notes: 'Lowest cost market in region' },
  NC: { factor: 0.92, region: 'Southeast', notes: 'Growing metro areas, moderate costs' },
  SC: { factor: 0.90, region: 'Southeast', notes: 'Moderate costs, coastal wind codes' },
  TN: { factor: 0.89, region: 'Southeast', notes: 'Low labor costs, growing construction market' },
  VA: { factor: 0.95, region: 'Southeast', notes: 'Northern VA premium, otherwise moderate' },
  WV: { factor: 0.87, region: 'Southeast', notes: 'Low labor costs, rural access challenges' },

  // Midwest (0.95-1.05) — moderate costs, seasonal variation
  IA: { factor: 0.95, region: 'Midwest', notes: 'Moderate costs, hail-prone' },
  IL: { factor: 1.05, region: 'Midwest', notes: 'Chicago metro premium, strong unions' },
  IN: { factor: 0.96, region: 'Midwest', notes: 'Moderate labor costs, competitive market' },
  KS: { factor: 0.95, region: 'Midwest', notes: 'Moderate costs, tornado/hail exposure' },
  MI: { factor: 1.02, region: 'Midwest', notes: 'Union labor influence, harsh winters' },
  MN: { factor: 1.04, region: 'Midwest', notes: 'Higher labor costs, extreme cold requirements' },
  MO: { factor: 0.96, region: 'Midwest', notes: 'Moderate costs, storm-prone' },
  ND: { factor: 1.00, region: 'Midwest', notes: 'Rural premium offsets lower labor rates' },
  NE: { factor: 0.96, region: 'Midwest', notes: 'Moderate costs, hail belt' },
  OH: { factor: 0.98, region: 'Midwest', notes: 'Moderate labor costs, competitive market' },
  SD: { factor: 0.97, region: 'Midwest', notes: 'Rural access challenges, hail exposure' },
  WI: { factor: 1.00, region: 'Midwest', notes: 'Moderate costs, cold climate requirements' },

  // Southwest (0.90-1.05) — mixed costs, fast-growing markets
  AZ: { factor: 0.95, region: 'Southwest', notes: 'Growing market, heat-related material requirements' },
  NM: { factor: 0.92, region: 'Southwest', notes: 'Lower labor costs, rural areas' },
  NV: { factor: 1.05, region: 'Southwest', notes: 'Las Vegas metro premium, desert climate' },
  OK: { factor: 0.90, region: 'Southwest', notes: 'Low labor costs, tornado/hail exposure' },
  TX: { factor: 0.93, region: 'Southwest', notes: 'Large competitive market, storm-prone' },
  UT: { factor: 1.00, region: 'Southwest', notes: 'Growing market, moderate costs' },

  // West Coast (1.15-1.35) — highest costs
  CA: { factor: 1.35, region: 'West Coast', notes: 'Highest in nation, strict codes, high labor' },
  OR: { factor: 1.18, region: 'West Coast', notes: 'High labor costs, rain/moisture requirements' },
  WA: { factor: 1.22, region: 'West Coast', notes: 'Seattle metro premium, high labor costs' },

  // Mountain (1.00-1.10) — moderate costs with altitude/access premiums
  CO: { factor: 1.08, region: 'Mountain', notes: 'Denver metro premium, altitude considerations' },
  ID: { factor: 1.02, region: 'Mountain', notes: 'Growing market, rural access challenges' },
  MT: { factor: 1.05, region: 'Mountain', notes: 'Rural premium, harsh winters' },
  WY: { factor: 1.04, region: 'Mountain', notes: 'Sparse population, access challenges' },

  // Pacific (1.25-1.45) — remote/island premiums
  AK: { factor: 1.35, region: 'Pacific', notes: 'Extreme climate, shipping costs, short season' },
  HI: { factor: 1.45, region: 'Pacific', notes: 'Island premium, all materials shipped in' },

  // District of Columbia
  DC: { factor: 1.28, region: 'Northeast', notes: 'Urban premium, high labor costs, strict codes' },
};

/** National average multiplier (factor of 1.0 = no regional adjustment). */
const NATIONAL_AVERAGE_FACTOR = 1.0;

/** Region label used when a state abbreviation isn't in the lookup table. */
const UNKNOWN_REGION = 'Unknown';

/** Note used on the unknown-state fallback record. */
const NOTE_UNKNOWN_STATE = 'State not found, using national average';

/** Note returned by `getRegionalPricingNote` for unknown states. */
const MSG_REGIONAL_UNAVAILABLE =
  'Regional pricing adjustment not available for this location. Using national average pricing.';

/** Round-cents multiplier — `Math.round(amount * 100) / 100` rounds to whole cents. */
const ROUND_CENTS_MULTIPLIER = 100;
/** Percent-multiplier converting a unit-fractional factor delta to a percentage. */
const PERCENT_MULTIPLIER = 100;

/** Percent-delta phrase fragments — assembled into:
 *  `'X% above the national average'` / `'Y% below the national average'` / `'at the national average'`. */
const MSG_PCT_ABOVE_SUFFIX = '% above the national average';
const MSG_PCT_BELOW_SUFFIX = '% below the national average';
const MSG_AT_NATIONAL_AVERAGE = 'at the national average';

/** Regional pricing note template fragments — assembled into:
 *  `'STATE (REGION): Construction costs are PCT_DESC. NOTES'`. */
const NOTE_STATE_REGION_OPEN_PAREN = ' (';
const NOTE_STATE_REGION_CLOSE_PAREN = '): Construction costs are ';
const NOTE_REGION_DESC_TERMINATOR = '. ';

const DEFAULT_FACTOR: RegionalFactor = {
  factor: NATIONAL_AVERAGE_FACTOR,
  region: UNKNOWN_REGION,
  notes: NOTE_UNKNOWN_STATE,
};

/**
 * Normalise a state abbreviation: trim + upper-case so look-ups match the
 * canonical `REGIONAL_FACTORS` keys (`'tx'`, `' TX '`, `'Tx'` all → `'TX'`).
 */
function normalizeStateAbbrev(stateAbbrev: string): string {
  return stateAbbrev.trim().toUpperCase();
}

/**
 * Round a dollar amount to whole cents (avoids floating-point drift).
 * Local copy — `lib/roof-report-pricing.ts` has the same helper, but this
 * module is imported standalone elsewhere.
 */
function roundCents(amount: number): number {
  return Math.round(amount * ROUND_CENTS_MULTIPLIER) / ROUND_CENTS_MULTIPLIER;
}

/**
 * Convert a regional factor into a signed percent delta vs the national
 * average. `1.15` → `15`, `0.92` → `-8`, `1.0` → `0`.
 */
function factorToPercentDelta(factor: number): number {
  return Math.round((factor - NATIONAL_AVERAGE_FACTOR) * PERCENT_MULTIPLIER);
}

/**
 * Build the human-readable "X% above/below/at the national average" clause.
 * Centralises the +/-/0 sign-handling so the three branches can't drift.
 */
function describePercentDelta(pctDiff: number): string {
  if (pctDiff > 0) return `${pctDiff}${MSG_PCT_ABOVE_SUFFIX}`;
  if (pctDiff < 0) return `${Math.abs(pctDiff)}${MSG_PCT_BELOW_SUFFIX}`;
  return MSG_AT_NATIONAL_AVERAGE;
}

/**
 * Get regional pricing adjustment factor by state abbreviation.
 * Returns multiplier (e.g. 1.15 means 15% above national average).
 */
export function getRegionalFactor(stateAbbrev: string): RegionalFactor {
  return REGIONAL_FACTORS[normalizeStateAbbrev(stateAbbrev)] ?? DEFAULT_FACTOR;
}

/**
 * Apply regional adjustment to a base price.
 */
export function applyRegionalAdjustment(basePrice: number, stateAbbrev: string): number {
  const { factor } = getRegionalFactor(stateAbbrev);
  return roundCents(basePrice * factor);
}

/**
 * Get human-readable regional pricing description for reports.
 */
export function getRegionalPricingNote(stateAbbrev: string): string {
  const { factor, region, notes } = getRegionalFactor(stateAbbrev);
  const key = normalizeStateAbbrev(stateAbbrev);

  if (region === UNKNOWN_REGION) {
    return MSG_REGIONAL_UNAVAILABLE;
  }

  const direction = describePercentDelta(factorToPercentDelta(factor));
  return `${key}${NOTE_STATE_REGION_OPEN_PAREN}${region}${NOTE_STATE_REGION_CLOSE_PAREN}${direction}${NOTE_REGION_DESC_TERMINATOR}${notes ?? ''}`.trim();
}
