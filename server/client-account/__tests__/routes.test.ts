import { describe, it, expect } from 'vitest';
import { leadMirror } from '../routes';

describe('leadMirror', () => {
  it('maps an account edit onto the local lead columns', () => {
    expect(leadMirror({ customer: 'Jane Doe', jobName: 'Doe Roof', fields: { projectManager: 'Sam', isClaim: true } }))
      .toEqual({ firstName: 'Jane Doe', jobName: 'Doe Roof', projectManager: 'Sam', insuranceClaim: true });
  });

  it('splits a new address into city, state and zip like the sync does', () => {
    expect(leadMirror({ address: '550 Manning Dr, Charlotte, NC 28209, USA' }))
      .toEqual({ address: '550 Manning Dr, Charlotte, NC 28209, USA', city: 'Charlotte', state: 'NC', zip: '28209' });
  });

  it('clears the project manager and leaves insurance-only fields to JobTread', () => {
    expect(leadMirror({ fields: { projectManager: null, carrier: 'State Farm' } })).toEqual({ projectManager: null });
  });
});

describe('nativeAccountChange (a job Archie keeps itself)', () => {
  it('writes what the lead has a place for, with the customer split into first and last name', async () => {
    const { nativeAccountChange } = await import('../routes');
    expect(nativeAccountChange({ customer: 'Pat Ann Hollis', jobName: 'Hollis Roof', fields: { projectManager: 'Sam', isClaim: false } }))
      .toEqual({ ok: true, set: { firstName: 'Pat', lastName: 'Ann Hollis', jobName: 'Hollis Roof', projectManager: 'Sam', insuranceClaim: false } });
    expect(nativeAccountChange({ customer: 'Cher' })).toEqual({ ok: true, set: { firstName: 'Cher', lastName: null } });
  });

  it('refuses, in plain words, a claim detail only JobTread keeps, rather than dropping it', async () => {
    const { nativeAccountChange, NATIVE_CLAIM_DETAILS_REFUSED } = await import('../routes');
    for (const key of ['carrier', 'claimNumber', 'policyNumber', 'dateOfLoss', 'typeOfLoss', 'adjusterName', 'adjusterPhone', 'adjusterEmail', 'claimsEmail'] as const) {
      expect(nativeAccountChange({ jobName: 'X', fields: { [key]: null } })).toEqual({ ok: false, error: NATIVE_CLAIM_DETAILS_REFUSED });
    }
    expect(NATIVE_CLAIM_DETAILS_REFUSED).not.toMatch(/JobTread|CRM|custom field/i);
  });
});
