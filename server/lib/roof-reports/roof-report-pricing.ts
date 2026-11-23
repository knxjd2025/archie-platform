/**
 * Roof Report Pricing Calculator
 * Bridges user inputs + company settings → pricing data for the PDF report.
 *
 * Supports three modes (priority order):
 * 1. Company custom pricing: repairItems / systemPackages from Settings → always wins
 * 2. Default pricing: Industry standard rates from default-pricing.ts → used when company has nothing
 * 3. Never returns null → always shows estimates (no more "Contact for quote")
 */

import type { CompanyProfile, SystemPackage, ProductItem } from './old-types.js';
import {
  REPAIR_TYPES,
  PRICING_MULTIPLIER,
  type RepairEstimate,
  type RepairEstimateSummary,
} from './roof-repair-pricing.js';
import type { EstimateTierData } from './old-types.js';
import type { DamageDetection } from './comprehensive-roof-report.js';
import { findProductById, type ShingleProduct } from './manufacturer-shingle-packages.js';
import {
  DEFAULT_REPAIR_PRICING,
  calculateDefaultShingleRepairCost,
  getDefaultTierPricing,
  getTierDisplayInfo,
  getDefaultWarrantyYears,
  getDefaultFeatures,
  tierMidpoint,
  normalizeMaterialType,
} from './default-pricing.js';
import { getRegionalFactor, applyRegionalAdjustment, getRegionalPricingNote } from './regional-pricing.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DamageCounts {
  windDamaged: number;
  hailDamaged: number;
  generalDamaged: number;
}

export interface RepairPricingResult {
  lineItems: RepairEstimate[];
  subtotal: number;
  total: number;
  priceRangeLow: number;
  priceRangeHigh: number;
  minimumApplied: boolean;
  markup: number;
  notes: string[];
}

export interface ReplacementPricingResult {
  tiers: EstimateTierData[];
  recommendation: {
    tier: 'good' | 'better' | 'best';
    reasoning: string;
  };
}

// ─── Shingle count → repair quantity conversion ───────────────────────────────
const SHINGLES_PER_SQUARE = 66;
const REPAIR_OVERHEAD_FACTOR = 2;

// Repair-pricing defaults are tighter (±15%) because they're already calibrated
// market rates; company-configured pricing widens to ±20% to leave room for
// negotiation on company-specific markups.
const PRICE_RANGE_LOW_DEFAULT = 0.85;
const PRICE_RANGE_HIGH_DEFAULT = 1.15;
const PRICE_RANGE_LOW_COMPANY = 0.8;
const PRICE_RANGE_HIGH_COMPANY = 1.2;

// Mapping from `DamageCounts` field → repair line-item id/label. Hoisted so
// the two pricing paths (default and company) consume the same definition
// instead of redeclaring an inline array each.
type ShingleBucketDef = { field: keyof DamageCounts; id: string; label: string };
const SHINGLE_BUCKET_DEFS: readonly ShingleBucketDef[] = [
  { field: 'windDamaged',    id: 'wind_damage_repair',    label: 'Wind Damage' },
  { field: 'hailDamaged',    id: 'hail_damage_repair',    label: 'Hail Damage' },
  { field: 'generalDamaged', id: 'general_damage_repair', label: 'General Damage' },
];

// AI-damage types whose repair cost is already covered by the shingle
// buckets above (we don't want to double-count). Any `damage.type` that
// `includes` one of these strings is skipped in the additional-types loop.
const EXCLUDED_AI_DAMAGE_KEYWORDS = ['shingle', 'hail', 'wind'];

// Repair-type IDs and fallbacks that used to live as inline string literals.
const SHINGLE_REPLACEMENT_PER_SQ_ID = 'shingle_replacement_per_sq';
const DEFAULT_REPAIR_FALLBACK_COST = 350;

// Note strings shared between the two pricing paths so a copy edit is one place.
const NOTE_REPAIR_ESTIMATE_DISCLAIMER = 'Repair pricing is estimated and subject to on-site verification.';
const NOTE_DEFAULT_RATES = 'Prices based on industry standard rates.';
const NOTE_COMPANY_RATES = 'Prices based on company-configured rates.';
/** Repair line-item template fragments — assembled into:
 *  `'LABEL — Shingle Repair (N shingle[s])'`. */
