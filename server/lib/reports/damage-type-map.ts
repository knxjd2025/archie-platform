/**
 * Damage vocabulary bridge.
 *
 * Three vocabularies meet here and none of them agree:
 *   1. what the vision model writes   — free text ("Missing shingles on the
 *      south slope"), because the prompt only ever asked for a "descriptive_id"
 *   2. the knowledge base (DAMAGE_TYPES) — `hail_bruise`, `wind_missing_shingle`
 *   3. the pricing table (DAMAGE_TO_REPAIR_MAPPINGS) — `hail_damage`,
 *      `missing_shingles`
 *
 * Only vocabulary 3 produces money: generateEstimateFromDamageAnalysis matches
 * on it exactly, so anything that doesn't land there prices at $0. A McMillan
 * inspection reported 11 damage findings and a $0 repair estimate for exactly
 * this reason. Everything is funnelled into vocabulary 3 here.
 */

/** The pricing vocabulary — these are the only ids that generate line items. */
export const PRICING_DAMAGE_TYPES = [
  'missing_shingles', 'cracked_shingles', 'curled_shingles', 'hail_damage',
  'granule_loss', 'flashing_damage', 'chimney_flashing_damage', 'valley_damage',
  'pipe_boot_cracked', 'ridge_cap_damage', 'vent_damage', 'skylight_damage',
  'decking_damage', 'gutter_damage', 'fascia_damage', 'active_leak', 'wind_damage',
] as const;

/** Knowledge-base id → pricing id. */
const KB_TO_PRICING: Record<string, string> = {
  hail_bruise: 'hail_damage',
  hail_granule_loss: 'granule_loss',
  wind_lifted_shingle: 'curled_shingles',
  wind_missing_shingle: 'missing_shingles',
  wind_creased_shingle: 'wind_damage',
  water_leak_stain: 'active_leak',
  age_curling: 'curled_shingles',
  age_cracking: 'cracked_shingles',
  age_bald_spots: 'granule_loss',
  structural_sagging: 'decking_damage',
  flashing_damaged: 'flashing_damage',
  mechanical_foot_traffic: 'granule_loss',
  debris_tree_impact: 'missing_shingles',
};

/**
 * Keyword matching runs in three tiers, because a roof component and a roof
 * defect are different things and naive ordering confuses them. "Missing
 * shingles near the ridge" is a missing-shingle claim that happens to mention
 * the ridge — matching `ridge` first would bill a ridge-cap repair instead.
 *
 * Tier 1 — a component named together with a defect ("damaged chimney flashing")
 * Tier 2 — a defect on its own ("granule loss")
 * Tier 3 — a bare component, when nothing else matched at all
 */
const DEFECT = String.raw`damag|crack|split|leak|rust|dent|bent|sag|rot|detach|clog|debris|seal|wear|peel|missing|broken`;
const near = (component: string): RegExp =>
  new RegExp(`(?:${component})[^.]{0,24}?(?:${DEFECT})|(?:${DEFECT})[^.]{0,24}?(?:${component})`, 'i');

const COMPONENT_WITH_DEFECT: [RegExp, string][] = [
  [near('chimney'), 'chimney_flashing_damage'],
  [near('skylight'), 'skylight_damage'],
  [near('valley'), 'valley_damage'],
  [near('pipe|boot|jack'), 'pipe_boot_cracked'],
  [near('vent|turbine|louver'), 'vent_damage'],
  [near('gutter|downspout'), 'gutter_damage'],
  [near('fascia|soffit'), 'fascia_damage'],
];

const DEFECT_ONLY: [RegExp, string][] = [
  [/ridge cap|hip cap/i, 'ridge_cap_damage'],
  [/missing|blow[ -]?off|torn off|exposed underlayment|bare deck/i, 'missing_shingles'],
  [/granule|bald|bare spot|exposed mat/i, 'granule_loss'],
  [/curl|lift|buckl|cup|crease|unseal/i, 'curled_shingles'],
  [/crack|split|fractur|tear/i, 'cracked_shingles'],
  [/hail|bruise|spatter/i, 'hail_damage'],
  [/leak|water stain|moisture|ponding/i, 'active_leak'],
  [/flash|drip edge/i, 'flashing_damage'],
  [/deck|sheath|sag/i, 'decking_damage'],
  [/wind/i, 'wind_damage'],
];

const COMPONENT_ONLY: [RegExp, string][] = [
  [/chimney/i, 'chimney_flashing_damage'],
  [/skylight/i, 'skylight_damage'],
  [/valley/i, 'valley_damage'],
  [/pipe|boot|jack/i, 'pipe_boot_cracked'],
  [/vent|turbine|louver/i, 'vent_damage'],
  [/gutter|downspout/i, 'gutter_damage'],
  [/fascia|soffit/i, 'fascia_damage'],
];

const KEYWORD_TIERS = [COMPONENT_WITH_DEFECT, DEFECT_ONLY, COMPONENT_ONLY];

/** Broad category → pricing id, used only when nothing more specific matched. */
const CATEGORY_TO_PRICING: Record<string, string> = {
  hail: 'hail_damage',
  wind: 'wind_damage',
  water: 'active_leak',
  flashing: 'flashing_damage',
  structural: 'decking_damage',
  age_wear: 'granule_loss',
  mechanical: 'granule_loss',
  debris: 'missing_shingles',
};

const isPricing = (v: string): boolean => (PRICING_DAMAGE_TYPES as readonly string[]).includes(v);

/**
 * Resolve one finding to a priceable damage type. Tries, in order: an id that's
 * already priceable, the knowledge-base mapping, keywords across every piece of
 * text the model gave us, then the broad category.
 *
 * Returns null rather than guessing when nothing matches — an unmatched finding
 * still appears in the report, it just adds no invented line item.
 */
export function toPricingDamageType(input: {
  typeId?: string | null;
  name?: string | null;
  category?: string | null;
  description?: string | null;
}): string | null {
  const typeId = (input.typeId || '').trim().toLowerCase();
  if (typeId && isPricing(typeId)) return typeId;
  if (typeId && KB_TO_PRICING[typeId]) return KB_TO_PRICING[typeId];

  // Models describe damage in prose far more reliably than they pick ids.
  const text = [input.name, input.typeId, input.description].filter(Boolean).join(' ');
  for (const tier of KEYWORD_TIERS) {
    for (const [re, id] of tier) {
      if (re.test(text)) return id;
    }
  }

  const category = (input.category || '').trim().toLowerCase();
  return CATEGORY_TO_PRICING[category] ?? null;
}
