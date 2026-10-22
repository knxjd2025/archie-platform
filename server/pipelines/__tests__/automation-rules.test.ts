import { describe, it, expect } from 'vitest';
import {
  effectsOfProductionStage, effectsOfSalesStage, effectsOfClaimStage, effectsOfPreconSubmitted,
  effectsOfWalkthroughSubmitted, effectsOfReportGenerated, effectsOfReportPresented, effectsOfProposalSigned, effectsOfJobtreadStatus,
} from '../automation-rules';

const at = (o: Partial<{ productionStage: string | null; salesStage: string | null; claimStage: string | null }>) =>
  ({ productionStage: null, salesStage: null, claimStage: null, ...o });
const moves = (e: { pipeline: string; to: string }[]) => e.map((x) => `${x.pipeline}→${x.to}`);

describe('production movement', () => {
  it('deposit on the production board marks the sale DP received; final invoice opens reviews', () => {
    expect(moves(effectsOfProductionStage('pre_production', at({ salesStage: 'approved' })))).toEqual(['sales→dp_received']);
    expect(moves(effectsOfProductionStage('pre_production', at({ salesStage: 'follow_up' })))).toEqual(['sales→dp_received']);
    expect(moves(effectsOfProductionStage('schedule', at({ salesStage: 'dp_received' })))).toEqual([]);
    expect(moves(effectsOfProductionStage('final_invoice', at({ salesStage: 'dp_received' })))).toEqual(['sales→reviews_referrals']);
    expect(moves(effectsOfProductionStage('closed_out', at({ salesStage: 'reviews_referrals' })))).toEqual([]);
  });
  it('the build finishing moves an approved claim to post-supplementing, then the invoice to depreciation', () => {
    expect(moves(effectsOfProductionStage('final_walkthrough', at({ claimStage: 'approved' })))).toEqual(['claims→post_supplementing']);
    expect(moves(effectsOfProductionStage('final_invoice', at({ claimStage: 'post_supplementing' })))).toEqual(['claims→request_depreciation']);
    expect(moves(effectsOfProductionStage('install', at({ claimStage: 'approved' })))).toEqual([]);
    expect(moves(effectsOfProductionStage('final_invoice', at({ claimStage: 'disputing' })))).toEqual([]);
  });
});

describe('sales movement', () => {
  it('approved opens production; DP received moves it to pre-production', () => {
    expect(moves(effectsOfSalesStage('approved', at({})))).toEqual(['production→approved']);
    expect(moves(effectsOfSalesStage('approved', at({ productionStage: 'approved' })))).toEqual([]);
    expect(moves(effectsOfSalesStage('dp_received', at({})))).toEqual(['production→pre_production']);
    expect(moves(effectsOfSalesStage('dp_received', at({ productionStage: 'waiting_dp' })))).toEqual(['production→pre_production']);
    expect(moves(effectsOfSalesStage('dp_received', at({ productionStage: 'schedule' })))).toEqual([]);
    expect(moves(effectsOfSalesStage('report', at({})))).toEqual([]);
  });
  it('marking a deal lost sets nothing else in motion', () => {
    expect(moves(effectsOfSalesStage('lost', at({})))).toEqual([]);
    expect(moves(effectsOfSalesStage('lost', at({ productionStage: 'approved', claimStage: 'inspect' })))).toEqual([]);
  });
});

describe('a lost deal stays lost', () => {
  // Lost has no position in the progression, so every "is it still before X?"
  // rule has to answer no — otherwise a rule quietly undoes a person's call.
  const lost = at({ salesStage: 'lost' });
  it('is not dragged back by production, a claim, a report or a proposal', () => {
    expect(moves(effectsOfProductionStage('pre_production', lost))).toEqual([]);
    expect(moves(effectsOfProductionStage('final_invoice', lost))).toEqual([]);
    expect(moves(effectsOfClaimStage('sa_signed', lost))).toEqual([]);
    expect(moves(effectsOfReportGenerated('inspection', lost))).toEqual([]);
    expect(moves(effectsOfReportPresented(lost))).toEqual([]);
  });
  it('but a signed proposal still opens the job in production, on purpose', () => {
    // Work that has been signed for belongs on the production board whatever
    // the sales board says. The sale stays Lost, and the card shows the
    // production stage — a contradiction a person can see and resolve, which
    // beats silently dropping a signed job or silently un-losing a deal.
    expect(moves(effectsOfProposalSigned(lost))).toEqual(['production→approved']);
  });
  it('is not dragged back by a JobTread status either', () => {
    expect(moves(effectsOfJobtreadStatus('Buyer Approved', lost))).toEqual([]);
    expect(moves(effectsOfJobtreadStatus('Complete', lost))).toEqual([]);
  });
});

