/**
 * The BRN commercial (low-slope) roof inspection checklist — one source of
 * truth for the form schema, shared by the client (renders it) and the
 * server (validates required fields, feeds the commercial reports).
 *
 * Same InspectionField shape and storage as the residential form
 * (shared/inspection-form.ts, inspection_submissions.form_kind =
 * 'commercial'), different questions: a flat roof is an ASSEMBLY — deck,
 * vapor retarder, insulation, cover board, membrane, surfacing — and the
 * report's whole argument (restore, recover, or tear off) turns on what
 * those layers are, how many of them there are, and whether they are wet.
 *
 * Ratings use one vocabulary everywhere: Good / Fair / Poor / Failed / N/A.
 */
import type { InspectionField } from './inspection-form';

export const RATINGS = ['Good', 'Fair', 'Poor', 'Failed', 'N/A'] as const;
export type Rating = (typeof RATINGS)[number];

const rate = (name: string, description: string | null, isRequired = false): InspectionField =>
  ({ name, description, type: 'option', options: [...RATINGS], isRequired, isReviewerField: false, section: 'Condition Assessment' });

export const COMMERCIAL_INSPECTION_FIELDS: InspectionField[] = [
  { name: 'Inspection Date', description: null, type: 'date', options: null, isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Inspector Name', description: null, type: 'string', options: null, isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Inspection Type', description: 'A claim needs the storm date and impact evidence below. A due-diligence or condition assessment needs the core cut and moisture findings.', type: 'option', options: ['Condition Assessment', 'Leak Investigation', 'Insurance Claim', 'Storm Response', 'Pre-Purchase / Due Diligence', 'Warranty / Maintenance'], isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'How was the roof accessed?', description: null, type: 'option', options: ['Walked the roof', 'Drone flown', 'Hatch or ladder, partial walk', 'Ground only'], isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Building type / use', description: null, type: 'option', options: ['Warehouse / Industrial', 'Office', 'Retail / Strip center', 'Restaurant', 'Church', 'School', 'Medical', 'Multi-family', 'Municipal', 'Other'], isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Building occupied during work?', description: 'Drives phasing, odor control (adhesives, torch), and where the crane and dumpster can sit.', type: 'option', options: ['Yes', 'Partially', 'No'], isRequired: false, isReviewerField: false, section: 'Basics' },
  { name: 'Number of stories', description: null, type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Basics' },
  { name: 'Roof height (ft)', description: 'Eave height to the ground — decides lift vs ladder, and fall-protection requirements.', type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Basics' },
  { name: 'Roof area (sq ft)', description: 'Field estimate; the measurement report is the final word. Reports convert to squares (÷100).', type: 'number', options: null, isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Number of roof sections / levels', description: null, type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Basics' },
  { name: 'Roof slope', description: 'Membrane roofs need positive drainage — 1/4 in 12 is the code minimum for a new system.', type: 'option', options: ['Dead flat (under 1/8:12)', 'About 1/8:12', '1/4:12', '1/2:12', 'Over 1/2:12 (tapered or structural)', 'Unknown'], isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Parapet walls', description: null, type: 'option', options: ['Full perimeter, 42 in or taller', 'Full perimeter, under 42 in', 'Partial perimeter', 'None — edge metal only'], isRequired: false, isReviewerField: false, section: 'Basics' },
  { name: 'Rooftop access', description: null, type: 'option', options: ['Interior roof hatch', 'Fixed exterior ladder', 'Stair / penthouse door', 'None — lift or ladder required'], isRequired: false, isReviewerField: false, section: 'Basics' },

  { name: 'Deck type', description: 'What the whole assembly is fastened to. Check at a hatch, a core cut, or from below.', type: 'option', options: ['Steel (metal deck)', 'Concrete', 'Wood / plywood', 'Gypsum', 'Cementitious wood fiber (Tectum)', 'Lightweight insulating concrete', 'Unknown'], isRequired: true, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Deck condition', description: 'Rust-through, soft spots, deflection, or rot seen from above or below.', type: 'option', options: ['Good', 'Fair', 'Poor', 'Failed', 'Not visible'], isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Vapor retarder', description: null, type: 'option', options: ['None seen', 'Present — type unknown', 'Self-adhered sheet', 'Asphalt / felt', 'Polyethylene', 'Unknown'], isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Insulation type', description: null, type: 'option', options: ['Polyiso', 'EPS', 'XPS', 'Mineral wool', 'Perlite', 'Wood fiber', 'Lightweight concrete fill', 'None', 'Unknown'], isRequired: true, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Insulation thickness (in)', description: 'Total, all layers. From the core cut or the edge metal.', type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Insulation attachment', description: null, type: 'option', options: ['Mechanically fastened', 'Adhered', 'Loose-laid / ballasted', 'Unknown'], isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Cover board', description: null, type: 'option', options: ['None', 'Gypsum (DensDeck / Securock type)', 'High-density polyiso', 'Perlite', 'Wood fiber', 'Unknown'], isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Membrane type', description: 'TPO is white and heat-welded; PVC similar but softer; EPDM is black rubber with taped/glued seams; mod-bit has granules and torched or mopped laps; BUR has gravel or a smooth coating.', type: 'option', options: ['TPO', 'PVC', 'EPDM', 'Modified bitumen — SBS', 'Modified bitumen — APP', 'Built-up (BUR) — gravel surfaced', 'Built-up (BUR) — smooth / coated', 'Metal panel', 'Spray polyurethane foam (SPF)', 'Coating over an older membrane', 'Unknown'], isRequired: true, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Membrane thickness / plies', description: 'e.g. 45 mil, 60 mil, 2-ply, 4-ply. From the core cut or a cut edge.', type: 'string', options: null, isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Membrane attachment', description: null, type: 'option', options: ['Fully adhered', 'Mechanically attached', 'Ballasted', 'Induction welded', 'Torched / hot-mopped', 'Unknown'], isRequired: true, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Surfacing', description: null, type: 'option', options: ['None (smooth)', 'Gravel / ballast', 'Granules', 'Coating — acrylic', 'Coating — silicone', 'Aluminum coating', 'Pavers'], isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Number of roof systems in place', description: 'Count every membrane you find in the core cut. Two or more is a tear-off under the code, no matter their condition.', type: 'option', options: ['1', '2', '3 or more', 'Unknown'], isRequired: true, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Estimated age of current roof (years)', description: null, type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Core cut taken', description: 'A core cut is the only way to know the layers, the insulation, and whether it is wet. Recommend one on every replacement candidate.', type: 'option', options: ['Yes', 'No — recommended', 'No — not needed'], isRequired: true, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Core cut findings', description: 'Top to bottom: each layer, its thickness, wet or dry, and the deck.', type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Existing Roof System' },
  { name: 'Roof history', description: 'Prior repairs, coatings, patches, a warranty on file, who installed it and when — from the owner or from what you can see.', type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Existing Roof System' },

  rate('Membrane field condition', 'Blisters, alligatoring, crazing, shrinkage/bridging, punctures, exposed scrim, ballast displacement.', true),
  rate('Seams and laps', 'Open, fishmouthed, or lifting seams; cold welds; lap sealant condition.', true),
  rate('Base flashings (walls and curbs)', 'Height (8 in minimum), adhesion, fishmouths, splits at corners.', true),
  rate('Counterflashing and termination bar', null),
  rate('Parapet coping and wall caps', 'Open joints, missing fasteners, standing water on the cap.'),
  rate('Perimeter edge metal (fascia, gravel stop, drip edge)', 'Loose, lifted, or rusted metal is the first thing wind takes.', true),
  rate('Penetrations (pipes, pitch pockets, conduits)', 'Pitch pockets that have sunk or cracked; unflashed penetrations; abandoned equipment curbs.', true),
  rate('HVAC curbs and rooftop equipment', 'Curb height, condensate lines discharging onto the roof, equipment set directly on the membrane.'),
  rate('Drains and strainers', 'Strainers in place, clamping rings tight, sumped and flashed.', true),
  rate('Scuppers and overflow drainage', null),
  rate('Gutters and downspouts', null),
  rate('Expansion joints', null),
  rate('Skylights, hatches and smoke vents', 'Yellowed or cracked domes; unguarded skylights are a fall hazard.'),
  rate('Walkway pads and traffic protection', 'Paths to every piece of equipment that gets serviced.'),
  rate('Rooftop pipe, conduit and gas-line supports', 'Wood blocks and bricks set on the membrane wear through it.'),
  { name: 'Condition notes by area', description: 'Plain language, area by area. What is failing, where, and what caused it. This is the heart of the customer report.', type: 'longString', options: null, isRequired: true, isReviewerField: false, section: 'Condition Assessment' },

  { name: 'Ponding observed', description: 'Ponding is water still standing 48 hours after rain.', type: 'option', options: ['None', 'Minor — under 1/4 in, drains within 48 hours', 'Moderate — 1/4 to 1 in, or slow to drain', 'Severe — over 1 in, or standing well past 48 hours'], isRequired: true, isReviewerField: false, section: 'Drainage & Moisture' },
  { name: 'Ponding locations and approximate area', description: 'e.g. NE corner near unit 3, about 200 sq ft.', type: 'string', options: null, isRequired: false, isReviewerField: false, section: 'Drainage & Moisture' },
  { name: 'Number of roof drains', description: null, type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Drainage & Moisture' },
  { name: 'Overflow / secondary drainage present', description: 'Overflow drains or scuppers protect the structure when a primary drain clogs.', type: 'option', options: ['Yes', 'No', 'Unknown'], isRequired: false, isReviewerField: false, section: 'Drainage & Moisture' },
  { name: 'Drains clear with strainers in place', description: null, type: 'option', options: ['Yes', 'Partially', 'No'], isRequired: false, isReviewerField: false, section: 'Drainage & Moisture' },
  { name: 'Moisture survey performed', description: 'A non-destructive survey finds wet insulation the eye cannot. Recommend one before any recover or restoration.', type: 'option', options: ['None', 'Infrared (IR) scan', 'Nuclear', 'Capacitance / impedance', 'Core cuts only'], isRequired: true, isReviewerField: false, section: 'Drainage & Moisture' },
  { name: 'Estimated wet insulation (% of roof area)', description: 'From the survey or the cores. Wet insulation cannot be covered over — it has to come out.', type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Drainage & Moisture' },
  { name: 'Active leaks reported by the owner', description: null, type: 'option', options: ['Yes', 'No'], isRequired: true, isReviewerField: false, section: 'Drainage & Moisture' },
  { name: 'Interior evidence', description: 'Ceiling stains, drips, deflected deck, wet insulation seen from below, rust on the deck underside.', type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Drainage & Moisture' },

  { name: 'Storm Date', description: 'Only for a claim: the specific hail or wind event. Use the storm lookup.', type: 'date', options: null, isRequired: false, isReviewerField: false, section: 'Damage & Claims' },
  { name: 'Storm Type', description: 'Only alongside a Storm Date.', type: 'option', options: ['Hail', 'Wind', 'Hail & Wind'], isRequired: false, isReviewerField: false, section: 'Damage & Claims' },
  { name: 'Hail impact evidence on membrane or equipment', description: 'Fractured membrane over insulation facer, spatter marks on units and vents, dented fins and hoods.', type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: false, isReviewerField: false, section: 'Damage & Claims' },
  { name: 'Wind damage (uplift, peeled edges, displaced ballast)', description: null, type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: false, isReviewerField: false, section: 'Damage & Claims' },
  { name: 'Punctures or mechanical damage', description: 'Dropped tools, HVAC service traffic, screws backing out through the membrane.', type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: false, isReviewerField: false, section: 'Damage & Claims' },
  { name: 'Overall condition summary', description: 'Plain language, for the owner: what this roof is, what shape it is in, and what we recommend and why. This leads every commercial report.', type: 'longString', options: null, isRequired: true, isReviewerField: false, section: 'Damage & Claims' },

  { name: 'Fall protection present', description: null, type: 'option', options: ['Parapet 42 in or taller', 'Guardrail', 'Anchor points / lifeline', 'None'], isRequired: false, isReviewerField: false, section: 'Safety & Access' },
  { name: 'Rooftop hazards', description: 'Unguarded skylights, exposed electrical, gas lines, hot exhaust, unstable deck areas.', type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Safety & Access' },
  { name: 'Access and staging notes', description: 'Where the crane, dumpster and material can go; hours the site is available; tenants to notify.', type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Safety & Access' },

  { name: 'Full photo package complete', description: 'Every roof section overview, every drain and scupper, every penetration and curb, all edge metal, each core cut, and every problem close up.', type: 'option', options: ['Yes', 'No'], isRequired: true, isReviewerField: false, section: 'Sign-Off' },
  { name: 'Inspector Signature', description: null, type: 'signature', options: null, isRequired: true, isReviewerField: false, section: 'Sign-Off' },

  { name: 'Recommendation', description: null, type: 'option', options: ['Restoration coating', 'Recover (layover) over the existing roof', 'Full replacement (tear-off)', 'Repair only', 'Maintenance plan — monitor', 'File a claim', 'Re-inspect after moisture survey'], isRequired: false, isReviewerField: true, section: 'Review' },
  { name: 'Reviewed by', description: null, type: 'string', options: null, isRequired: false, isReviewerField: true, section: 'Review' },
];

export const COMMERCIAL_INSPECTION_SECTIONS = [...new Set(COMMERCIAL_INSPECTION_FIELDS.map((f) => f.section))];

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

export function missingRequiredCommercialFields(answers: Record<string, any>): string[] {
  return COMMERCIAL_INSPECTION_FIELDS
    .filter((f) => f.isRequired && !f.isReviewerField)
    .filter((f) => !filled(answers[f.name]))
    .map((f) => f.name);
}

/* ------------------------------------------------ derived, for the reports --- */

export interface RoofLayer {
  /** deck → ... → surfacing, bottom to top */
  role: 'deck' | 'vapor' | 'insulation' | 'cover' | 'membrane' | 'surfacing' | 'older-roof';
  label: string;
  detail: string | null;
  /** true when the inspector could not determine it */
  unknown: boolean;
}

const unk = (v: string | null | undefined) => !v || /unknown|not visible|none seen/i.test(v);

/**
 * The existing assembly as a stack, bottom to top, straight from the
 * answers. Layers the inspector marked None are left out; layers marked
 * Unknown are kept and flagged, because "we don't know what's under there"
 * is itself a finding (and the reason to take a core cut).
 */
export function existingAssemblyLayers(a: Record<string, any>): RoofLayer[] {
  const s = (k: string) => (filled(a[k]) ? String(a[k]).trim() : null);
  const layers: RoofLayer[] = [];
  const deck = s('Deck type');
  layers.push({ role: 'deck', label: deck && !unk(deck) ? deck : 'Deck — not determined', detail: s('Deck condition') ? `Condition: ${s('Deck condition')}` : null, unknown: unk(deck) });
  const vr = s('Vapor retarder');
  if (vr && !/none seen/i.test(vr)) layers.push({ role: 'vapor', label: /unknown/i.test(vr) ? 'Vapor retarder — type not determined' : `Vapor retarder — ${vr}`, detail: null, unknown: unk(vr) });
  const ins = s('Insulation type');
  if (ins && ins !== 'None') {
    const t = s('Insulation thickness (in)');
    const att = s('Insulation attachment');
    layers.push({ role: 'insulation', label: unk(ins) ? 'Insulation — type not determined' : `${ins} insulation${t ? `, ${t} in` : ''}`, detail: att && !unk(att) ? att : null, unknown: unk(ins) });
  } else if (ins === 'None') {
    layers.push({ role: 'insulation', label: 'No insulation above the deck', detail: null, unknown: false });
  }
  const cb = s('Cover board');
  if (cb && cb !== 'None') layers.push({ role: 'cover', label: unk(cb) ? 'Cover board — not determined' : `Cover board — ${cb}`, detail: null, unknown: unk(cb) });
  const count = s('Number of roof systems in place');
  if (count === '2' || count === '3 or more') {
    layers.push({ role: 'older-roof', label: count === '2' ? 'An older roof membrane, still in place' : 'Two or more older roof membranes, still in place', detail: 'Found under the current roof', unknown: false });
  }
  const mem = s('Membrane type');
  const thick = s('Membrane thickness / plies');
  const mAtt = s('Membrane attachment');
  layers.push({ role: 'membrane', label: mem && !unk(mem) ? `${mem}${thick ? ` — ${thick}` : ''}` : 'Membrane — type not determined', detail: mAtt && !unk(mAtt) ? mAtt : null, unknown: unk(mem) });
  const surf = s('Surfacing');
  if (surf && !/^none/i.test(surf)) layers.push({ role: 'surfacing', label: surf, detail: null, unknown: false });
  return layers;
}

export interface ConditionItem { item: string; rating: Rating; description: string | null }

/** Every rated component with an answer, worst first. */
export function conditionItems(a: Record<string, any>): ConditionItem[] {
  const order: Record<string, number> = { Failed: 0, Poor: 1, Fair: 2, Good: 3, 'N/A': 4 };
  return COMMERCIAL_INSPECTION_FIELDS
    .filter((f) => f.section === 'Condition Assessment' && f.type === 'option')
    .map((f) => ({ item: f.name, rating: a[f.name] as Rating, description: f.description }))
    .filter((c) => RATINGS.includes(c.rating))
    .sort((x, y) => order[x.rating] - order[y.rating]);
}

export type ReroofPath = 'restore' | 'recover' | 'replace' | 'undetermined';

export interface ReroofDetermination {
  path: ReroofPath;
  /** Plain-English reasons, strongest first. A "replace" reason that comes from the code is tagged so the report can cite it. */
  reasons: Array<{ text: string; code?: boolean }>;
  /** What is still unknown and would change the answer. */
  openQuestions: string[];
}

/**
 * Restore, recover, or tear off — decided from the inspection the same way
 * the code and the manufacturers decide it, so the proposal's recommendation
 * is an argument the owner can follow, not a preference.
 *
 *   - two or more roof systems already in place  → replace (code)
 *   - wet insulation                             → replace (code: no recover over water-soaked roof)
 *   - deck failed, or membrane failed             → replace
 *   - membrane Poor, or Fair with poor seams      → recover, if the roof is dry and there is one system
 *   - membrane Good/Fair, dry, seams sound        → restore (coating) is on the table
 */
export function reroofDetermination(a: Record<string, any>): ReroofDetermination {
  const s = (k: string) => (filled(a[k]) ? String(a[k]).trim() : null);
  const n = (k: string) => (filled(a[k]) && Number.isFinite(Number(a[k])) ? Number(a[k]) : null);
  const reasons: ReroofDetermination['reasons'] = [];
  const open: string[] = [];

  const count = s('Number of roof systems in place');
  const wetPct = n('Estimated wet insulation (% of roof area)');
  const survey = s('Moisture survey performed');
  const core = s('Core cut taken');
  const deck = s('Deck condition');
  const membrane = s('Membrane field condition');
  const seams = s('Seams and laps');
  const ponding = s('Ponding observed');
  const leaks = s('Active leaks reported by the owner');

  if (count === '2' || count === '3 or more') reasons.push({ text: `There are already ${count === '2' ? 'two' : 'three or more'} roof systems on this building. The building code only lets a new roof go on top of one old roof. So the old roofs have to come off first.`, code: true });
  // Any wet insulation has to come out; past a quarter of the roof the
  // manufacturers call the whole roof a tear-off (GAF's coating program draws
  // that line at 25%), and the code bars a recover over a water-soaked roof.
  if (wetPct != null && wetPct >= 25) reasons.push({ text: `About ${wetPct}% of the insulation is wet. That is too much to just cut out the wet spots. The code does not allow a new roof over a soaked roof. Wet insulation also stops keeping heat in, and it rusts the deck under it.`, code: true });
  if (deck === 'Failed' || deck === 'Poor') reasons.push({ text: `The deck is rated ${deck}. Nothing put on top of a bad deck will last. To fix the deck, we have to take off the roof above it.` });
  if (membrane === 'Failed') reasons.push({ text: 'The waterproof layer has failed. A coating or a new roof on top would have nothing strong to stick to.' });

  if (reasons.length) {
    if (count === 'Unknown' || core !== 'Yes') open.push('A core cut (a small sample of the roof) to count the layers and check the deck.');
    return { path: 'replace', reasons, openQuestions: open };
  }

  if (count === 'Unknown') open.push('How many roofs are already on the building. A core cut will tell us.');
  if (survey === 'None') open.push('A moisture survey (a heat camera scan or small samples). Wet insulation is hidden, and a new roof or coating over it will fail.');
  if (core !== 'Yes') open.push('A core cut to check what kind of insulation is there, how thick it is, and if it is wet.');
  if (leaks === 'Yes' && wetPct == null) open.push('The owner says the roof leaks now. We do not yet know where the water has gone inside the roof.');

  const wetNote = wetPct != null && wetPct > 0 && wetPct < 25
    ? { text: `About ${wetPct}% of the insulation is wet. We cut out those spots and replace them with dry insulation first. A coating or new roof over wet insulation will fail, and no roof maker will put a warranty on it.` }
    : null;

  const weak = membrane === 'Poor' || seams === 'Poor' || seams === 'Failed' || /severe/i.test(ponding || '');
  if (weak) {
    if (wetNote) reasons.push(wetNote);
    reasons.push({ text: `The membrane is rated ${membrane || 'Poor'}${seams && seams !== 'Good' ? ` and the seams ${seams}` : ''}${/severe/i.test(ponding || '') ? ', and a lot of water sits on it' : ''}. A coating would just paint over the problem. But the roof is dry and there is only one roof on the building, so a new roof can go right on top. We do not have to tear it off.` });
    if (/severe|moderate/i.test(ponding || '')) reasons.push({ text: 'The new roof has to fix the standing water, with sloped insulation or more drains. If not, the water will wear out the new roof the same way it wore out this one.' });
    return { path: open.length ? 'undetermined' : 'recover', reasons, openQuestions: open };
  }

  if (membrane === 'Good' || membrane === 'Fair') {
    if (wetNote) reasons.push(wetNote);
    reasons.push({ text: `The membrane is rated ${membrane} and the seams ${seams || 'were not rated'}. A roof that is dry and still strong can get a coating. A coating seals the roof and starts a new warranty for much less than a new roof. First we test that the coating sticks well (it has to hold more than 2 pounds per inch), and that less than a quarter of the roof is wet.` });
    return { path: open.length ? 'undetermined' : 'restore', reasons, openQuestions: open };
  }

  return { path: 'undetermined', reasons: [{ text: 'The roof and seams were not graded yet, so we cannot say what the roof needs yet.' }], openQuestions: open };
}

export const REROOF_PATH_LABEL: Record<ReroofPath, string> = {
  restore: 'Restoration coating',
  recover: 'Recover — a new roof on top of the old one',
  replace: 'Replace — take the old roof off and put on a new one',
  undetermined: 'Not yet determined',
};
