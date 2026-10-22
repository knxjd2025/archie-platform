import type { Express, Request, Response } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { leads, syncRuns } from '../../shared/schema';
import { requireRole } from '../auth/middleware';
import { asyncHandler } from '../lib/async-handler';
import { runAllSyncs, runRoofLinkSync } from './index';
import { effectiveRunStatus } from './run';
import { sendFailure } from '../lib/failure';

export function registerSyncRoutes(app: Express) {
  // asyncHandler matters here the same way it does on /api/sync/cron below —
  // Express 4 doesn't catch a rejected promise from an async handler, so a
  // throw before runAllSyncs's own per-source try/catch (e.g. the initial
  // syncRuns insert failing because the DB is unreachable) would hang the
  // request forever with no response.
  app.post('/api/sync/refresh', requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    const results = await runAllSyncs();
    res.json({ results });
  }));

  // Pull roles + reporting lines from JobTread. Admin only: it can change what
  // people are allowed to see.
  app.post('/api/sync/jobtread-roles', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const { pullFromJobTread } = await import('./jobtread-roles');
      res.json(await pullFromJobTread());
    } catch (e: any) {
      return sendFailure(res, e, 'POST /api/sync/jobtread-roles', 502, 'JobTread role sync failed');
    }
  });

  // Link team members to JobTread's Sales Rep dropdown by exact name and
  // report what JobTread has that the app doesn't (and vice versa).
  app.post('/api/sync/jobtread-reps', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const { syncSalesRepsFromJobTread } = await import('./jobtread-reps');
      res.json(await syncSalesRepsFromJobTread());
    } catch (e: any) {
      return sendFailure(res, e, 'POST /api/sync/jobtread-reps', 502, 'JobTread sales-rep sync failed');
    }
  });

  // RoofLink (the old CRM): pull its clients now, or check the key works.
  app.post('/api/sync/rooflink', requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    res.json(await runRoofLinkSync());
  }));
  app.get('/api/sync/rooflink/health', requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    const { RoofLinkClient } = await import('../integrations/rooflink');
    const [health, [imported]] = await Promise.all([
      new RoofLinkClient().healthCheck(),
      db.select({ n: sql<number>`count(*)` }).from(leads).where(eq(leads.source, 'rooflink')),
    ]);
    res.json({ ...health, importedLeads: Number(imported?.n ?? 0) });
  }));

  app.get('/api/sync/status', requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(20);
    const now = new Date();
    const runs = rows.map((r) => ({ ...r, ...effectiveRunStatus(r, now) }));
    res.json({ runs });
  }));

  // Cron trigger — protected by a shared secret (crons can't hold a session).
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` (matching server/routes/brain.ts's
  // proven pattern); `x-cron-secret` is also accepted so manual curls still work.
  // Fail closed: a missing/blank CRON_SECRET must never allow an unauthenticated match.
  const cronAuthed = (req: Request): boolean => {
    const secret = process.env.CRON_SECRET;
    return !!secret && (
      req.headers['authorization'] === `Bearer ${secret}` ||
      req.header('x-cron-secret') === secret
    );
  };
  app.get('/api/sync/cron', asyncHandler(async (req: Request, res: Response) => {
    if (!cronAuthed(req)) return res.status(401).json({ message: 'no' });
    const results = await runAllSyncs();
    res.json({ results });
  }));

  // RoofLink on its own schedule (see runRoofLinkSync for why).
  app.get('/api/sync/rooflink/cron', asyncHandler(async (req: Request, res: Response) => {
    if (!cronAuthed(req)) return res.status(401).json({ message: 'no' });
    res.json({ results: [await runRoofLinkSync()] });
  }));
}
