/**
 * The production pipeline — every stage a sold job walks from the homeowner's
 * signature to the referral ask, in order. One source of truth for the board
 * (client) and the move rules (server).
 *
 * This is the app's own pipeline, not JobTread's. JobTread's "Status" dropdown
 * has nine coarse production statuses and can't say "deposit not in yet" or
 * "roof done, gutters next", so each job keeps a pipeline row here and every
 * move writes the nearest JobTread status (jobtreadStatusFor) so the two
 * never drift far apart. A job with no row yet is placed from its JobTread
 * status (stageForJobtreadStatus).
 */

export const PIPELINE_STAGES = [
  { key: 'approved',          label: 'Approved',            hint: 'Homeowner signed and approved the work' },
  { key: 'waiting_dp',        label: 'Waiting for DP',      hint: 'Deposit / down payment not in yet' },
  { key: 'pre_production',    label: 'Pre-Production',      hint: 'Deposit received · pre-construction checklist' },
  { key: 'schedule',          label: 'Schedule Job',        hint: 'Put the crew and dates on the calendar' },
  { key: 'material_check',    label: 'Material Check',      hint: 'Materials ordered, confirmed and staged' },
  { key: 'install',           label: 'Install / Production', hint: 'Trades run in order: roofing, gutters, soffit/fascia, siding, painting' },
  { key: 'final_walkthrough', label: 'Final Walk Through',  hint: 'Nail sweep, damage check, leftovers, homeowner sign-off' },
  { key: 'final_invoice',     label: 'Final Invoice',       hint: 'Invoice sent with photos · review requested' },
  { key: 'final_payment',     label: 'Final Payment',       hint: 'Balance collected' },
  { key: 'warranty',          label: 'Warranty',            hint: 'Warranty registered and sent to the homeowner' },
  { key: 'closed_out',        label: 'Closed Out',          hint: 'Ask for referrals' },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number]['key'];
export const PIPELINE_STAGE_KEYS: PipelineStage[] = PIPELINE_STAGES.map((s) => s.key);
const STAGE_INDEX: Record<string, number> = Object.fromEntries(PIPELINE_STAGE_KEYS.map((k, i) => [k, i]));
// Own keys only: `in` also answers true for 'constructor', '__proto__' and the
// rest of Object.prototype, and a stage of 'constructor' had no index, so
// moveBlocker compared NaN, waved the move through and the row was written
// with a stage no gate had ever seen.
export const isPipelineStage = (s: unknown): s is PipelineStage => typeof s === 'string' && Object.hasOwn(STAGE_INDEX, s);
export const stageIndex = (s: PipelineStage): number => STAGE_INDEX[s];
export const stageLabel = (s: PipelineStage): string => PIPELINE_STAGES[STAGE_INDEX[s]].label;

/** The trades a job can include, in the order they run on site. */
export const TRADES = [
  { key: 'roofing',       label: 'Roofing' },
  { key: 'gutters',       label: 'Gutters' },
  { key: 'soffit_fascia', label: 'Soffit / Fascia' },
  { key: 'siding',        label: 'Siding' },
  { key: 'painting',      label: 'Painting' },
] as const;
export type Trade = (typeof TRADES)[number]['key'];
const TRADE_INDEX: Record<string, number> = Object.fromEntries(TRADES.map((t, i) => [t.key, i]));
export const isTrade = (t: unknown): t is Trade => typeof t === 'string' && Object.hasOwn(TRADE_INDEX, t);
export const tradeLabel = (t: Trade): string => TRADES[TRADE_INDEX[t]].label;

export interface TradeStep { key: Trade; done: boolean }

/** Normalise a trade list: valid keys only, site order, no duplicates, roofing if empty. */
export function normalizeTrades(input: unknown, prior: TradeStep[] = []): TradeStep[] {
  const wanted = new Set<Trade>();
  if (Array.isArray(input)) for (const t of input) if (isTrade(t)) wanted.add(t);
  if (!wanted.size) wanted.add('roofing');
  const priorDone = new Map(prior.map((p) => [p.key, p.done]));
  return TRADES.filter((t) => wanted.has(t.key)).map((t) => ({ key: t.key, done: priorDone.get(t.key) ?? false }));
}

export const currentTrade = (trades: TradeStep[]): Trade | null => trades.find((t) => !t.done)?.key ?? null;
export const allTradesDone = (trades: TradeStep[]): boolean => trades.length > 0 && trades.every((t) => t.done);

/** Mark the next unfinished trade done; no-op when every trade is already done. */
export function completeCurrentTrade(trades: TradeStep[]): TradeStep[] {
  const cur = currentTrade(trades);
  return trades.map((t) => (t.key === cur ? { ...t, done: true } : t));
}

/**
 * The tick-boxes a stage asks for before the job can leave it. Stored on the
 * pipeline row as `checks` ({ [key]: true }).
 */
