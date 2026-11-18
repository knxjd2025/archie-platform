/**
 * The seed backfill cron. Seeding is never on the request path (api/index.ts):
 * a company is seeded when it is created, and this job seeds any live company
 * not yet seeded for the current deployment's definitions.
 */
import type { Express, Request, Response } from 'express';
import { asyncHandler } from './lib/async-handler';
import { timingSafeEqualStr } from './security-config';
import { runCompanyJob } from './tenant/fan-out';
import { seedCompaniesJob } from './seed';

const cronAuthorized = (req: Request): boolean =>
  !!process.env.CRON_SECRET && timingSafeEqualStr(String(req.headers['authorization'] || ''), `Bearer ${process.env.CRON_SECRET}`);

export function registerSeedRoutes(app: Express) {
  app.get('/api/cron/seed-companies', asyncHandler(async (req: Request, res: Response) => {
    if (!cronAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
    res.json(await runCompanyJob(seedCompaniesJob()));
  }));
}
