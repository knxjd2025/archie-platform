import { describe, it, expect } from 'vitest';
import { jobTypeFromInspectionType } from '../lookup';

describe('jobTypeFromInspectionType', () => {
  it('reads "Insurance Claim" as insurance', () => {
    expect(jobTypeFromInspectionType('Insurance Claim')).toBe('insurance');
  });

  it('reads every other checklist option as retail', () => {
    for (const t of ['Retail / Non-Insurance', 'Storm Response', 'Pre-Purchase', 'Warranty / Maintenance']) {
      expect(jobTypeFromInspectionType(t)).toBe('retail');
    }
  });

  it('defaults to retail when there is no inspection type yet', () => {
    expect(jobTypeFromInspectionType(null)).toBe('retail');
    expect(jobTypeFromInspectionType(undefined)).toBe('retail');
  });
});
