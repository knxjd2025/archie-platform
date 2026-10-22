import { describe, it, expect } from 'vitest';
import { MANUAL_TYPES, isManualType } from '../routes';
import { kpiEventTypeEnum } from '../../../shared/schema';

describe('manual KPI types', () => {
  it('accepts the two hand-logged activities', () => {
    expect(isManualType('referral_received')).toBe(true);
    expect(isManualType('lead_given')).toBe(true);
  });

  it('refuses the automatic ones', () => {
    // Door knocks and reports are recorded by the system as they happen. Letting
    // someone POST them by hand would make the numbers un-auditable.
    for (const t of ['door_knock', 'lead_contacted', 'report_created', 'report_presented']) {
      expect(isManualType(t), t).toBe(false);
    }
  });

  it('refuses junk without throwing', () => {
    for (const t of ['', 'REFERRAL_RECEIVED', null, undefined, 0, {}, ['lead_given']]) {
      expect(isManualType(t)).toBe(false);
    }
  });

  it('every manual type is a real database enum value', () => {
    // A type the enum lacks fails at INSERT with 22P02, in production, on save.
    for (const t of MANUAL_TYPES) {
      expect(kpiEventTypeEnum.enumValues, t).toContain(t);
    }
  });
});
