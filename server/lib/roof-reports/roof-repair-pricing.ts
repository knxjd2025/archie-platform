/**
 * Roof Repair Pricing Service
 * Research-based pricing with 1.65x markup multiplier to ensure competitive margins.
 *
 * Base prices are industry averages for 2024-2025.
 * All prices are multiplied by 1.65 for final customer pricing.
 */

/**
 * Default gross-margin multiplier applied on top of researched base costs
 * to land at customer-facing pricing. Companies can override per-company via
 * `companyProfile.defaultMarkup` (see `lib/roof-report-pricing.ts`).
 */
export const PRICING_MULTIPLIER = 1.65;

/** Round a dollar amount to whole cents — single source of truth for cent rounding. */
function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export type RepairUnit = 'each' | 'sq' | 'lf' | 'sqft' | 'sheet' | 'bundle';

/** Repair-type category — the seven category buckets a `RepairType` can live in. */
export type RepairCategory =
  | 'shingle'
  | 'flashing'
  | 'structure'
  | 'accessory'
  | 'emergency'
  | 'gutter';

export interface RepairType {
  id: string;
  name: string;
  description: string;
  baseCost: number;
  unit: RepairUnit;
  category: RepairCategory;
  laborIntensive: boolean;
}

export interface RepairEstimate {
  repairTypeId: string;
  repairName: string;
  quantity: number;
  unit: RepairUnit;
  baseCostPerUnit: number;
  finalCostPerUnit: number;
  totalBaseCost: number;
  totalFinalCost: number;
}

export interface RepairEstimateSummary {
  lineItems: RepairEstimate[];
  subtotalBase: number;
  subtotalFinal: number;
  multiplier: number;
  generatedAt: string;
}

/**
 * Repair types with base costs (before 1.65x multiplier)
 * Based on 2024-2025 industry averages
 */
