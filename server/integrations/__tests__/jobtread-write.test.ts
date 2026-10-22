import { describe, it, expect } from 'vitest';
import { JT_STATUS_OPTIONS, JT_STATUS_FIELD, JT_SALES_REP_FIELD, isValidJobStatus } from '../jobtread';

describe('JobTread write constants', () => {
  it('knows the full 25-stage Status option set', () => {
    expect(JT_STATUS_OPTIONS).toHaveLength(25);
    expect(JT_STATUS_OPTIONS).toContain('Schedule');
    expect(JT_STATUS_OPTIONS).toContain('Roof Construction');
    expect(JT_STATUS_OPTIONS).toContain('Closed');
  });

  it('validates stage values against the option set', () => {
    expect(isValidJobStatus('Roof Construction')).toBe(true);
    expect(isValidJobStatus('New Lead')).toBe(true);
    expect(isValidJobStatus('Nonsense')).toBe(false);
    expect(isValidJobStatus('')).toBe(false);
  });

  it('pins the verified custom-field ids', () => {
    expect(JT_STATUS_FIELD).toBe('22PCvVv9LFXi');
    expect(JT_SALES_REP_FIELD).toBe('22PCvciFkpGi');
  });
});
