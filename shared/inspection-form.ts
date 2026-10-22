/**
 * The field inspection checklist — one source of truth for the form
 * schema, shared by the client (renders it) and the server (validates
 * required fields, decides when a submission is complete).
 *
 * Ported field-for-field from a roofing company's real field process (a
 * "Roof Inspection Checklist", originally a JobTread form export). Field
 * names are stored as-is and used as the answers object's keys, so this
 * array is the schema for InspectionSubmission.answers.
 */

export type InspectionFieldType = 'string' | 'longString' | 'number' | 'date' | 'option' | 'signature';

export interface InspectionField {
  name: string;
  description: string | null;
  type: InspectionFieldType;
  options: string[] | null;
  isRequired: boolean;
  /** Reviewer-only fields (Recommendation, Reviewed by) — filled by a manager after the field submission, not the inspector. */
  isReviewerField: boolean;
  /** UI grouping only — not part of the original checklist's data. */
  section: string;
}

export const INSPECTION_FORM_FIELDS: InspectionField[] = [
  { name: 'Inspection Date', description: null, type: 'date', options: null, isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Inspector Name', description: null, type: 'string', options: null, isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Inspection Type', description: 'Insurance claims need the full photo package and test square counts. Retail does not.', type: 'option', options: ['Insurance Claim', 'Retail / Non-Insurance', 'Storm Response', 'Pre-Purchase', 'Warranty / Maintenance'], isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'How was the roof accessed?', description: null, type: 'option', options: ['Drone flown', 'Ladder and walked the roof', 'Ladder only, roof not walkable', 'Ground only, no ladder'], isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Number of Stories', description: null, type: 'option', options: ['1 Story', '1.5 Story', '2 Story', '2.5 Story', '3 or more', 'Split Level'], isRequired: false, isReviewerField: false, section: 'Basics' },
  { name: 'Roof Covering Type', description: null, type: 'option', options: ['Asphalt Shingle - 3-Tab', 'Asphalt Shingle - Architectural', 'Asphalt Shingle - Designer', 'Standing Seam Metal', 'Metal - Exposed Fastener', 'Cedar Shake', 'Slate', 'Tile', 'TPO', 'EPDM', 'Modified Bitumen', 'Roll Roofing', 'Other'], isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Shingle type, manufacturer, and any second layer', description: 'What is on the roof. If there are two layers, what is underneath. For flat or low slope sections, the material in use.', type: 'string', options: null, isRequired: false, isReviewerField: false, section: 'Basics' },
  { name: 'Average pitch across ALL slopes', description: 'Use the pitch gauge. If slopes differ, give the average and note the range.', type: 'string', options: null, isRequired: true, isReviewerField: false, section: 'Basics' },
  { name: 'Number of existing layers', description: null, type: 'option', options: ['1', '2', '3 or more', 'Could not determine'], isRequired: false, isReviewerField: false, section: 'Basics' },
  { name: 'Approximate roof size in squares', description: 'Field estimate. The measurement report is the final word.', type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Basics' },

  { name: 'Gutters and downspouts', description: 'Size (5 inch, 6 inch, half round, box), style, guards and how fastened, whether painted, and any damage. Chalk every hit.', type: 'longString', options: null, isRequired: true, isReviewerField: false, section: 'Ground & Exterior' },
  { name: 'Siding damage', description: 'Chalk hits. Note siding type and whether matching material is still available in the ground view notes.', type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: true, isReviewerField: false, section: 'Ground & Exterior' },
  { name: 'Other exterior damage - windows, fencing, garage doors, AC units', description: 'Glass, screens and beading. Chalk garage doors and AC fins. Photograph AC units even when undamaged so we cannot be blamed for damage that was already there.', type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: false, isReviewerField: false, section: 'Ground & Exterior' },
  { name: 'Ground view notes', description: 'Siding type and match availability, light fixtures, security systems, meter mast, overhead power lines, patio furniture, play equipment, grills, hot tubs. Location and any damage.', type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Ground & Exterior' },

  { name: 'Drip edge', description: 'Show presence and location, over or under the felt, eaves and rakes.', type: 'option', options: ['Yes - painted', 'Yes - prefinished / mill finished', 'No', 'Could not determine'], isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Felt or underlayment type', description: null, type: 'option', options: ['#15', '#30', 'Synthetic', 'Rolled ice and water shield', 'None present', 'Could not determine'], isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Ice and water shield', description: null, type: 'option', options: ['Yes - eaves only', 'Yes - eaves and valleys', 'Yes - eaves, valleys and penetrations', 'No', 'Could not determine'], isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Valley type', description: null, type: 'option', options: ['Ice and water shield', 'Metal', 'Roll roofing', 'Closed cut', 'No valleys', 'Could not determine'], isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Starter course present', description: null, type: 'option', options: ['Yes - eaves and rakes', 'Yes - eaves only', 'Yes - rakes only', 'No', 'Could not determine'], isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Soffit overhang depth and cornice returns', description: 'Soffit depth to the warm wall, photograph the tape measure. Also 1st and 2nd story gable cornice returns and cornice strips in linear feet.', type: 'string', options: null, isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Pipe jacks and exhaust caps', description: 'How many pipe jacks under 4 inch, how many 4 inch and over. Exhaust cap sizes and counts. Do the existing jacks need painting.', type: 'string', options: null, isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Flashings present and condition', description: 'Sidewall, step, counter or beauty strip, transition. Which exist, condition, and whether they need replacing. Include kickout and rain diverter counts.', type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Chimney', description: 'Length and width. Cricket existing, or needs one added. Flue cap and shroud condition. Write None if there is no chimney.', type: 'string', options: null, isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Skylights', description: 'How many, manufacturer or ID, length and width each. Chalk to show damage to the flashing kit or a broken seal. Write None if there are none.', type: 'string', options: null, isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Solar panels - how many', description: 'Placement, count and any damage. Enter 0 if none.', type: 'number', options: null, isRequired: false, isReviewerField: false, section: 'Roof Assembly' },
  { name: 'Ventilation types, counts, and plan', description: 'Every ventilation type and how many of each: soffit, box or turtle, power or solar powered, furnace, turbine, ridge vent. For each, install new or detach and reset. Are additional vents needed, and what would change.', type: 'longString', options: null, isRequired: true, isReviewerField: false, section: 'Roof Assembly' },

  { name: 'Hail hits per test square by slope', description: 'Count for each slope: North, South, East, West. Note the test square size used. Write None for a slope with no hits. This is the number the adjuster will argue about, so be exact.', type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Damage Findings' },
  { name: 'Wind damage found', description: 'Lifted tabs, creased shingles, broken sealant strips, missing shingles. Map the pattern by wind direction.', type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: true, isReviewerField: false, section: 'Damage Findings' },
  { name: 'Storm Date', description: 'The date of the specific hail or wind event that damaged this roof. Use the storm lookup to pull verified NOAA dates near this address, or enter it directly. Leave blank if this job has no specific storm date — the proposal will not show a storm timeline without one.', type: 'date', options: null, isRequired: false, isReviewerField: false, section: 'Damage Findings' },
  { name: 'Storm Type', description: 'What kind of storm caused the damage. Only set this alongside a Storm Date.', type: 'option', options: ['Hail', 'Wind', 'Hail & Wind'], isRequired: false, isReviewerField: false, section: 'Damage Findings' },
  { name: 'Soft metal hits found', description: 'AC fins, gutters, vents, flashing, downspouts. Photograph every hit.', type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: true, isReviewerField: false, section: 'Damage Findings' },
  { name: 'Granule loss or accumulation in gutters and downspouts', description: null, type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: false, isReviewerField: false, section: 'Damage Findings' },
  { name: 'Is shingle matching possible?', description: 'If matching is not possible that supports a full replacement argument. Say why in the damage summary.', type: 'option', options: ['Yes, matching available', 'No, discontinued or unavailable', 'Unsure, needs research', 'N/A'], isRequired: false, isReviewerField: false, section: 'Damage Findings' },
  { name: 'Overall damage summary', description: 'Plain language. What is damaged, where, how bad, and what caused it. This feeds the claim narrative and the customer report.', type: 'longString', options: null, isRequired: true, isReviewerField: false, section: 'Damage Findings' },

  { name: 'Leaks or water damage in the attic or interior', description: 'Staining on walls or ceilings, damp sheetrock, wet insulation, damp beams. Check outlets and light fixtures. Photograph every affected area.', type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: true, isReviewerField: false, section: 'Attic & Interior' },
  { name: 'Decking type and condition', description: 'Plank, spaced, or OSB / plywood. Damaged or spaced with gaps - show a tape measure at the gaps. Write Could not access if you could not get in the attic.', type: 'string', options: null, isRequired: false, isReviewerField: false, section: 'Attic & Interior' },
  { name: 'Attic and interior notes', description: null, type: 'longString', options: null, isRequired: false, isReviewerField: false, section: 'Attic & Interior' },

  { name: 'Full photo package complete', description: 'Front of house with address numbers, all 8 corners with the whole building in frame, an overview of every plane, close-ups with chalk on every damaged item, all sides of the structure, and all collateral damage. On insurance jobs the minimum is 75 photos.', type: 'option', options: ['Yes', 'No', 'N/A'], isRequired: true, isReviewerField: false, section: 'Sign-Off' },
  { name: 'Inspector Signature', description: null, type: 'signature', options: null, isRequired: true, isReviewerField: false, section: 'Sign-Off' },

  { name: 'Recommendation', description: null, type: 'option', options: ['Full replacement', 'Repair only', 'File a claim', 'Supplement needed', 'No damage found - retail quote only', 'Monitor, no action yet', 'Re-inspect'], isRequired: false, isReviewerField: true, section: 'Review' },
  { name: 'Reviewed by', description: null, type: 'string', options: null, isRequired: false, isReviewerField: true, section: 'Review' },
];

export const INSPECTION_FORM_SECTIONS = [...new Set(INSPECTION_FORM_FIELDS.map((f) => f.section))];

/** Every required, non-reviewer field has a non-empty answer — gates moving a submission from draft to submitted. */
export function inspectorFieldsComplete(answers: Record<string, any>): boolean {
  return INSPECTION_FORM_FIELDS
    .filter((f) => f.isRequired && !f.isReviewerField)
    .every((f) => {
      const v = answers[f.name];
      return v !== undefined && v !== null && String(v).trim() !== '';
    });
}

export function missingRequiredFields(answers: Record<string, any>): string[] {
  return INSPECTION_FORM_FIELDS
    .filter((f) => f.isRequired && !f.isReviewerField)
    .filter((f) => {
      const v = answers[f.name];
      return v === undefined || v === null || String(v).trim() === '';
    })
    .map((f) => f.name);
}