export const REPAIR_TYPES: RepairType[] = [
  // Shingle repairs
  {
    id: 'shingle_replacement_per_sq',
    name: 'Shingle Replacement',
    description: 'Replace damaged shingles (per roofing square = 100 sqft)',
    baseCost: 350,
    unit: 'sq',
    category: 'shingle',
    laborIntensive: true,
  },
  {
    id: 'full_roof_replacement_per_sq',
    name: 'Full Roof Replacement',
    description: 'Complete tear-off and replacement (per roofing square)',
    baseCost: 450,
    unit: 'sq',
    category: 'shingle',
    laborIntensive: true,
  },
  {
    id: 'ridge_cap_repair',
    name: 'Ridge Cap Repair',
    description: 'Repair or replace ridge cap shingles',
    baseCost: 12,
    unit: 'lf',
    category: 'shingle',
    laborIntensive: false,
  },
  {
    id: 'starter_strip_repair',
    name: 'Starter Strip Repair',
    description: 'Repair starter shingles at eaves',
    baseCost: 8,
    unit: 'lf',
    category: 'shingle',
    laborIntensive: false,
  },

  // Flashing repairs
  {
    id: 'flashing_repair',
    name: 'Flashing Repair',
    description: 'Repair or replace metal flashing',
    baseCost: 200,
    unit: 'each',
    category: 'flashing',
    laborIntensive: true,
  },
  {
    id: 'chimney_flashing',
    name: 'Chimney Flashing (with Replacement)',
    description: 'Chimney flashing when replacing the roof',
    baseCost: 400,
    unit: 'each',
    category: 'flashing',
    laborIntensive: true,
  },
  {
    id: 'chimney_flashing_standalone',
    name: 'Chimney Flashing (Standalone)',
    description: 'Standalone chimney flashing repair/replacement',
    baseCost: 1200,
    unit: 'each',
    category: 'flashing',
    laborIntensive: true,
  },
  {
    id: 'valley_repair',
    name: 'Valley Repair',
    description: 'Repair roof valley flashing or shingles',
    baseCost: 25,
    unit: 'lf',
    category: 'flashing',
    laborIntensive: true,
  },
  {
    id: 'pipe_boot_replacement',
    name: 'Pipe Boot Replacement',
    description: 'Replace cracked or damaged pipe boots ($400 for 1, $350 each for 2+)',
    baseCost: 400,
    unit: 'each',
    category: 'flashing',
    laborIntensive: false,
  },
  {
    id: 'perma_boot',
    name: 'Perma Boot (Retrofit)',
    description: 'Retrofit perma boot over existing pipe boot ($350 for 1, $300 for 2-3, $250 for 4+)',
    baseCost: 350,
    unit: 'each',
    category: 'flashing',
    laborIntensive: false,
  },
  {
    id: 'perma_boot_tuneup',
    name: 'Perma Boot (with Tune-Up)',
    description: 'Perma boot add-on when bundled with roof tune-up',
    baseCost: 200,
    unit: 'each',
    category: 'flashing',
    laborIntensive: false,
  },
  {
    id: 'drip_edge_repair',
    name: 'Drip Edge Repair',
    description: 'Repair or replace drip edge flashing',
    baseCost: 10,
    unit: 'lf',
    category: 'flashing',
    laborIntensive: false,
  },

  // Structural repairs
  {
    id: 'decking_replacement',
    name: 'Decking Replacement',
    description: 'Replace rotted or damaged roof decking (per 4x8 sheet)',
    baseCost: 75,
    unit: 'sheet',
    category: 'structure',
    laborIntensive: true,
  },
  {
    id: 'fascia_repair',
    name: 'Fascia Board Repair',
    description: 'Repair or replace fascia boards',
    baseCost: 18,
    unit: 'lf',
    category: 'structure',
    laborIntensive: true,
  },
  {
    id: 'soffit_repair',
    name: 'Soffit Repair',
    description: 'Repair or replace soffit panels',
    baseCost: 15,
    unit: 'lf',
    category: 'structure',
    laborIntensive: true,
  },
  {
    id: 'rafter_repair',
    name: 'Rafter Repair',
    description: 'Sister or repair damaged rafters',
    baseCost: 250,
    unit: 'each',
    category: 'structure',
    laborIntensive: true,
  },

  // Accessory repairs
  {
    id: 'vent_replacement',
    name: 'Roof Vent Replacement',
    description: 'Replace damaged roof vent',
    baseCost: 400,
    unit: 'each',
    category: 'accessory',
    laborIntensive: false,
  },
  {
    id: 'satellite_removal',
    name: 'Satellite Dish Removal',
    description: 'Remove satellite dish and seal penetrations',
    baseCost: 400,
    unit: 'each',
    category: 'accessory',
    laborIntensive: false,
  },
  {
    id: 'skylight_repair',
    name: 'Skylight Repair',
    description: 'Repair or reseal skylight',
    baseCost: 400,
    unit: 'each',
    category: 'accessory',
    laborIntensive: true,
  },
  {
    id: 'skylight_replacement',
    name: 'Skylight Replacement',
    description: 'Full skylight replacement',
    baseCost: 1200,
    unit: 'each',
    category: 'accessory',
    laborIntensive: true,
  },
  {
    id: 'turbine_vent',
    name: 'Turbine Vent Replacement',
    description: 'Replace roof turbine vent',
    baseCost: 175,
    unit: 'each',
    category: 'accessory',
    laborIntensive: false,
  },
  {
    id: 'ridge_vent',
    name: 'Ridge Vent Replacement',
    description: 'Replace ridge vent ($400 base + $25/LF)',
    baseCost: 25,
    unit: 'lf',
    category: 'accessory',
    laborIntensive: true,
  },
  {
    id: 'tune_up_basic',
    name: 'Roof Tune-Up (Basic)',
    description: 'Reseal flashings, replace pipe boots, clear debris, minor repairs ($25/SQ, $350 min)',
    baseCost: 25,
    unit: 'sq',
    category: 'accessory',
    laborIntensive: true,
  },
  {
    id: 'tune_up_advanced',
    name: 'Roof Tune-Up (Advanced)',
    description: 'Full tune-up with sealant, boot replacement, flashing repair ($50/SQ, $650 min)',
    baseCost: 50,
    unit: 'sq',
    category: 'accessory',
    laborIntensive: true,
  },

  // Gutter repairs
  {
    id: 'gutter_repair',
    name: 'Gutter Repair',
    description: 'Repair gutter sections',
    baseCost: 15,
    unit: 'lf',
    category: 'gutter',
    laborIntensive: false,
  },
  {
    id: 'gutter_replacement',
    name: 'Gutter Replacement',
    description: 'Replace gutter sections',
    baseCost: 22,
    unit: 'lf',
    category: 'gutter',
    laborIntensive: true,
  },
  {
    id: 'downspout_replacement',
    name: 'Downspout Replacement',
    description: 'Replace downspout',
    baseCost: 85,
    unit: 'each',
    category: 'gutter',
    laborIntensive: false,
  },
  {
    id: 'gutter_guard_install',
    name: 'Gutter Guard Installation',
    description: 'Install gutter guards',
    baseCost: 12,
    unit: 'lf',
    category: 'gutter',
    laborIntensive: false,
  },

  // Emergency repairs
  {
    id: 'emergency_tarp',
    name: 'Emergency Tarp Installation',
    description: 'Temporary tarp to prevent water intrusion',
    baseCost: 300,
    unit: 'each',
    category: 'emergency',
    laborIntensive: false,
  },
  {
    id: 'emergency_leak_repair',
    name: 'Emergency Leak Repair',
    description: 'Emergency same-day leak repair',
    baseCost: 450,
    unit: 'each',
    category: 'emergency',
    laborIntensive: true,
  },
  {
    id: 'storm_damage_inspection',
    name: 'Storm Damage Inspection',
    description: 'Professional storm damage assessment',
    baseCost: 150,
    unit: 'each',
    category: 'emergency',
    laborIntensive: false,
  },
];

