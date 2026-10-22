/**
 * Sales pipeline persistence + the move itself (rules: shared/sales-pipeline.ts).
 * Used by the board routes and by pipelines/automation.ts.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { leads, salesPipeline, clientReports, productionPipeline, type SalesPipelineRow } from '../../shared/schema';
import { logWrite } from '../writes/log';
import { JobTreadClient } from '../integrations/jobtread';
import { SALES_BOARD_STAGES, isSalesStage, isSalesLost, salesMoveBlocker, salesDone, jobtreadStatusForSales, salesStageForJob, salesReopenStage, lostReasonBlocker, salesLostReasonLabel, MAX_LOST_NOTE, type SalesGateContext } from '../../shared/sales-pipeline';
import { labelOf } from '../../shared/pipeline-core';
import { isPipelineStage as isProductionStage } from '../../shared/production-pipeline';

export interface SalesSnapshot {
  hasRow: boolean; stage: string; checks: Record<string, boolean>; stageEnteredAt: string | null; done: boolean;
  /** For a lost deal: the step it was on when it died, which is where Reopen puts it back. */
  reopenTo: string | null;
  /** Why it died, and the detail behind it. Null unless the deal is lost. */
  lostReason: string | null;
  lostNote: string | null;
}

export function salesSnapshot(row: SalesPipelineRow | undefined, jtStage: string | null, productionStage: string | null): SalesSnapshot | null {
  if (row) {
    const stage = isSalesStage(row.stage) ? row.stage : 'inspection';
    const checks = row.checks || {};
    return {
      hasRow: true, stage, checks,
      stageEnteredAt: row.stageEnteredAt ? row.stageEnteredAt.toISOString() : null,
      done: salesDone({ stage, checks }),
      reopenTo: isSalesLost(stage) ? salesReopenStage(row.history) : null,
      lostReason: isSalesLost(stage) ? row.lostReason : null,
      lostNote: isSalesLost(stage) ? row.lostNote : null,
    };
  }
  const stage = salesStageForJob(jtStage, productionStage);
  return stage ? { hasRow: false, stage, checks: {}, stageEnteredAt: null, done: false, reopenTo: isSalesLost(stage) ? 'follow_up' : null, lostReason: null, lostNote: null } : null;
}

/** Report generated? Production stage? — what the sales gates need, per job. */
export async function salesContexts(ids: string[]): Promise<Map<string, SalesGateContext & { reports: number }>> {
  const out = new Map<string, SalesGateContext & { reports: number }>();
  for (const id of ids) out.set(id, { reportGenerated: false, productionStage: null, reports: 0 });
  if (!ids.length) return out;
  const [reps, prod] = await Promise.all([
    db.select({ id: clientReports.jobExternalId }).from(clientReports).where(and(inArray(clientReports.jobExternalId, ids), eq(clientReports.status, 'succeeded'))),
    db.select({ id: productionPipeline.jobExternalId, stage: productionPipeline.stage }).from(productionPipeline).where(inArray(productionPipeline.jobExternalId, ids)),
  ]);
  for (const r of reps) { const c = out.get(r.id)!; c.reports++; c.reportGenerated = true; }
  for (const p of prod) if (isProductionStage(p.stage)) out.get(p.id)!.productionStage = p.stage;
  return out;
}

export async function salesRowFor(externalId: string): Promise<SalesPipelineRow | undefined> {
  const [row] = await db.select().from(salesPipeline).where(eq(salesPipeline.jobExternalId, externalId));
  return row;
}

export async function ensureSalesRow(externalId: string, actor: string): Promise<SalesPipelineRow> {
  const existing = await salesRowFor(externalId);
  if (existing) return existing;
  const [lead] = await db.select({ stage: leads.stage }).from(leads).where(eq(leads.externalId, externalId));
  const ctx = (await salesContexts([externalId])).get(externalId)!;
  const stage = salesStageForJob(lead?.stage, ctx.productionStage) ?? 'inspection';
  const [row] = await db.insert(salesPipeline).values({
    jobExternalId: externalId, stage, updatedBy: actor,
    history: [{ stage, at: new Date().toISOString(), by: actor }],
  }).onConflictDoNothing().returning();
  if (row) return row;
  return (await salesRowFor(externalId))!;
}

