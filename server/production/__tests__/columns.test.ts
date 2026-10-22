import { describe, it, expect } from 'vitest';
import { PRODUCTION_COLUMNS, PRODUCTION_STAGES, columnForStage } from '../columns';

describe('production columns', () => {
  it('maps each production stage to exactly one column', () => {
    for (const col of PRODUCTION_COLUMNS) {
      for (const stage of col.stages) {
        expect(columnForStage(stage)).toBe(col.key);
      }
    }
  });

  it('excludes sales / insurance / lost stages from the board', () => {
    for (const stage of ['New Lead', 'Appt Set', 'Sales Closing Meeting', 'Insurance Approved', 'Lost']) {
      expect(columnForStage(stage)).toBeNull();
      expect(PRODUCTION_STAGES.has(stage)).toBe(false);
    }
  });

  it('places the key production stages correctly', () => {
    expect(columnForStage('Schedule')).toBe('scheduled');
    expect(columnForStage('Roof Construction')).toBe('in_production');
    expect(columnForStage('Complete')).toBe('wrapping');
    expect(columnForStage('Closed')).toBe('closed');
    expect(columnForStage('Buyer Approved')).toBe('pre');
  });

  it('returns null for blank/unknown stages', () => {
    expect(columnForStage(null)).toBeNull();
    expect(columnForStage(undefined)).toBeNull();
    expect(columnForStage('Nonsense')).toBeNull();
  });
});