const REPAIR_LINE_DASH_INFIX = ' - Shingle Repair (';
const REPAIR_LINE_SHINGLE_SUFFIX = ' shingle';
const REPAIR_LINE_CLOSE_PAREN = ')';
/** Unit string used by the shingle-repair line items (default pricing path). */
const SHINGLE_REPAIR_UNIT = 'each';
/** Minimum-applied note template fragments. */
const MSG_MINIMUM_PREFIX = 'Minimum repair charge of $';
const MSG_MINIMUM_SUFFIX = ' applied.';

/** Repair label suffix for the company-pricing path (per-square units, not per-shingle). */
const REPAIR_LABEL_SHINGLE_REPAIR_SUFFIX = ' - Shingle Repair';
/** Per-square unit string used by the company-pricing line items. */
const REPAIR_PER_SQUARE_UNIT = 'sq';
/** Shingle-substring matcher used by `getRepairCost` to fuzzy-match a custom shingle line. */
const REPAIR_SHINGLE_SUBSTRING = 'shingle';

/** Replacement-tier order — fed through the `for (const tier of ...)` loop
 *  in `calculateTiersFromDefaults`. Hoisted so a future 4th-tier addition
 *  is a one-row data edit. */
const REPLACEMENT_TIERS_ORDER = ['good', 'better', 'best'] as const;
/** Warranty-years suffix in the tier features + warranty_description. */
const WARRANTY_YEAR_SUFFIX = '-year workmanship warranty';
/** Tier "custom" sentinel — skipped in the company-packages loop. */
const PACKAGE_TIER_CUSTOM = 'custom';
/** Pitch numerator separator (`'4/12'` → `'4'`). */
const PITCH_SEPARATOR = '/';
/** Recommendation reasoning template fragments — assembled into:
 *  `'The TIER option provides the best balance of protection, warranty coverage, and value.[ regional]'`. */
const REASONING_PREFIX = 'The ';
const REASONING_INFIX = ' option provides the best balance of protection, warranty coverage, and value.';

// ─── Replacement-tier pricing defaults ─────────────────────────────────────
/** Divisor converting a stored percent tax rate (`7.25`) to a fraction (`0.0725`). */
const TAX_PERCENT_TO_FRACTION = 100;
/** Rate applied when neither the caller nor the company supplies one. */
const NO_TAX_RATE = 0;
/** Default roof-material slug if `roofType` isn't supplied. */
const DEFAULT_MATERIAL_TYPE = 'asphalt_shingle';
/** Pitch above which we apply the steep-pitch labor multiplier (rise/12 > 4). */
const PITCH_STEEP_THRESHOLD = 4;
/** Multiplier added to per-square rates for steep (>4/12) roofs. */
const PITCH_STEEP_MULTIPLIER = 1.05;
/** Each story above 1 adds this fraction to the per-square cost. */
const PER_ADDITIONAL_STORY_FACTOR = 0.1;
/** The tier we recommend by default for every replacement quote. */
const DEFAULT_RECOMMENDED_TIER: 'better' = 'better';
/** Unit string used on materials line items in replacement tiers. */
const UNIT_SQ = 'SQ';
/** Stock features appended after material-specific features on every tier. */
const TIER_BOILERPLATE_FEATURES = ['Licensed & insured installation'];

// ─── Company-package replacement-tier constants ────────────────────────
// Company-configured tiers use a *different* set of factors than the
// defaults (looser story/pitch curves) because we trust the company's
// configured per-SQ rates more than our default calibration. Hoisting
// surfaces the difference instead of burying it as inline magic in
// `calculateTiersFromCompanyPackages`.
/** Per-additional-story multiplier for company packages (10% wider than defaults). */
const COMPANY_PER_ADDITIONAL_STORY_FACTOR = 0.15;
/** Steep-pitch multiplier for company packages (5pts higher than defaults). */
const COMPANY_PITCH_STEEP_MULTIPLIER = 1.1;
/** Base labor $/SQ before story+pitch+regional multipliers (industry blended). */
const COMPANY_BASE_LABOR_PER_SQ = 85;
/** Tear-off & disposal $/SQ before story+regional multipliers. */
const COMPANY_TEAROFF_PER_SQ = 65;
/** Dumpster & debris-removal flat fee. */
const COMPANY_DUMPSTER_BASE = 450;
/** Per-SQ adder on top of `COMPANY_DUMPSTER_BASE` for larger debris piles. */
const COMPANY_DUMPSTER_PER_SQ = 25;
/** Building-permit + inspection flat fee. */
const COMPANY_PERMIT_COST = 325;

