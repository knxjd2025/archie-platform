/**
 * Roofing Damage Knowledge Base
 * Comprehensive database of damage types, visual indicators, and HAAG-style assessment criteria
 * Based on industry standards and professional inspection protocols
 */

// ============================================
// DAMAGE CATEGORIES AND TYPES
// ============================================

export interface DamageType {
  id: string;
  category: DamageCategory;
  name: string;
  description: string;
  severity_levels: SeverityLevel[];
  visual_indicators: string[];
  common_causes: string[];
  haag_criteria?: HAGGCriteria;
  repair_urgency: 'immediate' | 'soon' | 'monitor' | 'cosmetic';
  insurance_relevance: 'high' | 'medium' | 'low';
  keywords: string[];
}

export type DamageCategory =
  | 'hail'
  | 'wind'
  | 'water'
  | 'age_wear'
  | 'structural'
  | 'installation'
  | 'biological'
  | 'thermal'
  | 'mechanical'
  | 'debris'
  | 'flashing';

export interface SeverityLevel {
  level: 'minor' | 'moderate' | 'severe' | 'critical';
  description: string;
  action_required: string;
  typical_repair: string;
}

export interface HAGGCriteria {
  threshold_size?: string;
  test_area_size: string;
  damage_per_square: string;
  distinguishing_features: string[];
  common_misidentifications: string[];
}

// ============================================
// COMPREHENSIVE DAMAGE TYPE DATABASE
// ============================================

