/**
 * Default Pricing Constants for All Roofing Materials
 *
 * Used when a company has no custom pricing configured in Settings.
 * Company-specific pricing (repairItems, systemPackages) always overrides these.
 *
 * Pricing is based on 2025 industry averages for the Southeast US market.
 */

// ─── Repair Pricing Defaults ─────────────────────────────────────────────────

export interface DefaultRepairPricing {
  // Shingle repair
  shingleRepairMinimum: number;
  shingleRepairPerAdditional: number;

  // Pipe boot replacement (full replacement)
  pipeBootSingle: number;
  pipeBootMultiple: number;

  // Perma boot (retrofit over existing boot)
  permaBootSingle: number;
  permaBoot2to3: number;
  permaBoot4plus: number;
  permaBootWithTuneUp: number;

  // Individual repairs
  satelliteRemoval: number;
  chimneyFlashingWithReplacement: number;
  chimneyFlashingStandalone: number;
  ventReplacement: number;
  ridgeVentBase: number;
  ridgeVentPerLF: number;

  // Tune-Up packages
  tuneUpBasicPerSQ: number;
  tuneUpBasicMinimum: number;
  tuneUpAdvancedPerSQ: number;
  tuneUpAdvancedMinimum: number;
}

export const DEFAULT_REPAIR_PRICING: DefaultRepairPricing = {
  // Shingle repair: $350 minimum for 1 shingle, +$35 each additional
  shingleRepairMinimum: 350,
  shingleRepairPerAdditional: 35,

  // Pipe boot: $400 for 1, $350 each for 2+
  pipeBootSingle: 400,
  pipeBootMultiple: 350,

  // Perma boot: $350 for 1, $300 for 2-3, $250 for 4+, $200 with tune-up
  permaBootSingle: 350,
  permaBoot2to3: 300,
  permaBoot4plus: 250,
  permaBootWithTuneUp: 200,

  // Individual repairs
  satelliteRemoval: 400,
  chimneyFlashingWithReplacement: 400,
  chimneyFlashingStandalone: 1200,
  ventReplacement: 400,
  ridgeVentBase: 400,
  ridgeVentPerLF: 25,

  // Tune-Up packages
  tuneUpBasicPerSQ: 25,
  tuneUpBasicMinimum: 350,
  tuneUpAdvancedPerSQ: 50,
  tuneUpAdvancedMinimum: 650,
};

// ─── Replacement Tier Pricing Defaults ───────────────────────────────────────

export interface TierRange {
  low: number;
  high: number;
}

export interface MaterialTierPricing {
  good: TierRange;
  better: TierRange;
  best: TierRange;
}

/** All supported roofing material types */
export type RoofMaterialType =
  | 'asphalt_shingle'
  | 'metal_standing_seam'
  | 'tpo'
  | 'pvc'
  | 'epdm'
  | 'flat_roof'          // Generic flat — maps to TPO defaults
  | 'modified_bitumen'
  | 'bur'                // Built-up roofing
  | 'tile_concrete'
  | 'tile_clay'
  | 'tile_s'
  | 'tile'               // Generic tile — maps to concrete defaults
  | 'cedar_shake'
  | 'slate'
  | 'coating_commercial'
  | 'coating_residential'
  | 'treatment_roofmaxx';

/**
 * Default replacement pricing per roofing square (100 sqft) by material.
 * Each tier has a low-high range. Reports use the midpoint for the estimate
 * and display the low-high as the price range.
 */
