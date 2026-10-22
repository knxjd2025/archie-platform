/**
 * The sales pipeline: inspection → report → sit-down close → follow up →
 * approved → deposit received → reviews & referrals. Approved and DP Received
 * hand the job to the production pipeline; the reviews/referrals follow-up
 * opens once production has the job through Final Invoice.
 *
 * Lost sits outside that order. A deal doesn't progress into Lost, it is put
 * there from wherever it died, so the stage is deliberately kept out of
 * SALES_PIPELINE_STAGES: nothing advances into it, no gate is walked to reach
 * it, no automation can move a job out of it, and it isn't counted as "in the
 * pipeline". Only a person marks a deal lost, and only a person reopens it.
 */
import { type StageDef, type CheckDef, moveBlocker as coreMoveBlocker, missingChecks } from './pipeline-core';
import { stageIndex as productionStageIndex, isPipelineStage as isProductionStage } from './production-pipeline';

export const SALES_PIPELINE_STAGES: readonly StageDef[] = [
  { key: 'inspection',        label: 'Inspection',           hint: 'Appointment set, roof inspected' },
  { key: 'report',            label: 'Report',               hint: 'Inspection / proposal report generated' },
  { key: 'sit_down_close',    label: 'Sit Down Close',       hint: 'Presenting the report and closing' },
  { key: 'follow_up',         label: 'Follow Up',            hint: 'Chasing the decision' },
  { key: 'approved',          label: 'Approved',             hint: 'Signed and approved — Production opens the job' },
  { key: 'dp_received',       label: 'DP Received',          hint: 'Deposit in — Production takes it from here' },
  { key: 'reviews_referrals', label: 'Reviews & Referrals',  hint: 'After the job: ask for the review and the referral' },
];
export const SALES_STAGE_KEYS = SALES_PIPELINE_STAGES.map((s) => s.key);

export const SALES_LOST = 'lost';
export const SALES_LOST_STAGE: StageDef = { key: SALES_LOST, label: 'Lost', hint: "Didn't close — reopen it if it comes back" };
/** What the board draws: the seven steps, then Lost on the end. */
export const SALES_BOARD_STAGES: readonly StageDef[] = [...SALES_PIPELINE_STAGES, SALES_LOST_STAGE];

export const isSalesLost = (s: unknown): s is 'lost' => s === SALES_LOST;
/** One of the seven ordered steps — what index, gate and automation comparisons mean by "a stage". */
export const isSalesProgressionStage = (s: unknown): s is string => typeof s === 'string' && SALES_STAGE_KEYS.includes(s);
/** Anything a job's stage is allowed to be, Lost included. */
export const isSalesStage = (s: unknown): s is string => isSalesProgressionStage(s) || isSalesLost(s);
/** Position in the progression; -1 for Lost, which has none. */
export const salesStageIndex = (s: string) => SALES_STAGE_KEYS.indexOf(s);

/**
 * Why a deal died. A bare "lost" tells you the number and nothing you can act
 * on; these are the answers that change what the business does — undercut on
 * price is a pricing problem, went dark is a follow-up problem, and they are
 * not the same problem.
 */
export interface LostReasonDef { key: string; label: string; hint?: string }
export const SALES_LOST_REASONS: readonly LostReasonDef[] = [
  { key: 'price',            label: 'Price — went cheaper elsewhere' },
  { key: 'competitor',       label: 'Went with another contractor', hint: 'Not on price — service, timing, a relationship' },
  { key: 'insurance_denied', label: 'Insurance denied the claim' },
  { key: 'not_doing_it',     label: 'Decided not to do the work' },
  { key: 'no_contact',       label: 'Went dark — could not reach them' },
  { key: 'not_qualified',    label: 'Never a real job', hint: 'Renter, no damage, outside the area' },
  { key: 'other',            label: 'Something else', hint: 'Say what in the note' },
];
const LOST_REASON_BY_KEY = new Map(SALES_LOST_REASONS.map((r) => [r.key, r]));
export const isSalesLostReason = (s: unknown): s is string => typeof s === 'string' && LOST_REASON_BY_KEY.has(s);
export const salesLostReasonLabel = (key: string | null | undefined): string | null =>
  key ? LOST_REASON_BY_KEY.get(key)?.label ?? key : null;

export const MAX_LOST_NOTE = 500;

/**
 * Why this reason can't be filed yet, or null. "Something else" with nothing
 * written in it records the same nothing as no reason at all, so it asks for
 * the note it exists to carry.
 */
export function lostReasonBlocker(reason: unknown, note: unknown): string | null {
  if (!isSalesLostReason(reason)) return 'Pick a reason.';
  if (reason === 'other' && !String(note ?? '').trim()) return 'Say what happened — "something else" on its own records nothing.';
  return null;
}

