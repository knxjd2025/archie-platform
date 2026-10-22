import { describe, it, expect } from 'vitest';
import { moveBlocker, normalizeSteps, completeCurrentStep, jumpToStep, currentStep, nextOf, prevOf } from '../pipeline-core';
import {
  CLAIM_STAGE_KEYS, DISPUTE_STEP_KEYS, freshDisputeSteps, claimEntryBlocker, claimMoveBlocker,
  jobtreadStatusForClaim, JT_STATUS_TO_CLAIM, LEGACY_CLAIM_STAGE, CLAIM_NEXT_ACTION, CLAIM_DUE_DAYS,
} from '../claims-pipeline';
import {
  SALES_STAGE_KEYS, SALES_BOARD_STAGES, salesEntryBlocker, salesMoveBlocker, jobtreadStatusForSales, salesStageForJob, salesDone,
  jobReadyForReviews, isSalesStage, isSalesProgressionStage, salesStageIndex, salesReopenStage,
  SALES_LOST_REASONS, isSalesLostReason, salesLostReasonLabel, lostReasonBlocker,
} from '../sales-pipeline';

const S = [{ key: 'a', label: 'A', hint: '' }, { key: 'b', label: 'B', hint: '' }, { key: 'c', label: 'C', hint: '' }];

describe('pipeline core', () => {
  it('moves back freely and checks every gate crossed going forward', () => {
    const gate = (s: string) => (s === 'b' ? 'B needs X' : null);
    expect(moveBlocker(S, 'c', 'a', gate)).toBeNull();
    expect(moveBlocker(S, 'a', 'c', gate)).toBe('B needs X');
    expect(moveBlocker(S, 'b', 'c', gate)).toBeNull();
    expect(moveBlocker(S, 'a', 'zzz', gate)).toBe('Unknown stage.');
    expect(nextOf(S, 'a')).toBe('b'); expect(prevOf(S, 'a')).toBeNull(); expect(nextOf(S, 'c')).toBeNull();
  });
  it('steps: catalog order, jump marks everything before as done', () => {
    const cat = [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }, { key: 'z', label: 'Z' }];
    let steps = normalizeSteps(cat, ['z', 'x', 'y'], [], []);
    expect(steps.map((s) => s.key)).toEqual(['x', 'y', 'z']);
    steps = completeCurrentStep(steps);
    expect(currentStep(steps)).toBe('y');
    steps = jumpToStep(steps, 'z');
    expect(steps).toEqual([{ key: 'x', done: true }, { key: 'y', done: true }, { key: 'z', done: false }]);
    expect(jumpToStep(steps, 'x')).toEqual([{ key: 'x', done: false }, { key: 'y', done: false }, { key: 'z', done: false }]);
  });
});