// ─── Indexed lookups (built once at module load) ────────────────────────
// Both `getRepairType` and `getRepairTypesByCategory` were doing linear
// scans on every call. We have ~50 repair types and these are called from
// inside per-line-item loops during estimate generation, so an O(1) lookup
// matters in aggregate.
const REPAIR_TYPE_BY_ID: ReadonlyMap<string, RepairType> = new Map(
  REPAIR_TYPES.map((r) => [r.id, r] as const),
);

const REPAIR_TYPES_BY_CATEGORY: ReadonlyMap<RepairType['category'], readonly RepairType[]> = (() => {
  const map = new Map<RepairType['category'], RepairType[]>();
  for (const r of REPAIR_TYPES) {
    const list = map.get(r.category);
    if (list) {
      list.push(r);
    } else {
      map.set(r.category, [r]);
    }
  }
  return map;
})();

/** Get repair type by ID. O(1) Map lookup. */
export function getRepairType(id: string): RepairType | undefined {
  return REPAIR_TYPE_BY_ID.get(id);
}

/** Get repair types by category. O(1) Map lookup; returns a fresh array copy. */
export function getRepairTypesByCategory(category: RepairCategory): RepairType[] {
  return [...(REPAIR_TYPES_BY_CATEGORY.get(category) || [])];
}

/** Apply the gross-margin multiplier to a base cost (rounded to cents).
 *  Returns 0 for non-finite / negative input — defensive against junk
 *  drifting in from JSONB columns. */
export function applyMultiplier(baseCost: number): number {
  if (!Number.isFinite(baseCost) || baseCost < 0) return 0;
  return roundCents(baseCost * PRICING_MULTIPLIER);
}

// Normalise a free-text damage type for matching: lowercase, then collapse
// any whitespace / hyphen runs to a single underscore. Hoisted out of
// `getRepairRecommendations` so it isn't recompiled per call.
const DAMAGE_TYPE_NORMALIZE_REGEX = /[\s-]+/g;

