/**
 * The roof age estimate a report makes from what its photos showed. Ported
 * from the old program's report route (it was never part of its library), as
 * plain functions with no outside calls. An age the photo analysis gave is
 * used as it is; otherwise the wear signs in its words are read; otherwise
 * the overall condition decides. Never throws.
 */
import type { RoofAgeEstimation } from '../lib/roof-reports/comprehensive-roof-report.js';

const LIFESPAN_YEARS: Record<string, number> = {
  asphalt_shingle: 20, architectural_shingle: 30, '3-tab_shingle': 20, metal: 50, metal_standing_seam: 60,
  tile: 50, clay_tile: 75, concrete_tile: 50, slate: 100, wood_shake: 30, wood_shingle: 25,
  flat_membrane: 20, flat_tpo: 25, flat_epdm: 25, tpo: 25, epdm: 25, modified_bitumen: 20, built_up: 25, bur: 25,
};
const DEFAULT_LIFESPAN_YEARS = 25;

/** How long a roof of this material usually lasts. An unknown material gets the cautious middle. */
export function materialLifespan(material: string | null | undefined): number {
  if (!material || typeof material !== 'string') return DEFAULT_LIFESPAN_YEARS;
  const lower = material.trim().toLowerCase().replace(/\s+/g, '_');
  if (Object.hasOwn(LIFESPAN_YEARS, lower)) return LIFESPAN_YEARS[lower];
  for (const [key, years] of Object.entries(LIFESPAN_YEARS)) {
    if (lower.includes(key) || key.includes(lower)) return years;
  }
  if (lower.includes('metal') || lower.includes('tile')) return 50;
  if (lower.includes('slate')) return 100;
  if (lower.includes('flat') || lower.includes('membrane')) return 20;
  return DEFAULT_LIFESPAN_YEARS;
}

type Condition = RoofAgeEstimation['materialCondition'];
const CONDITIONS: readonly string[] = ['excellent', 'good', 'fair', 'poor', 'critical'];
const AGE_FROM_CONDITION: Record<string, number> = { excellent: 3, good: 8, fair: 15, poor: 22, critical: 28 };

const WEAR_SIGNS: Array<{ pattern: RegExp; range: [number, number]; indicator: string }> = [
  { pattern: /new|recent|fresh/i, range: [0, 5], indicator: 'Recently installed appearance' },
  { pattern: /slight.*wear|minor.*wear/i, range: [5, 10], indicator: 'Slight wear patterns visible' },
  { pattern: /moderate.*wear|aging/i, range: [10, 15], indicator: 'Moderate aging visible' },
  { pattern: /significant.*wear|fad(ed|ing)/i, range: [15, 20], indicator: 'Significant fading or wear' },
  { pattern: /severe.*wear|deteriorat/i, range: [20, 30], indicator: 'Severe deterioration present' },
  { pattern: /granule.*loss/i, range: [12, 20], indicator: 'Granule loss detected' },
  { pattern: /curl(ed|ing)/i, range: [15, 25], indicator: 'Shingle curling visible' },
  { pattern: /crack(ed|ing)/i, range: [12, 20], indicator: 'Cracking observed' },
  { pattern: /moss|algae|lichen/i, range: [8, 15], indicator: 'Biological growth present' },
];

/** The part of an analysis this reads. */
export interface AgeInput {
  roof_material?: { type?: string; confidence?: number; characteristics?: string[] } | null;
  overall_condition?: string;
  summary?: string;
  detailed_findings?: string;
  raw_analysis?: string;
  damages_detected?: Array<{ category?: string }>;
}

function aiAge(raw: string | undefined): { years: number; confidence?: string; indicators?: string[] } | null {
  if (!raw) return null;
  try {
    let text = raw;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) text = fenced[1];
    const object = text.match(/\{[\s\S]*\}/);
    if (!object) return null;
    const parsed = JSON.parse(object[0]);
    const age = parsed?.estimated_age;
    return age && typeof age.years === 'number' && Number.isFinite(age.years) && age.years > 0 ? age : null;
  } catch {
    return null;
  }
}

export function estimateRoofAge(result: AgeInput | null | undefined): RoofAgeEstimation {
  const r: AgeInput = result ?? {};
  const material = r.roof_material ?? null;
  const materialType = typeof material?.type === 'string' ? material.type : null;
  const condition: Condition = CONDITIONS.includes(r.overall_condition ?? '') ? (r.overall_condition as Condition) : 'fair';
  const lifespan = materialLifespan(materialType);

  const given = aiAge(r.raw_analysis);
  if (given) {
    return {
      estimatedAgeYears: given.years,
      expectedLifespanYears: lifespan,
      remainingLifeYears: Math.max(0, lifespan - given.years),
      confidence: given.confidence === 'low' || given.confidence === 'high' ? given.confidence : 'medium',
      indicators: Array.isArray(given.indicators) && given.indicators.length ? given.indicators.map(String) : ['AI vision analysis'],
      roofMaterial: materialType,
      materialCondition: condition,
    };
  }

  let years: number | null = null;
  const indicators: string[] = [];
  const text = [...(Array.isArray(material?.characteristics) ? material!.characteristics! : []), r.summary ?? '', r.detailed_findings ?? ''].join(' ');
  for (const sign of WEAR_SIGNS) {
    if (!sign.pattern.test(text)) continue;
    const mid = Math.round((sign.range[0] + sign.range[1]) / 2);
    years = years === null ? mid : Math.round((years + mid) / 2);
    if (!indicators.includes(sign.indicator)) indicators.push(sign.indicator);
  }
  // Storm damage can look like age: when it is present, the age read from wear is lowered.
  const stormDamage = (r.damages_detected ?? []).some((d) => d?.category === 'hail' || d?.category === 'wind');
  if (stormDamage && years !== null && indicators.some((i) => i.includes('Granule') || i.includes('curling'))) {
    years = Math.max(3, years - 5);
    indicators.push('Age adjusted: storm damage may mimic aging patterns');
  }
  if (years === null) {
    years = AGE_FROM_CONDITION[condition] ?? 15;
    indicators.push(`Estimated from overall ${condition} condition`);
  }

  let confidence: RoofAgeEstimation['confidence'] = 'low';
  if (indicators.length >= 3 && (material?.confidence ?? 0) > 80) confidence = 'high';
  else if (indicators.length >= 1 && (material?.confidence ?? 0) > 50) confidence = 'medium';

  return {
    estimatedAgeYears: years,
    expectedLifespanYears: lifespan,
    remainingLifeYears: Math.max(0, lifespan - years),
    confidence,
    indicators,
    roofMaterial: materialType,
    materialCondition: condition,
  };
}
