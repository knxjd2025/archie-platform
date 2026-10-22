import { Router } from 'express';
import { db } from '../db';
import { brainRuns, claims } from '../../shared/schema';
import { eq, ne, gte, and, isNull, lt, sql } from 'drizzle-orm';
import { checkAndRunDueCampaigns, sendScheduledEmails } from '../outreach/outreach-scheduler';
import { runIngest, commitCursors, planCursorCommits } from '../brain/ingest';
import { processControlEvents } from '../brain/sms-control';
import { triageEvents, applyTriage } from '../brain/triage';
import { sweepClaims } from '../brain/claims';
import { sweepCalendar } from '../brain/calendar-brain';
import { actOnLoops } from '../brain/actor';
import { getOpenLoops, upsertLoop } from '../brain/loop-store';
import { backlogLoop, type BacklogKind } from '../brain/backlog';
import { buildDigest, unfinishedRunErrors, STALE_RUN_MS } from '../brain/digest';
import { sendGhlEmail } from '../brain/ghl-brain';
import { failStaleReports } from '../reports/routes';
import type { BrainEvent } from '../brain/types';

// The function is killed at 300s (vercel.json maxDuration). Triage starts no
// new batch after TRIAGE_BUDGET_MS — a batch in flight can still take up to
// LLM_TIMEOUT_MS — and the actor stops at ACT_BUDGET_MS, leaving room to save
// cursors and the run row. Whatever is left waits for the next hourly sweep.
const TRIAGE_BUDGET_MS = 120_000;
const ACT_BUDGET_MS = 230_000;
const TRIAGE_CONCURRENCY = 3;

/** One digest-only loop for the lot — see backlogLoop. */
async function parkBacklog(kind: BacklogKind, events: BrainEvent[], now: Date): Promise<void> {
  const loop = backlogLoop(kind, events, now);
  if (loop) await upsertLoop(loop);
}

const router = Router();
const ADMIN_CONTACT_ID = 'RJbLTbR2HjboQdaoxaih'; // admin@bestroofingnow.com in GHL

function authorized(req: { headers: Record<string, unknown> }): boolean {
  if (!process.env.CRON_SECRET) return false;
  return req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
}

