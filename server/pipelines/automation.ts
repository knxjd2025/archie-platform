/**
 * Cross-pipeline automation: something happened on one board (or in a
 * checklist, a report, a JobTread proposal, or JobTread's own status) and the
 * other boards move to match. Decisions are pure (automation-rules.ts); this
 * file gathers where the job sits, applies the effects as `system` moves
 * (gate-free, non-cascading), and never throws into the caller — a failed
 * cascade is logged, the triggering action still succeeds.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db';
import { leads, productionPipeline, salesPipeline, claims } from '../../shared/schema';
import { stageLabel as productionLabel, isPipelineStage as isProductionStage } from '../../shared/production-pipeline';
import { SALES_PIPELINE_STAGES } from '../../shared/sales-pipeline';
import { CLAIM_PIPELINE_STAGES } from '../../shared/claims-pipeline';
import { labelOf } from '../../shared/pipeline-core';
import * as rules from './automation-rules';
import type { Effect, Positions } from './automation-rules';
import { moveStage as moveProduction, ensureRow as ensureProductionRow } from '../production/pipeline';
import { moveSalesStage, ensureSalesRow } from '../sales/store';
import { moveClaimStage, openClaimForJob, claimStageOf } from '../claims/store';

const SYSTEM = 'system:automation';

export async function positionsFor(externalId: string): Promise<Positions> {
  const [[prod], [sale], claim] = await Promise.all([
    db.select({ stage: productionPipeline.stage }).from(productionPipeline).where(eq(productionPipeline.jobExternalId, externalId)),
    db.select({ stage: salesPipeline.stage }).from(salesPipeline).where(eq(salesPipeline.jobExternalId, externalId)),
    openClaimForJob(externalId),
  ]);
  return {
    productionStage: prod && isProductionStage(prod.stage) ? prod.stage : null,
    salesStage: sale?.stage ?? null,
    claimStage: claim ? claimStageOf(claim) : null,
  };
}

function describe(e: Effect): string {
  const label = e.pipeline === 'production' ? productionLabel(e.to as any)
    : e.pipeline === 'sales' ? labelOf(SALES_PIPELINE_STAGES, e.to)
    : labelOf(CLAIM_PIPELINE_STAGES, e.to);
  const board = e.pipeline === 'production' ? 'Production' : e.pipeline === 'sales' ? 'Sales' : 'Claim';
  return `${board} → ${label} (${e.reason})`;
}

/** What a move made by automation should itself cause — one more round, never deeper. */
function followOn(e: Effect, p: Positions): Effect[] {
  if (e.pipeline === 'production') return rules.effectsOfProductionStage(e.to, p);
  if (e.pipeline === 'sales') return rules.effectsOfSalesStage(e.to, p);
  return rules.effectsOfClaimStage(e.to, p);
}

/**
 * Apply effects as system moves. Returns a line per move actually made. A
 * move made here gets one follow-on round (a walkthrough moves Production to
 * Final Invoice, which moves the claim to depreciation) and no more, so two
 * rules can never chase each other.
 */
export async function applyEffects(externalId: string, effects: Effect[], actor: string, depth = 0): Promise<string[]> {
  const done: string[] = [];
  for (const e of effects) {
    try {
      let moved = false;
      if (e.pipeline === 'production') {
        if (e.to === 'approved') { await ensureProductionRow(externalId, `${SYSTEM}:${actor}`); moved = true; }
        else { const r = await moveProduction(externalId, e.to, actor, { system: true, reason: e.reason }); moved = r.ok && r.moved; }
      } else if (e.pipeline === 'sales') {
        const r = await moveSalesStage(externalId, e.to, actor, { system: true, reason: e.reason });
        moved = r.ok && r.moved;
      } else {
        const claim = await openClaimForJob(externalId);
        if (!claim) continue;
        const r = await moveClaimStage(claim, e.to, actor, { system: true, reason: e.reason });
        moved = r.ok && r.moved;
      }
      if (!moved) continue;
      done.push(describe(e));
      if (depth === 0) done.push(...(await applyEffects(externalId, followOn(e, await positionsFor(externalId)), actor, 1)));
    } catch (err: any) {
      console.error(`[pipelines] automation failed for ${externalId} (${e.pipeline} → ${e.to}):`, err?.message || err);
    }
  }
  return done;
}

const safe = async (label: string, fn: () => Promise<string[]>): Promise<string[]> => {
  try { return await fn(); }
  catch (e: any) { console.error(`[pipelines] ${label} failed:`, e?.message || e); return []; }
};