async function mirrorToJobTread(externalId: string, stage: string, actor: string, summary: string): Promise<{ ok: boolean; error?: string }> {
  const target = jobtreadStatusForSales(stage);
  if (!target) return { ok: true };
  const [before] = await db.select({ stage: leads.stage }).from(leads).where(eq(leads.externalId, externalId));
  if (before?.stage === target) return { ok: true };
  let result: { ok: boolean; error?: string };
  try { result = await new JobTreadClient().setJobStage(externalId, target); }
  catch (e: any) { result = { ok: false, error: e?.message || 'JobTread stage update failed' }; }
  await logWrite({
    actor, system: 'jobtread', action: 'set_stage', targetId: externalId,
    summary: `${summary} · JobTread ${before?.stage || '?'} → ${target}`, ok: result.ok, error: result.error || null,
  }).catch(() => {});
  if (result.ok) await db.update(leads).set({ stage: target }).where(eq(leads.externalId, externalId));
  return result;
}

export type SalesMoveResult =
  | { ok: true; row: SalesPipelineRow; moved: boolean; jobtread: { ok: boolean; error?: string }; automation: string[] }
  | { ok: false; status: number; error: string };

/**
 * Move a job on the sales board. `system` moves come from automation
 * (something happened that IS the gate) and skip the gate check; they also
 * don't cascade further, so two rules can't chase each other.
 */
export async function moveSalesStage(
  externalId: string,
  target: unknown,
  actor: string,
  opts: { system?: boolean; reason?: string; lostReason?: unknown; lostNote?: unknown } = {},
): Promise<SalesMoveResult> {
  if (!isSalesStage(target)) return { ok: false, status: 400, error: 'Unknown stage.' };
  const row = await ensureSalesRow(externalId, actor);
  const stage = isSalesStage(row.stage) ? row.stage : 'inspection';
  if (target === stage) return { ok: true, row, moved: false, jobtread: { ok: true }, automation: [] };
  const toLost = isSalesLost(target);
  // A person giving up on a deal has to say why; automation never marks one lost.
  if (toLost && !opts.system) {
    const why = lostReasonBlocker(opts.lostReason, opts.lostNote);
    if (why) return { ok: false, status: 400, error: why };
  }
  if (!opts.system) {
    const ctx = (await salesContexts([externalId])).get(externalId)!;
    const blocker = salesMoveBlocker(target, { stage, checks: row.checks || {}, history: row.history }, ctx);
    if (blocker) return { ok: false, status: 409, error: blocker };
  }
  const now = new Date();
  const by = opts.system ? `system: ${opts.reason || 'automation'}` : actor;
  const note = String(opts.lostNote ?? '').trim().slice(0, MAX_LOST_NOTE);
  const [updated] = await db.update(salesPipeline).set({
    stage: target, stageEnteredAt: now, updatedAt: now, updatedBy: actor,
    // A deal that came back was not lost: the old reason goes with it, or it
    // turns up in the next count of why deals die.
    lostReason: toLost ? (opts.lostReason as string | undefined) ?? null : null,
    lostNote: toLost ? (note || null) : null,
    history: [...(row.history || []), {
      stage: target, at: now.toISOString(), by,
      ...(toLost && opts.lostReason ? { reason: salesLostReasonLabel(opts.lostReason as string) } : {}),
    }].slice(-100),
  }).where(eq(salesPipeline.id, row.id)).returning();
  const jobtread = await mirrorToJobTread(externalId, target, actor, `sales ${labelOf(SALES_BOARD_STAGES, stage)} → ${labelOf(SALES_BOARD_STAGES, target)}`);
  let automation: string[] = [];
  if (!opts.system) {
    const { onSalesStage } = await import('../pipelines/automation');
    automation = await onSalesStage(externalId, target, actor);
  }
  return { ok: true, row: updated, moved: true, jobtread, automation };
}
