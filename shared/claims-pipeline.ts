/**
 * The insurance-claim pipeline, from the first inspection to depreciation in
 * hand. Stage keys are stored in claims.stage; the Disputing stage carries
 * ordered steps in claims.dispute_steps. Rules shared by the board and the API.
 */
import { type StageDef, type StepDef, type Step, type CheckDef, moveBlocker as coreMoveBlocker, missingChecks, currentStep, normalizeSteps } from './pipeline-core';

export const CLAIM_PIPELINE_STAGES: readonly StageDef[] = [
  { key: 'inspect',              label: 'Inspect',              hint: 'Roof inspected, damage documented' },
  { key: 'file_claim',           label: 'File Claim',           hint: 'Claim filed with the carrier, claim # in hand' },
  { key: 'sa_signed',            label: 'SA Signed',            hint: 'Service agreement signed by the homeowner' },
  { key: 'inspection_report',    label: 'Inspection Report',    hint: 'Report generated for the adjuster' },
  { key: 'adjuster_appt',        label: 'Adjuster Inspection',  hint: 'Adjuster appointment set and met' },
  { key: 'waiting_results',      label: 'Waiting Results',      hint: 'Carrier deciding' },
  { key: 'supplement',           label: 'Supplement',           hint: 'Supplement submitted for missed items' },
  { key: 'disputing',            label: 'Disputing',            hint: 'Reinspection → NTS & VRA → supervisor' },
  { key: 'approved',             label: 'Approved',             hint: 'Carrier approved the scope — build it' },
  { key: 'post_supplementing',   label: 'Post-Supplementing',   hint: 'Supplement for what the build uncovered' },
  { key: 'request_depreciation', label: 'Request Depreciation', hint: 'Certificate of completion sent, depreciation requested' },
  { key: 'closed',               label: 'Closed',               hint: 'Depreciation received, claim done' },
];
export const CLAIM_STAGE_KEYS = CLAIM_PIPELINE_STAGES.map((s) => s.key);
export const isClaimPipelineStage = (s: unknown): s is string => typeof s === 'string' && CLAIM_STAGE_KEYS.includes(s);
export const claimStageIndex = (s: string) => CLAIM_STAGE_KEYS.indexOf(s);

/** The Disputing stage's steps, in order. */
export const DISPUTE_STEPS: readonly StepDef[] = [
  { key: 'reinspection_requested', label: 'Reinspection requested' },
  { key: 'reinspection_scheduled', label: 'Reinspection meeting scheduled' },
  { key: 'need_nts_vra',           label: 'Need NTS report & VRA' },
  { key: 'nts_vra_sent',           label: 'NTS report & VRA sent' },
  { key: 'escalate_supervisor',    label: 'Escalated to supervisor' },
];
export const DISPUTE_STEP_KEYS = DISPUTE_STEPS.map((s) => s.key);
export const isDisputeStep = (s: unknown): s is string => typeof s === 'string' && DISPUTE_STEP_KEYS.includes(s);
/** A fresh Disputing step list: every step, none done. */
export const freshDisputeSteps = (prior: Step[] = []): Step[] => normalizeSteps(DISPUTE_STEPS, DISPUTE_STEP_KEYS, prior, DISPUTE_STEP_KEYS);

export const CLAIM_STAGE_CHECKS: Record<string, CheckDef[]> = {
  request_depreciation: [
    { key: 'depreciation_requested', label: 'Depreciation requested from the carrier' },
    { key: 'depreciation_received',  label: 'Depreciation check received' },
  ],
};
export const CLAIM_CHECK_KEYS = new Set(Object.values(CLAIM_STAGE_CHECKS).flat().map((c) => c.key));

export interface ClaimPipelineState { stage: string; disputeSteps: Step[]; checks: Record<string, boolean> }
export interface ClaimGateContext { inspectionReport: boolean }

export function claimEntryBlocker(stage: string, state: ClaimPipelineState, ctx: ClaimGateContext): string | null {
  switch (stage) {
    case 'adjuster_appt':
      return ctx.inspectionReport ? null : 'Generate the inspection report first (Reports on the client page) — the adjuster needs it.';
    case 'closed': {
      const missing = missingChecks(CLAIM_STAGE_CHECKS.request_depreciation, state.checks);
      return missing.length ? `Before closing: ${missing.join('; ')}.` : null;
    }
    default:
      return null;
  }
}