export const STAGE_CHECKS: Partial<Record<PipelineStage, { key: string; label: string }[]>> = {
  final_invoice: [
    { key: 'invoice_sent_with_photos', label: 'Final invoice sent, with photos of the finished work' },
    { key: 'review_requested', label: 'Review requested' },
  ],
  final_payment: [
    { key: 'final_payment_received', label: 'Final payment received' },
  ],
  warranty: [
    { key: 'warranty_registered', label: 'Warranty registered and sent to homeowner' },
  ],
  closed_out: [
    { key: 'referral_asked', label: 'Asked for referrals' },
  ],
};
export const CHECK_KEYS = new Set(Object.values(STAGE_CHECKS).flat().map((c) => c.key));

export interface PipelineState {
  stage: PipelineStage;
  trades: TradeStep[];
  checks: Record<string, boolean>;
}

/** What the gates need to know that lives outside the pipeline row. */
export interface GateContext {
  preconSubmitted: boolean;
  walkthroughSubmitted: boolean;
}

/** Why a job may not ENTER `stage` yet, or null when it may. */
export function entryBlocker(stage: PipelineStage, state: PipelineState, ctx: GateContext): string | null {
  const missing = (s: PipelineStage) => (STAGE_CHECKS[s] || []).filter((c) => !state.checks[c.key]).map((c) => c.label);
  switch (stage) {
    case 'schedule':
      return ctx.preconSubmitted ? null : 'Submit the pre-construction checklist first (on the client page).';
    case 'final_walkthrough':
      return allTradesDone(state.trades) ? null : `Finish every trade first — ${tradeLabel(currentTrade(state.trades) || 'roofing')} is still open.`;
    case 'final_invoice':
      return ctx.walkthroughSubmitted ? null : 'Submit the final walkthrough first (on the client page).';
    case 'final_payment':
      return missing('final_invoice').length ? `Before final payment: ${missing('final_invoice').join('; ')}.` : null;
    case 'warranty':
      return missing('final_payment').length ? `Before warranty: ${missing('final_payment').join('; ')}.` : null;
    case 'closed_out':
      return missing('warranty').length ? `Before closing out: ${missing('warranty').join('; ')}.` : null;
    default:
      return null;
  }
}

/**
 * May the job move from its current stage to `target`? Moving back is always
 * allowed (an undo). Moving forward checks the entry gate of every stage
 * crossed, so skipping a column can't skip its requirements.
 */
export function moveBlocker(target: PipelineStage, state: PipelineState, ctx: GateContext): string | null {
  const from = stageIndex(state.stage);
  const to = stageIndex(target);
  if (to <= from) return null;
  for (let i = from + 1; i <= to; i++) {
    const blocker = entryBlocker(PIPELINE_STAGE_KEYS[i], state, ctx);
    if (blocker) return blocker;
  }
  return null;
}

export const nextStage = (s: PipelineStage): PipelineStage | null => PIPELINE_STAGE_KEYS[stageIndex(s) + 1] ?? null;
export const prevStage = (s: PipelineStage): PipelineStage | null => PIPELINE_STAGE_KEYS[stageIndex(s) - 1] ?? null;

// ---- JobTread bridge ----------------------------------------------------------

/** The nearest JobTread "Status" for a pipeline position — written on every move. */
export function jobtreadStatusFor(stage: PipelineStage, trades: TradeStep[]): string {
  switch (stage) {
    case 'approved':
    case 'waiting_dp': return 'Buyer Approved';
    case 'pre_production': return 'Pre-Construction';
    case 'schedule':
    case 'material_check': return 'Schedule';
    case 'install': {
      // Roofing runs first, so "on the roof" is exactly "roofing not yet done";
      // once it's done (or the job has no roofing) the crew is on other trades.
      const roofing = trades.find((t) => t.key === 'roofing');
      return roofing && !roofing.done ? 'Roof Construction' : 'Other Construction Work';
    }
    case 'final_walkthrough':
    case 'final_invoice':
    case 'final_payment': return 'Complete';
    case 'warranty': return 'PIF File Warranties';
    case 'closed_out': return 'Closed';
  }
}

/** Where a job with no pipeline row yet sits, judged from its JobTread status. Null = not in production. */
export function stageForJobtreadStatus(jt: string | null | undefined): PipelineStage | null {
  switch (jt) {
    case 'Buyer Approved':
    case 'Insurance Approved': return 'approved';
    case 'Permitting':
    case 'Pre-Construction': return 'pre_production';
    case 'Schedule': return 'schedule';
    case 'Roof Construction':
    case 'Other Construction Work': return 'install';
    case 'Complete': return 'final_walkthrough';
    case 'PIF File Warranties': return 'warranty';
    case 'Closed': return 'closed_out';
    default: return null;
  }
}