// Keyword → canonical damage-type id. Was declared inside the function
// body and re-allocated on every call (and there are many calls per
// report). `as const` keeps the value type narrow for free typing.
const DAMAGE_KEYWORD_MAP = {
  hail: 'hail_damage',
  granule: 'granule_loss',
  curl: 'curled_shingles',
  crack: 'cracked_shingles',
  missing: 'missing_shingles',
  flash: 'flashing_damage',
  chimney: 'chimney_flashing_damage',
  valley: 'valley_damage',
  pipe: 'pipe_boot_cracked',
  boot: 'pipe_boot_cracked',
  ridge: 'ridge_cap_damage',
  vent: 'vent_damage',
  gutter: 'gutter_damage',
  fascia: 'fascia_damage',
  leak: 'active_leak',
  wind: 'wind_damage',
  nail: 'exposed_nail',
  age: 'aging',
  wear: 'wear',
  weather: 'weathering',
  deteriorat: 'deterioration',
  algae: 'algae_growth',
  moss: 'moss_growth',
  stain: 'staining',
  discolor: 'discoloration',
  blister: 'blistering',
  impact: 'impact_damage',
  bruise: 'bruising',
  rust: 'rust',
  sag: 'sagging',
  lift: 'lifted_shingles',
  debris: 'debris',
  seal: 'sealant_failure',
  caulk: 'caulk_failure',
  pond: 'ponding',
} as const;

// Hoisted formatter — was being recreated on every formatCurrency call.
const USD_FORMATTER_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// Hoisted unit-labels lookup — was declared inside formatUnit per call.
const UNIT_LABELS: Record<RepairUnit, { singular: string; plural: string }> = {
  each: { singular: 'unit', plural: 'units' },
  sq: { singular: 'sq', plural: 'sq' },
  lf: { singular: 'LF', plural: 'LF' },
  sqft: { singular: 'sqft', plural: 'sqft' },
  sheet: { singular: 'sheet', plural: 'sheets' },
  bundle: { singular: 'bundle', plural: 'bundles' },
};

/**
 * Calculate a single repair estimate.
 * Returns `null` for unknown repair types or non-positive/non-finite quantities
 * — guards against zero-cost or negative line items leaking into invoices.
 */
export function calculateRepairEstimate(
  repairTypeId: string,
  quantity: number
): RepairEstimate | null {
  const repairType = getRepairType(repairTypeId);
  if (!repairType) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const finalCostPerUnit = applyMultiplier(repairType.baseCost);
  const totalBaseCost = roundCents(repairType.baseCost * quantity);
  const totalFinalCost = roundCents(finalCostPerUnit * quantity);

  return {
    repairTypeId,
    repairName: repairType.name,
    quantity,
    unit: repairType.unit,
    baseCostPerUnit: repairType.baseCost,
    finalCostPerUnit,
    totalBaseCost,
    totalFinalCost,
  };
}

/**
 * Calculate multiple repair estimates and return summary
 */
export function calculateRepairEstimateSummary(
  items: { repairTypeId: string; quantity: number }[]
): RepairEstimateSummary {
  const lineItems: RepairEstimate[] = [];
  let subtotalBase = 0;
  let subtotalFinal = 0;

  for (const item of items) {
    const estimate = calculateRepairEstimate(item.repairTypeId, item.quantity);
    if (estimate) {
      lineItems.push(estimate);
      subtotalBase += estimate.totalBaseCost;
      subtotalFinal += estimate.totalFinalCost;
    }
  }

  return {
    lineItems,
    subtotalBase: roundCents(subtotalBase),
    subtotalFinal: roundCents(subtotalFinal),
    multiplier: PRICING_MULTIPLIER,
    generatedAt: new Date().toISOString(),
  };
}

/** Severity bands recognised by the damage→repair mappings. */
export type DamageSeverity = 'low' | 'medium' | 'high' | 'critical';

/** A single repair recommendation entry — what to fix, how much, and why. */
export interface RecommendedRepair {
  repairTypeId: string;
  estimatedQuantity: number;
  notes?: string;
}

/**
 * Map damage types from AI analysis to repair recommendations
 */
export interface DamageToRepairMapping {
  damageType: string;
  severity: DamageSeverity;
  recommendedRepairs: RecommendedRepair[];
}