export function claimMoveBlocker(target: string, state: ClaimPipelineState, ctx: ClaimGateContext): string | null {
  return coreMoveBlocker(CLAIM_PIPELINE_STAGES, state.stage, target, (s) => claimEntryBlocker(s, state, ctx));
}

/** What the board should say happens next when a claim lands in a stage, and how long that gets. */
export const CLAIM_NEXT_ACTION: Record<string, string> = {
  inspect: 'Inspect the roof and document the damage',
  file_claim: 'File the claim and get the claim number',
  sa_signed: 'Get the service agreement signed',
  inspection_report: 'Generate the inspection report for the adjuster',
  adjuster_appt: 'Confirm the adjuster meeting and be on the roof with them',
  waiting_results: 'Chase the carrier for the written decision',
  supplement: 'Submit the supplement with photos and code items',
  disputing: 'Request the reinspection',
  approved: 'Review the scope for missed items, then hand off to production',
  post_supplementing: 'Submit the post-build supplement',
  request_depreciation: 'Send the certificate of completion and request depreciation',
  closed: 'Nothing — closed',
};
export const CLAIM_DUE_DAYS: Record<string, number> = {
  file_claim: 2, sa_signed: 3, inspection_report: 2, adjuster_appt: 2, waiting_results: 3,
  supplement: 5, disputing: 3, approved: 3, post_supplementing: 5, request_depreciation: 7,
};

// ---- JobTread bridge ----------------------------------------------------------

/** The JobTread "Status" to write for a claim position; null when JobTread has no matching status. */
export function jobtreadStatusForClaim(stage: string, disputeSteps: Step[]): string | null {
  switch (stage) {
    case 'file_claim':
    case 'sa_signed':
    case 'inspection_report': return 'Claim Filed';
    case 'adjuster_appt': return 'Adj Meeting';
    case 'waiting_results': return 'Waiting Decision';
    case 'supplement': return 'Pre-Supplementing';
    case 'disputing': {
      const cur = currentStep(disputeSteps);
      if (cur === 'need_nts_vra') return 'NTS Needed';
      if (cur === 'nts_vra_sent' || cur === 'escalate_supervisor') return 'NTS Sent';
      return 'Denied Disputing';
    }
    case 'approved': return 'Insurance Approved';
    case 'post_supplementing':
    case 'request_depreciation': return 'Post-Supplementing';
    default: return null;
  }
}

/** JobTread status → claim stage (+ dispute step). Lower-case keys; anything absent is not a claim. */
export const JT_STATUS_TO_CLAIM: Record<string, { stage: string; step?: string }> = {
  'claim filed': { stage: 'file_claim' },
  'claim submitted': { stage: 'file_claim' },
  'adj meeting': { stage: 'adjuster_appt' },
  'adjuster scheduled': { stage: 'adjuster_appt' },
  'adjuster meeting': { stage: 'adjuster_appt' },
  'adjuster met': { stage: 'adjuster_appt' },
  'waiting decision': { stage: 'waiting_results' },
  'pre-supplementing': { stage: 'supplement' },
  'supplementing': { stage: 'supplement' },
  'denied disputing': { stage: 'disputing' },
  'denied': { stage: 'disputing' },
  'partial approval disputing': { stage: 'disputing' },
  'nts needed': { stage: 'disputing', step: 'need_nts_vra' },
  'nts sent': { stage: 'disputing', step: 'nts_vra_sent' },
  'insurance approved': { stage: 'approved' },
  'approved': { stage: 'approved' },
  'post-supplementing': { stage: 'post_supplementing' },
};

/** The board's pre-Sept-2026 stage keys → today's, for rows that predate the pipeline. */
export const LEGACY_CLAIM_STAGE: Record<string, string> = {
  intake: 'file_claim', inspection_done: 'inspection_report', sa_signed: 'sa_signed',
  adjuster_scheduled: 'adjuster_appt', adjuster_met: 'adjuster_appt', decision_pending: 'waiting_results',
  approved: 'approved', supplementing: 'supplement', build_scheduled: 'post_supplementing',
  build_done: 'post_supplementing', final_invoiced: 'post_supplementing', depreciation_pending: 'request_depreciation',
  closed: 'closed', denied_dispute: 'disputing',
};
