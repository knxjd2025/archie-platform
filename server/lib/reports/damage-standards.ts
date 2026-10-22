/**
 * What a finding MEANS, and what the code and the manufacturer say about it.
 *
 * plain-language-damage.ts answers "what is this?" in one sentence. This
 * answers the two questions a homeowner (and an adjuster) asks next: "why
 * does it matter?" and "who says so?". Keyed by the same pricing damage type,
 * so it reaches every finding card on the Inspection, Proposal and
 * Presentation through the lookup those renderers already make.
 *
 * Two kinds of content, handled differently on purpose:
 *
 *  - `whyItMatters` is house-authored plain English, distilled from the
 *    damage knowledge base (damage-knowledge-base.ts). It prints immediately.
 *  - `codeRefs` / `manufacturerRefs` are CITATIONS. A citation on a customer
 *    document is a claim about what the law or the manufacturer requires, so
 *    every one carries `verifiedOn` and prints ONLY once a person has set it.
 *    Until then it exists here for review (see STANDARDS_REVIEW.md and
 *    `standardsReviewSheet()`), and nowhere a customer can see it.
 *
 * Code edition: drafted against the 2018 NC Residential Code, which is the
 * 2015 IRC with North Carolina amendments. North Carolina has since adopted a
 * newer edition; section numbers in Chapter 9 are stable across 2015/2018/2021
 * for the sections cited here, but the reviewer must confirm the edition in
 * force in Mecklenburg County on the date they verify. NC amended the ice
 * barrier rule (R905.1.2) — the IRC's "history of ice forming along the
 * eaves" trigger — and that entry is flagged.
 */
import type { PRICING_DAMAGE_TYPES } from './damage-type-map.js';
import { esc } from './report-theme.js';

type PricingDamageType = (typeof PRICING_DAMAGE_TYPES)[number];

export interface StandardRef {
  /** Short citation as it prints, e.g. "R905.2.8.5". */
  cite: string;
  /** What the cited section is about, in plain words. */
  title: string;
  /** Reviewer guidance — never printed. */
  note?: string;
  /** YYYY-MM-DD a person confirmed this citation. null = draft, never printed. */
  verifiedOn: string | null;
}

export interface DamageStandards {
  whyItMatters: string;
  codeRefs: StandardRef[];
  manufacturerRefs: StandardRef[];
}

export const CODE_EDITION = '2018 NC Residential Code';

const draft = (cite: string, title: string, note?: string): StandardRef => ({ cite, title, note, verifiedOn: null });

// Shared citations, so one verification covers every finding that uses it.
const IRC = {
  flashingLocations: draft('R903.2.1', 'Flashing required at roof-wall intersections, slope changes, and around every roof penetration'),
  drainage: draft('R903.4', 'Roof drainage — water must be carried off the roof, not held or redirected onto the structure'),
  application: draft('R905.1', 'Roof coverings installed per the manufacturer\'s installation instructions'),
  underlayment: draft('R905.1.1', 'Underlayment required beneath asphalt shingles, per Table R905.1.1'),
  iceBarrier: draft('R905.1.2', 'Ice barrier at the eaves', 'NC AMENDMENT: NC limits the IRC ice-barrier trigger. Confirm the exact NC wording before verifying; may be manufacturer-required rather than code-required in Charlotte.'),
  slope: draft('R905.2.2', 'Asphalt shingles only on slopes of 2:12 or steeper; double underlayment from 2:12 up to 4:12'),
  fasteners: draft('R905.2.5', 'Shingle fasteners — corrosion-resistant, 12-gauge, 3/8-inch head, penetrating the deck'),
  attachment: draft('R905.2.6', 'Minimum fastener count per shingle, per the manufacturer and never fewer than four'),
  baseCap: draft('R905.2.8.1', 'Base and cap flashing at vertical surfaces'),
  valleys: draft('R905.2.8.2', 'Valley lining — minimum materials for open and closed valleys'),
  cricket: draft('R905.2.8.3', 'A cricket or saddle behind any chimney or penetration more than 30 inches wide'),
  sidewall: draft('R905.2.8.4', 'Step flashing at sidewalls — minimum 4 by 4 inches, one piece per course'),
  dripEdge: draft('R905.2.8.5', 'Drip edge required at eaves and rakes, lapped 2 inches, extended below the sheathing'),
  ventRequired: draft('R806.1', 'Enclosed attics must be ventilated'),
  ventArea: draft('R806.2', 'Net free vent area of 1/150 of the attic floor, or 1/300 when intake and exhaust are balanced'),
  sheathing: draft('R803', 'Roof sheathing — wood structural panel decks and their fastening'),
  reroofTearOff: draft('R908.3', 'Roof replacement removes all existing layers down to the deck (limited exceptions)'),
  reroofReinstall: draft('R908.4', 'Rusted, damaged or deteriorated flashing and drip edge may not be reinstalled'),
  reroofFlashing: draft('R908.5', 'Flashings reconstructed per the manufacturer\'s installation instructions when reroofing'),
  skylight: draft('R308.6', 'Skylights and sloped glazing — installation and flashing'),
};