export const DEFAULT_REPLACEMENT_TIERS: Record<string, MaterialTierPricing> = {
  // ── Asphalt Shingles ──
  asphalt_shingle: {
    good:   { low: 375, high: 425 },
    better: { low: 425, high: 475 },
    best:   { low: 500, high: 600 },
  },

  // ── Standing Seam Metal ──
  metal_standing_seam: {
    good:   { low: 800,  high: 900 },
    better: { low: 1000, high: 1200 },
    best:   { low: 1200, high: 1600 },
  },

  // ── Flat / Low-Slope (TPO, PVC, EPDM — 50 mil w/ ISO boards) ──
  tpo: {
    good:   { low: 800,  high: 900 },
    better: { low: 900,  high: 1000 },
    best:   { low: 1000, high: 1200 },
  },
  pvc: {
    good:   { low: 800,  high: 900 },
    better: { low: 900,  high: 1000 },
    best:   { low: 1000, high: 1200 },
  },
  epdm: {
    good:   { low: 800,  high: 900 },
    better: { low: 900,  high: 1000 },
    best:   { low: 1000, high: 1200 },
  },
  flat_roof: {
    good:   { low: 800,  high: 900 },
    better: { low: 900,  high: 1000 },
    best:   { low: 1000, high: 1200 },
  },
  modified_bitumen: {
    good:   { low: 400,  high: 500 },
    better: { low: 500,  high: 600 },
    best:   { low: 650,  high: 750 },
  },
  bur: {
    good:   { low: 500,  high: 600 },
    better: { low: 600,  high: 750 },
    best:   { low: 750,  high: 900 },
  },

  // ── Tile ──
  tile_concrete: {
    good:   { low: 800,  high: 1200 },
    better: { low: 1200, high: 1600 },
    best:   { low: 1600, high: 2200 },
  },
  tile_s: {
    good:   { low: 800,  high: 1200 },
    better: { low: 1200, high: 1600 },
    best:   { low: 1600, high: 2200 },
  },
  tile_clay: {
    good:   { low: 800,  high: 1200 },
    better: { low: 1200, high: 1600 },
    best:   { low: 1600, high: 2200 },
  },
  tile: {
    good:   { low: 800,  high: 1200 },
    better: { low: 1200, high: 1600 },
    best:   { low: 1600, high: 2200 },
  },

  // ── Cedar Shake ──
  cedar_shake: {
    good:   { low: 900,  high: 1100 },
    better: { low: 1100, high: 1400 },
    best:   { low: 1400, high: 1800 },
  },

  // ── Slate ── (single tier, wide range)
  slate: {
    good:   { low: 1500, high: 2000 },
    better: { low: 2000, high: 2500 },
    best:   { low: 2500, high: 3000 },
  },

  // ── Coatings & Treatments ── (not true G/B/B tiers, but fits the structure)
  coating_commercial: {
    good:   { low: 750,  high: 800 },
    better: { low: 800,  high: 850 },
    best:   { low: 850,  high: 900 },
  },
  coating_residential: {
    good:   { low: 250,  high: 300 },
    better: { low: 300,  high: 350 },
    best:   { low: 350,  high: 400 },
  },
  treatment_roofmaxx: {
    good:   { low: 200,  high: 225 },
    better: { low: 225,  high: 250 },
    best:   { low: 250,  high: 275 },
  },
};

// ─── Tier Display Names by Material ──────────────────────────────────────────

export interface TierDisplayInfo {
  good: { name: string; tagline: string };
  better: { name: string; tagline: string };
  best: { name: string; tagline: string };
}

