/**
 * Claim pipeline moves (rules: shared/claims-pipeline.ts). Used by the board
 * routes and by pipelines/automation.ts.
 */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import { claims, clientReports, leads } from '../../shared/schema';
import { logWrite } from '../writes/log';
import { JobTreadClient } from '../integrations/jobtread';
import {
  CLAIM_NEXT_ACTION, CLAIM_DUE_DAYS, isClaimPipelineStage, freshDisputeSteps, claimMoveBlocker, jobtreadStatusForClaim, LEGACY_CLAIM_STAGE,
  type ClaimGateContext,
} from '../../shared/claims-pipeline';

export type ClaimRow = typeof claims.$inferSelect;

/**
 * Rows that predate the pipeline may still carry an old key. Own keys only: a
 * stage of 'constructor' read Object's constructor function off the map and
 * handed it back as the claim's stage.
 */
export const claimStageOf = (c: ClaimRow): string =>
  isClaimPipelineStage(c.stage) ? c.stage : (Object.hasOwn(LEGACY_CLAIM_STAGE, c.stage) ? LEGACY_CLAIM_STAGE[c.stage] : 'file_claim');
export const claimStepsOf = (c: ClaimRow) => (Array.isArray(c.disputeSteps) && c.disputeSteps.length ? freshDisputeSteps(c.disputeSteps) : freshDisputeSteps());

/** Which claims have a generated inspection report (the adjuster gate), and their JobTread statuses. */
export async function claimContexts(rows: ClaimRow[]): Promise<{ ctx: Map<number, ClaimGateContext>; jt: Map<string, string | null> }> {
  const ids = rows.map((r) => r.jobtreadJobId).filter((x): x is string => !!x);
  const reported = new Set<string>();
  const jt = new Map<string, string | null>();
  if (ids.length) {
    const [reps, lds] = await Promise.all([
      db.select({ id: clientReports.jobExternalId }).from(clientReports)
        .where(and(inArray(clientReports.jobExternalId, ids), eq(clientReports.status, 'succeeded'), sql`lower(coalesce(${clientReports.reportType}, '')) like '%inspection%'`)),
      db.select({ id: leads.externalId, stage: leads.stage }).from(leads).where(inArray(leads.externalId, ids)),
    ]);
    for (const r of reps) reported.add(r.id);
    for (const l of lds) if (l.id) jt.set(l.id, l.stage);
  }
  const ctx = new Map<number, ClaimGateContext>();
  for (const r of rows) ctx.set(r.id, { inspectionReport: !!r.jobtreadJobId && reported.has(r.jobtreadJobId) });
  return { ctx, jt };
}

/** The open claim for a JobTread job, if any. */
export async function openClaimForJob(externalId: string): Promise<ClaimRow | undefined> {
  const [row] = await db.select().from(claims).where(and(eq(claims.jobtreadJobId, externalId), ne(claims.stage, 'closed'))).orderBy(desc(claims.updatedAt)).limit(1);
  return row;
}

/** Best-effort JobTread status write for a claim with a linked job. */
export async function mirrorClaimToJobTread(c: ClaimRow, stage: string, actor: string, summary: string): Promise<{ ok: boolean; error?: string }> {
  if (!c.jobtreadJobId) return { ok: true };
  const target = jobtreadStatusForClaim(stage, claimStepsOf({ ...c, stage }));
  if (!target) return { ok: true };
  const [before] = await db.select({ stage: leads.stage }).from(leads).where(eq(leads.externalId, c.jobtreadJobId));
  if (before?.stage === target) return { ok: true };
  let result: { ok: boolean; error?: string };
  try { result = await new JobTreadClient().setJobStage(c.jobtreadJobId, target); }
  catch (e: any) { result = { ok: false, error: e?.message || 'JobTread stage update failed' }; }
  await logWrite({
    actor, system: 'jobtread', action: 'set_stage', targetId: c.jobtreadJobId,
    summary: `${summary} · JobTread ${before?.stage || '?'} → ${target}`, ok: result.ok, error: result.error || null,
  }).catch(() => {});
  if (result.ok) await db.update(leads).set({ stage: target }).where(eq(leads.externalId, c.jobtreadJobId));
  return result;
}

export type ClaimMoveResult =
  | { ok: true; row: ClaimRow; moved: boolean; jobtread: { ok: boolean; error?: string }; automation: string[] }
  | { ok: false; status: number; error: string };

/**
 * Move a claim. Resets the next action to the new stage's default and the
 * clock the ops-brain rules count from. `system` moves (automation) skip
 * the gate and don't cascade.
 */
export async function moveClaimStage(c: ClaimRow, target: unknown, actor: string, opts: { system?: boolean; reason?: string } = {}): Promise<ClaimMoveResult> {
  if (!isClaimPipelineStage(target)) return { ok: false, status: 400, error: 'Unknown stage.' };
  const stage = claimStageOf(c);
  if (target === stage) return { ok: true, row: c, moved: false, jobtread: { ok: true }, automation: [] };
  if (!opts.system) {
    const { ctx } = await claimContexts([c]);
    const blocker = claimMoveBlocker(target, { stage, disputeSteps: claimStepsOf(c), checks: c.checks || {} }, ctx.get(c.id)!);
    if (blocker) return { ok: false, status: 409, error: blocker };
  }
  const now = new Date();
  const by = opts.system ? `system: ${opts.reason || 'automation'}` : actor;
  const [row] = await db.update(claims).set({
    stage: target,
    stageEnteredAt: now, updatedAt: now,
    nextAction: CLAIM_NEXT_ACTION[target],
    nextActionDue: new Date(now.getTime() + (CLAIM_DUE_DAYS[target] ?? 7) * 864e5),
    history: [...(c.history || []), { stage: target, at: now.toISOString(), by }].slice(-100),
  }).where(eq(claims.id, c.id)).returning();
  const jobtread = await mirrorClaimToJobTread(row, target, actor, `claim ${stage} → ${target}`);
  let automation: string[] = [];
  if (!opts.system && row.jobtreadJobId) {
    const { onClaimStage } = await import('../pipelines/automation');
    automation = await onClaimStage(row.jobtreadJobId, target, actor);
  }
  return { ok: true, row, moved: true, jobtread, automation };
}
