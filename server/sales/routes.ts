/**
 * The sales board — the sales pipeline (shared/sales-pipeline.ts) over the
 * leads table, one sales_pipeline row per job once it's moved here. Approved
 * opens the job on the production board; DP Received moves it to
 * Pre-Production there (and stamps the deposit). Rep-scoped like leads.
 */
import type { Express, Request, Response } from 'express';
import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leads, salesPipeline, type SalesPipelineRow } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { repLeadWhere, ownsLead, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { SALES_PIPELINE_STAGES, SALES_BOARD_STAGES, SALES_STAGE_CHECKS, SALES_CHECK_KEYS, SALES_BAND, salesMoveBlocker } from '../../shared/sales-pipeline';
import { nextOf } from '../../shared/pipeline-core';
import { salesSnapshot as snapshot, salesContexts as contexts, ensureSalesRow as ensureRow, moveSalesStage } from './store';

export function registerSalesRoutes(app: Express) {
  app.get('/api/sales', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user!;
    const includeDone = req.query.all === 'true';
    const tracked = db.select({ id: salesPipeline.jobExternalId }).from(salesPipeline);
    const bandScope = or(inArray(leads.stage, SALES_BAND), inArray(leads.externalId, tracked)) as SQL;
    const repScope = await repLeadWhere(user);
    const where = repScope ? (and(bandScope, repScope) as SQL) : bandScope;
    const rows = await db.select().from(leads).where(where);
    const ids = rows.map((r) => r.externalId).filter((id): id is string => !!id);

    const [pipes, ctxs] = await Promise.all([
      ids.length ? db.select().from(salesPipeline).where(inArray(salesPipeline.jobExternalId, ids)) : Promise.resolve([] as SalesPipelineRow[]),
      contexts(ids),
    ]);
    const byId = new Map(pipes.map((p) => [p.jobExternalId, p]));

    const jobs = [];
    for (const r of rows) {
      if (!r.externalId) continue;
      const ctx = ctxs.get(r.externalId)!;
      const pipeline = snapshot(byId.get(r.externalId), r.stage, ctx.productionStage);
      if (!pipeline) continue;
      if (pipeline.done && !includeDone) continue;
      const next = nextOf(SALES_PIPELINE_STAGES, pipeline.stage);
      jobs.push({
        externalId: r.externalId,
        customer: [r.firstName, r.lastName].filter((x) => x && x !== 'null').join(' ').trim() || r.jobName,
        jobName: r.jobName,
        phone: r.phone, email: r.email, address: r.address, city: r.city,
        jtStage: r.stage, repName: r.jtSalesRep, source: r.source,
        projectedValue: r.projectedValue != null ? Number(r.projectedValue) : null,
        insuranceClaim: !!r.insuranceClaim,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
        pipeline,
        gates: { reportGenerated: ctx.reportGenerated, productionStage: ctx.productionStage, reports: ctx.reports },
        nextBlocker: next ? salesMoveBlocker(next, pipeline, ctx) : null,
      });
    }
    res.json({ stages: SALES_BOARD_STAGES, checks: SALES_STAGE_CHECKS, jobs });
  }));

  const guard = async (req: Request, res: Response): Promise<string | null> => {
    const { externalId } = req.params;
    if (!externalId) { res.status(400).json({ error: 'externalId is required' }); return null; }
    if (!(await ownsLead(req.session.user! as SessionUser, externalId))) { res.status(404).json({ error: 'not found' }); return null; }
    return externalId;
  };

  app.post('/api/sales/:externalId/stage', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = await guard(req, res); if (!id) return;
    const r = await moveSalesStage(id, req.body?.stage, req.session.user!.email, {
      lostReason: req.body?.lostReason, lostNote: req.body?.lostNote,
    });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    const after = (await contexts([id])).get(id)!;
    res.json({ ok: true, pipeline: snapshot(r.row, null, after.productionStage), jobtread: r.jobtread, automation: r.automation });
  }));

  app.post('/api/sales/:externalId/check', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = await guard(req, res); if (!id) return;
    const key = req.body?.key;
    if (typeof key !== 'string' || !SALES_CHECK_KEYS.has(key)) return res.status(400).json({ error: 'Unknown check.' });
    const actor = req.session.user!.email;
    const row = await ensureRow(id, actor);
    const checks = { ...(row.checks || {}), [key]: req.body?.value === true };
    const [updated] = await db.update(salesPipeline).set({ checks, updatedAt: new Date(), updatedBy: actor }).where(eq(salesPipeline.id, row.id)).returning();
    res.json({ ok: true, pipeline: snapshot(updated, null, null) });
  }));
}