const TIER_DISPLAY: Record<string, TierDisplayInfo> = {
  asphalt_shingle: {
    good:   { name: 'Essential Protection',  tagline: 'Reliable architectural shingles at a great value' },
    better: { name: 'Enhanced Performance',  tagline: 'Premium shingles with enhanced wind & impact ratings' },
    best:   { name: 'Ultimate Protection',   tagline: 'Designer shingles with maximum warranty coverage' },
  },
  metal_standing_seam: {
    good:   { name: 'Standard Metal',        tagline: 'Exposed fastener or corrugated metal roofing' },
    better: { name: 'Standing Seam',         tagline: 'Concealed fastener standing seam metal roof' },
    best:   { name: 'Premium Metal',         tagline: 'Premium gauge standing seam with copper accents' },
  },
  tpo: {
    good:   { name: 'Standard TPO',          tagline: '50 mil TPO with minimum ISO insulation' },
    better: { name: 'Enhanced TPO',          tagline: '60 mil TPO with upgraded insulation' },
    best:   { name: 'Premium TPO',           tagline: '80 mil TPO with full insulation package' },
  },
  pvc: {
    good:   { name: 'Standard PVC',          tagline: '50 mil PVC with minimum ISO insulation' },
    better: { name: 'Enhanced PVC',          tagline: '60 mil PVC with upgraded insulation' },
    best:   { name: 'Premium PVC',           tagline: '80 mil PVC with full insulation package' },
  },
  epdm: {
    good:   { name: 'Standard EPDM',         tagline: '45 mil EPDM with minimum ISO insulation' },
    better: { name: 'Enhanced EPDM',         tagline: '60 mil EPDM with upgraded insulation' },
    best:   { name: 'Premium EPDM',          tagline: '90 mil EPDM with full insulation package' },
  },
  flat_roof: {
    good:   { name: 'Standard System',       tagline: '50 mil membrane with minimum ISO insulation' },
    better: { name: 'Enhanced System',        tagline: '60 mil membrane with upgraded insulation' },
    best:   { name: 'Premium System',        tagline: '80 mil membrane with full insulation package' },
  },
  modified_bitumen: {
    good:   { name: 'Standard Mod-Bit',      tagline: '2-ply modified bitumen with smooth surface' },
    better: { name: 'Enhanced Mod-Bit',      tagline: '3-ply modified bitumen with granule cap sheet' },
    best:   { name: 'Premium Mod-Bit',       tagline: 'Multi-ply mod-bit with reflective cap sheet' },
  },
  bur: {
    good:   { name: 'Standard BUR',          tagline: '3-ply built-up roof with gravel surface' },
    better: { name: 'Enhanced BUR',          tagline: '4-ply built-up roof with mineral cap sheet' },
    best:   { name: 'Premium BUR',           tagline: '5-ply built-up roof with reflective coating' },
  },
  tile_concrete: {
    good:   { name: 'Concrete Tile',         tagline: 'Durable concrete flat or profile tile' },
    better: { name: 'S-Tile',                tagline: 'Classic S-curve profile concrete tile' },
    best:   { name: 'Clay Barrel Tile',      tagline: 'Premium clay barrel tile with lifetime durability' },
  },
  tile: {
    good:   { name: 'Concrete Tile',         tagline: 'Durable concrete flat or profile tile' },
    better: { name: 'S-Tile',                tagline: 'Classic S-curve profile concrete tile' },
    best:   { name: 'Clay Barrel Tile',      tagline: 'Premium clay barrel tile with lifetime durability' },
  },
  tile_clay: {
    good:   { name: 'Standard Clay',         tagline: 'Classic clay tile roofing' },
    better: { name: 'Premium Clay',          tagline: 'Premium clay tile with enhanced profiles' },
    best:   { name: 'Custom Clay',           tagline: 'Custom clay tile with designer profiles' },
  },
  tile_s: {
    good:   { name: 'Standard S-Tile',       tagline: 'Classic S-curve profile tile' },
    better: { name: 'Premium S-Tile',        tagline: 'Premium S-tile with enhanced color options' },
    best:   { name: 'Designer S-Tile',       tagline: 'Designer S-tile with custom finishes' },
  },
  cedar_shake: {
    good:   { name: 'Standard Cedar',        tagline: 'Machine-split cedar shakes' },
    better: { name: 'Premium Cedar',         tagline: 'Hand-split medium cedar shakes' },
    best:   { name: 'Heavy Cedar',           tagline: 'Hand-split heavy cedar shakes with premium grade' },
  },
  slate: {
    good:   { name: 'Standard Slate',        tagline: 'Natural slate roofing - standard thickness' },
    better: { name: 'Premium Slate',         tagline: 'Premium grade natural slate' },
    best:   { name: 'Architectural Slate',   tagline: 'Thick-cut architectural grade natural slate' },
  },
  coating_commercial: {
    good:   { name: 'Standard Coating',      tagline: 'Acrylic roof coating system' },
    better: { name: 'Enhanced Coating',      tagline: 'Silicone or acrylic with reinforcement' },
    best:   { name: 'Premium Coating',       tagline: 'Multi-layer silicone system with warranty' },
  },
  coating_residential: {
    good:   { name: 'Basic Coating',         tagline: 'Single-coat silicone application' },
    better: { name: 'Standard Coating',      tagline: 'Two-coat silicone system' },
    best:   { name: 'Premium Coating',       tagline: 'Full silicone system with primer and topcoat' },
  },
  treatment_roofmaxx: {
    good:   { name: 'Single Treatment',      tagline: 'One application of bio-oil rejuvenation' },
    better: { name: 'Treatment + Inspection', tagline: 'Treatment with full roof inspection report' },
    best:   { name: 'Treatment Package',     tagline: 'Treatment with inspection and 5-year plan' },
  },
};