export const DAMAGE_TYPES: DamageType[] = [
  // ========== HAIL DAMAGE ==========
  {
    id: 'hail_bruise',
    category: 'hail',
    name: 'Hail Bruise/Impact',
    description: 'Fracture of the reinforcing mat caused by hail impact, appearing as soft spots or indentations',
    severity_levels: [
      {
        level: 'minor',
        description: 'Small isolated impacts, granule loss minimal',
        action_required: 'Document and monitor',
        typical_repair: 'May not require immediate repair',
      },
      {
        level: 'moderate',
        description: 'Multiple impacts per square, visible granule displacement',
        action_required: 'Professional inspection recommended',
        typical_repair: 'Partial shingle replacement',
      },
      {
        level: 'severe',
        description: 'Widespread impacts, exposed mat visible',
        action_required: 'Immediate professional assessment',
        typical_repair: 'Full roof replacement may be needed',
      },
      {
        level: 'critical',
        description: 'Punctures through shingle, water infiltration risk',
        action_required: 'Emergency repair needed',
        typical_repair: 'Full roof replacement',
      },
    ],
    visual_indicators: [
      'Round or irregular indentations in shingle surface',
      'Soft spots when pressed (like bruise on apple)',
      'Black or dark colored divots',
      'Shiny appearance where granules displaced',
      'Random pattern across roof surface',
      'Collateral damage on gutters, vents, or AC units',
    ],
    common_causes: ['Hailstorm', 'Ice storm', 'Falling debris during storm'],
    haag_criteria: {
      threshold_size: '1 inch for 3-tab, 1.25 inch for laminated shingles',
      test_area_size: '100 square feet',
      damage_per_square: 'Count impacts per test square, extrapolate',
      distinguishing_features: [
        'Random pattern (not aligned with shingle edges)',
        'Soft to touch, mat fractured underneath',
        'Granule displacement exposes black asphalt',
        'Similar damage on other surfaces (gutters, AC, cars)',
      ],
      common_misidentifications: [
        'Blisters (manufacturing defect)',
        'Foot traffic damage',
        'Tool drops/mechanical damage',
        'Bird droppings',
        'Tree sap or debris',
      ],
    },
    repair_urgency: 'soon',
    insurance_relevance: 'high',
    keywords: ['hail', 'impact', 'bruise', 'dent', 'divot', 'storm', 'granule loss'],
  },
  {
    id: 'hail_granule_loss',
    category: 'hail',
    name: 'Hail-Caused Granule Loss',
    description: 'Displacement of protective granules from shingle surface due to hail impact',
    severity_levels: [
      {
        level: 'minor',
        description: 'Scattered granule loss, asphalt barely visible',
        action_required: 'Monitor over time',
        typical_repair: 'No immediate repair needed',
      },
      {
        level: 'moderate',
        description: 'Noticeable granule loss, dark spots visible',
        action_required: 'Schedule inspection',
        typical_repair: 'Shingle replacement recommended',
      },
      {
        level: 'severe',
        description: 'Significant bare spots, fiberglass mat exposed',
        action_required: 'Prompt repair needed',
        typical_repair: 'Area replacement required',
      },
      {
        level: 'critical',
        description: 'Widespread exposure, UV damage accelerating',
        action_required: 'Immediate action',
        typical_repair: 'Full replacement',
      },
    ],
    visual_indicators: [
      'Bare spots on shingle surface',
      'Granules accumulated in gutters',
      'Shiny black asphalt exposed',
      'Pattern follows hail impact locations',
    ],
    common_causes: ['Hail impact', 'Repeated freeze-thaw cycles', 'Age deterioration'],
    repair_urgency: 'soon',
    insurance_relevance: 'high',
    keywords: ['granule', 'loss', 'bare', 'exposed', 'asphalt', 'hail'],
  },

  // ========== WIND DAMAGE ==========
  {
    id: 'wind_lifted_shingle',
    category: 'wind',
    name: 'Wind-Lifted/Curled Shingles',
    description: 'Shingles lifted or curled by high winds, breaking the waterproof seal',
    severity_levels: [
      {
        level: 'minor',
        description: 'Slight lifting at edges, seal may reseal',
        action_required: 'Monitor during next storm',
        typical_repair: 'May self-seal in warm weather',
      },
      {
        level: 'moderate',
        description: 'Visible curling, seal broken',
        action_required: 'Repair before next storm',
        typical_repair: 'Re-seal or replace affected shingles',
      },
      {
        level: 'severe',
        description: 'Significant lifting, underlayment exposed',
        action_required: 'Immediate repair needed',
        typical_repair: 'Replace affected shingles',
      },
      {
        level: 'critical',
        description: 'Shingles folded over or torn',
        action_required: 'Emergency repair',
        typical_repair: 'Section replacement',
      },
    ],
    visual_indicators: [
      'Shingle edges lifted or curled upward',
      'Visible seal line broken between shingles',
      'Horizontal wear lines from flapping',
      'Underlayment or deck visible beneath',
    ],
    common_causes: ['High winds (39+ mph)', 'Hurricane/tornado', 'Improper installation'],
    repair_urgency: 'soon',
    insurance_relevance: 'high',
    keywords: ['wind', 'lifted', 'curled', 'seal', 'flapping', 'storm'],
  },
  {
    id: 'wind_missing_shingle',
    category: 'wind',
    name: 'Missing Shingles',
    description: 'Shingles completely removed by wind forces',
    severity_levels: [
      {
        level: 'minor',
        description: '1-2 shingles missing, underlayment intact',
        action_required: 'Repair within 1-2 weeks',
        typical_repair: 'Replace missing shingles',
      },
      {
        level: 'moderate',
        description: 'Multiple shingles missing, scattered locations',
        action_required: 'Repair within days',
        typical_repair: 'Replace all missing shingles',
      },
      {
        level: 'severe',
        description: 'Large sections missing, deck exposed',
        action_required: 'Immediate repair',
        typical_repair: 'Section replacement with tarping',
      },
      {
        level: 'critical',
        description: 'Majority of shingles missing, water intrusion',
        action_required: 'Emergency',
        typical_repair: 'Full replacement with emergency tarping',
      },
    ],
    visual_indicators: [
      'Visible gaps in roof coverage',
      'Exposed underlayment (usually black or gray felt)',
      'Exposed wood decking',
      'Nails visible where shingles were',
      'Shingles found in yard/gutters',
    ],
    common_causes: ['Severe wind event', 'Tornado', 'Hurricane', 'Aged/brittle shingles'],
    repair_urgency: 'immediate',
    insurance_relevance: 'high',
    keywords: ['missing', 'torn', 'blown off', 'exposed', 'wind damage'],
  },
  {
    id: 'wind_creased_shingle',
    category: 'wind',
    name: 'Wind-Creased Shingles',
    description: 'Shingles with visible creases or fold lines from wind stress',
    severity_levels: [
      {
        level: 'minor',
        description: 'Light creasing, shingle still functional',
        action_required: 'Monitor',
        typical_repair: 'May not need immediate repair',
      },
      {
        level: 'moderate',
        description: 'Visible crease lines, potential leak points',
        action_required: 'Schedule repair',
        typical_repair: 'Replace creased shingles',
      },
      {
        level: 'severe',
        description: 'Deep creases, cracking along fold',
        action_required: 'Repair soon',
        typical_repair: 'Replace affected area',
      },
      {
        level: 'critical',
        description: 'Torn along crease lines',
        action_required: 'Immediate repair',
        typical_repair: 'Full section replacement',
      },
    ],
    visual_indicators: [
      'Visible horizontal or diagonal fold lines',
      'Crease marks across shingle face',
      'Granule loss along crease',
      'Possible cracking at crease point',
    ],
    common_causes: ['Severe wind gusts', 'Repeated wind stress', 'Flying debris impact'],
    repair_urgency: 'soon',
    insurance_relevance: 'high',
    keywords: ['crease', 'fold', 'bent', 'wind', 'stress'],
  },

  // ========== WATER DAMAGE ==========
  {
    id: 'water_leak_stain',
    category: 'water',
    name: 'Water Leak/Staining',
    description: 'Evidence of water infiltration causing staining on roof or interior surfaces',
    severity_levels: [
      {
        level: 'minor',
        description: 'Small stain, single occurrence',
        action_required: 'Investigate source',
        typical_repair: 'Seal identified leak point',
      },
      {
        level: 'moderate',
        description: 'Recurring stains, growing in size',
        action_required: 'Professional inspection',
        typical_repair: 'Repair leak source, replace damaged materials',
      },
      {
        level: 'severe',
        description: 'Large stains, active dripping',
        action_required: 'Immediate repair',
        typical_repair: 'Emergency repair, possible deck replacement',
      },
      {
        level: 'critical',
        description: 'Structural saturation, mold present',
        action_required: 'Emergency intervention',
        typical_repair: 'Major repair with mold remediation',
      },
    ],
    visual_indicators: [
      'Brown or yellow stains on ceiling',
      'Water marks on attic rafters',
      'Peeling paint or bubbling drywall',
      'Musty odor in attic',
      'Wet insulation',
    ],
    common_causes: ['Damaged flashing', 'Missing shingles', 'Ice dam', 'Clogged gutters'],
    repair_urgency: 'immediate',
    insurance_relevance: 'high',
    keywords: ['leak', 'water', 'stain', 'wet', 'moisture', 'drip'],
  },
  {
    id: 'water_ponding',
    category: 'water',
    name: 'Water Ponding',
    description: 'Standing water on roof surface that does not drain within 48 hours',
    severity_levels: [
      {
        level: 'minor',
        description: 'Small puddles, drain within 48 hours',
        action_required: 'Monitor drainage',
        typical_repair: 'May not need immediate action',
      },
      {
        level: 'moderate',
        description: 'Persistent ponding, algae growth visible',
        action_required: 'Improve drainage',
        typical_repair: 'Add drains or tapered insulation',
      },
      {
        level: 'severe',
        description: 'Large ponding areas, membrane stress visible',
        action_required: 'Address promptly',
        typical_repair: 'Re-slope or add drainage system',
      },
      {
        level: 'critical',
        description: 'Structural sagging under water weight',
        action_required: 'Emergency drainage',
        typical_repair: 'Structural repair and re-roofing',
      },
    ],
    visual_indicators: [
      'Standing water visible after rain',
      'Water stains/rings after drying',
      'Algae or moss growth in low areas',
      'Membrane discoloration',
    ],
    common_causes: ['Poor slope design', 'Clogged drains', 'Structural settling', 'HVAC unit blocking drainage'],
    repair_urgency: 'soon',
    insurance_relevance: 'medium',
    keywords: ['ponding', 'standing water', 'puddle', 'drainage', 'flat roof'],
  },

  // ========== AGE/WEAR DAMAGE ==========
  {
    id: 'age_curling',
    category: 'age_wear',
    name: 'Age-Related Curling',
    description: 'Shingle edges curling upward or cupping due to age and weathering',
    severity_levels: [
      {
        level: 'minor',
        description: 'Slight curling at edges',
        action_required: 'Plan for future replacement',
        typical_repair: 'Monitor, budget for replacement',
      },
      {
        level: 'moderate',
        description: 'Noticeable curling, multiple shingles',
        action_required: 'Begin replacement planning',
        typical_repair: 'Replacement within 1-2 years',
      },
      {
        level: 'severe',
        description: 'Widespread curling, brittleness',
        action_required: 'Replace soon',
        typical_repair: 'Full replacement recommended',
      },
      {
        level: 'critical',
        description: 'Extreme curling, shingles breaking off',
        action_required: 'Immediate replacement',
        typical_repair: 'Full replacement required',
      },
    ],
    visual_indicators: [
      'Shingle edges turning upward',
      'Cupping or clawing appearance',
      'Uniform pattern across roof',
      'Brittle when touched',
    ],
    common_causes: ['Age (15+ years)', 'Poor ventilation', 'Manufacturing defect', 'UV exposure'],
    repair_urgency: 'monitor',
    insurance_relevance: 'low',
    keywords: ['curling', 'cupping', 'clawing', 'age', 'old', 'weathered'],
  },
  {
    id: 'age_cracking',
    category: 'age_wear',
    name: 'Age-Related Cracking',
    description: 'Cracks forming in shingles due to thermal cycling and age',
    severity_levels: [
      {
        level: 'minor',
        description: 'Hairline cracks, isolated locations',
        action_required: 'Monitor progression',
        typical_repair: 'Spot repairs as needed',
      },
      {
        level: 'moderate',
        description: 'Visible cracks, multiple shingles',
        action_required: 'Schedule repairs',
        typical_repair: 'Replace cracked shingles',
      },
      {
        level: 'severe',
        description: 'Deep cracks, pieces breaking off',
        action_required: 'Repair promptly',
        typical_repair: 'Section replacement',
      },
      {
        level: 'critical',
        description: 'Widespread cracking, shingles failing',
        action_required: 'Full replacement needed',
        typical_repair: 'Complete re-roof',
      },
    ],
    visual_indicators: [
      'Visible crack lines on shingle surface',
      'Cracking following shingle tab lines',
      'Pieces of shingle breaking off',
      'Granule loss along crack lines',
    ],
    common_causes: ['Thermal expansion/contraction', 'UV degradation', 'Age', 'Poor quality materials'],
    repair_urgency: 'soon',
    insurance_relevance: 'low',
    keywords: ['crack', 'split', 'break', 'age', 'brittle'],
  },
  {
    id: 'age_bald_spots',
    category: 'age_wear',
    name: 'Bald/Bare Spots',
    description: 'Areas where granules have worn away exposing the asphalt underneath',
    severity_levels: [
      {
        level: 'minor',
        description: 'Small bald spots, scattered',
        action_required: 'Monitor',
        typical_repair: 'Plan for replacement',
      },
      {
        level: 'moderate',
        description: 'Multiple bald areas, growing',
        action_required: 'Schedule inspection',
        typical_repair: 'Replacement within 2-3 years',
      },
      {
        level: 'severe',
        description: 'Large bald sections, UV damage visible',
        action_required: 'Replace soon',
        typical_repair: 'Replacement within 1 year',
      },
      {
        level: 'critical',
        description: 'Widespread balding, mat exposed',
        action_required: 'Immediate replacement',
        typical_repair: 'Full replacement',
      },
    ],
    visual_indicators: [
      'Shiny black spots on shingles',
      'Heavy granules in gutters',
      'Uneven coloring across roof',
      'Exposed fiberglass mat in severe cases',
    ],
    common_causes: ['Normal wear', 'Foot traffic', 'Debris abrasion', 'Poor quality shingles'],
    repair_urgency: 'monitor',
    insurance_relevance: 'low',
    keywords: ['bald', 'bare', 'granule loss', 'worn', 'faded'],
  },

  // ========== STRUCTURAL DAMAGE ==========
  {
    id: 'structural_sagging',
    category: 'structural',
    name: 'Roof Sagging',
    description: 'Visible dip or sag in roof line indicating structural issues',
    severity_levels: [
      {
        level: 'minor',
        description: 'Barely visible dip, may be optical',
        action_required: 'Professional inspection',
        typical_repair: 'May need bracing or support',
      },
      {
        level: 'moderate',
        description: 'Visible sag, localized area',
        action_required: 'Structural assessment',
        typical_repair: 'Add support, possible deck replacement',
      },
      {
        level: 'severe',
        description: 'Significant sagging, spreading',
        action_required: 'Immediate structural repair',
        typical_repair: 'Major structural work required',
      },
      {
        level: 'critical',
        description: 'Imminent collapse risk',
        action_required: 'Emergency - evacuate',
        typical_repair: 'Complete rebuild may be needed',
      },
    ],
    visual_indicators: [
      'Visible dip in roof line',
      'Wavy or uneven roof surface',
      'Interior ceiling showing sag',
      'Doors/windows not closing properly',
    ],
    common_causes: ['Water damage to decking', 'Inadequate framing', 'Snow/ice load', 'Age', 'Termite damage'],
    repair_urgency: 'immediate',
    insurance_relevance: 'high',
    keywords: ['sag', 'sagging', 'dip', 'structural', 'collapse'],
  },

  // ========== FLASHING DAMAGE ==========
  {
    id: 'flashing_damaged',
    category: 'water',
    name: 'Damaged Flashing',
    description: 'Flashing that is bent, rusted, loose, or missing around penetrations',
    severity_levels: [
      {
        level: 'minor',
        description: 'Minor rust or slight lifting',
        action_required: 'Schedule repair',
        typical_repair: 'Re-seal or minor repair',
      },
      {
        level: 'moderate',
        description: 'Visible gaps, significant rust',
        action_required: 'Repair soon',
        typical_repair: 'Replace affected flashing',
      },
      {
        level: 'severe',
        description: 'Missing sections, active leak',
        action_required: 'Immediate repair',
        typical_repair: 'Full flashing replacement',
      },
      {
        level: 'critical',
        description: 'Complete failure, water intrusion',
        action_required: 'Emergency repair',
        typical_repair: 'Replace flashing and repair water damage',
      },
    ],
    visual_indicators: [
      'Rust stains on flashing',
      'Lifted or bent flashing edges',
      'Gaps between flashing and surface',
      'Missing caulk or sealant',
      'Water stains below flashing',
    ],
    common_causes: ['Age', 'Storm damage', 'Poor installation', 'Thermal movement'],
    repair_urgency: 'soon',
    insurance_relevance: 'medium',
    keywords: ['flashing', 'rust', 'bent', 'chimney', 'vent', 'pipe boot'],
  },

  // ========== BIOLOGICAL DAMAGE ==========
  {
    id: 'bio_moss_algae',
    category: 'biological',
    name: 'Moss/Algae Growth',
    description: 'Biological growth on roof surface that can damage shingles over time',
    severity_levels: [
      {
        level: 'minor',
        description: 'Light discoloration, small patches',
        action_required: 'Schedule cleaning',
        typical_repair: 'Soft wash treatment',
      },
      {
        level: 'moderate',
        description: 'Visible green/black patches, spreading',
        action_required: 'Clean soon',
        typical_repair: 'Professional cleaning, zinc strips',
      },
      {
        level: 'severe',
        description: 'Heavy growth, lifting shingle edges',
        action_required: 'Immediate cleaning',
        typical_repair: 'Clean and repair lifted shingles',
      },
      {
        level: 'critical',
        description: 'Severe moss penetrating shingles',
        action_required: 'Major intervention',
        typical_repair: 'Replacement may be needed',
      },
    ],
    visual_indicators: [
      'Green moss patches (usually north-facing)',
      'Black streaks (algae/Gloeocapsa magma)',
      'Lifted shingle edges from moss roots',
      'Damp areas that stay wet longer',
    ],
    common_causes: ['Shade', 'Moisture retention', 'Organic debris', 'Poor ventilation'],
    repair_urgency: 'monitor',
    insurance_relevance: 'low',
    keywords: ['moss', 'algae', 'green', 'black streaks', 'biological', 'mold'],
  },

  // ========== MECHANICAL DAMAGE ==========
  {
    id: 'mechanical_foot_traffic',
    category: 'mechanical',
    name: 'Foot Traffic Damage',
    description: 'Damage caused by walking on roof, often misidentified as hail damage',
    severity_levels: [
      {
        level: 'minor',
        description: 'Scuff marks, granule displacement',
        action_required: 'No action needed',
        typical_repair: 'Cosmetic only',
      },
      {
        level: 'moderate',
        description: 'Multiple scuffs, visible wear paths',
        action_required: 'Limit roof access',
        typical_repair: 'No repair needed if not leaking',
      },
      {
        level: 'severe',
        description: 'Cracked shingles from impact',
        action_required: 'Repair damaged shingles',
        typical_repair: 'Replace cracked shingles',
      },
      {
        level: 'critical',
        description: 'Broken/crushed shingles',
        action_required: 'Immediate repair',
        typical_repair: 'Replace damaged area',
      },
    ],
    visual_indicators: [
      'Scuff marks in walking patterns',
      'Damage concentrated near access points',
      'Linear patterns rather than random',
      'Damage near HVAC units or satellites',
    ],
    common_causes: ['Maintenance access', 'Installation work', 'Inspections', 'HVAC service'],
    haag_criteria: {
      threshold_size: 'N/A',
      test_area_size: 'Pattern analysis',
      damage_per_square: 'Follows walking paths',
      distinguishing_features: [
        'Linear patterns following walking paths',
        'Concentrated near access points or equipment',
        'Scuff marks rather than round impacts',
        'No collateral damage on other surfaces',
      ],
      common_misidentifications: ['Often mistaken for hail damage'],
    },
    repair_urgency: 'cosmetic',
    insurance_relevance: 'low',
    keywords: ['foot traffic', 'scuff', 'walked on', 'mechanical'],
  },

  // ========== DEBRIS DAMAGE ==========
  {
    id: 'debris_tree_impact',
    category: 'debris',
    name: 'Tree/Branch Impact',
    description: 'Damage from falling trees or branches',
    severity_levels: [
      {
        level: 'minor',
        description: 'Small branch scratches',
        action_required: 'Inspect and clean',
        typical_repair: 'May not need repair',
      },
      {
        level: 'moderate',
        description: 'Branch punctures, localized damage',
        action_required: 'Repair soon',
        typical_repair: 'Replace affected shingles',
      },
      {
        level: 'severe',
        description: 'Large limb damage, deck impact',
        action_required: 'Immediate repair',
        typical_repair: 'Section replacement, possible deck repair',
      },
      {
        level: 'critical',
        description: 'Tree fall, structural damage',
        action_required: 'Emergency',
        typical_repair: 'Major reconstruction',
      },
    ],
    visual_indicators: [
      'Visible punctures or tears',
      'Scratch marks from branches',
      'Crushed or broken shingles',
      'Debris still on roof',
    ],
    common_causes: ['Storm winds', 'Dead/dying trees', 'Ice accumulation on branches'],
    repair_urgency: 'immediate',
    insurance_relevance: 'high',
    keywords: ['tree', 'branch', 'debris', 'puncture', 'impact', 'fallen'],
  },
];