/** Where reopening a lost deal should put it: the last step it was on before it died. */
export function salesReopenStage(history: ReadonlyArray<{ stage: string }> | null | undefined): string {
  for (let i = (history?.length ?? 0) - 1; i >= 0; i--) {
    const stage = history![i].stage;
    if (isSalesProgressionStage(stage)) return stage;
  }
  return 'follow_up';
}

export const SALES_STAGE_CHECKS: Record<string, CheckDef[]> = {
  reviews_referrals: [
    { key: 'review_requested', label: 'Review requested' },
    { key: 'review_received',  label: 'Review received' },
    { key: 'referral_asked',   label: 'Asked for a referral' },
  ],
};
export const SALES_CHECK_KEYS = new Set(Object.values(SALES_STAGE_CHECKS).flat().map((c) => c.key));

export interface SalesPipelineState {
  stage: string;
  checks: Record<string, boolean>;
  /** The row's stage history — where a lost deal goes back to (salesReopenStage). */
  history?: ReadonlyArray<{ stage: string }> | null;
}
export interface SalesGateContext {
  /** A report has been generated for this job. */
  reportGenerated: boolean;
  /** Where the job sits on the production board, if it's there. */
  productionStage: string | null;
}

/** Production has the job at or past Final Invoice — time to ask for the review. */
export function jobReadyForReviews(productionStage: string | null): boolean {
  return !!productionStage && isProductionStage(productionStage) && productionStageIndex(productionStage) >= productionStageIndex('final_invoice');
}

export function salesEntryBlocker(stage: string, _state: SalesPipelineState, ctx: SalesGateContext): string | null {
  switch (stage) {
    case 'sit_down_close':
      return ctx.reportGenerated ? null : 'Generate the report first (Reports on the client page) — that is what you sit down with.';
    case 'reviews_referrals':
      return jobReadyForReviews(ctx.productionStage) ? null : 'Wait for Production to reach Final Invoice — ask for the review once the work is done and invoiced.';
    default:
      return null;
  }
}

export function salesMoveBlocker(target: string, state: SalesPipelineState, ctx: SalesGateContext): string | null {
  const gate = (s: string) => salesEntryBlocker(s, state, ctx);
  // A deal can be given up on from anywhere — that crosses no gate.
  if (isSalesLost(target)) return null;
  if (isSalesLost(state.stage)) {
    // Reopening puts it back where it already was, which it passed the gates
    // to reach. Anywhere else is a new position: Lost has no place in the
    // order, so every gate from the first step up to the target is walked.
    // Skipping that let a deal lost at Inspection be dragged straight to
    // Reviews & Referrals with no report and no finished job behind it.
    if (target === salesReopenStage(state.history)) return null;
    return coreMoveBlocker(SALES_PIPELINE_STAGES, SALES_STAGE_KEYS[0], target, gate);
  }
  return coreMoveBlocker(SALES_PIPELINE_STAGES, state.stage, target, gate);
}

/** Everything the reviews stage asks for is ticked — the job is off the board by default. */
export const salesDone = (state: SalesPipelineState): boolean =>
  state.stage === 'reviews_referrals' && missingChecks(SALES_STAGE_CHECKS.reviews_referrals, state.checks).length === 0;

// ---- JobTread bridge ----------------------------------------------------------

/** JobTread status to write for a sales stage; null once production owns the job's status. */
export function jobtreadStatusForSales(stage: string): string | null {
  switch (stage) {
    case 'inspection': return 'Appt Set';
    case 'report': return 'Estimating';
    case 'sit_down_close': return 'Sales Closing Meeting';
    case 'follow_up': return 'Follow Up Close';
    case 'approved': return 'Buyer Approved';
    case SALES_LOST: return 'Lost';
    default: return null;
  }
}

/** JobTread statuses a job can have and still be on the sales board without a row of its own. */
export const SALES_BAND = ['New Lead', 'Appt Set', 'Estimating', 'Sales Closing Meeting', 'Follow Up Close', 'Buyer Approved', 'Insurance Approved'];

/** Where a job with no sales row sits. Production placement wins once the deposit is in. */
export function salesStageForJob(jt: string | null | undefined, productionStage: string | null): string | null {
  // Lost in JobTread beats anything a production row says: the job is dead.
  if (jt === 'Lost') return SALES_LOST;
  if (productionStage && isProductionStage(productionStage)) {
    if (productionStageIndex(productionStage) >= productionStageIndex('pre_production')) return 'dp_received';
    return 'approved';
  }
  switch (jt) {
    case 'New Lead':
    case 'Appt Set': return 'inspection';
    case 'Estimating': return 'report';
    case 'Sales Closing Meeting': return 'sit_down_close';
    case 'Follow Up Close': return 'follow_up';
    case 'Buyer Approved':
    case 'Insurance Approved': return 'approved';
    case 'Permitting':
    case 'Pre-Construction':
    case 'Schedule':
    case 'Roof Construction':
    case 'Other Construction Work': return 'dp_received';
    case 'Complete':
    case 'PIF File Warranties':
    case 'Closed': return 'reviews_referrals';
    default: return null;
  }
}