router.get('/cron/brain-sweep', async (req, res) => {
  if (!authorized(req as any)) return res.status(401).json({ error: 'unauthorized' });
  const now = new Date();
  const startedAt = Date.now();
  // Everything after the auth check lives inside this try so a thrown error
  // (including the initial insert below) always yields a 500 response instead
  // of Express 4 silently dropping an unhandled async rejection.
  let runId: number | undefined;
  try {
    // Bare .returning() (no column projection) — the inserted row's id is read
    // off the array instead of a typed `.returning({ id: brainRuns.id })`.
    const [run] = await db.insert(brainRuns).values({ kind: 'sweep' }).returning();
    runId = run.id;
    const { events, jobtreadLoops, cursors, errors } = await runIngest(now);
    // Team control replies ("DONE 12", "SNOOZE 12 2d") ride the GHL ingest — apply
    // them and keep them away from triage before anything else sees the batch.
    const { remaining, handled: controlHandled } = await processControlEvents(events);
    const { decisions, failed, failureMessages, deferred } = await triageEvents(remaining, {
      deadline: startedAt + TRIAGE_BUDGET_MS, concurrency: TRIAGE_CONCURRENCY,
    });
    const { opened, closed, skipped } = await applyTriage(decisions, now, remaining);
    // Events the sweep ran out of time for are not parked: each cursor is held
    // back to just before the oldest of them, so the next sweep reads them
    // again. Parking them one loop each, then moving the cursor past, turned a
    // backlog into a text to James per event and never triaged any of them.
    const { commits, unheld } = planCursorCommits(cursors, deferred);
    // A batch that blew up is not retried (the same events would likely blow
    // it up again every hour), and an untriaged event with no position to hold
    // a cursor at is past for good — both go into one digest-only loop each,
    // never one loop (and one nudge) per event.
    await parkBacklog('triage-failed', failed, now);
    await parkBacklog('not-triaged', unheld, now);
    if (failed.length > 0) {
      errors.push({
        source: 'triage',
        message: `${failed.length} event(s) failed triage and were parked for manual review — ${failureMessages.join(' | ')}`,
      });
    }
    if (deferred.length > 0) {
      errors.push({ source: 'triage', message: `${deferred.length} event(s) left untriaged at the time budget — ${deferred.length - unheld.length} kept for the next sweep, ${unheld.length} parked for manual review` });
    }
    // Saved only now, so a sweep killed before this line re-reads its events
    // next hour instead of losing them; re-applying is harmless, loops are
    // upserted by dedupe key.
    await commitCursors(commits);
    // JobTread findings are deterministic — straight to loops, no LLM.
    let jtOpened = 0;
    for (const loop of jobtreadLoops) {
      if ((await upsertLoop(loop)).created) jtOpened++;
    }
    const claimsOpened = await sweepClaims(now);
    // Calendar findings are deterministic (no LLM) and self-contained — a Google
    // Calendar outage must not sink the rest of the sweep.
    let calOpened = 0; let calClosed = 0;
    try {
      const cal = await sweepCalendar(now);
      calOpened = cal.opened; calClosed = cal.closed;
      for (const msg of cal.errors) errors.push({ source: 'calendar', message: msg });
    } catch (e: any) {
      errors.push({ source: 'calendar', message: String(e?.message ?? e).slice(0, 200) });
    }
    const acted = await actOnLoops(now, { deadline: startedAt + ACT_BUDGET_MS });
    // Piggybacks on the hourly sweep rather than a setInterval — this app has
    // no persistent process in production (Vercel serverless), so a report
    // stuck 'running' for a client nobody revisits had nothing to clean it up.
    try {
      await failStaleReports();
    } catch (e: any) {
      errors.push({ source: 'stale-reports', message: String(e?.message ?? e).slice(0, 200) });
    }
    await db.update(brainRuns).set({
      finishedAt: new Date(), eventsSeen: events.length + jobtreadLoops.length,
      loopsOpened: opened + jtOpened + claimsOpened + calOpened, loopsClosed: closed + calClosed, errors,
    }).where(eq(brainRuns.id, run.id));
    res.json({ ok: true, events: events.length, jobtreadFindings: jobtreadLoops.length, controlHandled, opened: opened + jtOpened + claimsOpened + calOpened, closed: closed + calClosed, skipped, parked: failed.length + unheld.length, deferredToNextSweep: deferred.length - unheld.length, ...acted, errors });
  } catch (e: any) {
    if (runId !== undefined) {
      await db.update(brainRuns).set({ finishedAt: new Date(), errors: [{ source: 'sweep', message: String(e?.message ?? e) }] }).where(eq(brainRuns.id, runId));
    }
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get('/cron/brain-digest', async (req, res) => {
  if (!authorized(req as any)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const loops = await getOpenLoops();
    const claimRows = await db.select().from(claims).where(ne(claims.stage, 'closed'));
    // brain_runs.errors was written every sweep but never read anywhere — a
    // persistent failure (e.g. an expired GHL_PIT_TOKEN) accumulated silently.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentRuns = await db.select({ errors: brainRuns.errors }).from(brainRuns)
      .where(and(gte(brainRuns.startedAt, since), sql`jsonb_array_length(${brainRuns.errors}) > 0`));
    // A killed sweep never writes its errors (or its finishedAt) — surface
    // those too, or a sweep dying every hour reads as all clear.
    const unfinished = await db.select({ id: brainRuns.id, startedAt: brainRuns.startedAt, finishedAt: brainRuns.finishedAt }).from(brainRuns)
      .where(and(eq(brainRuns.kind, 'sweep'), gte(brainRuns.startedAt, since), isNull(brainRuns.finishedAt), lt(brainRuns.startedAt, new Date(Date.now() - STALE_RUN_MS))));
    const recentErrors = [
      ...unfinishedRunErrors(unfinished, new Date()),
      ...recentRuns.flatMap((r) => (r.errors as any[]) ?? []),
    ].slice(0, 20);
    const digest = buildDigest(loops as any, claimRows as any, recentErrors);
    // The digest is an internal email to James/admin, not a customer-facing action —
    // it must send even during BRAIN_DRY_RUN (rollout step 1 has James reviewing it
    // every day of dry-run week). Every customer/team-facing send stays dry-run-gated
    // elsewhere (actor.ts); this is the one exception, and it's intentional.
    await sendGhlEmail(ADMIN_CONTACT_ID, 'admin@bestroofingnow.com', digest.subject, digest.html);
    await db.insert(brainRuns).values({ kind: 'digest', finishedAt: new Date(), eventsSeen: loops.length });
    res.json({ ok: true, loops: loops.length, subject: digest.subject });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// The outreach campaign engine (server/outreach/outreach-scheduler.ts) has a
// real serverless-friendly API (checkAndRunDueCampaigns/sendScheduledEmails,
// literally commented "for Vercel Cron") — it was just never wired to the
// vercel.json cron entries that are supposed to call it. Those entries hit
// /api/cron/outreach-campaigns and /api/cron/outreach-send, which previously
// 404'd forever against the placeholder router mounted at /api/cron. The
// pipeline itself stays behind ENABLE_OUTREACH (unset in this deployment —
// see .env.example) so wiring this up doesn't turn on live sending; it only
// means the flag will actually do something the day it's flipped on, instead
// of the cron silently 404ing forever even then.
const outreachConfig = {
  brightDataApiKey: process.env.BRIGHTDATA_API_KEY,
  hunterApiKey: process.env.HUNTER_IO_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
};

router.get('/cron/outreach-campaigns', async (req, res) => {
  if (!authorized(req as any)) return res.status(401).json({ error: 'unauthorized' });
  if (process.env.ENABLE_OUTREACH !== 'true') return res.json({ ok: true, skipped: true, reason: 'ENABLE_OUTREACH is not set' });
  try {
    res.json({ ok: true, ...(await checkAndRunDueCampaigns(outreachConfig)) });
  } catch (e: any) {
    console.error('[cron] outreach-campaigns failed:', e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get('/cron/outreach-send', async (req, res) => {
  if (!authorized(req as any)) return res.status(401).json({ error: 'unauthorized' });
  if (process.env.ENABLE_OUTREACH !== 'true') return res.json({ ok: true, skipped: true, reason: 'ENABLE_OUTREACH is not set' });
  try {
    res.json({ ok: true, ...(await sendScheduledEmails(outreachConfig)) });
  } catch (e: any) {
    console.error('[cron] outreach-send failed:', e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

export default router;
