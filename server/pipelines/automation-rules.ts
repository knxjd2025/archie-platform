/**
 * What movement in one pipeline should cause in the others — pure decisions,
 * no database. automation.ts applies them. Every rule only ever moves a
 * pipeline FORWARD, and only when the thing that happened is the thing that
 * stage was waiting for, so a person's own moves are never undone.
 */
import { stageIndex as prodIdx, isPipelineStage as isProd, stageForJobtreadStatus, type PipelineStage } from '../../shared/production-pipeline';
import { salesStageIndex as salesIdx, isSalesProgressionStage, salesStageForJob } from '../../shared/sales-pipeline';
import { claimStageIndex as claimIdx, isClaimPipelineStage } from '../../shared/claims-pipeline';

export interface Effect { pipeline: 'sales' | 'production' | 'claims'; to: string; reason: string }

export interface Positions {
  /** Production stage, or null when the job isn't on that board yet. */
  productionStage: string | null;
  /** Sales stage, or null when the job has no sales row. */
  salesStage: string | null;
  /** Open claim's stage, or null when there's no claim. */
  claimStage: string | null;
}

const prodAtLeast = (stage: string | null, floor: PipelineStage) => !!stage && isProd(stage) && prodIdx(stage) >= prodIdx(floor);
const prodBefore = (stage: string | null, ceiling: PipelineStage) => !stage || !isProd(stage) || prodIdx(stage) < prodIdx(ceiling);
// Lost is not a progression stage, so it is never "before" anything: a deal a
// person gave up on is not dragged back onto the board by a rule.
const salesBefore = (stage: string | null, ceiling: string) => !!stage && isSalesProgressionStage(stage) && salesIdx(stage) < salesIdx(ceiling);

/** The job moved on the production board. */
export function effectsOfProductionStage(stage: string, p: Positions): Effect[] {
  const out: Effect[] = [];
  if (prodAtLeast(stage, 'pre_production') && salesBefore(p.salesStage, 'dp_received')) {
    out.push({ pipeline: 'sales', to: 'dp_received', reason: 'deposit received on the production board' });
  }
  if (prodAtLeast(stage, 'final_invoice') && p.salesStage === 'dp_received') {
    out.push({ pipeline: 'sales', to: 'reviews_referrals', reason: 'production reached Final Invoice' });
  }
  if (prodAtLeast(stage, 'final_walkthrough') && p.claimStage === 'approved') {
    out.push({ pipeline: 'claims', to: 'post_supplementing', reason: 'the build is done' });
  }
  if (prodAtLeast(stage, 'final_invoice') && p.claimStage === 'post_supplementing') {
    out.push({ pipeline: 'claims', to: 'request_depreciation', reason: 'final invoice sent' });
  }
  return out;
}

/** The job moved on the sales board. */
export function effectsOfSalesStage(stage: string, p: Positions): Effect[] {
  const out: Effect[] = [];
  if (stage === 'approved' && !p.productionStage) {
    out.push({ pipeline: 'production', to: 'approved', reason: 'homeowner approved the work' });
  }
  if (stage === 'dp_received' && prodBefore(p.productionStage, 'pre_production')) {
    out.push({ pipeline: 'production', to: 'pre_production', reason: 'deposit received' });
  }
  if (salesIdx(stage) >= salesIdx('approved') && p.claimStage === 'inspect') {
    // nothing: a claim's own steps (file, SA) are a person's call
  }
  return out;
}

/** The claim moved. */
export function effectsOfClaimStage(stage: string, p: Positions): Effect[] {
  const out: Effect[] = [];
  if (isClaimPipelineStage(stage) && claimIdx(stage) >= claimIdx('sa_signed') && salesBefore(p.salesStage, 'approved')) {
    out.push({ pipeline: 'sales', to: 'approved', reason: 'service agreement signed' });
  }
  if (isClaimPipelineStage(stage) && claimIdx(stage) >= claimIdx('approved') && !p.productionStage) {
    out.push({ pipeline: 'production', to: 'approved', reason: 'insurance approved the claim' });
  }
  return out;
}

/** The rep submitted the pre-construction checklist (done when the deposit is collected). */
export function effectsOfPreconSubmitted(p: Positions): Effect[] {
  if (p.productionStage && prodAtLeast(p.productionStage, 'schedule')) return [];
  return [{ pipeline: 'production', to: 'schedule', reason: 'pre-construction checklist submitted' }];
}

/** The final walkthrough was submitted. */
export function effectsOfWalkthroughSubmitted(p: Positions): Effect[] {
  if (p.productionStage && prodAtLeast(p.productionStage, 'final_invoice')) return [];
  if (!p.productionStage) return [];
  return [{ pipeline: 'production', to: 'final_invoice', reason: 'final walkthrough submitted' }];
}

/** A report finished generating for the job. */
export function effectsOfReportGenerated(reportType: string | null, p: Positions): Effect[] {
  const out: Effect[] = [];
  if (p.salesStage === 'inspection') out.push({ pipeline: 'sales', to: 'report', reason: 'report generated' });
  if ((reportType || '').toLowerCase().includes('inspection') && p.claimStage === 'inspection_report') {
    out.push({ pipeline: 'claims', to: 'adjuster_appt', reason: 'inspection report generated' });
  }
  return out;
}

/** A rep marked a report as presented to the customer. */
export function effectsOfReportPresented(p: Positions): Effect[] {
  return salesBefore(p.salesStage, 'sit_down_close') ? [{ pipeline: 'sales', to: 'sit_down_close', reason: 'report presented' }] : [];
}

/** A JobTread proposal for the job was signed / approved. */
export function effectsOfProposalSigned(p: Positions): Effect[] {
  const out: Effect[] = [];
  if (salesBefore(p.salesStage, 'approved')) out.push({ pipeline: 'sales', to: 'approved', reason: 'proposal signed in JobTread' });
  if (!p.productionStage) out.push({ pipeline: 'production', to: 'approved', reason: 'proposal signed in JobTread' });
  return out;
}

/**
 * JobTread's status moved past where the boards have the job (someone
 * changed it in JobTread). Boards follow forward, never back.
 */
export function effectsOfJobtreadStatus(jt: string | null, p: Positions): Effect[] {
  const out: Effect[] = [];
  const prodTarget = stageForJobtreadStatus(jt);
  if (prodTarget && p.productionStage && isProd(p.productionStage) && prodIdx(prodTarget) > prodIdx(p.productionStage)) {
    out.push({ pipeline: 'production', to: prodTarget, reason: `JobTread status is ${jt}` });
  }
  const salesTarget = salesStageForJob(jt, prodTarget ?? p.productionStage);
  if (salesTarget && p.salesStage && isSalesProgressionStage(p.salesStage) && salesIdx(salesTarget) > salesIdx(p.salesStage)) {
    out.push({ pipeline: 'sales', to: salesTarget, reason: `JobTread status is ${jt}` });
  }
  return out;
}