// ─── Default Warranty Years by Material ──────────────────────────────────────

const DEFAULT_WARRANTIES: Record<string, { good: number; better: number; best: number }> = {
  asphalt_shingle:    { good: 10, better: 15, best: 25 },
  metal_standing_seam: { good: 20, better: 30, best: 50 },
  tpo:                { good: 10, better: 15, best: 20 },
  pvc:                { good: 10, better: 15, best: 20 },
  epdm:               { good: 10, better: 15, best: 20 },
  flat_roof:          { good: 10, better: 15, best: 20 },
  modified_bitumen:   { good: 10, better: 15, best: 20 },
  bur:                { good: 10, better: 15, best: 20 },
  tile_concrete:      { good: 25, better: 30, best: 50 },
  tile_clay:          { good: 25, better: 30, best: 50 },
  tile_s:             { good: 25, better: 30, best: 50 },
  tile:               { good: 25, better: 30, best: 50 },
  cedar_shake:        { good: 15, better: 20, best: 30 },
  slate:              { good: 30, better: 50, best: 75 },
  coating_commercial: { good: 5,  better: 10, best: 15 },
  coating_residential: { good: 5,  better: 7,  best: 10 },
  treatment_roofmaxx: { good: 5,  better: 5,  best: 5 },
};

// ─── Default Features by Material ────────────────────────────────────────────

