/**
 * The Final Walkthrough — done by the sales rep or the project manager once
 * the crew is off the roof, before the job is called complete. Same pattern
 * as the pre-construction checklist (one shared field schema, a JSONB answers
 * blob, autosaved draft → locked submit → JobTread comment), with one extra
 * field type: 'verify', an inspection point answered Pass / Issue / N/A.
 *
 * What it exists to catch, in James's words: nails, any damage or defect,
 * and anything the crew left behind. Every Issue must carry a note, and on
 * submit each one becomes a follow-up so it can't be forgotten.
 */
import type { ChecklistField } from './preconstruction-checklist';

export type VerifyState = 'ok' | 'issue' | 'na';
export interface VerifyAnswer { state: VerifyState; note?: string }

export const VERIFY_LABELS: Record<VerifyState, string> = { ok: 'Pass', issue: 'Issue found', na: 'N/A' };

const v = (name: string, description: string | null, section: string, isRequired = true): ChecklistField =>
  ({ name, description, type: 'verify', options: null, isRequired, section });

export const WALKTHROUGH_FIELDS: ChecklistField[] = [
  { name: 'Walked by', description: null, type: 'string', options: null, isRequired: true, section: 'Basics' },
  { name: 'Role', description: null, type: 'option', options: ['Sales Rep', 'Project Manager', 'Both'], isRequired: true, section: 'Basics' },
  { name: 'Date', description: null, type: 'date', options: null, isRequired: true, section: 'Basics' },
  { name: 'Homeowner present', description: 'Walk it with them whenever you can — it is the moment they decide how they feel about us.', type: 'option', options: ['Yes', 'No'], isRequired: true, section: 'Basics' },

  v('Magnetic sweep — driveway, walkways, garage apron', 'Roll the magnet slowly, twice, in both directions. This is where tires and feet meet nails.', 'Nail Sweep'),
  v('Magnetic sweep — lawn, flower beds, mulch', 'The full drip line of the roof, plus wherever bundles were staged.', 'Nail Sweep'),
  v('Magnetic sweep — patio, deck, pool area, around the AC unit', null, 'Nail Sweep'),
  v('Magnetic sweep — street and curb where the dumpster and materials sat', null, 'Nail Sweep'),
  v('Gutters and downspouts cleared of nails, granules and debris', 'Look in every gutter run; flush a downspout if it has been a granule-heavy tear-off.', 'Nail Sweep'),
  { name: 'Nails and debris collected', description: 'Photo of the magnet / bucket haul before it goes in the truck.', type: 'photo', options: null, isRequired: true, section: 'Nail Sweep' },

  v('Shingle scraps, wrappers, felt and cut-offs removed from the property', null, 'Cleanup & Leftovers'),
  v('Leftover material removed, or stacked where the homeowner agreed', 'Extra bundles are either back on the truck or where the homeowner asked — never left in the driveway by default.', 'Cleanup & Leftovers'),
  v('Dumpster hauled away; the pad under it swept and checked for marks', null, 'Cleanup & Leftovers'),
  v('Tarps, ladders, tools, coolers and equipment gone', null, 'Cleanup & Leftovers'),
  v('Old satellite dish / antenna hardware and removed vents disposed of', null, 'Cleanup & Leftovers', false),
  { name: 'Site after cleanup', description: 'Photos of the yard, driveway and street frontage once the crew is gone.', type: 'photo', options: null, isRequired: true, section: 'Cleanup & Leftovers' },

  v('Driveway and concrete — no cracks, chips or dumpster marks', null, 'Property Check'),
  v('Siding, trim, paint, windows and screens undamaged', 'Look under every eave and at every ladder point.', 'Property Check'),
  v('Gutters and downspouts — no dents, loose hangers or knocked-out alignment', null, 'Property Check'),
  v('Landscaping, shrubs, flower beds and lawn undamaged', null, 'Property Check'),
  v('AC unit, exterior lights, cameras, doorbell working and undamaged', null, 'Property Check'),
  v('Satellite dish reinstalled and pointing; homeowner confirmed signal', null, 'Property Check', false),
  v('Fence, mailbox, décor and outdoor furniture back in place and undamaged', null, 'Property Check'),
  v('Interior — no ceiling marks, attic debris cleared, fallen pictures or fixtures reported', 'Ask the homeowner; do not assume.', 'Property Check'),

  v('Ridge and hip caps straight, sealed, no exposed nails', null, 'Roof Check'),
  v('Shingle courses straight; no lifted, torn or unsealed tabs', 'Fresh seal strips take a few warm days — note anything that looks lifted, not just torn.', 'Roof Check'),
  v('All flashing, pipe boots, vents and counter-flashing installed and sealed', null, 'Roof Check'),
  v('Drip edge and valleys finished; no gaps at rakes and eaves', null, 'Roof Check'),
  v('Roof surface clean; ridge vent and soffit intake unobstructed', null, 'Roof Check'),
  v('Skylights, chimney cap and any specialty work finished as sold', null, 'Roof Check', false),
  { name: 'Completed roof — every slope', description: 'One photo per slope plus the ridge line. These become the warranty record.', type: 'photo', options: null, isRequired: true, section: 'Roof Check' },

  { name: 'Walked the property with the homeowner', description: null, type: 'checkbox', options: null, isRequired: false, section: 'Homeowner' },
  { name: 'Explained the warranty, roof care and what to expect', description: 'Seal-down period, a few loose granules in the gutters for the first rains, who to call.', type: 'checkbox', options: null, isRequired: true, section: 'Homeowner' },
  { name: 'Final balance', description: null, type: 'option', options: ['Paid in full', 'Balance due — collected today', 'Balance due — not yet collected', 'Insurance — awaiting depreciation / final check'], isRequired: true, section: 'Homeowner' },
  { name: 'Asked for a Google review', description: null, type: 'checkbox', options: null, isRequired: false, section: 'Homeowner' },
  { name: 'Homeowner concerns', description: 'Anything they mentioned, in their words.', type: 'longString', options: null, isRequired: false, section: 'Homeowner' },
  { name: 'Homeowner signature', description: 'Required when the homeowner is present.', type: 'signature', options: null, isRequired: false, section: 'Homeowner' },

  { name: 'Additional notes', description: null, type: 'longString', options: null, isRequired: false, section: 'Sign-Off' },
  { name: 'Walkthrough signature', description: null, type: 'signature', options: null, isRequired: true, section: 'Sign-Off' },
];