describe('claims pipeline', () => {
  it('runs in the order James laid out, with the dispute steps inside Disputing', () => {
    expect(CLAIM_STAGE_KEYS).toEqual(['inspect', 'file_claim', 'sa_signed', 'inspection_report', 'adjuster_appt', 'waiting_results', 'supplement', 'disputing', 'approved', 'post_supplementing', 'request_depreciation', 'closed']);
    expect(DISPUTE_STEP_KEYS).toEqual(['reinspection_requested', 'reinspection_scheduled', 'need_nts_vra', 'nts_vra_sent', 'escalate_supervisor']);
    for (const k of CLAIM_STAGE_KEYS) { expect(CLAIM_NEXT_ACTION[k]).toBeTruthy(); }
    expect(CLAIM_DUE_DAYS.waiting_results).toBe(3);
  });
  it('the adjuster appointment needs the inspection report; closing needs depreciation in hand', () => {
    const st = { stage: 'inspection_report', disputeSteps: freshDisputeSteps(), checks: {} };
    expect(claimEntryBlocker('adjuster_appt', st, { inspectionReport: false })).toMatch(/inspection report/);
    expect(claimEntryBlocker('adjuster_appt', st, { inspectionReport: true })).toBeNull();
    expect(claimMoveBlocker('waiting_results', st, { inspectionReport: false })).toMatch(/inspection report/);
    const late = { stage: 'request_depreciation', disputeSteps: freshDisputeSteps(), checks: { depreciation_requested: true } };
    expect(claimEntryBlocker('closed', late, { inspectionReport: true })).toMatch(/Depreciation check received/);
    expect(claimMoveBlocker('file_claim', late, { inspectionReport: false })).toBeNull(); // back is free
  });
  it('mirrors the nearest JobTread status, following the dispute step', () => {
    const steps = freshDisputeSteps();
    expect(jobtreadStatusForClaim('inspect', steps)).toBeNull();
    expect(jobtreadStatusForClaim('sa_signed', steps)).toBe('Claim Filed');
    expect(jobtreadStatusForClaim('adjuster_appt', steps)).toBe('Adj Meeting');
    expect(jobtreadStatusForClaim('waiting_results', steps)).toBe('Waiting Decision');
    expect(jobtreadStatusForClaim('supplement', steps)).toBe('Pre-Supplementing');
    expect(jobtreadStatusForClaim('disputing', steps)).toBe('Denied Disputing');
    expect(jobtreadStatusForClaim('disputing', jumpToStep(steps, 'need_nts_vra'))).toBe('NTS Needed');
    expect(jobtreadStatusForClaim('disputing', jumpToStep(steps, 'nts_vra_sent'))).toBe('NTS Sent');
    expect(jobtreadStatusForClaim('approved', steps)).toBe('Insurance Approved');
    expect(jobtreadStatusForClaim('request_depreciation', steps)).toBe('Post-Supplementing');
    expect(jobtreadStatusForClaim('closed', steps)).toBeNull();
  });
  it('every JobTread and legacy mapping lands on a real stage', () => {
    for (const v of Object.values(JT_STATUS_TO_CLAIM)) expect(CLAIM_STAGE_KEYS).toContain(v.stage);
    for (const v of Object.values(LEGACY_CLAIM_STAGE)) expect(CLAIM_STAGE_KEYS).toContain(v);
    expect(JT_STATUS_TO_CLAIM['nts sent']).toEqual({ stage: 'disputing', step: 'nts_vra_sent' });
  });
});

describe('sales pipeline', () => {
  it('runs in the order James laid out', () => {
    expect(SALES_STAGE_KEYS).toEqual(['inspection', 'report', 'sit_down_close', 'follow_up', 'approved', 'dp_received', 'reviews_referrals']);
  });
  it('the sit-down needs a report; reviews wait for production to invoice', () => {
    const st = { stage: 'report', checks: {} };
    expect(salesEntryBlocker('sit_down_close', st, { reportGenerated: false, productionStage: null })).toMatch(/Generate the report/);
    expect(salesMoveBlocker('follow_up', st, { reportGenerated: true, productionStage: null })).toBeNull();
    const dp = { stage: 'dp_received', checks: {} };
    expect(salesMoveBlocker('reviews_referrals', dp, { reportGenerated: true, productionStage: 'install' })).toMatch(/Final Invoice/);
    expect(salesMoveBlocker('reviews_referrals', dp, { reportGenerated: true, productionStage: 'final_invoice' })).toBeNull();
    expect(jobReadyForReviews('closed_out')).toBe(true);
    expect(jobReadyForReviews(null)).toBe(false);
  });
  it('is done once the reviews stage is fully ticked', () => {
    expect(salesDone({ stage: 'reviews_referrals', checks: { review_requested: true, review_received: true, referral_asked: true } })).toBe(true);
    expect(salesDone({ stage: 'reviews_referrals', checks: { review_requested: true } })).toBe(false);
    expect(salesDone({ stage: 'approved', checks: {} })).toBe(false);
  });
  it('mirrors JobTread up to Approved, then production owns the status', () => {
    expect(jobtreadStatusForSales('inspection')).toBe('Appt Set');
    expect(jobtreadStatusForSales('report')).toBe('Estimating');
    expect(jobtreadStatusForSales('sit_down_close')).toBe('Sales Closing Meeting');
    expect(jobtreadStatusForSales('follow_up')).toBe('Follow Up Close');
    expect(jobtreadStatusForSales('approved')).toBe('Buyer Approved');
    expect(jobtreadStatusForSales('dp_received')).toBeNull();
  });
  it('places a job with no row from JobTread, letting production win once the deposit is in', () => {
    expect(salesStageForJob('Appt Set', null)).toBe('inspection');
    expect(salesStageForJob('Estimating', null)).toBe('report');
    expect(salesStageForJob('Buyer Approved', null)).toBe('approved');
    expect(salesStageForJob('Buyer Approved', 'approved')).toBe('approved');
    expect(salesStageForJob('Buyer Approved', 'pre_production')).toBe('dp_received');
    expect(salesStageForJob('Complete', null)).toBe('reviews_referrals');
    expect(salesStageForJob('Lost', null)).toBe('lost');
    // Dead in JobTread beats a production row that was never closed out.
    expect(salesStageForJob('Lost', 'install')).toBe('lost');
  });
});

