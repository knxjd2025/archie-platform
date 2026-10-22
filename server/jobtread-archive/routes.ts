/**
 * The JobTread archive: status, a manual run, re-running one step, and the
 * cron that keeps going until it is finished. Admin only — it is the whole
 * company's history.
 */
import type { Express, Request, Response } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { asyncHandler } from '../lib/async-handler';
import { timingSafeEqualStr } from '../security-config';
import { db } from '../db';
import { archiveStatus, resetStep, runArchiveChunk } from './runner';

/** The function is capped at 300s; leave room to save progress and answer. */
const RUN_BUDGET_MS = 240_000;

// Constant-time, so a guess at the secret cannot be refined from how long a
// refusal takes — the same check the other crons already make.
export function cronAuthed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return timingSafeEqualStr(String(req.headers['authorization'] || ''), `Bearer ${secret}`)
    || timingSafeEqualStr(String(req.header('x-cron-secret') || ''), secret);
}

// One run at a time. An in-memory flag only covered one server instance —
// on Vercel each invocation may be its own instance, so the cron and a "Run
// now" could both walk the same steps. JobTread is read-only here, so an
// overlap only duplicates work, but there is no reason to pay for it.
//
// The lock is Postgres's, held by an open transaction on a connection of its
// own: DATABASE_URL is Supabase's transaction pooler, which does not keep a
// session-level lock (pg_try_advisory_lock) on one backend between
// statements, so the transaction-scoped form is the one that holds. If the
// function is killed the connection drops and Postgres releases the lock.
const ARCHIVE_LOCK_KEY = 7_204_311; // arbitrary, unique to this job

async function runOnce() {
  const client = await db.$client.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [ARCHIVE_LOCK_KEY]);
    if (!rows[0]?.locked) return { busy: true as const };
    return await runArchiveChunk(RUN_BUDGET_MS);
  } finally {
    // COMMIT is what lets the lock go; a connection that cannot commit is
    // thrown away rather than returned to the pool still holding it.
    try { await client.query('COMMIT'); } catch { broken = true; }
    client.release(broken);
  }
}

export function registerJobtreadArchiveRoutes(app: Express) {
  app.get('/api/jobtread-archive/status', requireAuth, requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    res.json(await archiveStatus());
  }));

  app.post('/api/jobtread-archive/run', requireAuth, requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    const run = await runOnce();
    res.json({ run, status: await archiveStatus() });
  }));

  app.post('/api/jobtread-archive/reset/:step', requireAuth, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    if (!(await resetStep(req.params.step))) return res.status(400).json({ error: 'Unknown step.' });
    res.json(await archiveStatus());
  }));

  // Every 10 minutes until the archive is complete; after that it just reports done.
  app.get('/api/jobtread-archive/cron', asyncHandler(async (req: Request, res: Response) => {
    if (!cronAuthed(req)) return res.status(401).json({ message: 'no' });
    if (process.env.JOBTREAD_ARCHIVE === 'off') return res.json({ skipped: 'JOBTREAD_ARCHIVE=off' });
    const before = await archiveStatus();
    if (before.finished) return res.json({ finished: true });
    res.json({ run: await runOnce() });
  }));
}