const DEFAULT_FEATURES: Record<string, { good: string[]; better: string[]; best: string[] }> = {
  asphalt_shingle: {
    good:   ['Architectural shingles', 'Synthetic underlayment', 'Standard ventilation', 'New drip edge'],
    better: ['Premium architectural shingles', 'Ice & water shield at eaves', 'Ridge vent system', 'New pipe boots'],
    best:   ['Designer shingles', 'Full deck ice & water shield', 'All new flashings', 'Premium ventilation system'],
  },
  metal_standing_seam: {
    good:   ['26-gauge panels', 'Standard underlayment', 'Factory color finish', 'Standard trim'],
    better: ['24-gauge panels', 'Synthetic underlayment', 'Kynar 500 finish', 'Custom trim package'],
    best:   ['22-gauge panels', 'Ice & water shield full deck', 'Premium Kynar finish', 'Copper accent trim'],
  },
  tpo: {
    good:   ['50 mil TPO membrane', 'Min ISO insulation', 'Standard flashing', 'Mechanically attached'],
    better: ['60 mil TPO membrane', 'R-20 ISO insulation', 'Custom metal edge', 'Fully adhered'],
    best:   ['80 mil TPO membrane', 'R-30 ISO insulation', 'Full perimeter metal', 'Fully adhered w/ warranty'],
  },
  pvc: {
    good:   ['50 mil PVC membrane', 'Min ISO insulation', 'Standard flashing', 'Mechanically attached'],
    better: ['60 mil PVC membrane', 'R-20 ISO insulation', 'Custom metal edge', 'Fully adhered'],
    best:   ['80 mil PVC membrane', 'R-30 ISO insulation', 'Full perimeter metal', 'Fully adhered w/ warranty'],
  },
  epdm: {
    good:   ['45 mil EPDM membrane', 'Min ISO insulation', 'Standard flashing', 'Ballasted system'],
    better: ['60 mil EPDM membrane', 'R-20 ISO insulation', 'Custom flashing', 'Fully adhered'],
    best:   ['90 mil EPDM membrane', 'R-30 ISO insulation', 'Full perimeter metal', 'Fully adhered w/ warranty'],
  },
  flat_roof: {
    good:   ['50 mil membrane', 'Min ISO insulation', 'Standard flashing', 'Mechanically attached'],
    better: ['60 mil membrane', 'R-20 ISO insulation', 'Custom metal edge', 'Fully adhered'],
    best:   ['80 mil membrane', 'R-30 ISO insulation', 'Full perimeter metal', 'Fully adhered w/ warranty'],
  },
  modified_bitumen: {
    good:   ['2-ply mod-bit system', 'Smooth surface cap', 'Standard base sheet', 'Torch-applied'],
    better: ['3-ply mod-bit system', 'Granule cap sheet', 'Fiberglass base', 'Torch or cold-applied'],
    best:   ['Multi-ply mod-bit system', 'Reflective cap sheet', 'Premium fiberglass base', 'Full warranty package'],
  },
  bur: {
    good:   ['3-ply BUR system', 'Gravel surfacing', 'Standard felt layers', 'Hot-mopped'],
    better: ['4-ply BUR system', 'Mineral cap sheet', 'Fiberglass felts', 'Hot-mopped w/ insulation'],
    best:   ['5-ply BUR system', 'Reflective coating', 'Premium fiberglass felts', 'Full insulation package'],
  },
  tile_concrete: {
    good:   ['Concrete flat tile', 'Synthetic underlayment', 'Standard battens', 'New flashing'],
    better: ['S-curve profile tile', 'Ice & water shield', 'Treated battens', 'Copper flashing'],
    best:   ['Clay barrel tile', 'Full deck protection', 'Stainless battens', 'All copper flashings'],
  },
  tile: {
    good:   ['Concrete flat tile', 'Synthetic underlayment', 'Standard battens', 'New flashing'],
    better: ['S-curve profile tile', 'Ice & water shield', 'Treated battens', 'Copper flashing'],
    best:   ['Clay barrel tile', 'Full deck protection', 'Stainless battens', 'All copper flashings'],
  },
  tile_clay: {
    good:   ['Standard clay tile', 'Synthetic underlayment', 'Standard battens', 'New flashing'],
    better: ['Premium clay tile', 'Ice & water shield', 'Treated battens', 'Copper flashing'],
    best:   ['Custom clay tile', 'Full deck protection', 'Stainless battens', 'All copper flashings'],
  },
  tile_s: {
    good:   ['Standard S-tile', 'Synthetic underlayment', 'Standard battens', 'New flashing'],
    better: ['Premium S-tile', 'Ice & water shield', 'Treated battens', 'Copper flashing'],
    best:   ['Designer S-tile', 'Full deck protection', 'Stainless battens', 'All copper flashings'],
  },
  cedar_shake: {
    good:   ['Machine-split shakes', 'Breathable underlayment', 'Standard spaced sheathing', 'Galvanized nails'],
    better: ['Hand-split medium shakes', 'Premium underlayment', 'Spaced sheathing', 'Stainless nails'],
    best:   ['Hand-split heavy shakes', 'Full deck + breathable', 'Premium sheathing system', 'Stainless + copper flashings'],
  },
  slate: {
    good:   ['Standard thickness slate', 'Ice & water shield', 'Copper nails', 'Standard flashing'],
    better: ['Premium grade slate', 'Full deck protection', 'Copper nails & flashings', 'Custom detailing'],
    best:   ['Thick-cut architectural slate', 'Full copper system', 'Custom copper flashings', 'Architectural detailing'],
  },
  coating_commercial: {
    good:   ['Acrylic coating system', 'Power wash prep', 'Seam treatment', '5-year warranty'],
    better: ['Silicone coating system', 'Power wash + prime', 'Fabric reinforcement at seams', '10-year warranty'],
    best:   ['Multi-layer silicone system', 'Full prep + primer', 'Full fabric reinforcement', '15-year warranty'],
  },
  coating_residential: {
    good:   ['Single-coat silicone', 'Basic surface prep', 'Seam sealing', '5-year warranty'],
    better: ['Two-coat silicone', 'Power wash prep', 'Seam reinforcement', '7-year warranty'],
    best:   ['Full silicone system', 'Complete prep + primer', 'Full reinforcement', '10-year warranty'],
  },
  treatment_roofmaxx: {
    good:   ['Single bio-oil application', 'Extends roof life 5 years', 'Restores flexibility', 'Non-toxic formula'],
    better: ['Bio-oil treatment', 'Full roof inspection', 'Detailed condition report', '5-year retreatment plan'],
    best:   ['Bio-oil treatment', 'Full inspection + report', 'Minor repairs included', 'Maintenance schedule'],
  },
};

