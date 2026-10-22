/**
 * Reading the call and message history the app now owns.
 *
 * Everything here reads our own tables, never a provider, which is the point:
 * these screens keep working identically whether the rows came from the GHL
 * mirror or from Twilio after the cutover.
 *
 * Money and whole-team numbers are admin/manager only. A rep sees their own
 * calls and the calls on their own leads, the same rule `ownsLead` applies
 * everywhere else.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { calls, commMessages, leads } from '../../shared/schema';
import { requireAuth, requireRole } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { asyncHandler } from '../lib/async-handler';
import { sendFailure } from '../lib/failure';
import { rateLimit } from '../lib/rate-limit';
import { mirrorFromGhl, linkCallsToLeads } from './ghl-mirror';
import { getCommsVersion, setCommsVersion, readiness, isCommsOwner, COMMS_OWNER } from './version';
import { registerVoiceRoutes } from './voice-routes';
import { isCommsVersion, blockedReason, COMMS_VERSION_LABEL, COMMS_VERSION_BLURB } from '../../shared/comms-version';

/** A backfill is thousands of GHL requests; it is not a button to lean on. */
const mirrorLimiter = rateLimit(4, 60 * 60 * 1000);

const days = (v: unknown, fallback: number, max = 365) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
};

export function registerCommsRoutes(app: Express): void {
  // Placing calls, and everything Twilio posts back about them.
  registerVoiceRoutes(app);

  /**
   * The V1/V2 switch. Owner only — not by role, by identity: this changes how
   * the whole company's texts and calls are sent, and it is a testing control,
   * not an admin feature. Anyone else gets a 404 rather than a 403, so it
   * doesn't advertise itself.
   */
  app.get('/api/comms/version', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    if (!isCommsOwner(user.email)) return res.status(404).json({ error: 'not found' });
    const state = await getCommsVersion();
    const ready = await readiness();
    res.json({
      ...state,
      owner: COMMS_OWNER,
      labels: COMMS_VERSION_LABEL,
      blurbs: COMMS_VERSION_BLURB,
      readiness: ready,
      blockedReason: blockedReason(ready),
    });
  }));

  app.put('/api/comms/version', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    if (!isCommsOwner(user.email)) return res.status(404).json({ error: 'not found' });

    const next = req.body?.version;
    if (!isCommsVersion(next)) return res.status(400).json({ error: 'version must be v1 or v2' });

    // Going back to V1 is always allowed and never questioned — that is the
    // whole safety net, and anything that can refuse it is a bug.
    if (next === 'v2') {
      const ready = await readiness();
      const blocked = blockedReason(ready);
      if (blocked) return res.status(409).json({ error: blocked, readiness: ready });
    }

    const state = await setCommsVersion(next, user.email);
    res.json({ ...state, readiness: await readiness() });
  }));

  /**
   * How the phones actually went. The question nobody could answer from this
   * app before: dials, connects, and the talk minutes behind them.
   */
  app.get('/api/comms/summary', requireAuth, requireRole('manager'), asyncHandler(async (req: Request, res: Response) => {
    const since = new Date(Date.now() - days(req.query.days, 30) * 864e5);

    const byNumber = await db
      .select({
        ourNumber: calls.ourNumber,
        direction: calls.direction,
        n: sql<number>`count(*)::int`,
        connected: sql<number>`count(*) filter (where ${calls.outcome} = 'connected')::int`,
        talkSeconds: sql<number>`coalesce(sum(${calls.durationSeconds}) filter (where ${calls.outcome} = 'connected'), 0)::int`,
      })
      .from(calls)
      .where(gte(calls.startedAt, since))
      .groupBy(calls.ourNumber, calls.direction)
      .orderBy(desc(sql`count(*)`));

    const byOutcome = await db
      .select({
        direction: calls.direction,
        outcome: calls.outcome,
        n: sql<number>`count(*)::int`,
      })
      .from(calls)
      .where(gte(calls.startedAt, since))
      .groupBy(calls.direction, calls.outcome);

    const messages = await db
      .select({ channel: commMessages.channel, direction: commMessages.direction, n: sql<number>`count(*)::int` })
      .from(commMessages)
      .where(gte(commMessages.sentAt, since))
      .groupBy(commMessages.channel, commMessages.direction);

    const dials = byNumber.filter((r) => r.direction === 'outbound');
    const totalDials = dials.reduce((n, r) => n + r.n, 0);
    const totalConnected = dials.reduce((n, r) => n + r.connected, 0);

    res.json({
      since: since.toISOString(),
      outbound: {
        dials: totalDials,
        connected: totalConnected,
        // Null rather than 0 when nobody dialled — a 0% connect rate and "no
        // dials at all" are different things and a dashboard should not
        // silently merge them.
        connectRate: totalDials ? totalConnected / totalDials : null,
        talkMinutes: Math.round(dials.reduce((n, r) => n + r.talkSeconds, 0) / 60),
      },
      byNumber,
      byOutcome,
      messages,
    });
  }));

  /** Every call on one job, for the client profile. Rep-scoped. */
  app.get('/api/clients/:externalId/calls', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
    if (!lead) return res.status(404).json({ error: 'not found' });
    if (!(await ownsLead(user, lead.externalId!))) return res.status(404).json({ error: 'not found' });

    const rows = await db
      .select({
        id: calls.id, direction: calls.direction, status: calls.status, outcome: calls.outcome,
        startedAt: calls.startedAt, durationSeconds: calls.durationSeconds,
        fromE164: calls.fromE164, toE164: calls.toE164, ourNumber: calls.ourNumber,
        repName: calls.repName, answeredBy: calls.answeredBy,
        summary: calls.summary, transcript: calls.transcript,
        hasRecording: sql<boolean>`${calls.recordingUrl} is not null`,
      })
      .from(calls)
      .where(eq(calls.leadExternalId, req.params.externalId))
      .orderBy(desc(calls.startedAt))
      .limit(200);

    res.json({ calls: rows });
  }));

  /**
   * Pull GHL's history in. Admin only and rate limited, because a wide
   * backfill is thousands of upstream requests.
   */
  app.post('/api/comms/mirror', requireRole('admin'), mirrorLimiter, async (req: Request, res: Response) => {
    try {
      const since = new Date(Date.now() - days(req.body?.days, 7, 400) * 864e5);
      const max = Math.min(Number(req.body?.maxConversations) || 200, 2000);
      const result = await mirrorFromGhl({ since, maxConversations: max });
      const linked = await linkCallsToLeads();
      res.json({ ...result, leadsLinked: linked });
    } catch (e) {
      return sendFailure(res, e, 'POST /api/comms/mirror', 502, 'Could not read the history from GoHighLevel.');
    }
  });
}