// ============================================
// ROOFING MATERIAL TYPES
// ============================================

export interface RoofingMaterial {
  id: string;
  name: string;
  description: string;
  typical_lifespan_years: [number, number];
  susceptible_damage_types: string[];
  visual_characteristics: string[];
  hail_threshold: string;
}

export const ROOFING_MATERIALS: RoofingMaterial[] = [
  {
    id: 'asphalt_3tab',
    name: '3-Tab Asphalt Shingles',
    description: 'Traditional flat appearance with 3 tabs per shingle strip',
    typical_lifespan_years: [15, 20],
    susceptible_damage_types: ['hail_bruise', 'wind_lifted_shingle', 'age_curling'],
    visual_characteristics: [
      'Flat appearance with uniform tabs',
      'Single layer thickness',
      'Visible cutouts between tabs',
    ],
    hail_threshold: '1 inch diameter',
  },
  {
    id: 'asphalt_architectural',
    name: 'Architectural/Dimensional Shingles',
    description: 'Layered appearance with varied thickness, also called laminated shingles',
    typical_lifespan_years: [25, 30],
    susceptible_damage_types: ['hail_bruise', 'wind_lifted_shingle', 'age_cracking'],
    visual_characteristics: [
      'Multi-dimensional appearance',
      'Thicker than 3-tab',
      'Shadow lines from layering',
      'Random or staggered pattern',
    ],
    hail_threshold: '1.25 inch diameter',
  },
  {
    id: 'metal_standing_seam',
    name: 'Standing Seam Metal',
    description: 'Metal panels with raised seams that interlock',
    typical_lifespan_years: [40, 70],
    susceptible_damage_types: ['hail_dent_metal', 'wind_panel_lift'],
    visual_characteristics: [
      'Raised vertical seams',
      'Long continuous panels',
      'Smooth or textured surface',
      'Various colors available',
    ],
    hail_threshold: '1.5 inch diameter for denting',
  },
  {
    id: 'tile_clay',
    name: 'Clay Tile',
    description: 'Traditional curved clay tiles, common in Mediterranean styles',
    typical_lifespan_years: [50, 100],
    susceptible_damage_types: ['debris_impact', 'foot_traffic_cracking'],
    visual_characteristics: [
      'Curved barrel shape',
      'Terra cotta or glazed colors',
      'Heavy individual tiles',
      'Overlapping installation',
    ],
    hail_threshold: '2 inch diameter for cracking',
  },
  {
    id: 'tile_concrete',
    name: 'Concrete Tile',
    description: 'Molded concrete tiles, can mimic various styles',
    typical_lifespan_years: [40, 50],
    susceptible_damage_types: ['debris_impact', 'age_cracking', 'foot_traffic'],
    visual_characteristics: [
      'Heavy, dense tiles',
      'Various profiles (flat, S-shaped, barrel)',
      'Painted or color-through',
    ],
    hail_threshold: '1.75 inch diameter for damage',
  },
  {
    id: 'slate',
    name: 'Natural Slate',
    description: 'Natural stone roofing material, premium appearance',
    typical_lifespan_years: [75, 150],
    susceptible_damage_types: ['debris_impact', 'foot_traffic_cracking'],
    visual_characteristics: [
      'Natural stone appearance',
      'Varied colors (gray, green, purple)',
      'Smooth or textured surface',
      'Individual stone pieces',
    ],
    hail_threshold: '2+ inch diameter',
  },
  {
    id: 'wood_shake',
    name: 'Wood Shake/Shingle',
    description: 'Natural wood roofing, typically cedar',
    typical_lifespan_years: [20, 40],
    susceptible_damage_types: ['hail_split', 'wind_lifted', 'bio_rot', 'age_split'],
    visual_characteristics: [
      'Natural wood grain visible',
      'Rough or smooth texture',
      'Gray weathered appearance over time',
      'Individual wood pieces',
    ],
    hail_threshold: '1.25 inch diameter for splitting',
  },
  {
    id: 'tpo_membrane',
    name: 'TPO Membrane (Flat Roof)',
    description: 'Single-ply thermoplastic membrane for flat/low-slope roofs',
    typical_lifespan_years: [15, 25],
    susceptible_damage_types: ['puncture', 'seam_failure', 'ponding'],
    visual_characteristics: [
      'White or light gray color',
      'Smooth rubber-like surface',
      'Visible heat-welded seams',
      'Flat application',
    ],
    hail_threshold: 'Varies, typically 1.5+ inch',
  },
  {
    id: 'epdm_membrane',
    name: 'EPDM Rubber Membrane',
    description: 'Black rubber membrane for flat roofs',
    typical_lifespan_years: [20, 30],
    susceptible_damage_types: ['puncture', 'seam_failure', 'shrinkage'],
    visual_characteristics: [
      'Black rubber surface',
      'Smooth appearance',
      'Adhesive or mechanically attached',
    ],
    hail_threshold: 'Generally hail resistant',
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getDamageTypeById(id: string): DamageType | undefined {
  return DAMAGE_TYPES.find((d) => d.id === id);
}

export function getDamageTypesByCategory(category: DamageCategory): DamageType[] {
  return DAMAGE_TYPES.filter((d) => d.category === category);
}

export function getDamageTypesByKeyword(keyword: string): DamageType[] {
  const lowerKeyword = keyword.toLowerCase();
  return DAMAGE_TYPES.filter((d) =>
    d.keywords.some((k) => k.includes(lowerKeyword)) ||
    d.name.toLowerCase().includes(lowerKeyword) ||
    d.description.toLowerCase().includes(lowerKeyword)
  );
}

export function getMaterialById(id: string): RoofingMaterial | undefined {
  return ROOFING_MATERIALS.find((m) => m.id === id);
}

export function getInsuranceRelevantDamage(): DamageType[] {
  return DAMAGE_TYPES.filter((d) => d.insurance_relevance === 'high');
}

export function getUrgentRepairs(): DamageType[] {
  return DAMAGE_TYPES.filter((d) => d.repair_urgency === 'immediate');
}