// ─── Helper Functions ────────────────────────────────────────────────────────

/** The recognised tier names. Distinguishes the three pricing brackets. */
export type TierName = 'good' | 'better' | 'best';

/** The fallback material slug used everywhere `material` lookups miss. */
export const DEFAULT_MATERIAL: RoofMaterialType = 'asphalt_shingle';

/**
 * Look up `material` in `record` after normalising it; fall back to the
 * `DEFAULT_MATERIAL` row if the key isn't present. Centralises the
 * `RECORD[normalized] || RECORD['asphalt_shingle']` idiom that used to
 * repeat in four helpers.
 */
function lookupByMaterial<T>(record: Record<string, T>, material: string): T {
  const normalized = normalizeMaterialType(material);
  return record[normalized] ?? record[DEFAULT_MATERIAL];
}

/** Get the default repair pricing constants */
export function getDefaultRepairPricing(): DefaultRepairPricing {
  return DEFAULT_REPAIR_PRICING;
}

/** Get default replacement tier pricing for a material type */
export function getDefaultTierPricing(material: string): MaterialTierPricing | null {
  return lookupByMaterial(DEFAULT_REPLACEMENT_TIERS, material);
}

/** Get the midpoint of a tier range */
export function tierMidpoint(range: TierRange): number {
  return Math.round((range.low + range.high) / 2);
}

/** Get display info (name + tagline) for a material's tiers */
export function getTierDisplayInfo(material: string): TierDisplayInfo {
  return lookupByMaterial(TIER_DISPLAY, material);
}

/** Get default warranty years for a material */
export function getDefaultWarrantyYears(material: string, tier: TierName): number {
  return lookupByMaterial(DEFAULT_WARRANTIES, material)[tier];
}

/** Get default feature list for a material tier */
export function getDefaultFeatures(material: string, tier: TierName): string[] {
  return [...lookupByMaterial(DEFAULT_FEATURES, material)[tier]];
}

/**
 * Calculate shingle repair cost using default pricing rules.
 * Formula: max($350, 350 + (count - 1) * 35)
 */
export function calculateDefaultShingleRepairCost(damagedCount: number): number {
  if (!Number.isFinite(damagedCount) || damagedCount <= 0) return 0;
  if (damagedCount === 1) return DEFAULT_REPAIR_PRICING.shingleRepairMinimum;
  return DEFAULT_REPAIR_PRICING.shingleRepairMinimum +
    (damagedCount - 1) * DEFAULT_REPAIR_PRICING.shingleRepairPerAdditional;
}

/**
 * Calculate pipe boot replacement cost based on quantity.
 * 1 boot = $400, 2+ = $350 each
 */
export function calculatePipeBootCost(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count === 1) return DEFAULT_REPAIR_PRICING.pipeBootSingle;
  return count * DEFAULT_REPAIR_PRICING.pipeBootMultiple;
}

/**
 * Calculate perma boot (retrofit) cost based on quantity and context.
 * 1 = $350, 2-3 = $300 each, 4+ = $250 each, with tune-up = $200 each
 */
export function calculatePermaBootCost(count: number, withTuneUp: boolean = false): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (withTuneUp) return count * DEFAULT_REPAIR_PRICING.permaBootWithTuneUp;
  if (count === 1) return DEFAULT_REPAIR_PRICING.permaBootSingle;
  if (count <= 3) return count * DEFAULT_REPAIR_PRICING.permaBoot2to3;
  return count * DEFAULT_REPAIR_PRICING.permaBoot4plus;
}

/**
 * Calculate ridge vent replacement cost.
 * $400 base + $25/LF — base fee applies whenever ridge vent work is scoped,
 * even at 0 LF (mobilization/setup minimum). Negative or non-finite inputs
 * fall through to 0.
 */