const CT = {
  sam: (topic: string) => draft('CertainTeed Shingle Applicator\'s Manual', topic),
  landmark: (topic: string) => draft('CertainTeed Landmark® Series Application Instructions', topic),
  integrity: draft('CertainTeed Integrity Roof System™', 'Warranty registration requires the full system — starter, underlayment, shingle, hip & ridge, and ventilation — installed to CertainTeed\'s instructions'),
  wind: draft('ASTM D3161 / ASTM D7158', 'Wind-resistance classification of asphalt shingles'),
  impact: draft('UL 2218', 'Impact-resistance classes 1-4 for roof coverings'),
  shingle: draft('ASTM D3462', 'Standard specification for fiberglass asphalt shingles'),
  selfAdhered: draft('ASTM D1970', 'Self-adhering ice-and-water underlayment'),
  felt: draft('ASTM D226 / D4869 / D6757', 'Underlayment material standards referenced by the code'),
  arma: draft('ARMA Residential Asphalt Roofing Manual', 'Industry installation practice for asphalt shingle roofs'),
};

const STANDARDS: Record<PricingDamageType, DamageStandards> = {
  missing_shingles: {
    whyItMatters: 'The shingle is the only layer built to shed water. Where it is gone, the underlayment is doing a job it was never designed to do alone, and each rain moves water closer to the wood deck. Left open through a season, a small gap becomes a soft deck, then a ceiling stain.',
    codeRefs: [IRC.attachment, IRC.fasteners, IRC.application],
    manufacturerRefs: [CT.landmark('Fastener placement and count for the warranty to hold'), CT.wind, CT.integrity],
  },
  cracked_shingles: {
    whyItMatters: 'A crack is a path. Water follows it under the shingle to the nail line, and every freeze-thaw cycle pries it wider. Cracked shingles also cannot reseal, so wind lifts them more easily each storm.',
    codeRefs: [IRC.application],
    manufacturerRefs: [CT.shingle, CT.arma],
  },
  curled_shingles: {
    whyItMatters: 'A shingle that no longer lies flat has lost its seal. Wind gets underneath and lifts it further, and rain is driven up under the edge instead of running over it. It is the stage right before shingles start coming off.',
    codeRefs: [IRC.attachment, IRC.application],
    manufacturerRefs: [CT.wind, CT.landmark('Sealant strip and fastening requirements')],
  },
  hail_damage: {
    whyItMatters: 'A hail bruise breaks the fiberglass mat inside the shingle even when the surface looks intact. The protective granules wash away from that spot, the sun breaks down the exposed asphalt, and the shingle fails years early. Insurance carriers treat documented hail bruising as storm damage, which is why it is counted per test square.',
    codeRefs: [IRC.application],
    manufacturerRefs: [CT.impact, CT.shingle],
  },
  granule_loss: {
    whyItMatters: 'Granules are the shingle\'s sunscreen. Bare asphalt goes brittle under UV within a few seasons, cracks, and stops shedding water. Heavy granules in the gutters are the roof telling you it is wearing out.',
    codeRefs: [IRC.application],
    manufacturerRefs: [CT.shingle, CT.arma],
  },
  flashing_damage: {
    whyItMatters: 'Flashing is where most roofs actually leak — not in the field of shingles but at the joints. Bent, rusted or lifted flashing lets water behind the roofing at exactly the places the code requires it to be sealed.',
    codeRefs: [IRC.flashingLocations, IRC.baseCap, IRC.sidewall, IRC.reroofReinstall],
    manufacturerRefs: [CT.sam('Flashing details at walls, penetrations and slope changes'), CT.integrity],
  },
  chimney_flashing_damage: {
    whyItMatters: 'A chimney is the largest thing poking through the roof, and water runs at it from the uphill side. The code requires a cricket behind any chimney wider than 30 inches for that reason, and proper base and counter-flashing on all four sides. This is the single most common source of a slow leak that shows up as a stain near the fireplace.',
    codeRefs: [IRC.flashingLocations, IRC.baseCap, IRC.cricket, IRC.reroofFlashing],
    manufacturerRefs: [CT.sam('Chimney flashing — base, counter and cricket')],
  },
  valley_damage: {
    whyItMatters: 'Two slopes drain into a valley, so it carries more water per foot than anywhere else on the roof. The code sets a minimum for how a valley must be lined precisely because a failure here leaks fast and floods the deck below.',
    codeRefs: [IRC.valleys, IRC.drainage],
    manufacturerRefs: [CT.sam('Open and closed valley construction'), CT.selfAdhered],
  },
  pipe_boot_cracked: {
    whyItMatters: 'The rubber collar on a plumbing vent dries, cracks and splits years before the shingles around it wear out. It is a penetration, so the code requires it to be flashed and sealed — and a split boot is an open hole straight into the attic.',
    codeRefs: [IRC.flashingLocations],
    manufacturerRefs: [CT.sam('Pipe and vent penetration flashing')],
  },
  ridge_cap_damage: {
    whyItMatters: 'The ridge is the most wind-exposed line on the roof and the caps are the only thing covering the seam where two slopes meet. A damaged cap exposes that seam and, on a vented ridge, the ventilation slot cut into the deck.',
    codeRefs: [IRC.attachment, IRC.application],
    manufacturerRefs: [CT.landmark('Hip and ridge application'), CT.integrity],
  },
  vent_damage: {
    whyItMatters: 'A vent does two jobs: it lets the attic breathe and it keeps water out of the hole cut for it. A damaged vent fails at both — the attic runs hotter and wetter, which shortens the life of every shingle, and the opening leaks.',
    codeRefs: [IRC.ventRequired, IRC.ventArea, IRC.flashingLocations],
    manufacturerRefs: [CT.integrity, CT.sam('Balanced intake and exhaust ventilation')],
  },
  skylight_damage: {
    whyItMatters: 'A skylight is a window in the roof, and the code treats it as one — it must be flashed like any other penetration. Failed seals or flashing here leak directly into living space, not into an attic where there is time to catch it.',
    codeRefs: [IRC.skylight, IRC.flashingLocations],
    manufacturerRefs: [CT.sam('Skylight and curb flashing')],
  },
  decking_damage: {
    whyItMatters: 'The deck is the structure everything else is nailed to. Soft or rotted decking will not hold a fastener, so new shingles over it fail the wind rating no matter how well they are installed. The code does not allow damaged sheathing to be covered over during a reroof.',
    codeRefs: [IRC.sheathing, IRC.reroofTearOff, IRC.fasteners],
    manufacturerRefs: [CT.landmark('Deck requirements — solid, dry, and able to hold fasteners')],
  },
  gutter_damage: {
    whyItMatters: 'Gutters are the roof\'s drainage system. When they sag, separate or overflow, water lands on the fascia, the siding and the foundation instead of being carried away — the code requires roof water to drain off the structure.',
    codeRefs: [IRC.drainage],
    manufacturerRefs: [CT.arma],
  },
  fascia_damage: {
    whyItMatters: 'The fascia carries the gutter and closes the edge of the roof. Rot here usually means water has been getting behind the drip edge or over the back of the gutter for a long time, and the damage is often worse underneath than it looks from the ground.',
    codeRefs: [IRC.dripEdge, IRC.drainage],
    manufacturerRefs: [CT.sam('Eave and rake edge construction')],
  },
  active_leak: {
    whyItMatters: 'Everything else on this report is a risk of water getting in. This is water already in. Wet insulation stops insulating, wet framing rots, and staining is the last stage — the damage above the ceiling started well before the stain appeared.',
    codeRefs: [IRC.application, IRC.flashingLocations],
    manufacturerRefs: [CT.arma],
  },
  wind_damage: {
    whyItMatters: 'Wind damage — creased, lifted or torn shingles — means the seal that holds each course to the one below has failed. Once broken it does not reliably reseal, so the next storm finds the same weak spot. Shingles are rated for a wind class; a creased shingle no longer meets the one it was sold with.',
    codeRefs: [IRC.attachment, IRC.application],
    manufacturerRefs: [CT.wind, CT.landmark('High-wind fastening (six-nail) pattern')],
  },
};

