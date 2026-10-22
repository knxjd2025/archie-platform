/**
 * The Pre-Construction Checklist — filled out by the sales rep at the point
 * they collect the down payment, on the job's detail page (not JobTread —
 * see shared/inspection-form.ts's header for why this pattern exists).
 * One source of truth for the form schema, shared by client and server.
 *
 * Two field types beyond the inspection form's set:
 *  - 'checkbox': a talking-point confirmation (boolean answer)
 *  - 'photo': answer is an array of { fileId, name } uploaded via the
 *    existing job-photos endpoint; "required" means at least one item.
 */

/**
 * 'verify' (final walkthrough): an inspection point answered Pass / Issue /
 * N/A — `{ state, note }`, where an Issue must carry a note. Every Issue
 * becomes a follow-up on submit (shared/final-walkthrough.ts).
 */
export type ChecklistFieldType = 'string' | 'longString' | 'date' | 'option' | 'checkbox' | 'photo' | 'signature' | 'verify';

export interface ChecklistPhotoAnswer {
  fileId: string;
  name: string;
}

export interface ChecklistField {
  name: string;
  description: string | null;
  type: ChecklistFieldType;
  options: string[] | null;
  isRequired: boolean;
  section: string;
}

export const PRECON_CHECKLIST_FIELDS: ChecklistField[] = [
  { name: 'Rep Name', description: null, type: 'string', options: null, isRequired: true, section: 'Basics' },
  { name: 'Date', description: null, type: 'date', options: null, isRequired: true, section: 'Basics' },

  { name: 'Material drop location', description: 'Photo of where shingles/material bundles will be dropped.', type: 'photo', options: null, isRequired: true, section: 'Site Photos' },
  { name: 'Dumpster location', description: 'Photo of where the dumpster will be placed.', type: 'photo', options: null, isRequired: true, section: 'Site Photos' },
  { name: 'Aerial view of home', description: 'An overhead/aerial shot of the whole house.', type: 'photo', options: null, isRequired: true, section: 'Site Photos' },
  { name: 'Risk / hazard items', description: 'Anything that could be an issue on install day — low power lines, pools, fragile fencing or décor, tight access, etc. Leave empty if none.', type: 'photo', options: null, isRequired: false, section: 'Site Photos' },
  { name: 'Risk notes', description: 'Describe what’s photographed above, if anything.', type: 'longString', options: null, isRequired: false, section: 'Site Photos' },

  { name: 'Confirmed crew arrival time', description: 'Told the homeowner the crew arrives no later than 7:00 AM.', type: 'checkbox', options: null, isRequired: true, section: 'Homeowner Conversation' },
  { name: 'Asked homeowner to mow the lawn', description: 'If thick/summer grass: asked homeowner to mow within 48 hours of the install date.', type: 'checkbox', options: null, isRequired: true, section: 'Homeowner Conversation' },
  { name: 'Confirmed shingle/material color', description: null, type: 'string', options: null, isRequired: true, section: 'Homeowner Conversation' },
  { name: 'Confirmed material drop-off location preference', description: null, type: 'option', options: ['Driveway', 'Side yard', 'Street', 'Other'], isRequired: true, section: 'Homeowner Conversation' },
  // Asked every time rather than only when the rep notices one: a dish nobody
  // mentioned is a decision the crew ends up making on the roof, on the day.
  { name: 'Satellite dish', description: 'Ask the homeowner: does it come off and stay off, or does it go back on after the roof? N/A if there is no dish.', type: 'option', options: ['Stays', 'Goes', 'N/A'], isRequired: true, section: 'Homeowner Conversation' },
  { name: 'Explained possible house vibration', description: 'Explained the house can shake a little during tear-off/install and may knock down pictures or light fixtures. Rare, and nothing can be done about it — homeowner just needs to be aware.', type: 'checkbox', options: null, isRequired: true, section: 'Homeowner Conversation' },

  { name: 'Additional notes', description: null, type: 'longString', options: null, isRequired: false, section: 'Sign-Off' },
  { name: 'Rep Signature', description: null, type: 'signature', options: null, isRequired: true, section: 'Sign-Off' },
];

export const PRECON_CHECKLIST_SECTIONS = [...new Set(PRECON_CHECKLIST_FIELDS.map((f) => f.section))];

function isAnswered(field: ChecklistField, answers: Record<string, any>): boolean {
  const v = answers[field.name];
  if (field.type === 'photo') return Array.isArray(v) && v.length > 0;
  if (field.type === 'checkbox') return v === true;
  return v !== undefined && v !== null && String(v).trim() !== '';
}

/** Every required field has a non-empty answer — gates moving a submission from draft to submitted. */
export function preconFieldsComplete(answers: Record<string, any>): boolean {
  return PRECON_CHECKLIST_FIELDS.filter((f) => f.isRequired).every((f) => isAnswered(f, answers));
}

export function missingRequiredPreconFields(answers: Record<string, any>): string[] {
  return PRECON_CHECKLIST_FIELDS.filter((f) => f.isRequired).filter((f) => !isAnswered(f, answers)).map((f) => f.name);
}