export const DAMAGE_TO_REPAIR_MAPPINGS: DamageToRepairMapping[] = [
  {
    damageType: 'missing_shingles',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Per 100 sqft area affected' },
    ],
  },
  {
    damageType: 'cracked_shingles',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.5, notes: 'Partial square replacement' },
    ],
  },
  {
    damageType: 'curled_shingles',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Area showing curling' },
    ],
  },
  {
    damageType: 'hail_damage',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'full_roof_replacement_per_sq', estimatedQuantity: 1, notes: 'Consider full replacement for widespread damage' },
    ],
  },
  {
    damageType: 'granule_loss',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Affected area' },
    ],
  },
  {
    damageType: 'flashing_damage',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'flashing_repair', estimatedQuantity: 1, notes: 'Per flashing section' },
    ],
  },
  {
    damageType: 'chimney_flashing_damage',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'chimney_flashing', estimatedQuantity: 1 },
    ],
  },
  {
    damageType: 'valley_damage',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'valley_repair', estimatedQuantity: 15, notes: 'Average valley length' },
    ],
  },
  {
    damageType: 'pipe_boot_cracked',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'pipe_boot_replacement', estimatedQuantity: 1 },
    ],
  },
  {
    damageType: 'ridge_cap_damage',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'ridge_cap_repair', estimatedQuantity: 20, notes: 'Average ridge length' },
    ],
  },
  {
    damageType: 'vent_damage',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'vent_replacement', estimatedQuantity: 1 },
    ],
  },
  {
    damageType: 'skylight_damage',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'skylight_repair', estimatedQuantity: 1 },
    ],
  },
  {
    damageType: 'decking_damage',
    severity: 'critical',
    recommendedRepairs: [
      { repairTypeId: 'decking_replacement', estimatedQuantity: 2, notes: 'Minimum 2 sheets typical' },
    ],
  },
  {
    damageType: 'gutter_damage',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'gutter_repair', estimatedQuantity: 20, notes: 'Average section length' },
    ],
  },
  {
    damageType: 'fascia_damage',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'fascia_repair', estimatedQuantity: 12, notes: 'Average section' },
    ],
  },
  {
    damageType: 'active_leak',
    severity: 'critical',
    recommendedRepairs: [
      { repairTypeId: 'emergency_leak_repair', estimatedQuantity: 1 },
      { repairTypeId: 'emergency_tarp', estimatedQuantity: 1, notes: 'If needed for temporary protection' },
    ],
  },
  {
    damageType: 'wind_damage',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 2, notes: 'Typical wind damage area' },
      { repairTypeId: 'ridge_cap_repair', estimatedQuantity: 10, notes: 'Often affected by wind' },
    ],
  },
  // ── AI-returned damage types that need mapping ─────────────────────
  // The AI vision models return varied damage type strings. These mappings
  // ensure they produce meaningful repair estimates instead of $0.
  {
    damageType: 'aging',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Age-related deterioration area' },
    ],
  },
  {
    damageType: 'wear',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'General wear area' },
    ],
  },
  {
    damageType: 'weathering',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Weather deterioration' },
    ],
  },
  {
    damageType: 'deterioration',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Material deterioration' },
    ],
  },
  {
    damageType: 'algae_growth',
    severity: 'low',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.25, notes: 'Algae-affected area — cleaning may suffice' },
    ],
  },
  {
    damageType: 'algae',
    severity: 'low',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.25, notes: 'Algae-affected area — cleaning may suffice' },
    ],
  },
  {
    damageType: 'moss_growth',
    severity: 'low',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.25, notes: 'Moss-affected area — cleaning may suffice' },
    ],
  },
  {
    damageType: 'moss',
    severity: 'low',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.25, notes: 'Moss-affected area' },
    ],
  },
  {
    damageType: 'discoloration',
    severity: 'low',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.25, notes: 'Cosmetic deterioration' },
    ],
  },
  {
    damageType: 'staining',
    severity: 'low',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.25, notes: 'Surface staining' },
    ],
  },
  {
    damageType: 'exposed_nail',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.25, notes: 'Nail pop area — reseal or replace' },
    ],
  },
  {
    damageType: 'nail_pop',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.25, notes: 'Nail pop — reseal or replace surrounding shingles' },
    ],
  },
  {
    damageType: 'lifted_shingles',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Lifted/unsealed shingle area' },
    ],
  },
  {
    damageType: 'debris_accumulation',
    severity: 'low',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.1, notes: 'Debris area — cleaning recommended' },
    ],
  },
  {
    damageType: 'debris',
    severity: 'low',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 0.1, notes: 'Debris area — cleaning recommended' },
    ],
  },
  {
    damageType: 'vent_pipe_damage',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'pipe_boot_replacement', estimatedQuantity: 1 },
    ],
  },
  {
    damageType: 'pipe_boot_deterioration',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'pipe_boot_replacement', estimatedQuantity: 1 },
    ],
  },
  {
    damageType: 'boot_damage',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'pipe_boot_replacement', estimatedQuantity: 1 },
    ],
  },
  {
    damageType: 'flashing_deterioration',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'flashing_repair', estimatedQuantity: 1, notes: 'Deteriorated flashing section' },
    ],
  },
  {
    damageType: 'ridge_vent_damage',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'ridge_cap_repair', estimatedQuantity: 20, notes: 'Ridge vent section' },
    ],
  },
  {
    damageType: 'ridge_cap_deterioration',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'ridge_cap_repair', estimatedQuantity: 20, notes: 'Deteriorated ridge cap' },
    ],
  },
  {
    damageType: 'shingle_deterioration',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Deteriorated shingle area' },
    ],
  },
  {
    damageType: 'blistering',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Blistered shingle area' },
    ],
  },
  {
    damageType: 'impact_damage',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'full_roof_replacement_per_sq', estimatedQuantity: 1, notes: 'Impact damage — consider full replacement if widespread' },
    ],
  },
  {
    damageType: 'bruising',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Bruised/impacted shingle area' },
    ],
  },
  {
    damageType: 'sealant_failure',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'flashing_repair', estimatedQuantity: 1, notes: 'Failed sealant — reseal' },
    ],
  },
  {
    damageType: 'caulk_failure',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'flashing_repair', estimatedQuantity: 1, notes: 'Failed caulking — reseal' },
    ],
  },
  {
    damageType: 'rust',
    severity: 'medium',
    recommendedRepairs: [
      { repairTypeId: 'flashing_repair', estimatedQuantity: 1, notes: 'Rusted metal component' },
    ],
  },
  {
    damageType: 'sagging',
    severity: 'critical',
    recommendedRepairs: [
      { repairTypeId: 'decking_replacement', estimatedQuantity: 2, notes: 'Sagging indicates structural concern' },
    ],
  },
  {
    damageType: 'ponding',
    severity: 'high',
    recommendedRepairs: [
      { repairTypeId: 'shingle_replacement_per_sq', estimatedQuantity: 1, notes: 'Water ponding area' },
    ],
  },
];