const FALLBACK: DamageStandards = {
  whyItMatters: 'Any break in the roof\'s surface or its flashing is a path for water. The longer it stays open, the more of the structure beneath it is involved in the repair.',
  codeRefs: [IRC.application],
  manufacturerRefs: [],
};

export function standardsFor(pricingType: string | null | undefined): DamageStandards {
  if (!pricingType) return FALLBACK;
  return STANDARDS[pricingType as PricingDamageType] || FALLBACK;
}

/** Only citations a person has verified — the only ones a customer may see. */
export function printableRefs(refs: StandardRef[]): StandardRef[] {
  return refs.filter((r) => !!r.verifiedOn);
}

/**
 * One line of citations for a finding card, or '' while nothing is verified.
 * Kept to one line so it reads as a footnote, not a legal brief.
 */
export function standardsLine(pricingType: string | null | undefined): { code: StandardRef[]; manufacturer: StandardRef[] } {
  const s = standardsFor(pricingType);
  return { code: printableRefs(s.codeRefs), manufacturer: printableRefs(s.manufacturerRefs) };
}

// ---------------------------------------------------------------------------
// Roof assembly components — what the standard calls for, graded against
// what the inspector found (shared/inspection-form.ts option strings).
// ---------------------------------------------------------------------------

export type AssemblyStatus = 'present' | 'attention' | 'unknown';