export function calculateRidgeVentCost(linearFeet: number): number {
  if (!Number.isFinite(linearFeet) || linearFeet < 0) return 0;
  return DEFAULT_REPAIR_PRICING.ridgeVentBase +
    linearFeet * DEFAULT_REPAIR_PRICING.ridgeVentPerLF;
}

/**
 * Calculate tune-up cost.
 * Basic: $25/SQ, $350 min. Advanced: $50/SQ, $650 min.
 */
export function calculateTuneUpCost(
  roofSquares: number,
  type: 'basic' | 'advanced'
): number {
  if (!Number.isFinite(roofSquares) || roofSquares <= 0) return 0;
  if (type === 'basic') {
    return Math.max(
      DEFAULT_REPAIR_PRICING.tuneUpBasicMinimum,
      roofSquares * DEFAULT_REPAIR_PRICING.tuneUpBasicPerSQ
    );
  }
  return Math.max(
    DEFAULT_REPAIR_PRICING.tuneUpAdvancedMinimum,
    roofSquares * DEFAULT_REPAIR_PRICING.tuneUpAdvancedPerSQ
  );
}

// ─── Material Normalization ──────────────────────────────────────────────────

/**
 * Whitespace/dash collapse regex used to canonicalise material slugs
 * (`'Asphalt Shingle'` → `'asphalt_shingle'`). Hoisted to module scope so
 * every `normalizeMaterialType` call reuses the same compiled regex.
 */
const MATERIAL_NORMALIZE_RE = /[-\s]+/g;

/**
 * Ordered fuzzy-match table for `normalizeMaterialType`. The first row
 * whose `match(lower)` predicate returns true wins. Order matters — more
 * specific tiles (clay/concrete/s) must precede the generic 'tile' bucket;
 * 'coating + commercial' must precede generic 'coating' etc.
 */
type MaterialMatcher = {
  match: (lower: string) => boolean;
  result: RoofMaterialType;
};
const MATERIAL_MATCHERS: readonly MaterialMatcher[] = [
  { match: l => l.includes('asphalt') || l.includes('shingle') || l.includes('comp'), result: 'asphalt_shingle' },
  { match: l => l.includes('metal') || l.includes('standing_seam') || l.includes('steel'), result: 'metal_standing_seam' },
  { match: l => l.includes('tpo'), result: 'tpo' },
  { match: l => l.includes('pvc'), result: 'pvc' },
  { match: l => l.includes('epdm') || l.includes('rubber'), result: 'epdm' },
  { match: l => l.includes('modified') || l.includes('mod_bit') || l.includes('bitumen'), result: 'modified_bitumen' },
  { match: l => l.includes('built_up') || l === 'bur', result: 'bur' },
  { match: l => l.includes('flat') || l.includes('low_slope') || l.includes('membrane'), result: 'flat_roof' },
  { match: l => l.includes('clay') && l.includes('tile'), result: 'tile_clay' },
  { match: l => l.includes('concrete') && l.includes('tile'), result: 'tile_concrete' },
  { match: l => l.includes('s_tile') || l.includes('s-tile'), result: 'tile_s' },
  { match: l => l.includes('tile'), result: 'tile' },
  { match: l => l.includes('cedar') || l.includes('shake') || l.includes('wood'), result: 'cedar_shake' },
  { match: l => l.includes('slate'), result: 'slate' },
  { match: l => l.includes('coating') && l.includes('commercial'), result: 'coating_commercial' },
  { match: l => l.includes('coating') || l.includes('silicone') || l.includes('acrylic'), result: 'coating_residential' },
  { match: l => l.includes('roofmaxx') || l.includes('treatment'), result: 'treatment_roofmaxx' },
];

/** Normalize various material name formats to our standard keys */
export function normalizeMaterialType(input: string): string {
  if (!input) return DEFAULT_MATERIAL;

  const lower = input.toLowerCase().replace(MATERIAL_NORMALIZE_RE, '_').trim();

  // Direct matches against the full pricing table
  if (DEFAULT_REPLACEMENT_TIERS[lower]) return lower;

  // Fuzzy matches via the ordered matcher list
  for (const matcher of MATERIAL_MATCHERS) {
    if (matcher.match(lower)) return matcher.result;
  }

  return DEFAULT_MATERIAL;
}