export const WALKTHROUGH_SECTIONS = [...new Set(WALKTHROUGH_FIELDS.map((f) => f.section))];

/** JobTread stages where the crew is on or just off the roof — the walkthrough is due, and a missing one is worth a banner. */
export const WALKTHROUGH_RELEVANT_STAGES = ['Roof Construction', 'Other Construction Work', 'Complete', 'PIF File Warranties'];

export function verifyAnswer(value: unknown): VerifyAnswer | null {
  if (!value || typeof value !== 'object') return null;
  const state = (value as any).state;
  if (state !== 'ok' && state !== 'issue' && state !== 'na') return null;
  const note = String((value as any).note ?? '').trim();
  return note ? { state, note } : { state };
}

function isAnswered(field: ChecklistField, answers: Record<string, any>): boolean {
  const val = answers[field.name];
  if (field.type === 'verify') {
    const a = verifyAnswer(val);
    if (!a) return false;
    return a.state !== 'issue' || !!a.note; // an Issue with no note is not an answer
  }
  if (field.type === 'photo') return Array.isArray(val) && val.length > 0;
  if (field.type === 'checkbox') return val === true;
  return val !== undefined && val !== null && String(val).trim() !== '';
}

/** Required fields still unanswered — plus the homeowner's signature when they were present. */
export function missingRequiredWalkthroughFields(answers: Record<string, any>): string[] {
  const missing = WALKTHROUGH_FIELDS.filter((f) => f.isRequired).filter((f) => !isAnswered(f, answers)).map((f) => f.name);
  const sig = WALKTHROUGH_FIELDS.find((f) => f.name === 'Homeowner signature')!;
  if (answers['Homeowner present'] === 'Yes' && !isAnswered(sig, answers)) missing.push(sig.name);
  // A verify item answered Issue without a note is incomplete even when the item itself is optional.
  for (const f of WALKTHROUGH_FIELDS) {
    if (f.type === 'verify' && !f.isRequired) {
      const a = verifyAnswer(answers[f.name]);
      if (a?.state === 'issue' && !a.note && !missing.includes(f.name)) missing.push(f.name);
    }
  }
  return missing;
}

export interface WalkthroughIssue { item: string; section: string; note: string }

/** Every inspection point answered "Issue found" — what becomes a follow-up on submit. */
export function walkthroughIssues(answers: Record<string, any>): WalkthroughIssue[] {
  return WALKTHROUGH_FIELDS
    .filter((f) => f.type === 'verify')
    .map((f) => ({ f, a: verifyAnswer(answers[f.name]) }))
    .filter(({ a }) => a?.state === 'issue')
    .map(({ f, a }) => ({ item: f.name, section: f.section, note: a!.note || '' }));
}

/** Pass / issue / n-a counts, for the summary line. */
export function walkthroughTally(answers: Record<string, any>): { ok: number; issue: number; na: number; unanswered: number } {
  const t = { ok: 0, issue: 0, na: 0, unanswered: 0 };
  for (const f of WALKTHROUGH_FIELDS) {
    if (f.type !== 'verify') continue;
    const a = verifyAnswer(answers[f.name]);
    if (!a) t.unanswered++; else t[a.state]++;
  }
  return t;
}