describe('sales pipeline — Lost', () => {
  it('is a column on the board but not a step in the progression', () => {
    expect(SALES_STAGE_KEYS).not.toContain('lost');
    expect(SALES_BOARD_STAGES.map((s) => s.key)).toEqual([...SALES_STAGE_KEYS, 'lost']);
    expect(SALES_BOARD_STAGES[SALES_BOARD_STAGES.length - 1].label).toBe('Lost');
    // Storable as a stage, but it has no position, so no comparison can reach it.
    expect(isSalesStage('lost')).toBe(true);
    expect(isSalesProgressionStage('lost')).toBe(false);
    expect(salesStageIndex('lost')).toBe(-1);
  });

  it('can be reached from anywhere without crossing a gate', () => {
    // Inspection to Lost would otherwise walk the sit-down's report gate.
    const early = { stage: 'inspection', checks: {} };
    const noReport = { reportGenerated: false, productionStage: null };
    expect(salesMoveBlocker('sit_down_close', early, noReport)).toMatch(/Generate the report/);
    expect(salesMoveBlocker('lost', early, noReport)).toBeNull();
    expect(salesMoveBlocker('lost', { stage: 'dp_received', checks: {} }, noReport)).toBeNull();
  });

  it('reopens to wherever the deal died, without re-checking that stage', () => {
    const lost = { stage: 'lost', checks: {} };
    expect(salesMoveBlocker('follow_up', lost, { reportGenerated: false, productionStage: null })).toBeNull();
    expect(salesReopenStage([
      { stage: 'inspection' }, { stage: 'report' }, { stage: 'follow_up' }, { stage: 'lost' },
    ])).toBe('follow_up');
    // Lost twice over: skip past every Lost entry to the last real step.
    expect(salesReopenStage([{ stage: 'report' }, { stage: 'lost' }, { stage: 'lost' }])).toBe('report');
    expect(salesReopenStage([])).toBe('follow_up');
    expect(salesReopenStage(null)).toBe('follow_up');
  });

  it('will not be filed without a reason', () => {
    expect(lostReasonBlocker(undefined, '')).toMatch(/Pick a reason/);
    expect(lostReasonBlocker('', '')).toMatch(/Pick a reason/);
    expect(lostReasonBlocker('made_up', '')).toMatch(/Pick a reason/);
    expect(lostReasonBlocker('price', '')).toBeNull();
    // "Something else" with nothing written in it records the same nothing.
    expect(lostReasonBlocker('other', '')).toMatch(/Say what happened/);
    expect(lostReasonBlocker('other', '   ')).toMatch(/Say what happened/);
    expect(lostReasonBlocker('other', 'roof was already replaced')).toBeNull();
  });

  it('names its reasons once, for the picker and the check alike', () => {
    expect(SALES_LOST_REASONS.map((r) => r.key)).toContain('price');
    expect(new Set(SALES_LOST_REASONS.map((r) => r.key)).size).toBe(SALES_LOST_REASONS.length);
    expect(SALES_LOST_REASONS.every((r) => isSalesLostReason(r.key))).toBe(true);
    expect(salesLostReasonLabel('no_contact')).toMatch(/Went dark/);
    expect(salesLostReasonLabel(null)).toBeNull();
    // An unknown key still reads as something rather than vanishing.
    expect(salesLostReasonLabel('retired_key')).toBe('retired_key');
  });

  it('tells JobTread, and is never counted as finished', () => {
    expect(jobtreadStatusForSales('lost')).toBe('Lost');
    expect(salesDone({ stage: 'lost', checks: { review_requested: true, review_received: true, referral_asked: true } })).toBe(false);
  });
});
