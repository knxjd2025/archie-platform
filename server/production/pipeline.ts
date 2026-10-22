/**
 * Production pipeline persistence + the move itself. Pure rules (stage order,
 * gates, trade sequence, JobTread mapping) live in shared/production-pipeline.ts;
 * this file is the part that touches the database and JobTread.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { leads, productionPipeline, preConstructionChecklists, finalWalkthroughs, type ProductionPipelineRow } from '../../shared/schema';
import {
  type PipelineStage, type PipelineState, type GateContext, type TradeStep,
  isPipelineStage, moveBlocker, normalizeTrades, completeCurrentTrade, allTradesDone, currentTrade,
  jobtreadStatusFor, stageForJobtreadStatus, stageLabel, CHECK_KEYS,
} from '../../shared/production-pipeline';
import { JobTreadClient } from '../integrations/jobtread';
import { logWrite } from '../writes/log';

export interface PipelineSnapshot extends PipelineState {
  hasRow: boolean;
  depositReceivedAt: string | null;
  stageEnteredAt: string | null;
  currentTrade: string | null;
  allTradesDone: boolean;
}

/** A job's pipeline position: its row, or a placement derived from JobTread's status. */
export function snapshotFor(row: ProductionPipelineRow | undefined, jtStage: string | null): PipelineSnapshot | null {
  if (row) {
    const trades = normalizeTrades(row.trades.map((t) => t.key), row.trades as TradeStep[]);
    return {
      hasRow: true,
      stage: isPipelineStage(row.stage) ? row.stage : 'approved',
      trades,
      checks: row.checks || {},
      depositReceivedAt: row.depositReceivedAt ? row.depositReceivedAt.toISOString() : null,
      stageEnteredAt: row.stageEnteredAt ? row.stageEnteredAt.toISOString() : null,
      currentTrade: currentTrade(trades),
      allTradesDone: allTradesDone(trades),
    };
  }
  const stage = stageForJobtreadStatus(jtStage);
  if (!stage) return null;
  const trades = normalizeTrades(['roofing']);
  return { hasRow: false, stage, trades, checks: {}, depositReceivedAt: null, stageEnteredAt: null, currentTrade: 'roofing', allTradesDone: false };
}

/** Which jobs have a submitted pre-con checklist / final walkthrough — the facts the gates need. */
export async function gateContexts(ids: string[]): Promise<Map<string, GateContext>> {
  const out = new Map<string, GateContext>();
  for (const id of ids) out.set(id, { preconSubmitted: false, walkthroughSubmitted: false });
  if (!ids.length) return out;
  const [pre, wt] = await Promise.all([
    db.select({ id: preConstructionChecklists.jobExternalId }).from(preConstructionChecklists)
      .where(and(inArray(preConstructionChecklists.jobExternalId, ids), eq(preConstructionChecklists.status, 'submitted'))),
    db.select({ id: finalWalkthroughs.jobExternalId }).from(finalWalkthroughs)
      .where(and(inArray(finalWalkthroughs.jobExternalId, ids), eq(finalWalkthroughs.status, 'submitted'))),
  ]);
  for (const r of pre) out.get(r.id)!.preconSubmitted = true;
  for (const r of wt) out.get(r.id)!.walkthroughSubmitted = true;
  return out;
}

export async function pipelineRows(ids: string[]): Promise<Map<string, ProductionPipelineRow>> {
  if (!ids.length) return new Map();
  const rows = await db.select().from(productionPipeline).where(inArray(productionPipeline.jobExternalId, ids));
  return new Map(rows.map((r) => [r.jobExternalId, r]));
}

/** The row for a job, created from its JobTread placement the first time it's touched. */
export async function ensureRow(externalId: string, actor: string): Promise<ProductionPipelineRow> {
  const [existing] = await db.select().from(productionPipeline).where(eq(productionPipeline.jobExternalId, externalId));
  if (existing) return existing;
  const [lead] = await db.select({ stage: leads.stage }).from(leads).where(eq(leads.externalId, externalId));
  const stage = stageForJobtreadStatus(lead?.stage) ?? 'approved';
  const [row] = await db.insert(productionPipeline).values({
    jobExternalId: externalId, stage, updatedBy: actor,
    history: [{ stage, at: new Date().toISOString(), by: actor }],
  }).onConflictDoNothing().returning();
  if (row) return row;
  const [raced] = await db.select().from(productionPipeline).where(eq(productionPipeline.jobExternalId, externalId));
  return raced;
}

/** Best-effort JobTread status write + audit log. Never blocks the board. */
async function mirrorToJobTread(externalId: string, stage: PipelineStage, trades: TradeStep[], actor: string, summary: string): Promise<{ ok: boolean; error?: string }> {
  const target = jobtreadStatusFor(stage, trades);
  const [before] = await db.select({ stage: leads.stage }).from(leads).where(eq(leads.externalId, externalId));
  if (before?.stage === target) return { ok: true };
  let result: { ok: boolean; error?: string };
  try {
    result = await new JobTreadClient().setJobStage(externalId, target);
  } catch (e: any) {
    result = { ok: false, error: e?.message || 'JobTread stage update failed' };
  }
  await logWrite({
    actor, system: 'jobtread', action: 'set_stage', targetId: externalId,
    summary: `${summary} · JobTread ${before?.stage || '?'} → ${target}`, ok: result.ok, error: result.error || null,
  }).catch(() => {});
  if (result.ok) await db.update(leads).set({ stage: target }).where(eq(leads.externalId, externalId));
  return result;
}

export type MoveResult =
  | { ok: true; row: ProductionPipelineRow; moved: boolean; jobtread: { ok: boolean; error?: string }; automation: string[] }
  | { ok: false; status: number; error: string };

