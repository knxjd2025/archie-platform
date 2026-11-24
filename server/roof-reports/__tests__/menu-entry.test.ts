/**
 * Whether the app draws the Roof reports entry is decided here, on the server:
 * the switch is on AND the role may see reports. The app never guesses it.
 */
import { describe, expect, it } from 'vitest';
import { roofReportsEntryFor } from '../access';
import { ALL_ROLES } from '../../../shared/rbac';

describe('the roof reports menu entry', () => {
  it('is off for everyone while the switch is not exactly "on"', () => {
    for (const env of [{}, { ARCHIE_ROOF_REPORTS: '' }, { ARCHIE_ROOF_REPORTS: 'ON' }, { ARCHIE_ROOF_REPORTS: 'true' }, { ARCHIE_ROOF_REPORTS: '1' }]) {
      for (const role of ALL_ROLES) expect(roofReportsEntryFor(role, env), `${role} with ${JSON.stringify(env)}`).toBe(false);
    }
  });

  it('is on, with the switch on, for every role that may see reports, and never for crew', () => {
    const env = { ARCHIE_ROOF_REPORTS: 'on' };
    for (const role of ALL_ROLES) expect(roofReportsEntryFor(role, env), role).toBe(role !== 'production');
  });

  it('is off for a role nobody has decided', () => {
    expect(roofReportsEntryFor('intern' as never, { ARCHIE_ROOF_REPORTS: 'on' })).toBe(false);
  });
});
