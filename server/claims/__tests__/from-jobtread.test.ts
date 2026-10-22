import { describe, it, expect } from 'vitest';
import { claimStageFor, disputeStepFor, isClaimJobStage, ownerFor, JT_STAGE_TO_CLAIM_STAGE } from '../from-jobtread';
import { CLAIM_STAGES } from '../columns';

describe('claimStageFor', () => {
  it('recognises the claim stages actually in use', () => {
    // Every one of these exists on live jobs today and none of them reached
    // the claims board, which is why the board was empty.
    expect(claimStageFor('NTS Sent')).toBe('disputing');
    expect(disputeStepFor('NTS Sent')).toBe('nts_vra_sent');
    expect(disputeStepFor('NTS Needed')).toBe('need_nts_vra');
    expect(claimStageFor('Pre-Supplementing')).toBe('supplement');
    expect(claimStageFor('Post-Supplementing')).toBe('post_supplementing');
    expect(claimStageFor('Denied Disputing')).toBe('disputing');
    expect(claimStageFor('Insurance Approved')).toBe('approved');
    expect(claimStageFor('Partial Approval Disputing')).toBe('disputing');
    expect(claimStageFor('Waiting Decision')).toBe('waiting_results');
    expect(claimStageFor('Adj Meeting')).toBe('adjuster_appt');
  });

  it('recognises a filed claim', () => {
    expect(claimStageFor('Claim Filed')).toBe('file_claim');
  });

  it('treats a partial approval as still being fought, not won', () => {
    // "Partial Approval Disputing" means money is still on the table; filing
    // it under approved would hide a supplement that is still owed.
    expect(claimStageFor('Partial Approval Disputing')).toBe('disputing');
  });

  it('ignores case and padding', () => {
    for (const v of ['nts sent', '  NTS SENT  ', 'Nts Sent']) {
      expect(claimStageFor(v), v).toBe('disputing');
    }
  });

  it('does NOT treat retail or general work as a claim', () => {
    // A claims board that contains retail sales stops meaning anything.
    for (const s of ['Closed', 'Lost', 'Estimating', 'New Lead', 'Follow Up Close',
                     'Sales Closing Meeting', 'Pre-Construction', 'Complete',
                     'Buyer Approved', 'Other Construction Work', 'Schedule']) {
      expect(isClaimJobStage(s), s).toBe(false);
    }
  });

  it('returns null rather than guessing on an unknown stage', () => {
    expect(claimStageFor('Some New Stage')).toBeNull();
    expect(claimStageFor(null)).toBeNull();
    expect(claimStageFor(undefined)).toBeNull();
    expect(claimStageFor('')).toBeNull();
  });

  it('only ever maps to real claim stages', () => {
    // A value outside the enum fails at INSERT, in production, on sync.
    for (const [jt, mapped] of Object.entries(JT_STAGE_TO_CLAIM_STAGE)) {
      expect(CLAIM_STAGES, `${jt} -> ${mapped}`).toContain(mapped);
    }
  });
});

describe('ownerFor', () => {
  const roster = [
    { email: 'dana@acme.test', name: 'Dana Reed', jobtreadSalesRep: 'Dana R.' },
    { email: 'sam@acme.test', name: 'Sam Ortiz', jobtreadSalesRep: null },
  ];

  it('matches the JobTread rep name first, then the member name', () => {
    expect(ownerFor('Dana R.', roster)).toBe('dana@acme.test');
    expect(ownerFor('Sam Ortiz', roster)).toBe('sam@acme.test');
  });

  it('is null when nobody matches', () => {
    for (const v of [null, undefined, '', 'Some Vendor']) expect(ownerFor(v, roster)).toBe(null);
  });

  it('ignores case and extra spaces', () => {
    expect(ownerFor('  sam   ortiz ', roster)).toBe('sam@acme.test');
  });
});