/**
 * Pre-indexed `damageType → mapping` lookup for O(1) exact matches.
 * Built once at module load; the prior `.find()` was O(n) per call.
 */
const DAMAGE_MAPPING_BY_TYPE: ReadonlyMap<string, DamageToRepairMapping> = new Map(
  DAMAGE_TO_REPAIR_MAPPINGS.map((m) => [m.damageType.toLowerCase(), m] as const),
);

/** Exact-match lookup. Returns the mapping if `lower` exactly matches a known damage type. */
function findExactDamageMapping(lower: string): DamageToRepairMapping | undefined {
  return DAMAGE_MAPPING_BY_TYPE.get(lower);
}

/** Partial-match lookup. Either side `.includes` the other. */
function findPartialDamageMapping(lower: string): DamageToRepairMapping | undefined {
  return DAMAGE_TO_REPAIR_MAPPINGS.find(
    (m) => lower.includes(m.damageType.toLowerCase()) || m.damageType.toLowerCase().includes(lower),
  );
}

/** Keyword-fallback lookup. First matching keyword in `DAMAGE_KEYWORD_MAP` wins. */
function findKeywordDamageMapping(lower: string): DamageToRepairMapping | undefined {
  for (const [keyword, mappedType] of Object.entries(DAMAGE_KEYWORD_MAP)) {
    // Match word stems, so "damage" does not accidentally match the keyword "age".
    if (lower.split('_').some(word => word.startsWith(keyword))) {
      return DAMAGE_MAPPING_BY_TYPE.get(mappedType);
    }
  }
  return undefined;
}

