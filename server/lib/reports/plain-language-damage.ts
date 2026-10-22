/**
 * Plain-English label + one-sentence explanation for every pricing damage
 * type, for the Inspection report — which is read by the homeowner AND the
 * insurance adjuster and needs to be understood at a 5th-grade reading level.
 *
 * Deterministic and hand-written rather than asked of the vision model:
 * the detection prompt (groq-vision.ts) stays technical on purpose — it
 * drives PRICING_DAMAGE_TYPES matching (damage-type-map.ts), and loosening
 * its language risks the exact "$0 estimate from 11 findings" failure that
 * prompt is already guarding against. This is a separate, controlled
 * translation layer applied after the technical type is already resolved.
 */
import type { PRICING_DAMAGE_TYPES } from './damage-type-map.js';

type PricingDamageType = (typeof PRICING_DAMAGE_TYPES)[number];

export interface PlainLanguageDamage {
  label: string;
  explanation: string;
}

const PLAIN_LANGUAGE: Record<PricingDamageType, PlainLanguageDamage> = {
  missing_shingles: {
    label: 'Missing Shingles',
    explanation: 'Some shingles have come off the roof. This leaves the wood underneath open to rain, which can cause a leak.',
  },
  cracked_shingles: {
    label: 'Cracked Shingles',
    explanation: 'Some shingles are cracked or split. Water can get in through the crack and cause damage over time.',
  },
  curled_shingles: {
    label: 'Curled or Lifted Shingles',
    explanation: 'The edges of some shingles are curling up instead of lying flat. This lets wind and rain get underneath them.',
  },
  hail_damage: {
    label: 'Hail Damage',
    explanation: 'Hail has hit the roof and left small dents or bruises. This can wear away the shingle’s protective layer.',
  },
  granule_loss: {
    label: 'Worn Spots (Granule Loss)',
    explanation: 'The small protective granules on the shingles have worn away in spots. Bare spots like this age faster and protect the roof less.',
  },
  flashing_damage: {
    label: 'Damaged Flashing',
    explanation: 'Flashing is the metal that seals joints on the roof (like around a chimney or wall). Here it’s bent, rusted, or pulled loose, which can let water in.',
  },
  chimney_flashing_damage: {
    label: 'Chimney Flashing Damage',
    explanation: 'The metal sealing the roof around the chimney is damaged. This is one of the most common places roofs leak.',
  },
  valley_damage: {
    label: 'Valley Damage',
    explanation: 'A "valley" is where two roof slopes meet and water drains through. It’s damaged here, which matters because a lot of water passes through this spot.',
  },
  pipe_boot_cracked: {
    label: 'Cracked Pipe Boot',
    explanation: 'A "pipe boot" is the rubber seal around a pipe sticking through the roof. It’s cracked, which is a very common cause of slow, hidden leaks.',
  },
  ridge_cap_damage: {
    label: 'Ridge Cap Damage',
    explanation: 'The cap shingles along the very top ridge of the roof are damaged. This is one of the most exposed parts of the roof to wind.',
  },
  vent_damage: {
    label: 'Vent Damage',
    explanation: 'A roof vent is damaged. Vents let the attic breathe, and a damaged one can also let water in.',
  },
  skylight_damage: {
    label: 'Skylight Damage',
    explanation: 'The seal or frame around a skylight is damaged, which is a common spot for leaks.',
  },
  decking_damage: {
    label: 'Decking Damage',
    explanation: 'The decking is the solid wood layer underneath the shingles. Damage here is more serious — it’s the roof’s structural base, not just its surface.',
  },
  gutter_damage: {
    label: 'Gutter Damage',
    explanation: 'The gutters are damaged. Gutters that don’t work right can send water where it doesn’t belong, including toward the foundation.',
  },
  fascia_damage: {
    label: 'Fascia Damage',
    explanation: 'The fascia is the board along the roof’s edge that the gutters attach to. It’s damaged, usually from water or rot.',
  },
  active_leak: {
    label: 'Active Leak',
    explanation: 'There are signs water is already getting into the home right now — this is the most urgent kind of finding.',
  },
  wind_damage: {
    label: 'Wind Damage',
    explanation: 'Wind has damaged part of the roof, for example by creasing or lifting shingles or blowing pieces off.',
  },
};

const FALLBACK: PlainLanguageDamage = {
  label: 'Roof Damage',
  explanation: 'This part of the roof shows damage that a licensed roofer should look at.',
};

export function plainLanguageFor(pricingType: string | null | undefined): PlainLanguageDamage {
  if (!pricingType) return FALLBACK;
  return PLAIN_LANGUAGE[pricingType as PricingDamageType] || FALLBACK;
}

const SEVERITY_PLAIN: Record<string, string> = {
  critical: 'Fix Right Away',
  high: 'Fix Soon',
  medium: 'Should Be Fixed',
  low: 'Keep an Eye On It',
  none: 'No Action Needed',
};

export function plainSeverity(severity: string | null | undefined): string {
  return SEVERITY_PLAIN[(severity || 'none').toLowerCase()] || SEVERITY_PLAIN.none;
}