export const onProductionStage = (id: string, stage: string, actor: string) =>
  safe('onProductionStage', async () => applyEffects(id, rules.effectsOfProductionStage(stage, await positionsFor(id)), actor));

export const onSalesStage = (id: string, stage: string, actor: string) =>
  safe('onSalesStage', async () => applyEffects(id, rules.effectsOfSalesStage(stage, await positionsFor(id)), actor));

export const onClaimStage = (id: string, stage: string, actor: string) =>
  safe('onClaimStage', async () => applyEffects(id, rules.effectsOfClaimStage(stage, await positionsFor(id)), actor));

export const onPreconSubmitted = (id: string, actor: string) =>
  safe('onPreconSubmitted', async () => {
    // The checklist is filled when the deposit is collected — the job belongs on the production board from here.
    await ensureProductionRow(id, `${SYSTEM}:${actor}`);
    return applyEffects(id, rules.effectsOfPreconSubmitted(await positionsFor(id)), actor);
  });

export const onWalkthroughSubmitted = (id: string, actor: string) =>
  safe('onWalkthroughSubmitted', async () => applyEffects(id, rules.effectsOfWalkthroughSubmitted(await positionsFor(id)), actor));

export const onReportGenerated = (id: string, reportType: string | null, actor: string) =>
  safe('onReportGenerated', async () => {
    const p = await positionsFor(id);
    // A job with no sales row yet still gets one: the report is the sales pipeline's second step.
    if (!p.salesStage) { const row = await ensureSalesRow(id, `${SYSTEM}:${actor}`); p.salesStage = row.stage; }
    return applyEffects(id, rules.effectsOfReportGenerated(reportType, p), actor);
  });

export const onReportPresented = (id: string, actor: string) =>
  safe('onReportPresented', async () => {
    const p = await positionsFor(id);
    if (!p.salesStage) { const row = await ensureSalesRow(id, `${SYSTEM}:${actor}`); p.salesStage = row.stage; }
    return applyEffects(id, rules.effectsOfReportPresented(p), actor);
  });

export const onProposalSigned = (id: string, actor: string) =>
  safe('onProposalSigned', async () => {
    const p = await positionsFor(id);
    if (!p.salesStage) { const row = await ensureSalesRow(id, `${SYSTEM}:${actor}`); p.salesStage = row.stage; }
    return applyEffects(id, rules.effectsOfProposalSigned(p), actor);
  });

/**
 * After the hourly JobTread pull: any board row sitting behind JobTread's
 * status follows it forward. Someone moving a job in JobTread is a real move.
 */
export async function reconcileWithJobTread(): Promise<{ checked: number; moved: number }> {
  const [prodRows, salesRows] = await Promise.all([
    db.select({ id: productionPipeline.jobExternalId, stage: productionPipeline.stage }).from(productionPipeline).where(ne(productionPipeline.stage, 'closed_out')),
    db.select({ id: salesPipeline.jobExternalId, stage: salesPipeline.stage }).from(salesPipeline).where(ne(salesPipeline.stage, 'reviews_referrals')),
  ]);
  const ids = Array.from(new Set([...prodRows.map((r) => r.id), ...salesRows.map((r) => r.id)]));
  if (!ids.length) return { checked: 0, moved: 0 };
  const jt = new Map((await db.select({ id: leads.externalId, stage: leads.stage }).from(leads).where(and(inArray(leads.externalId, ids), eq(leads.source, 'jobtread')))).map((l) => [l.id!, l.stage]));
  const prodBy = new Map(prodRows.map((r) => [r.id, r.stage]));
  const salesBy = new Map(salesRows.map((r) => [r.id, r.stage]));
  let moved = 0;
  for (const id of ids) {
    if (!jt.has(id)) continue;
    const p: Positions = { productionStage: prodBy.get(id) ?? null, salesStage: salesBy.get(id) ?? null, claimStage: null };
    const effects = rules.effectsOfJobtreadStatus(jt.get(id) ?? null, p);
    if (effects.length) moved += (await applyEffects(id, effects, 'system:jobtread-sync')).length;
  }
  return { checked: ids.length, moved };
}

// Keep the claims import referenced for the claim-side helper below.
export async function claimStageForJob(externalId: string): Promise<string | null> {
  const [c] = await db.select({ stage: claims.stage }).from(claims).where(and(eq(claims.jobtreadJobId, externalId), ne(claims.stage, 'closed'))).limit(1);
  return c?.stage ?? null;
}