/**
 * Get repair recommendations based on detected damage type.
 * Tries (1) exact, (2) partial substring, (3) keyword-fallback in order.
 */
export function getRepairRecommendations(damageType: string): DamageToRepairMapping | undefined {
  // Defensive: malformed damage data (e.g. from JSONB) can pass a missing /
  // null / non-string `type`. Coerce to a safe string so we return `undefined`
  // (no recommendation) instead of throwing on `.toLowerCase()`.
  if (typeof damageType !== 'string') return undefined;
  const lower = damageType.trim().toLowerCase().replace(DAMAGE_TYPE_NORMALIZE_REGEX, '_');
  if (!lower) return undefined;
  return (
    findExactDamageMapping(lower) ??
    findPartialDamageMapping(lower) ??
    findKeywordDamageMapping(lower)
  );
}

/** Floor for the per-damage-row count multiplier. Single-instance rows scale by 1. */
const MIN_DAMAGE_COUNT_MULTIPLIER = 1;

/**
 * Coerce a raw `damage.count` to a safe quantity multiplier:
 * `undefined` / `null` / `0` / `NaN` / negative all collapse to 1.
 */
function coerceCountToMultiplier(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > MIN_DAMAGE_COUNT_MULTIPLIER ? n : MIN_DAMAGE_COUNT_MULTIPLIER;
}

/**
 * Generate repair estimate from damage analysis results.
 *
 * Walks the AI / user damage list, maps each entry to one or more
 * recommended repair types via `getRepairRecommendations`, scales
 * quantities by `damage.count` (when >1), and consolidates duplicate
 * repair-type ids by summing their quantities. Returns a summary ready
 * for the report's "Repair Estimate" section.
 */
export function generateEstimateFromDamageAnalysis(
  damages: { type: string; severity?: string; count?: number }[]
): RepairEstimateSummary {
  // Map keyed by repairTypeId for O(n) consolidation — was O(n²) `.find()`
  // in the prior reduce.
  const consolidated = new Map<string, number>();

  for (const damage of damages) {
    const mapping = getRepairRecommendations(damage.type);
    if (!mapping) continue;
    const multiplier = coerceCountToMultiplier(damage.count);
    for (const repair of mapping.recommendedRepairs) {
      const qty = repair.estimatedQuantity * multiplier;
      consolidated.set(
        repair.repairTypeId,
        (consolidated.get(repair.repairTypeId) || 0) + qty,
      );
    }
  }

  return calculateRepairEstimateSummary(
    Array.from(consolidated, ([repairTypeId, quantity]) => ({ repairTypeId, quantity })),
  );
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return USD_FORMATTER_WHOLE.format(Number.isFinite(amount) ? amount : 0);
}

/**
 * Format unit for display.
 * Treats non-finite or non-1 quantities as plural (matches the prior
 * behaviour where `quantity === 1` was the only singular case but adds
 * defensive handling against `NaN` / `Infinity` slipping in).
 */
export function formatUnit(unit: RepairUnit, quantity: number): string {
  // A unit read back from a saved report can be anything; never throw for one.
  const label = UNIT_LABELS[unit] ?? UNIT_LABELS.each;
  return Number.isFinite(quantity) && quantity === 1 ? label.singular : label.plural;
}

/** List of all repair categories available in `REPAIR_TYPES`. Stable order. */
export function getRepairCategories(): RepairCategory[] {
  return Array.from(REPAIR_TYPES_BY_CATEGORY.keys());
}
