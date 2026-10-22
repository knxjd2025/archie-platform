import { describe, it, expect } from 'vitest';
import { INSPECTION_FORM_FIELDS, inspectorFieldsComplete, missingRequiredFields } from '../inspection-form';

const requiredInspectorFields = INSPECTION_FORM_FIELDS.filter((f) => f.isRequired && !f.isReviewerField);

describe('inspectorFieldsComplete', () => {
  it('is false with no answers at all', () => {
    expect(inspectorFieldsComplete({})).toBe(false);
  });

  it('is true once every required, non-reviewer field has an answer', () => {
    const answers: Record<string, any> = {};
    for (const f of requiredInspectorFields) answers[f.name] = 'x';
    expect(inspectorFieldsComplete(answers)).toBe(true);
  });

  it('ignores reviewer-only fields (Recommendation, Reviewed by) — those are never required to submit', () => {
    const answers: Record<string, any> = {};
    for (const f of requiredInspectorFields) answers[f.name] = 'x';
    // Recommendation/Reviewed by deliberately left unanswered.
    expect(inspectorFieldsComplete(answers)).toBe(true);
  });

  it('treats whitespace-only answers as missing', () => {
    const answers: Record<string, any> = {};
    for (const f of requiredInspectorFields) answers[f.name] = 'x';
    answers[requiredInspectorFields[0].name] = '   ';
    expect(inspectorFieldsComplete(answers)).toBe(false);
  });
});

describe('missingRequiredFields', () => {
  it('lists every unanswered required field', () => {
    expect(missingRequiredFields({})).toEqual(requiredInspectorFields.map((f) => f.name));
  });

  it('shrinks as fields are answered', () => {
    const answers: Record<string, any> = { [requiredInspectorFields[0].name]: 'Insurance Claim' };
    expect(missingRequiredFields(answers).length).toBe(requiredInspectorFields.length - 1);
  });

  it('returns empty once every required field is answered', () => {
    const answers: Record<string, any> = {};
    for (const f of requiredInspectorFields) answers[f.name] = 'x';
    expect(missingRequiredFields(answers)).toEqual([]);
  });
});