/**
 * Move a job on the production board. `system` moves come from automation
 * (the thing the gate was waiting for just happened) and skip the gate check;
 * they also don't cascade further, so two rules can't chase each other.
 */
export async function moveStage(externalId: string, target: unknown, actor: string, opts: { system?: boolean; reason?: string } = {}): Promise<MoveResult> {
  if (!isPipelineStage(target)) return { ok: false, status: 400, error: 'Unknown stage.' };
  const row = await ensureRow(externalId, actor);
  const snap = snapshotFor(row, null)!;
  if (snap.stage === target) return { ok: true, row, moved: false, jobtread: { ok: true }, automation: [] };
  if (!opts.system) {
    const ctx = (await gateContexts([externalId])).get(externalId)!;
    const blocker = moveBlocker(target, snap, ctx);
    if (blocker) return { ok: false, status: 409, error: blocker };
  }

  const now = new Date();
  const by = opts.system ? `system: ${opts.reason || 'automation'}` : actor;
  const patch: Partial<ProductionPipelineRow> = {
    stage: target, stageEnteredAt: now, updatedAt: now, updatedBy: actor,
    history: [...(row.history || []), { stage: target, at: now.toISOString(), by }].slice(-100),
  };
  // Crossing into (or past) Pre-Production is the deposit landing.
  const { stageIndex } = await import('../../shared/production-pipeline');
  if (!row.depositReceivedAt && stageIndex(snap.stage) < stageIndex('pre_production') && stageIndex(target) >= stageIndex('pre_production')) patch.depositReceivedAt = now;
  const [updated] = await db.update(productionPipeline).set(patch).where(eq(productionPipeline.id, row.id)).returning();
  const jobtread = await mirrorToJobTread(externalId, target, snap.trades, actor, `${stageLabel(snap.stage)} → ${stageLabel(target)}`);
  let automation: string[] = [];
  if (!opts.system) {
    const { onProductionStage } = await import('../pipelines/automation');
    automation = await onProductionStage(externalId, target, actor);
  }
  return { ok: true, row: updated, moved: true, jobtread, automation };
}

export async function setTrades(externalId: string, trades: unknown, actor: string): Promise<ProductionPipelineRow> {
  const row = await ensureRow(externalId, actor);
  const next = normalizeTrades(trades, row.trades as TradeStep[]);
  const [updated] = await db.update(productionPipeline).set({ trades: next, updatedAt: new Date(), updatedBy: actor }).where(eq(productionPipeline.id, row.id)).returning();
  return updated;
}

export type CompleteTradeResult =
  | { ok: true; row: ProductionPipelineRow; completed: boolean; jobtread: { ok: boolean; error?: string } }
  | { ok: false; status: number; error: string };

/**
 * Mark the trade the crew is on as done; JobTread flips to "Other Construction
 * Work" once roofing is off the list.
 *
 * The caller names the trade it means. This used to complete "whatever is
 * current", so a double tap (or a retry after a slow response) finished
 * roofing and then gutters too. Now a second tap for the same trade finds it
 * already done and changes nothing, and the update only lands if the trade
 * list is still the one we read, so two taps racing can't both win.
 */
export async function completeTrade(externalId: string, expected: unknown, actor: string): Promise<CompleteTradeResult> {
  if (typeof expected !== 'string' || !expected) return { ok: false, status: 400, error: 'Which trade is finished? Refresh the board and try again.' };
  const row = await ensureRow(externalId, actor);
  const before = normalizeTrades(row.trades.map((t) => t.key), row.trades as TradeStep[]);
  if (currentTrade(before) !== expected) return { ok: true, row, completed: false, jobtread: { ok: true } };
  const next = completeCurrentTrade(before);
  const [updated] = await db.update(productionPipeline).set({ trades: next, updatedAt: new Date(), updatedBy: actor })
    .where(and(eq(productionPipeline.id, row.id), sql`${productionPipeline.trades} = ${JSON.stringify(row.trades)}::jsonb`))
    .returning();
  if (!updated) {
    const [now] = await db.select().from(productionPipeline).where(eq(productionPipeline.id, row.id));
    return { ok: true, row: now ?? row, completed: false, jobtread: { ok: true } };
  }
  const stage = isPipelineStage(updated.stage) ? updated.stage : 'install';
  const jobtread = stage === 'install' && !allTradesDone(next)
    ? await mirrorToJobTread(externalId, stage, next, actor, `${currentTrade(before)} done`)
    : { ok: true };
  return { ok: true, row: updated, completed: true, jobtread };
}

/**
 * Tick or untick one box. Written as a single jsonb merge of just that key:
 * the old read-the-row, rebuild-checks, write-it-back lost a tick whenever two
 * people (or two quick taps on different boxes) saved at the same moment.
 */
export async function setCheck(externalId: string, key: unknown, value: unknown, actor: string): Promise<ProductionPipelineRow | null> {
  if (typeof key !== 'string' || !CHECK_KEYS.has(key)) return null;
  const row = await ensureRow(externalId, actor);
  const [updated] = await db.update(productionPipeline)
    .set({ checks: sql`coalesce(${productionPipeline.checks}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${value === true}::boolean)`, updatedAt: new Date(), updatedBy: actor })
    .where(eq(productionPipeline.id, row.id)).returning();
  return updated;
}

/** Newest first, for a job's history panel. */
export async function pipelineHistory(externalId: string) {
  const [row] = await db.select().from(productionPipeline).where(eq(productionPipeline.jobExternalId, externalId)).orderBy(desc(productionPipeline.id));
  return row ? [...(row.history || [])].reverse() : [];
}