describe('claim movement', () => {
  it('a signed SA is the sale; insurance approval opens production', () => {
    expect(moves(effectsOfClaimStage('sa_signed', at({ salesStage: 'follow_up' })))).toEqual(['sales→approved']);
    expect(moves(effectsOfClaimStage('sa_signed', at({ salesStage: 'dp_received' })))).toEqual([]);
    expect(moves(effectsOfClaimStage('approved', at({ salesStage: 'approved' })))).toEqual(['production→approved']);
    expect(moves(effectsOfClaimStage('approved', at({ salesStage: 'report', productionStage: 'approved' })))).toEqual(['sales→approved']);
    expect(moves(effectsOfClaimStage('file_claim', at({ salesStage: 'report' })))).toEqual([]);
  });
});

describe('checklists, reports, proposals', () => {
  it('pre-con submitted schedules the job; walkthrough submitted moves to final invoice', () => {
    expect(moves(effectsOfPreconSubmitted(at({ productionStage: 'pre_production' })))).toEqual(['production→schedule']);
    expect(moves(effectsOfPreconSubmitted(at({ productionStage: 'waiting_dp' })))).toEqual(['production→schedule']);
    expect(moves(effectsOfPreconSubmitted(at({ productionStage: 'install' })))).toEqual([]);
    expect(moves(effectsOfWalkthroughSubmitted(at({ productionStage: 'final_walkthrough' })))).toEqual(['production→final_invoice']);
    expect(moves(effectsOfWalkthroughSubmitted(at({ productionStage: 'install' })))).toEqual(['production→final_invoice']);
    expect(moves(effectsOfWalkthroughSubmitted(at({ productionStage: 'warranty' })))).toEqual([]);
    expect(moves(effectsOfWalkthroughSubmitted(at({})))).toEqual([]);
  });
  it('a generated report moves the sale to Report and an inspection report moves the claim to the adjuster', () => {
    expect(moves(effectsOfReportGenerated('inspection', at({ salesStage: 'inspection', claimStage: 'inspection_report' })))).toEqual(['sales→report', 'claims→adjuster_appt']);
    expect(moves(effectsOfReportGenerated('proposal', at({ salesStage: 'inspection', claimStage: 'inspection_report' })))).toEqual(['sales→report']);
    expect(moves(effectsOfReportGenerated('inspection', at({ salesStage: 'follow_up', claimStage: 'sa_signed' })))).toEqual([]);
  });
  it('presenting the report is the sit-down; a signed proposal is the sale', () => {
    expect(moves(effectsOfReportPresented(at({ salesStage: 'report' })))).toEqual(['sales→sit_down_close']);
    expect(moves(effectsOfReportPresented(at({ salesStage: 'follow_up' })))).toEqual([]);
    expect(moves(effectsOfProposalSigned(at({ salesStage: 'sit_down_close' })))).toEqual(['sales→approved', 'production→approved']);
    expect(moves(effectsOfProposalSigned(at({ salesStage: 'dp_received', productionStage: 'schedule' })))).toEqual([]);
  });
});

describe('JobTread status changes', () => {
  it('boards follow JobTread forward, never back', () => {
    expect(moves(effectsOfJobtreadStatus('Schedule', at({ productionStage: 'pre_production', salesStage: 'dp_received' })))).toEqual(['production→schedule']);
    expect(moves(effectsOfJobtreadStatus('Buyer Approved', at({ productionStage: 'schedule', salesStage: 'dp_received' })))).toEqual([]);
    expect(moves(effectsOfJobtreadStatus('Buyer Approved', at({ salesStage: 'follow_up' })))).toEqual(['sales→approved']);
    // 'Complete' is Final Walk Through, before Final Invoice — the sale waits for the invoice before asking for the review.
    expect(moves(effectsOfJobtreadStatus('Complete', at({ productionStage: 'install', salesStage: 'dp_received' })))).toEqual(['production→final_walkthrough']);
    expect(moves(effectsOfJobtreadStatus('Lost', at({ productionStage: 'install', salesStage: 'dp_received' })))).toEqual([]);
  });
});
