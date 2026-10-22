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
