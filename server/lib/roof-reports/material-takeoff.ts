/**
 * Material takeoff calculations for roofing projects.
 * Uses industry-standard formulas to estimate materials from measurement data.
 */

import type { RoofSegment, RoofEdgeLengths } from './geometry-utils.js';
import { adjustAreaForPitch, sqFeetToSquares, pitchFactor } from './geometry-utils.js';

// ─── Material-takeoff conversion factors ─────────────────────────────
// Industry-standard packaging numbers; matched to interface JSDoc above.

/** Bundles per shingle square (typical 3-tab and architectural shingles). */
const BUNDLES_PER_SQUARE = 3;
/** Shingle squares covered by 1 underlayment roll (4 sq @ 100 sqft = 400 sqft). */
const SQUARES_PER_UNDERLAYMENT_ROLL = 4;
/** Linear feet of starter strip in 1 box. */
const STARTER_STRIP_LF_PER_BOX = 105;
/** Linear feet of ridge cap in 1 bundle. */
const RIDGE_CAP_LF_PER_BUNDLE = 25;
/** Linear feet per drip-edge piece (10 ft sticks are the supplier standard). */
const DRIP_EDGE_LF_PER_PIECE = 10;
/** Linear feet per flashing piece — same supplier 10 ft stock as drip edge. */
const FLASHING_LF_PER_PIECE = 10;
/** Linear feet of ice & water shield per roll (3 ft × 25 ft = 75 LF coverage). */
const ICE_SHIELD_LF_PER_ROLL = 75;
/** Pounds of roofing nails per shingle square. */
const NAIL_LBS_PER_SQUARE = 1.5;
/** Square feet of attic per square inch of ventilation NFA — code-required ratio. */
const SQ_FT_PER_SQ_IN_VENT = 150;
/** Divisor used to convert a percentage to a 0..1 fraction. */
const PERCENT_DIVISOR = 100;

/** Tenth-multiplier used by `roundToTenth`. */
const ROUND_TO_TENTH_MULTIPLIER = 10;

/** Round a quantity to the nearest tenth — used so customer-facing
 *  material rows display as `4.5 bundles` not `4.5000000007 bundles`. */
function roundToTenth(value: number): number {
  return Math.round(value * ROUND_TO_TENTH_MULTIPLIER) / ROUND_TO_TENTH_MULTIPLIER;
}

/** Empty-segment all-zeroes default returned when `segments` is empty/null. */
const EMPTY_TAKEOFF_DEFAULTS = {
  shingleSquares: 0,
  shingleBundles: 0,
  underlaymentRolls: 0,
  starterStripLF: 0,
  starterStripBoxes: 0,
  ridgeCapLF: 0,
  ridgeCapBundles: 0,
  dripEdgeLF: 0,
  dripEdgePieces: 0,
  iceShieldLF: 0,
  iceShieldRolls: 0,
  flashingLF: 0,
  flashingPieces: 0,
  nailPounds: 0,
  ventSquareInches: 0,
} as const;

/** Format-line template separators. */
const FORMAT_LINE_NAME_SEPARATOR = ': ';
const FORMAT_LINE_QTY_UNIT_SEPARATOR = ' ';

export interface MaterialTakeoff {
  // Shingles
  shingleSquares: number;       // Total squares including waste
  shingleBundles: number;       // 3 bundles per square

  // Underlayment
  underlaymentRolls: number;    // 1 roll covers ~4 squares (400 sq ft)

  // Starter strip
  starterStripLF: number;       // Linear feet = eave + rake length
  starterStripBoxes: number;    // 1 box = ~105 linear ft

  // Ridge cap
  ridgeCapLF: number;           // Linear feet = ridge + hip length
  ridgeCapBundles: number;      // 1 bundle = ~25 linear ft

  // Drip edge
  dripEdgeLF: number;           // Linear feet = eave + rake length
  dripEdgePieces: number;       // 10 ft per piece

  // Ice & water shield
  iceShieldLF: number;          // Eave length * 3 ft wide
  iceShieldRolls: number;       // 1 roll = 75 linear ft at 3 ft width

  // Flashing
  flashingLF: number;           // Flashing length from edges
  flashingPieces: number;       // 10 ft per piece

  // Nails
  nailPounds: number;           // ~1.5 lbs per square

  // Ventilation
  ventSquareInches: number;     // 1 sq inch per 150 sq ft of attic

  // Waste
  wastePercentage: number;
}

export interface MaterialTakeoffInput {
  segments: RoofSegment[];
  edgeLengths?: RoofEdgeLengths;
  wastePercentage: number;
  averagePitch: string;
}

/**
 * Calculate a complete material takeoff from roof measurement data.
 *
 * For each segment, pitch-adjusted area is computed using the segment's own
 * pitch when available, falling back to the averagePitch. All quantities
 * include the specified waste percentage and are rounded up to whole
 * purchasable units where applicable.
 */