export interface AssemblyStandard {
  /** The checklist field this grades. */
  field: string;
  label: string;
  /** House-authored, prints immediately: what a properly built roof has here and why. */
  standardText: string;
  codeRefs: StandardRef[];
  manufacturerRefs: StandardRef[];
  /** Grade the inspector's answer. Returns the status and a short customer-facing note. */
  grade: (answer: string) => { status: AssemblyStatus; note: string };
}

const unknownIf = (a: string) => /could not determine|n\/a/i.test(a);

export const ASSEMBLY_STANDARDS: AssemblyStandard[] = [
  {
    field: 'Drip edge', label: 'Drip edge',
    standardText: 'Metal drip edge at every eave and rake, lapped, extended below the sheathing, and fastened so water runs off the deck into the gutter instead of behind the fascia.',
    codeRefs: [IRC.dripEdge, IRC.reroofReinstall],
    manufacturerRefs: [CT.sam('Eave and rake edge construction')],
    grade: (a) => unknownIf(a) ? { status: 'unknown', note: 'Could not be verified from this inspection.' }
      : /^no\b/i.test(a) ? { status: 'attention', note: 'No drip edge found. A new roof gets it at every eave and rake; without it, water can wick behind the fascia and rot the edge.' }
      : { status: 'present', note: `Present (${a.replace(/^yes\s*-\s*/i, '')}).` },
  },
  {
    field: 'Felt or underlayment type', label: 'Underlayment',
    standardText: 'A continuous underlayment over the whole deck beneath the shingles — the second line of defense if water ever gets past the surface.',
    codeRefs: [IRC.underlayment],
    manufacturerRefs: [CT.felt, CT.integrity],
    grade: (a) => unknownIf(a) ? { status: 'unknown', note: 'Could not be verified from this inspection.' }
      : /none/i.test(a) ? { status: 'attention', note: 'No underlayment found. Shingles laid straight on the deck have nothing beneath them when a seal fails.' }
      : { status: 'present', note: `${a} underlayment in place.` },
  },
  {
    field: 'Ice and water shield', label: 'Ice & water shield',
    standardText: 'Self-adhering waterproofing in the valleys and around penetrations, where water concentrates — and along the eaves where ice backup is a history. Manufacturer best practice on every roof we build; the code trigger is regional.',
    codeRefs: [IRC.iceBarrier],
    manufacturerRefs: [CT.selfAdhered, CT.integrity],
    grade: (a) => unknownIf(a) ? { status: 'unknown', note: 'Could not be verified from this inspection.' }
      : /^no\b/i.test(a) ? { status: 'attention', note: 'None found. Valleys and penetrations are where a roof leaks first; a new roof gets self-adhering membrane there.' }
      : /eaves only/i.test(a) ? { status: 'attention', note: 'At the eaves only — the valleys and penetrations are not protected.' }
      : { status: 'present', note: `Present: ${a.replace(/^yes\s*-\s*/i, '')}.` },
  },
  {
    field: 'Valley type', label: 'Valleys',
    standardText: 'A lined valley — self-adhering membrane or metal beneath the shingles — because two slopes drain through it and it carries more water per foot than anywhere else on the roof.',
    codeRefs: [IRC.valleys],
    manufacturerRefs: [CT.sam('Open and closed valley construction')],
    grade: (a) => unknownIf(a) ? { status: 'unknown', note: 'Could not be verified from this inspection.' }
      : /no valleys/i.test(a) ? { status: 'present', note: 'This roof has no valleys.' }
      : /roll roofing/i.test(a) ? { status: 'attention', note: 'Roll-roofing valleys crack and split with age; a new roof gets a membrane-lined valley.' }
      : { status: 'present', note: `${a} valleys.` },
  },
  {
    field: 'Starter course present', label: 'Starter course',
    standardText: 'A starter strip along every eave and rake, with its adhesive line at the edge, so the first course is sealed down where wind uplift begins. Required for the manufacturer\'s wind warranty.',
    codeRefs: [IRC.attachment],
    manufacturerRefs: [CT.landmark('Starter course at eaves and rakes'), CT.wind],
    grade: (a) => unknownIf(a) ? { status: 'unknown', note: 'Could not be verified from this inspection.' }
      : /^no\b/i.test(a) ? { status: 'attention', note: 'No starter course. The first course of shingles is unsealed at the edge, which is exactly where wind gets under a roof.' }
      : /eaves only|rakes only/i.test(a) ? { status: 'attention', note: `Starter at ${a.replace(/^yes\s*-\s*/i, '')} — the other edge is unsealed.` }
      : { status: 'present', note: 'Starter course at the eaves and rakes.' },
  },
];

