/**
 * Roof Repair Pricing Service
 * Research-based pricing with 1.65x markup multiplier to ensure competitive margins.
 *
 * Base prices are industry averages for 2024-2025.
 * All prices are multiplied by 1.65 for final customer pricing.
 */

export const PRICING_MULTIPLIER = 1.65;

export type RepairUnit = 'each' | 'sq' | 'lf' | 'sqft' | 'sheet' | 'bundle';

export interface RepairType {
  id: string;
  name: string;
  description: string;
  baseCost: number;
  unit: RepairUnit;
  category: 'shingle' | 'flashing' | 'structure' | 'accessory' | 'emergency' | 'gutter';
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

/**
 * Get repair type by ID
 */
export function getRepairType(id: string): RepairType | undefined {
  return REPAIR_TYPES.find(r => r.id === id);
}

/**
 * Get repair types by category
 */
export function getRepairTypesByCategory(category: RepairType['category']): RepairType[] {
  return REPAIR_TYPES.filter(r => r.category === category);
}

/**
 * Apply the 1.65x multiplier to a base cost
 */
export function applyMultiplier(baseCost: number): number {
  return Math.round(baseCost * PRICING_MULTIPLIER * 100) / 100;
}

/**
 * Calculate a single repair estimate
 */
export function calculateRepairEstimate(
  repairTypeId: string,
  quantity: number
): RepairEstimate | null {
  const repairType = getRepairType(repairTypeId);
  if (!repairType) return null;

  const finalCostPerUnit = applyMultiplier(repairType.baseCost);
  const totalBaseCost = repairType.baseCost * quantity;
  const totalFinalCost = finalCostPerUnit * quantity;

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
    subtotalBase: Math.round(subtotalBase * 100) / 100,
    subtotalFinal: Math.round(subtotalFinal * 100) / 100,
    multiplier: PRICING_MULTIPLIER,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Map damage types from AI analysis to repair recommendations
 */
export interface DamageToRepairMapping {
  damageType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommendedRepairs: {
    repairTypeId: string;
    estimatedQuantity: number;
    notes?: string;
  }[];
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
];

/**
 * Get repair recommendations based on detected damage type
 */
export function getRepairRecommendations(damageType: string): DamageToRepairMapping | undefined {
  return DAMAGE_TO_REPAIR_MAPPINGS.find(
    m => m.damageType.toLowerCase() === damageType.toLowerCase()
  );
}

/**
 * Generate repair estimate from damage analysis results
 */
/**
 * Emergency and temporary-protection work belongs on a roof that is actively
 * failing, not on one the inspection calls minor. The mappings carry a fixed
 * severity (active_leak is always "critical"), so a low-severity finding was
 * pulling in an emergency tarp and emergency leak repair — over $1,200 of
 * crisis work on a report that read "minor damage, low severity". That is a
 * credibility problem in front of a customer, so the observed severity wins.
 */
function isEmergencyRepair(repair: { repairTypeId: string; notes?: string }): boolean {
  return /^emergency_/.test(repair.repairTypeId) || /if needed|temporary/i.test(repair.notes || '');
}

const MINOR = new Set(['low', 'minor', 'none', 'cosmetic']);

export function generateEstimateFromDamageAnalysis(
  damages: { type: string; severity?: string; count?: number; label?: string }[]
): RepairEstimateSummary {
  const repairItems: { repairTypeId: string; quantity: number }[] = [];
  // Which findings drove each repair. A homeowner reading "Ridge Cap Repair,
  // 40 lf, $792" has no idea why it is on their estimate; naming the finding
  // that caused it is the difference between a price and an argument.
  const because = new Map<string, Set<string>>();

  for (const damage of damages) {
    const mapping = getRepairRecommendations(damage.type);
    if (mapping) {
      const minor = MINOR.has(String(damage.severity || '').toLowerCase());
      for (const repair of mapping.recommendedRepairs) {
        if (minor && isEmergencyRepair(repair)) continue;
        // Adjust quantity based on count if provided
        const baseQty = repair.estimatedQuantity;
        const multiplier = damage.count && damage.count > 1 ? damage.count : 1;

        repairItems.push({
          repairTypeId: repair.repairTypeId,
          quantity: baseQty * multiplier,
        });
        const reason = (damage.label || '').trim();
        if (reason) {
          if (!because.has(repair.repairTypeId)) because.set(repair.repairTypeId, new Set());
          because.get(repair.repairTypeId)!.add(reason);
        }
      }
    }
  }

  // Deduplicate by repair type and sum quantities
  const consolidated = repairItems.reduce((acc, item) => {
    const existing = acc.find(i => i.repairTypeId === item.repairTypeId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      acc.push({ ...item });
    }
    return acc;
  }, [] as { repairTypeId: string; quantity: number }[]);

  const out = calculateRepairEstimateSummary(consolidated);
  for (const li of out.lineItems as any[]) {
    const reasons = Array.from(because.get(li.repairTypeId) ?? []);
    if (reasons.length) li.because = reasons.slice(0, 3);
  }
  return out;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format unit for display
 */
export function formatUnit(unit: RepairUnit, quantity: number): string {
  const unitLabels: Record<RepairUnit, { singular: string; plural: string }> = {
    each: { singular: 'unit', plural: 'units' },
    sq: { singular: 'sq', plural: 'sq' },
    lf: { singular: 'LF', plural: 'LF' },
    sqft: { singular: 'sqft', plural: 'sqft' },
    sheet: { singular: 'sheet', plural: 'sheets' },
    bundle: { singular: 'bundle', plural: 'bundles' },
  };

  const label = unitLabels[unit];
  return quantity === 1 ? label.singular : label.plural;
}