export function calculateMaterialTakeoff(input: MaterialTakeoffInput): MaterialTakeoff {
  const { segments, edgeLengths, averagePitch } = input;
  const wastePercentage = Math.max(0, input.wastePercentage);

  // --- Handle empty segments ---
  if (!segments || segments.length === 0) {
    return {
      ...EMPTY_TAKEOFF_DEFAULTS,
      wastePercentage,
    };
  }

  // --- Total adjusted area from all segments ---
  let totalAdjustedSqFt = 0;
  for (const seg of segments) {
    if (seg.adjustedAreaSqFt && seg.adjustedAreaSqFt > 0) {
      // Pre-calculated adjusted area takes priority
      totalAdjustedSqFt += seg.adjustedAreaSqFt;
    } else {
      const segPitch = seg.pitch || averagePitch;
      totalAdjustedSqFt += adjustAreaForPitch(seg.areaSqFt, segPitch);
    }
  }

  // --- Shingles ---
  const wasteFactor = 1 + wastePercentage / PERCENT_DIVISOR;
  const shingleSquares = sqFeetToSquares(totalAdjustedSqFt) * wasteFactor;
  const shingleBundles = Math.ceil(shingleSquares * BUNDLES_PER_SQUARE);

  // --- Underlayment (1 roll = ~4 squares = 400 sq ft) ---
  const underlaymentRolls = Math.ceil(shingleSquares / SQUARES_PER_UNDERLAYMENT_ROLL);

  // --- Edge-based materials ---
  const eaveLF = edgeLengths?.eaveLengthFt ?? 0;
  const rakeLF = edgeLengths?.rakeLengthFt ?? 0;
  const ridgeLF = edgeLengths?.ridgeLengthFt ?? 0;
  const hipLF = edgeLengths?.hipLengthFt ?? 0;
  const flashingLFRaw = edgeLengths?.flashingLengthFt ?? 0;

  // Starter strip: installed along eaves and rakes
  const starterStripLF = eaveLF + rakeLF;
  const starterStripBoxes = starterStripLF > 0 ? Math.ceil(starterStripLF / STARTER_STRIP_LF_PER_BOX) : 0;

  // Ridge cap: covers ridges and hips
  const ridgeCapLF = ridgeLF + hipLF;
  const ridgeCapBundles = ridgeCapLF > 0 ? Math.ceil(ridgeCapLF / RIDGE_CAP_LF_PER_BUNDLE) : 0;

  // Drip edge: installed along eaves and rakes
  const dripEdgeLF = eaveLF + rakeLF;
  const dripEdgePieces = dripEdgeLF > 0 ? Math.ceil(dripEdgeLF / DRIP_EDGE_LF_PER_PIECE) : 0;

  // Ice & water shield: runs along eaves (3 ft wide coverage per linear ft)
  const iceShieldLF = eaveLF;
  const iceShieldRolls = iceShieldLF > 0 ? Math.ceil(iceShieldLF / ICE_SHIELD_LF_PER_ROLL) : 0;

  // Flashing
  const flashingLF = flashingLFRaw;
  const flashingPieces = flashingLF > 0 ? Math.ceil(flashingLF / FLASHING_LF_PER_PIECE) : 0;

  // --- Nails (NAIL_LBS_PER_SQUARE per square) ---
  const nailPounds = roundToTenth(shingleSquares * NAIL_LBS_PER_SQUARE);

  // --- Ventilation (1 sq inch per SQ_FT_PER_SQ_IN_VENT sq ft of attic / footprint area) ---
  const totalFootprintSqFt = segments.reduce((sum, s) => sum + s.areaSqFt, 0);
  const ventSquareInches = Math.ceil(totalFootprintSqFt / SQ_FT_PER_SQ_IN_VENT);

  return {
    shingleSquares: roundToTenth(shingleSquares),
    shingleBundles,
    underlaymentRolls,
    starterStripLF: roundToTenth(starterStripLF),
    starterStripBoxes,
    ridgeCapLF: roundToTenth(ridgeCapLF),
    ridgeCapBundles,
    dripEdgeLF: roundToTenth(dripEdgeLF),
    dripEdgePieces,
    iceShieldLF: roundToTenth(iceShieldLF),
    iceShieldRolls,
    flashingLF: roundToTenth(flashingLF),
    flashingPieces,
    nailPounds,
    ventSquareInches,
    wastePercentage,
  };
}

/**
 * Format a single material line item as a human-readable string.
 * Example: "Shingle Bundles: 45 bundles"
 */
export function formatMaterialLine(name: string, qty: number, unit: string): string {
  return `${name}${FORMAT_LINE_NAME_SEPARATOR}${qty}${FORMAT_LINE_QTY_UNIT_SEPARATOR}${unit}`;
}