export function assemblyStandardFor(field: string): AssemblyStandard | undefined {
  return ASSEMBLY_STANDARDS.find((s) => s.field === field);
}

/** Attic ventilation, per the industry 1/150 rule (1/300 when intake and exhaust are balanced). */
export const VENTILATION_STANDARD = {
  label: 'Attic ventilation',
  standardText: 'Net free vent area of at least 1 square foot per 150 square feet of attic floor — or 1 per 300 when intake at the eaves and exhaust at the ridge are balanced. Exhaust without intake does not ventilate.',
  codeRefs: [IRC.ventRequired, IRC.ventArea],
  manufacturerRefs: [CT.integrity, CT.sam('Balanced intake and exhaust ventilation')],
};

/**
 * The verified citations for a finding as one footnote block, or '' while
 * none are verified. `className` is the host document's small-print class
 * ('muted' on the printed documents, 'sc-body tiny' on the scroll ones).
 */
export function renderStandardsFootnote(pricingType: string | null | undefined, className: string): string {
  const { code, manufacturer } = standardsLine(pricingType);
  if (!code.length && !manufacturer.length) return '';
  const parts: string[] = [];
  if (code.length) parts.push(`<b>${esc(CODE_EDITION)}:</b> ${code.map((r) => `${esc(r.cite)} (${esc(r.title)})`).join('; ')}`);
  if (manufacturer.length) parts.push(`<b>Manufacturer / standards:</b> ${manufacturer.map((r) => `${esc(r.cite)} — ${esc(r.title)}`).join('; ')}`);
  return `<div class="${esc(className)} standards-note" style="margin-top:6px;font-size:11px;line-height:1.5">${parts.join('<br/>')}</div>`;
}

