import type { Express, Request, Response } from 'express';
import { and, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leads, finalWalkthroughs, productionPipeline } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { repLeadWhere, ownsLead, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { PRODUCTION_STAGES } from './columns';
import { latestWalkthroughByJob, walkthroughSummary, type WalkthroughSummary } from './walkthrough-status';
import { PIPELINE_STAGES, TRADES, STAGE_CHECKS, moveBlocker, nextStage, type GateContext } from '../../shared/production-pipeline';
import { snapshotFor, gateContexts, pipelineRows, moveStage, setTrades, completeTrade, setCheck, pipelineHistory, type PipelineSnapshot } from './pipeline';

export interface ProductionJob {
  externalId: string | null;
  customer: string | null;
  jobName: string | null;
  jobNumber: string | null;
  /** JobTread's own status, for reference on the card. */
  jtStage: string | null;
  projectManager: string | null;
  repName: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  projectedValue: number | null;
  insuranceClaim: boolean;
  pipeline: PipelineSnapshot;
  gates: GateContext;
  /** Why the job can't advance to the next stage yet; null when it can (or it's the last stage). */
  nextBlocker: string | null;
  /** Final walkthrough state for the card (walkthrough-status.ts); null before it is expected. */
  walkthrough: WalkthroughSummary | null;
}

// Which pipeline stages expect a walkthrough chip on the card.
const WALKTHROUGH_COLUMN: Record<string, 'in_production' | 'wrapping' | 'closed' | null> = {
  install: 'in_production', final_walkthrough: 'wrapping', final_invoice: 'wrapping', final_payment: 'wrapping',
  warranty: 'wrapping', closed_out: 'closed',
};

export function registerProductionRoutes(app: Express) {
  // The production board: every job in the production band of JobTread's
  // status, plus any job with a pipeline row, placed on the app's own
  // eleven-stage pipeline. Rep-scoped for sales users.
  app.get('/api/production', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user!;
    const includeClosed = req.query.all === 'true';
    const tracked = db.select({ id: productionPipeline.jobExternalId }).from(productionPipeline);
    // "Insurance Approved" is the carrier's go-ahead on a claim job — it belongs
    // in Approved here even though the sales-side stage set doesn't count it.
    const band = [...PRODUCTION_STAGES, 'Insurance Approved'].filter((s) => includeClosed || s !== 'Closed');
    const bandScope = or(inArray(leads.stage, band), inArray(leads.externalId, tracked)) as SQL;
    const repScope = await repLeadWhere(user);
    const where = repScope ? (and(bandScope, repScope) as SQL) : bandScope;
    const rows = await db.select().from(leads).where(where);
    const ids = rows.map((r) => r.externalId).filter((id): id is string => !!id);

    const [pipes, gates] = await Promise.all([pipelineRows(ids), gateContexts(ids)]);

    // Newest final walkthrough per job on the board, in one query. A
    // walkthrough lookup failure must not blank the whole board.
    let latest = new Map<string, ReturnType<typeof latestWalkthroughByJob> extends Map<string, infer V> ? V : never>();
    if (ids.length) {
      try {
        const wt = await db.select({
          jobExternalId: finalWalkthroughs.jobExternalId, status: finalWalkthroughs.status, issueCount: finalWalkthroughs.issueCount,
          submittedAt: finalWalkthroughs.submittedAt, createdAt: finalWalkthroughs.createdAt,
        }).from(finalWalkthroughs).where(inArray(finalWalkthroughs.jobExternalId, ids));
        latest = latestWalkthroughByJob(wt);
      } catch (e: any) {
        console.error('[production] walkthrough lookup failed:', e?.message || e);
      }
    }

    const jobs: ProductionJob[] = [];
    for (const r of rows) {
      const pipeline = snapshotFor(r.externalId ? pipes.get(r.externalId) : undefined, r.stage);
      if (!pipeline || !r.externalId) continue;
      // Closed-out jobs stay off the board unless asked for — hundreds of
      // finished jobs would bury the fifteen that need someone today.
      if (pipeline.stage === 'closed_out' && !includeClosed) continue;
      const g = gates.get(r.externalId) || { preconSubmitted: false, walkthroughSubmitted: false };
      const next = nextStage(pipeline.stage);
      jobs.push({
        externalId: r.externalId,
        customer: r.firstName,
        jobName: r.jobName,
        jobNumber: r.jobNumber,
        jtStage: r.stage,
        projectManager: r.projectManager,
        repName: r.jtSalesRep,
        scheduleStart: r.scheduleStart ? r.scheduleStart.toISOString() : null,
        scheduleEnd: r.scheduleEnd ? r.scheduleEnd.toISOString() : null,
        projectedValue: r.projectedValue != null ? Number(r.projectedValue) : null,
        insuranceClaim: !!r.insuranceClaim,
        pipeline,
        gates: g,
        nextBlocker: next ? moveBlocker(next, pipeline, g) : null,
        walkthrough: walkthroughSummary(WALKTHROUGH_COLUMN[pipeline.stage] ?? null, latest.get(r.externalId)),
      });
    }

    res.json({ stages: PIPELINE_STAGES, trades: TRADES, checks: STAGE_CHECKS, jobs });
  }));

  const guard = async (req: Request, res: Response): Promise<string | null> => {
    const { externalId } = req.params;
    if (!externalId) { res.status(400).json({ error: 'externalId is required' }); return null; }
    if (!(await ownsLead(req.session.user! as SessionUser, externalId))) { res.status(404).json({ error: 'not found' }); return null; }
    return externalId;
  };

  // Move a job along the pipeline. Gated (409 with the reason) and mirrored
  // to JobTread's status best-effort — a JobTread outage never blocks the crew.
  app.post('/api/production/:externalId/pipeline/stage', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = await guard(req, res); if (!id) return;
    const r = await moveStage(id, req.body?.stage, req.session.user!.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, pipeline: snapshotFor(r.row, null), jobtread: r.jobtread });
  }));

  // Which trades this job includes (site order is enforced server-side).
  app.post('/api/production/:externalId/pipeline/trades', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = await guard(req, res); if (!id) return;
    const row = await setTrades(id, req.body?.trades, req.session.user!.email);
    res.json({ ok: true, pipeline: snapshotFor(row, null) });
  }));

  // The crew finished the trade they're on.
  app.post('/api/production/:externalId/pipeline/trade-done', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = await guard(req, res); if (!id) return;
    const r = await completeTrade(id, req.body?.trade, req.session.user!.email);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, completed: r.completed, pipeline: snapshotFor(r.row, null), jobtread: r.jobtread });
  }));

  // Tick / untick one of a stage's boxes (invoice sent, review requested, …).
  app.post('/api/production/:externalId/pipeline/check', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = await guard(req, res); if (!id) return;
    const row = await setCheck(id, req.body?.key, req.body?.value, req.session.user!.email);
    if (!row) return res.status(400).json({ error: 'Unknown check.' });
    res.json({ ok: true, pipeline: snapshotFor(row, null) });
  }));

  app.get('/api/production/:externalId/pipeline/history', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = await guard(req, res); if (!id) return;
    res.json({ history: await pipelineHistory(id) });
  }));
}