/** Sort order for `good < better < best` tiers in the company-package output. */
const TIER_SORT_ORDER: Record<string, number> = { good: 0, better: 1, best: 2 };
/** Fallback rank for unknown tier names — sorts them after `best` (rank 2). */
const TIER_SORT_FALLBACK_RANK = 3;

/**
 * Parse the rise component of a `"X/12"` pitch string.
 * Returns 0 (treated as flat / not steep) when the input is missing or malformed.
 */
function parsePitchRise(pitch: string | undefined): number {
  if (!pitch) return 0;
  const head = pitch.split('/')[0];
  const n = parseInt(head, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Story multiplier: 1.0 for one story, +`PER_ADDITIONAL_STORY_FACTOR` per extra story. */
function storyMultiplier(stories: number): number {
  return stories > 1 ? 1 + ((stories - 1) * PER_ADDITIONAL_STORY_FACTOR) : 1;
}

/** Pitch multiplier: 1.0 for low slope, `PITCH_STEEP_MULTIPLIER` for steep. */
function pitchMultiplierFor(pitch: string | undefined): number {
  return parsePitchRise(pitch) > PITCH_STEEP_THRESHOLD ? PITCH_STEEP_MULTIPLIER : 1;
}

// ─── Money helpers ────────────────────────────────────────────────────────────

/** Round a dollar amount to whole cents (avoids floating-point drift). */
function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** "1 shingle" vs "5 shingles". */
function pluralS(n: number): string {
  return n === 1 ? '' : 's';
}

/**
 * Parse a CompanyProfile.pricing string into a non-negative dollar amount.
 * Returns 0 for missing, NaN, negative, or non-finite values.
 */
function parseMinimumCost(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Walk an aiDamages list and append a line item for each *new* repair type
 * not already covered by the shingle buckets. Both pricing paths used to
 * have a near-identical version of this loop.
 *
 * `costFn` lets the caller decide how `baseCost` becomes `final` (identity
 * for default pricing, multiplier-applied for company pricing).
 */
function pushAiAdditionalDamages(
  lineItems: RepairEstimate[],
  aiDamages: DamageDetection[] | undefined,
  costFn: (baseCost: number) => { final: number; quantity: number },
): void {
  if (!aiDamages || aiDamages.length === 0) return;
  const seen = new Set<string>();
  for (const damage of aiDamages) {
    const type = damage.type.toLowerCase();
    if (EXCLUDED_AI_DAMAGE_KEYWORDS.some(kw => type.includes(kw))) continue;
    if (seen.has(type)) continue;
    seen.add(type);

    const repairType = REPAIR_TYPES.find(r =>
      r.id.includes(type) || r.name.toLowerCase().includes(type)
    );
    if (!repairType) continue;
    const { final, quantity } = costFn(repairType.baseCost);
    lineItems.push({
      repairTypeId: repairType.id,
      repairName: repairType.name,
      quantity,
      unit: repairType.unit,
      baseCostPerUnit: repairType.baseCost,
      finalCostPerUnit: final,
      totalBaseCost: roundCents(repairType.baseCost * quantity),
      totalFinalCost: roundCents(final * quantity),
    });
  }
}

/**
 * Calculate repair pricing from shingle damage counts.
 * Uses company custom pricing if available, otherwise uses default pricing rules.
 */
export function calculateShingleRepairPricing(params: {
  damageCounts: DamageCounts;
  aiDamages?: DamageDetection[];
  companyProfile: CompanyProfile | null;
  roofSquares?: number;
  state?: string;
}): RepairPricingResult | null {
  const { damageCounts, aiDamages, companyProfile, roofSquares } = params;
  const totalDamaged = damageCounts.windDamaged + damageCounts.hailDamaged + damageCounts.generalDamaged;

  // If no counts and no AI damages, nothing to price
  if (totalDamaged === 0 && (!aiDamages || aiDamages.length === 0)) {
    return null;
  }

  // Check if company has custom repair item pricing
  const hasCustomPricing = companyProfile?.repairItems && companyProfile.repairItems.length > 0;

  // If company has custom pricing, use the old per-square approach with markup
  if (hasCustomPricing) {
    return calculateWithCompanyPricing(params);
  }

  // ── Default pricing: use real-world repair rules ──
  return calculateWithDefaultPricing(params);
}

/**
 * Default pricing: uses the simple shingle-count rules
 * $350 minimum for 1 damaged shingle, +$35 per additional
 */
function calculateWithDefaultPricing(params: {
  damageCounts: DamageCounts;
  aiDamages?: DamageDetection[];
  companyProfile: CompanyProfile | null;
  roofSquares?: number;
  state?: string;
}): RepairPricingResult {
  const { damageCounts, aiDamages, companyProfile, state } = params;
  const lineItems: RepairEstimate[] = [];
  const notes: string[] = [];

  // --- Shingle repairs using simple count-based pricing ---
  for (const def of SHINGLE_BUCKET_DEFS) {
    const count = damageCounts[def.field];
    if (count <= 0) continue;
    const cost = calculateDefaultShingleRepairCost(count);
    const perUnit = count === 1
      ? DEFAULT_REPAIR_PRICING.shingleRepairMinimum
      : roundCents(cost / count);
    lineItems.push({
      repairTypeId: def.id,
      repairName: `${def.label}${REPAIR_LINE_DASH_INFIX}${count}${REPAIR_LINE_SHINGLE_SUFFIX}${pluralS(count)}${REPAIR_LINE_CLOSE_PAREN}`,
      quantity: count,
      unit: SHINGLE_REPAIR_UNIT,
      baseCostPerUnit: perUnit,
      finalCostPerUnit: perUnit,
      totalBaseCost: cost,
      totalFinalCost: cost,
    });
  }

  // --- AI-detected additional damages → use default prices from REPAIR_TYPES ---
  pushAiAdditionalDamages(lineItems, aiDamages, (baseCost) => ({ final: baseCost, quantity: 1 }));

  // Calculate totals
  let subtotal = lineItems.reduce((sum, item) => sum + item.totalFinalCost, 0);
  let total = subtotal;

  // Apply minimum from company settings if configured
  const minimumCost = parseMinimumCost(companyProfile?.pricing);
  let minimumApplied = false;

  // Default minimum is $350 (shingle repair minimum)
  const effectiveMinimum = minimumCost > 0 ? minimumCost : DEFAULT_REPAIR_PRICING.shingleRepairMinimum;
  if (total > 0 && total < effectiveMinimum) {
    total = effectiveMinimum;
    minimumApplied = true;
    notes.push(`${MSG_MINIMUM_PREFIX}${effectiveMinimum.toLocaleString()}${MSG_MINIMUM_SUFFIX}`);
  }

  // Apply regional adjustment if state is provided
  if (state) {
    const regionalFactor = getRegionalFactor(state).factor;
    total = roundCents(total * regionalFactor);
    subtotal = roundCents(subtotal * regionalFactor);
  }

  // Price range — defaults are pre-calibrated market rates, so use the
  // tighter ±15% band.
  const priceRangeLow = Math.round(total * PRICE_RANGE_LOW_DEFAULT);
  const priceRangeHigh = Math.round(total * PRICE_RANGE_HIGH_DEFAULT);

  if (state) {
    notes.push(getRegionalPricingNote(state));
  }

  notes.push(NOTE_REPAIR_ESTIMATE_DISCLAIMER);
  notes.push(NOTE_DEFAULT_RATES);

  return {
    lineItems,
    subtotal: roundCents(subtotal),
    total: roundCents(total),
    priceRangeLow,
    priceRangeHigh,
    minimumApplied,
    markup: 1,
    notes,
  };
}

/**
 * Company-configured pricing: uses the old per-square approach with markup
 */
function calculateWithCompanyPricing(params: {
  damageCounts: DamageCounts;
  aiDamages?: DamageDetection[];
  companyProfile: CompanyProfile | null;
  roofSquares?: number;
  state?: string;
}): RepairPricingResult {
  const { damageCounts, aiDamages, companyProfile, state } = params;

  // ?? not || so a company explicitly setting defaultMarkup=0 (cost-plus
  // pricing) isn't silently overridden by the platform default.
  const markup = companyProfile?.defaultMarkup != null
    ? (1 + companyProfile.defaultMarkup / 100)
    : PRICING_MULTIPLIER;

  const lineItems: RepairEstimate[] = [];
  const notes: string[] = [];

  for (const def of SHINGLE_BUCKET_DEFS) {
    const count = damageCounts[def.field];
    if (count <= 0) continue;
    const quantity = (count / SHINGLES_PER_SQUARE) * REPAIR_OVERHEAD_FACTOR;
    const baseCost = getRepairCost(SHINGLE_REPLACEMENT_PER_SQ_ID, companyProfile);
    const finalCost = roundCents(baseCost * markup);
    lineItems.push({
      repairTypeId: def.id,
      repairName: `${def.label}${REPAIR_LABEL_SHINGLE_REPAIR_SUFFIX}`,
      quantity: roundCents(quantity),
      unit: REPAIR_PER_SQUARE_UNIT,
      baseCostPerUnit: baseCost,
      finalCostPerUnit: finalCost,
      totalBaseCost: roundCents(baseCost * quantity),
      totalFinalCost: roundCents(finalCost * quantity),
    });
  }

  // --- AI-detected additional damages ---
  pushAiAdditionalDamages(lineItems, aiDamages, (baseCost) => ({
    final: roundCents(baseCost * markup),
    quantity: 1,
  }));

  // Calculate totals
  let subtotal = lineItems.reduce((sum, item) => sum + item.totalBaseCost, 0);
  let total = lineItems.reduce((sum, item) => sum + item.totalFinalCost, 0);

  const minimumCost = parseMinimumCost(companyProfile?.pricing);
  let minimumApplied = false;

  if (minimumCost > 0 && total < minimumCost && total > 0) {
    total = minimumCost;
    minimumApplied = true;
    notes.push(`${MSG_MINIMUM_PREFIX}${minimumCost.toLocaleString()}${MSG_MINIMUM_SUFFIX}`);
  }

  // Apply regional adjustment if state is provided
  if (state) {
    const regionalFactor = getRegionalFactor(state).factor;
    total = roundCents(total * regionalFactor);
    subtotal = roundCents(subtotal * regionalFactor);
  }

  // Company pricing → wider ±20% range to leave room for company-specific
  // markup negotiation.
  const priceRangeLow = Math.round(total * PRICE_RANGE_LOW_COMPANY);
  const priceRangeHigh = Math.round(total * PRICE_RANGE_HIGH_COMPANY);

  if (state) {
    notes.push(getRegionalPricingNote(state));
  }

  notes.push(NOTE_REPAIR_ESTIMATE_DISCLAIMER);
  notes.push(NOTE_COMPANY_RATES);

  return {
    lineItems,
    subtotal: roundCents(subtotal),
    total: roundCents(total),
    priceRangeLow,
    priceRangeHigh,
    minimumApplied,
    markup,
    notes,
  };
}

/**
 * Get repair cost for a specific type, checking company overrides first.
 * The previous signature took a redundant `hasCustomPricing` boolean — the
 * presence of `companyProfile.repairItems` is the same condition.
 */
function getRepairCost(
  repairTypeId: string,
  companyProfile: CompanyProfile | null
): number {
  if (companyProfile?.repairItems && companyProfile.repairItems.length > 0) {
    const customItem = companyProfile.repairItems.find(
      item => item.id === repairTypeId || item.name.toLowerCase().includes(REPAIR_SHINGLE_SUBSTRING)
    );
    if (customItem && (customItem as any).price) {
      return (customItem as any).price;
    }
  }

  const standardType = REPAIR_TYPES.find(r => r.id === repairTypeId);
  return standardType?.baseCost || DEFAULT_REPAIR_FALLBACK_COST;
}

/**
 * Calculate Good/Better/Best replacement tiers.
 * Uses company system packages if configured, otherwise uses default material pricing.
 */
/**
 * Resolve the sales-tax rate to apply, as a FRACTION (`0.0725` = 7.25%).
 *
 * Two scales meet here, which is the whole reason this lives in one function:
 * an explicit `taxRate` argument is already a fraction, while the rate saved in
 * the company's own settings is a PERCENT (that field reads "e.g. 7.25"), so it
 * is divided down. An explicit argument wins; otherwise the company's own rate
 * applies. When neither is usable the result is 0 — no tax is invented for a
 * company that has not told us its rate.
 */
function resolveTaxRate(taxRate: number | undefined, companyProfile: CompanyProfile | null): number {
  if (taxRate != null && Number.isFinite(taxRate) && taxRate >= 0) return taxRate;

  const companyPercent = companyProfile?.taxRate;
  if (companyPercent != null && Number.isFinite(companyPercent) && companyPercent > 0) {
    return companyPercent / TAX_PERCENT_TO_FRACTION;
  }

  return NO_TAX_RATE;
}

export function calculateReplacementTiers(params: {
  roofSquares: number;
  pitch?: string;
  stories?: number;
  roofType?: string;
  companyProfile: CompanyProfile | null;
  taxRate?: number;
  state?: string;
}): ReplacementPricingResult | null {
  const { roofSquares, pitch, stories = 1, roofType, companyProfile, taxRate, state } = params;

  if (!Number.isFinite(roofSquares) || roofSquares <= 0) return null;

  const effectiveTaxRate = resolveTaxRate(taxRate, companyProfile);

  // Check if company has system packages configured
  const hasSystemPackages = companyProfile?.systemPackages && companyProfile.systemPackages.length > 0;

  if (hasSystemPackages) {
    return calculateTiersFromCompanyPackages({ ...params, taxRate: effectiveTaxRate });
  }

  // ── No company packages → use default material pricing ──
  return calculateTiersFromDefaults(roofSquares, roofType, stories, pitch, effectiveTaxRate, state);
}

/**
 * Generate replacement tiers from default pricing based on roof material.
 */
function calculateTiersFromDefaults(
  roofSquares: number,
  roofType: string | undefined,
  stories: number,
  pitch: string | undefined,
  taxRate: number,
  state?: string,
): ReplacementPricingResult {
  const material = normalizeMaterialType(roofType || DEFAULT_MATERIAL_TYPE);
  const tierPricing = getDefaultTierPricing(material)!;
  const displayInfo = getTierDisplayInfo(material);

  const storyFactor = storyMultiplier(stories);
  const pitchFactor = pitchMultiplierFor(pitch);
  const regionalFactor = state ? getRegionalFactor(state).factor : 1.0;

  const tiers: EstimateTierData[] = [];

  for (const tier of REPLACEMENT_TIERS_ORDER) {
    const range = tierPricing[tier];
    const midPerSq = tierMidpoint(range);
    const adjustedPerSq = Math.round(midPerSq * storyFactor * pitchFactor);

    // Calculate total from per-SQ rate × roof size, with regional adjustment
    const materialAndLabor = roofSquares * adjustedPerSq * regionalFactor;
    const subtotal = materialAndLabor;
    const tax = roundCents(subtotal * taxRate);
    const total = roundCents(subtotal + tax);

    const warrantyYears = getDefaultWarrantyYears(material, tier);
    const features = getDefaultFeatures(material, tier);
    features.push(`${warrantyYears}${WARRANTY_YEAR_SUFFIX}`);
    features.push(...TIER_BOILERPLATE_FEATURES);

    const info = displayInfo[tier];

    tiers.push({
      tier,
      name: info.name,
      tagline: info.tagline,
      total,
      warranty_years: warrantyYears,
      warranty_description: `${warrantyYears}${WARRANTY_YEAR_SUFFIX}`,
      features,
      recommended: tier === DEFAULT_RECOMMENDED_TIER,
      materials: [
        {
          description: info.name,
          quantity: roofSquares,
          unit: UNIT_SQ,
          unit_price: adjustedPerSq,
          total: materialAndLabor,
        },
      ],
      labor: [],
      other_costs: [],
      subtotal: roundCents(subtotal),
      tax,
    });
  }

  const regionalNote = state ? ` ${getRegionalPricingNote(state)}` : '';

  return {
    tiers,
    recommendation: {
      tier: DEFAULT_RECOMMENDED_TIER,
      reasoning: `${REASONING_PREFIX}${displayInfo[DEFAULT_RECOMMENDED_TIER].name}${REASONING_INFIX}${regionalNote}`,
    },
  };
}

/**
 * Build replacement tiers from company-configured system packages (existing logic).
 */
function calculateTiersFromCompanyPackages(params: {
  roofSquares: number;
  pitch?: string;
  stories?: number;
  roofType?: string;
  companyProfile: CompanyProfile | null;
  taxRate?: number;
  state?: string;
}): ReplacementPricingResult {
  // `taxRate` arrives already resolved from `calculateReplacementTiers`, the
  // only caller; the fallback keeps this branch tax-free rather than guessing.
  const { roofSquares, pitch, stories = 1, companyProfile, taxRate = NO_TAX_RATE, state } = params;

  const packages = companyProfile!.systemPackages;
  const companyStoryFactor = stories > 1
    ? 1 + ((stories - 1) * COMPANY_PER_ADDITIONAL_STORY_FACTOR)
    : 1;
  const isPitched = pitch ? parseInt(pitch.split(PITCH_SEPARATOR)[0]) > PITCH_STEEP_THRESHOLD : false;
  const companyPitchFactor = isPitched ? COMPANY_PITCH_STEEP_MULTIPLIER : 1;

  const tiers: EstimateTierData[] = [];

  for (const pkg of packages) {
    if (pkg.tier === PACKAGE_TIER_CUSTOM) continue;

    const shingleProduct = findShingleProduct(pkg, companyProfile);

    const materialCostPerSq = shingleProduct?.pricePerSq ||
      getProductPricePerSq(pkg.tier, companyProfile);

    const markup = pkg.markupPercent ? (1 + pkg.markupPercent / 100) : 1;
    const laborMultiplier = pkg.laborMultiplier || 1;

    const baseLaborPerSq = COMPANY_BASE_LABOR_PER_SQ * laborMultiplier * companyStoryFactor * companyPitchFactor;

    const regionalFactor = state ? getRegionalFactor(state).factor : 1.0;
    const materialTotal = roofSquares * materialCostPerSq * markup * regionalFactor;
    const laborTotal = roofSquares * baseLaborPerSq * regionalFactor;
    const tearOffTotal = roofSquares * COMPANY_TEAROFF_PER_SQ * companyStoryFactor * regionalFactor;
    const otherCosts = COMPANY_DUMPSTER_BASE + (roofSquares * COMPANY_DUMPSTER_PER_SQ) + COMPANY_PERMIT_COST;

    const subtotal = materialTotal + laborTotal + tearOffTotal + otherCosts;
    const tax = roundCents(subtotal * taxRate);
    const total = roundCents(subtotal + tax);

    const warrantyYears = pkg.warrantyYears || getDefaultWarrantyCompany(pkg.tier);

    tiers.push({
      tier: pkg.tier,
      name: pkg.name || getDefaultTierNameCompany(pkg.tier),
      tagline: pkg.description || getDefaultTaglineCompany(pkg.tier),
      total,
      warranty_years: warrantyYears,
      warranty_description: `${warrantyYears}-year workmanship warranty`,
      features: buildFeatureList(pkg, shingleProduct),
      recommended: pkg.tier === DEFAULT_RECOMMENDED_TIER,
      materials: [
        {
          description: shingleProduct?.productLine || getMaterialName(pkg.tier),
          details: shingleProduct
            ? `${shingleProduct.manufacturer} - ${shingleProduct.description}`
            : undefined,
          brand: shingleProduct?.manufacturer,
          quantity: roofSquares,
          unit: UNIT_SQ,
          unit_price: roundCents(materialCostPerSq * markup),
          total: roundCents(materialTotal),
        },
      ],
      labor: [
        {
          description: 'Tear Off & Disposal',
          quantity: roofSquares,
          unit: UNIT_SQ,
          unit_price: roundCents(COMPANY_TEAROFF_PER_SQ * companyStoryFactor),
          total: roundCents(tearOffTotal),
        },
        {
          description: 'Installation',
          quantity: roofSquares,
          unit: UNIT_SQ,
          unit_price: roundCents(baseLaborPerSq),
          total: roundCents(laborTotal),
        },
      ],
      other_costs: [
        { item: 'Dumpster & Disposal', description: 'Debris removal', amount: COMPANY_DUMPSTER_BASE + (roofSquares * COMPANY_DUMPSTER_PER_SQ) },
        { item: 'Permit & Inspection', description: 'Building permit', amount: COMPANY_PERMIT_COST },
      ],
      subtotal: roundCents(subtotal),
      tax,
    });
  }

  tiers.sort((a, b) =>
    (TIER_SORT_ORDER[a.tier] ?? TIER_SORT_FALLBACK_RANK) -
    (TIER_SORT_ORDER[b.tier] ?? TIER_SORT_FALLBACK_RANK),
  );

  const regionalNote = state ? ` ${getRegionalPricingNote(state)}` : '';

  return {
    tiers,
    recommendation: {
      tier: DEFAULT_RECOMMENDED_TIER,
      reasoning: `The Enhanced tier provides the best balance of protection, warranty coverage, and value.${regionalNote}`,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findShingleProduct(
  pkg: SystemPackage,
  _profile: CompanyProfile | null
): ShingleProduct | undefined {
  if (!pkg.components || pkg.components.length === 0) return undefined;
  for (const compId of pkg.components) {
    const product = findProductById(compId);
    if (product) return product;
  }
  return undefined;
}

function getProductPricePerSq(tier: string, profile: CompanyProfile | null): number {
  if (profile?.productItems && profile.productItems.length > 0) {
    const tierProducts = profile.productItems.filter((p: ProductItem) =>
      p.name.toLowerCase().includes(tier)
    );
    if (tierProducts.length > 0 && tierProducts[0].pricePerSq) {
      return tierProducts[0].pricePerSq;
    }
  }

  const defaults: Record<string, number> = {
    good: 105,
    better: 145,
    best: 225,
  };
  return defaults[tier] || 145;
}

function getDefaultWarrantyCompany(tier: string): number {
  return { good: 10, better: 15, best: 25 }[tier] || 15;
}

function getDefaultTierNameCompany(tier: string): string {
  return {
    good: 'Essential Protection',
    better: 'Enhanced Performance',
    best: 'Ultimate Protection',
  }[tier] || 'Standard';
}

function getDefaultTaglineCompany(tier: string): string {
  return {
    good: 'Reliable protection with solid budget value',
    better: 'Enhanced wind and impact ratings - most popular choice',
    best: 'Maximum protection with premium materials and warranty',
  }[tier] || '';
}

function getMaterialName(tier: string): string {
  return {
    good: 'Architectural Shingles',
    better: 'Premium Architectural Shingles',
    best: 'Designer Shingles',
  }[tier] || 'Architectural Shingles';
}

function buildFeatureList(pkg: SystemPackage, product: ShingleProduct | undefined): string[] {
  const features: string[] = [];

  if (product) {
    features.push(...product.features.slice(0, 4));
    if (product.impactRating !== 'N/A') {
      features.push(`${product.impactRating} impact rating`);
    }
  } else {
    const tier = pkg.tier;
    if (tier === 'good') {
      features.push('Architectural shingles', 'Synthetic underlayment', 'Standard ventilation');
    } else if (tier === 'better') {
      features.push('Premium shingles', 'Ice & water shield', 'Ridge vent system', 'Premium pipe boots');
    } else if (tier === 'best') {
      features.push('Designer shingles', 'Full deck protection', 'All new flashings', 'Premium ventilation');
    }
  }

  features.push(`${pkg.warrantyYears || getDefaultWarrantyCompany(pkg.tier)}-year workmanship warranty`);
  features.push('Licensed & insured installation');
  return features;
}