/** Every distinct citation, with which findings use it — the reviewer's worksheet. */
export function standardsReviewSheet(): Array<{ cite: string; title: string; note?: string; verifiedOn: string | null; usedBy: string[] }> {
  const byCite = new Map<string, { cite: string; title: string; note?: string; verifiedOn: string | null; usedBy: string[] }>();
  const add = (usedBy: string, refs: StandardRef[]) => {
    for (const r of refs) {
      const key = `${r.cite} — ${r.title}`;
      const row = byCite.get(key) ?? { cite: r.cite, title: r.title, note: r.note, verifiedOn: r.verifiedOn, usedBy: [] };
      row.usedBy.push(usedBy);
      byCite.set(key, row);
    }
  };
  for (const [type, s] of Object.entries(STANDARDS)) add(type, [...s.codeRefs, ...s.manufacturerRefs]);
  for (const a of ASSEMBLY_STANDARDS) add(`assembly:${a.field}`, [...a.codeRefs, ...a.manufacturerRefs]);
  add('assembly:ventilation', [...VENTILATION_STANDARD.codeRefs, ...VENTILATION_STANDARD.manufacturerRefs]);
  return Array.from(byCite.values());
}

/** Citation footnote for an arbitrary ref list (assembly rows, ventilation). */
export function renderRefsFootnote(refs: { codeRefs: StandardRef[]; manufacturerRefs: StandardRef[] }, className: string): string {
  const code = printableRefs(refs.codeRefs);
  const manufacturer = printableRefs(refs.manufacturerRefs);
  if (!code.length && !manufacturer.length) return '';
  const parts: string[] = [];
  if (code.length) parts.push(`<b>${esc(CODE_EDITION)}:</b> ${code.map((r) => `${esc(r.cite)} (${esc(r.title)})`).join('; ')}`);
  if (manufacturer.length) parts.push(`<b>Manufacturer / standards:</b> ${manufacturer.map((r) => `${esc(r.cite)} — ${esc(r.title)}`).join('; ')}`);
  return `<div class="${esc(className)} standards-note" style="margin-top:6px;font-size:11px;line-height:1.5">${parts.join('<br/>')}</div>`;
}

export const ALL_STANDARDS_TYPES = Object.keys(STANDARDS) as PricingDamageType[];
