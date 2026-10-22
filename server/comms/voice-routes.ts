/**
 * Placing calls from the app, and recording what happened to them.
 *
 * A rep taps Call on a client; we ring the rep's own phone, and when they pick
 * up Twilio bridges them to the customer showing our business number. The
 * customer never sees a personal mobile, and the whole thing lands in `calls`
 * with a recording and, later, a transcript.
 *
 * This is the half of the GoHighLevel migration that is NOT waiting on A2P —
 * voice needs no carrier registration, so it can run today while texting is
 * still in vetting.
 *
 * Everything Twilio posts back is signature-checked. These endpoints are
 * necessarily public (Twilio has no session) and they write to the call
 * record, so an unverified POST would let anyone forge call history.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { calls, leads, phoneNumbers, settings, teamMembers } from '../../shared/schema';
import { requireAuth, requireRole } from '../auth/middleware';
import { ownsLead, type SessionUser } from '../access/rep-scope';
import { mayHearCall, seesEveryCall } from './call-access';
import { asyncHandler } from '../lib/async-handler';
import { sendFailure } from '../lib/failure';
import { sendUpstreamFailure } from '../lib/upstream';
import { rateLimit } from '../lib/rate-limit';
import { getTwilioClient } from '../integrations/twilio';
import { toE164 } from '../../shared/comms';
import {
  bridgeTwiml, inboundTwiml, statusToUpdate, isFinalStatus,
  handoffTwiml, nobodyAnswered, browserDialTwiml,
} from '../../shared/twilio-voice';
import { routeInbound, routingGaps, isNumberPurpose, isRingTo } from '../../shared/phone-routing';
import { buildVoiceToken, safeIdentity } from './voice-token';
import { samePhone, statusMayReplace } from './phone-match';

/**
 * Where an unanswered call goes.
 *
 * Today that is the GoHighLevel line the Dakota agent already answers on, so
 * callers get the AI service James has now rather than waiting weeks for it
 * to be rebuilt here. Stored in settings rather than an env var precisely
 * because it is meant to move: when Dakota runs on our own stack this becomes
 * one of our numbers, with no deploy.
 */
const AI_KEY = 'voice.aiFallbackNumber';
const SECONDS_KEY = 'voice.secondsBeforeAi';

async function aiFallbackNumber(): Promise<string | null> {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, AI_KEY));
    const v = (row?.value ?? null) as any;
    return toE164(typeof v === 'string' ? v : v?.number) ?? null;
  } catch { return null; }
}

/** How long a caller rings before the AI takes it. Seconds, not rings. */
async function secondsBeforeAi(): Promise<number> {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, SECONDS_KEY));
    const v = Number((row?.value as any)?.seconds ?? row?.value);
    // Below about five seconds a caller barely hears a ring; above sixty they
    // have usually given up.
    return Number.isFinite(v) && v >= 5 && v <= 60 ? Math.round(v) : 10;
  } catch { return 10; }
}

/** A call costs money and rings a real person. Not a button to lean on. */
const placeLimiter = rateLimit(30, 10 * 60 * 1000);

const baseUrl = (req: Request): string =>
  (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

/** Verify a Twilio callback, or refuse it. */
function fromTwilio(req: Request): boolean {
  try {
    const sig = req.header('x-twilio-signature');
    if (!sig) return false;
    const url = `${baseUrl(req)}${req.originalUrl}`;
    return getTwilioClient().validateWebhookSignature(url, req.body, sig);
  } catch {
    return false;
  }
}

/** The number we show customers. */
async function callerIdFor(): Promise<string | null> {
  const [main] = await db.select().from(phoneNumbers)
    .where(and(eq(phoneNumbers.active, true), eq(phoneNumbers.purpose, 'main'))).limit(1);
  if (main) return main.e164;
  const [any] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.active, true)).limit(1);
  return any?.e164 ?? null;
}

export function registerVoiceRoutes(app: Express): void {
  /**
   * The numbers we own, who they belong to, and where each one currently
   * rings. Admin only — it is the company's phone plan.
   *
   * Reports the gaps alongside the list, because a number assigned to someone
   * with no phone on file looks configured and behaves as though it is not.
   */
  app.get('/api/phone-numbers', requireAuth, requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    const owned = await db.select().from(phoneNumbers).orderBy(phoneNumbers.e164);
    const team = await db.select({ id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, phone: teamMembers.phone, active: teamMembers.active })
      .from(teamMembers).orderBy(teamMembers.name);

    const asOwned = owned.map((n) => ({ e164: n.e164, purpose: n.purpose, teamMemberId: n.teamMemberId, forwardsTo: toE164(n.forwardsTo), active: n.active, ringTo: n.ringTo, clientIdentity: n.clientIdentity }));
    const asPeople = team.map((t) => ({ id: t.id, name: t.name, phone: toE164(t.phone), active: t.active }));
    const fallback = toE164(process.env.OFFICE_FORWARD_NUMBER);

    res.json({
      numbers: owned.map((n) => {
        const d = routeInbound(n.e164, asOwned, asPeople, fallback);
        const owner = team.find((t) => t.id === n.teamMemberId);
        return {
          id: n.id, e164: n.e164, label: n.label, purpose: n.purpose, active: n.active,
          forwardsTo: n.forwardsTo,
          assignedTo: owner ? { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone } : null,
          ringsAt: d.ring,
          reason: d.reason,
          goesToVoicemail: d.voicemail,
        };
      }),
      team: team.filter((t) => t.active !== false).map((t) => ({ id: t.id, name: t.name, email: t.email, hasPhone: !!t.phone })),
      gaps: routingGaps(asOwned, asPeople, fallback),
    });
  }));

  /**
   * Assign a number to a person, or change what it is for.
   *
   * Assignment is by team member, not by typing a phone number in twice: the
   * person's own phone is already on their record, so a number follows them
   * when they change their mobile instead of silently ringing the old one.
   */
  app.put('/api/phone-numbers/:id', requireAuth, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });

    const [existing] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id));
    if (!existing) return res.status(404).json({ error: 'not found' });

    const patch: Record<string, unknown> = {};

    if ('teamMemberId' in (req.body || {})) {
      const t = req.body.teamMemberId;
      if (t === null) patch.teamMemberId = null;
      else {
        const n = Number(t);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'teamMemberId must be a number or null' });
        const [who] = await db.select().from(teamMembers).where(eq(teamMembers.id, n));
        if (!who) return res.status(422).json({ error: 'That team member does not exist.' });
        if (who.active === false) return res.status(422).json({ error: `${who.name} is not active, so a number cannot ring them.` });
        patch.teamMemberId = n;
      }
    }

    if ('purpose' in (req.body || {})) {
      if (!isNumberPurpose(req.body.purpose)) return res.status(400).json({ error: 'purpose must be direct, main, ai_answer or outbound' });
      patch.purpose = req.body.purpose;
    }

    if ('label' in (req.body || {})) {
      const l = String(req.body.label ?? '').trim();
      if (!l) return res.status(400).json({ error: 'label cannot be empty' });
      patch.label = l.slice(0, 120);
    }

    if ('forwardsTo' in (req.body || {})) {
      const f = req.body.forwardsTo;
      if (f === null || f === '') patch.forwardsTo = null;
      else {
        const e = toE164(f);
        if (!e) return res.status(400).json({ error: 'That does not look like a phone number.' });
        patch.forwardsTo = e;
      }
    }

    if ('active' in (req.body || {})) patch.active = !!req.body.active;

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to change' });

    await db.update(phoneNumbers).set(patch).where(eq(phoneNumbers.id, id));

    // Answer with what the change actually did to the routing, not just "ok".
    const owned = await db.select().from(phoneNumbers);
    const team = await db.select({ id: teamMembers.id, name: teamMembers.name, phone: teamMembers.phone, active: teamMembers.active }).from(teamMembers);
    const d = routeInbound(
      existing.e164,
      owned.map((n) => ({ e164: n.e164, purpose: n.purpose, teamMemberId: n.teamMemberId, forwardsTo: toE164(n.forwardsTo), active: n.active, ringTo: n.ringTo, clientIdentity: n.clientIdentity })),
      team.map((t) => ({ id: t.id, name: t.name, phone: toE164(t.phone), active: t.active })),
      toE164(process.env.OFFICE_FORWARD_NUMBER),
    );
    res.json({ ok: true, e164: existing.e164, ringsAt: d.ring, reason: d.reason, goesToVoicemail: d.voicemail });
  }));


  /**
   * The TwiML App a browser needs before it can dial out.
   *
   * Idempotent: it finds ours by name and only creates one if it is missing,
   * and it refreshes the Voice URL either way so the app moving domain never
   * leaves outbound calls pointing at a dead address. Admin only, and safe to
   * run again.
   */
  app.post('/api/voice/setup-app', requireAuth, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    const base = baseUrl(req);
    if (!/^https:\/\//.test(base)) {
      return res.status(422).json({ error: 'APP_BASE_URL must be a public https URL before browser calling can be set up.' });
    }
    try {
      const r = await getTwilioClient().ensureTwimlApp({
        friendlyName: 'Best Roofing Now — browser calling',
        voiceUrl: `${base}/api/voice/browser-dial`,
        statusCallback: `${base}/api/voice/status`,
      });
      res.json({
        ...r,
        note: r.created ? 'Created.' : 'Already existed; its URL was refreshed.',
        next: `Add TWILIO_TWIML_APP_SID=${r.sid} in Vercel, then redeploy.`,
      });
    } catch (e) {
      return sendUpstreamFailure(res, e, 'Twilio', 'POST /api/voice/setup-app');
    }
  }));

  /**
   * What a browser dials. Twilio fetches this when someone places a call from
   * the call bar, having already joined the browser to itself.
   *
   * The caller id is never taken from the browser — it is looked up from the
   * number that person owns. A browser that could nominate its own caller id
   * could place calls as anybody.
   */
  app.post('/api/voice/browser-dial', asyncHandler(async (req: Request, res: Response) => {
    if (!fromTwilio(req)) return res.status(403).type('text/plain').send('forbidden');

    const to = toE164(req.body?.To);
    const identity = safeIdentity(String(req.body?.From || '').replace(/^client:/i, ''));

    if (!to) {
      return res.type('text/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Sorry, that number was not understood.</Say></Response>',
      );
    }

    const [mine] = identity
      ? await db.select().from(phoneNumbers).where(eq(phoneNumbers.clientIdentity, identity)).limit(1)
      : [];
    if (!mine) {
      console.warn(`[voice] browser dial from unknown identity "${identity}"`);
      return res.type('text/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">This line is not set up to make calls.</Say></Response>',
      );
    }

    // Log it before it connects, so a call that fails still leaves a trace.
    const [lead] = await db.select({ id: leads.id, externalId: leads.externalId }).from(leads)
      .where(samePhone(leads.phone, to))
      .limit(1);

    if (req.body?.CallSid) {
      await db.insert(calls).values({
        provider: 'twilio',
        providerSid: req.body.CallSid,
        direction: 'outbound',
        fromE164: mine.e164,
        toE164: to,
        ourNumber: mine.e164,
        teamMemberId: mine.teamMemberId,
        leadId: lead?.id ?? null,
        leadExternalId: lead?.externalId ?? null,
        answeredBy: 'human',
        status: 'in-progress',
        startedAt: new Date(),
        summary: `Placed from the browser by ${identity}.`,
      }).onConflictDoNothing({ target: calls.providerSid });
    }

    res.type('text/xml').send(browserDialTwiml({
      to,
      callerId: mine.e164,
      announceRecording: true,
      recordingStatusCallback: `${baseUrl(req)}/api/voice/recording`,
      timeLimitSeconds: 3600,
    }));
  }));

  /**
   * Recent calls, newest first.
   *
   * Rep-scoped: a rep sees calls on their own jobs and calls they were part
   * of, an admin sees everything. A call with no client attached — a wrong
   * number, a supplier — is visible to admins only, since there is no job to
   * scope it by.
   */
  app.get('/api/calls', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const rows = await db
      .select({
        id: calls.id, direction: calls.direction, status: calls.status, outcome: calls.outcome,
        fromE164: calls.fromE164, toE164: calls.toE164, ourNumber: calls.ourNumber,
        startedAt: calls.startedAt, durationSeconds: calls.durationSeconds,
        answeredBy: calls.answeredBy, repName: calls.repName, summary: calls.summary,
        leadExternalId: calls.leadExternalId,
        hasRecording: sql<boolean>`${calls.recordingUrl} is not null`,
        transcript: calls.transcript,
        clientName: sql<string | null>`nullif(trim(coalesce(${leads.firstName}, '') || ' ' || coalesce(${leads.lastName}, '')), '')`,
      })
      .from(calls)
      .leftJoin(leads, eq(leads.id, calls.leadId))
      .orderBy(desc(calls.startedAt))
      .limit(limit);

    // Scope after the query rather than in it: ownsLead already encodes the
    // rules (shared reps, assignments), and duplicating them in SQL is how
    // the two drift apart.
    const isAdmin = seesEveryCall(user.role);
    const visible = isAdmin
      ? rows
      : (await Promise.all(rows.map(async (r) => (r.leadExternalId && (await ownsLead(user, r.leadExternalId)) ? r : null))))
          .filter(Boolean);

    res.json({ calls: visible, scoped: !isAdmin });
  }));

  /**
   * Who is calling? Matched on the last ten digits, so a number stored as
   * (704) 555-1234 still matches +17045551234 arriving from Twilio.
   *
   * Best effort by design: the call bar shows the number regardless, and a
   * missing match must never hold up a ringing phone.
   */
  app.get('/api/comms/who-is/:raw', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const e = toE164(String(req.params.raw || '').replace(/^client:/i, ''));
    if (!e) return res.json({ name: null, externalId: null });

    const [lead] = await db
      .select({ id: leads.id, externalId: leads.externalId, firstName: leads.firstName, lastName: leads.lastName })
      .from(leads)
      .where(samePhone(leads.phone, e))
      .limit(1);

    if (!lead) return res.json({ name: null, externalId: null });
    res.json({
      name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || null,
      externalId: lead.externalId,
    });
  }));

  /**
   * A token that lets this person's browser act as a phone.
   *
   * Short-lived and scoped to one identity, so it can be handed to a browser
   * in a way the account credentials never could. Issued only for a number
   * this person actually owns — a token for someone else's identity would let
   * them take someone else's calls.
   */
  app.get('/api/voice/token', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;

    const [me] = await db.select().from(teamMembers).where(eq(teamMembers.email, user.email)).limit(1);
    if (!me) return res.status(403).json({ error: 'You are not on the team roster.' });

    const mine = await db.select().from(phoneNumbers)
      .where(and(eq(phoneNumbers.teamMemberId, me.id), eq(phoneNumbers.active, true)));
    const browserNumber = mine.find((n) => (n.ringTo === 'browser' || n.ringTo === 'both') && n.clientIdentity);

    if (!browserNumber) {
      return res.status(403).json({
        error: mine.length
          ? 'Your number is set to ring a phone, not this browser.'
          : 'No number is assigned to you yet, so there is nothing to answer here.',
      });
    }

    try {
      const { token, identity, expiresAt } = buildVoiceToken({
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        apiKeySid: process.env.TWILIO_API_KEY_SID || '',
        apiKeySecret: process.env.TWILIO_API_KEY_SECRET || '',
        identity: browserNumber.clientIdentity!,
        outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID || undefined,
        ttlSeconds: 3600,
      });
      res.json({
        token, identity, expiresAt,
        number: browserNumber.e164,
        label: browserNumber.label,
        // Without a TwiML App the browser can answer but not dial. Say which,
        // so the interface offers only what actually works.
        canDial: !!process.env.TWILIO_TWIML_APP_SID,
      });
    } catch (e) {
      // A missing API key is configuration, not a fault, and the browser
      // should say so rather than sit there looking broken.
      return res.status(503).json({ error: e instanceof Error ? e.message : 'Browser calling is not configured yet.' });
    }
  }));

  /**
   * The AI backstop: who takes a call nobody answered, and after how long.
   *
   * Separate from the numbers themselves because it is a policy, not a line —
   * and because it is explicitly temporary. It points at GoHighLevel today and
   * at our own service later, and that change should be a field, not a deploy.
   */
  app.get('/api/voice/ai-backstop', requireAuth, requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
    const number = await aiFallbackNumber();
    const seconds = await secondsBeforeAi();
    res.json({
      number,
      seconds,
      on: !!number,
      note: number
        ? `Calls nobody answers within ${seconds} seconds go to ${number}.`
        : 'No AI backstop set, so an unanswered call takes a message instead.',
    });
  }));

  app.put('/api/voice/ai-backstop', requireAuth, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    const patch: Record<string, unknown> = {};

    if ('number' in (req.body || {})) {
      const raw = req.body.number;
      if (raw === null || raw === '') {
        await db.insert(settings).values({ key: AI_KEY, value: null as any })
          .onConflictDoUpdate({ target: settings.key, set: { value: null as any, updatedAt: new Date() } });
        patch.number = null;
      } else {
        const e = toE164(raw);
        if (!e) return res.status(400).json({ error: 'That does not look like a phone number.' });
        // Handing a call to one of our own numbers would route it straight
        // back here and loop until the caller gives up.
        const [mine] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.e164, e)).limit(1);
        if (mine) return res.status(422).json({ error: `${e} is one of our own numbers — handing calls there would loop.` });
        await db.insert(settings).values({ key: AI_KEY, value: e as any })
          .onConflictDoUpdate({ target: settings.key, set: { value: e as any, updatedAt: new Date() } });
        patch.number = e;
      }
    }

    if ('seconds' in (req.body || {})) {
      const n = Number(req.body.seconds);
      if (!Number.isFinite(n) || n < 5 || n > 60) {
        return res.status(400).json({ error: 'seconds must be between 5 and 60 — less and the caller barely hears a ring, more and they have usually hung up' });
      }
      await db.insert(settings).values({ key: SECONDS_KEY, value: { seconds: Math.round(n) } as any })
        .onConflictDoUpdate({ target: settings.key, set: { value: { seconds: Math.round(n) } as any, updatedAt: new Date() } });
      patch.seconds = Math.round(n);
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to change' });

    const number = await aiFallbackNumber();
    const seconds = await secondsBeforeAi();
    res.json({ ok: true, number, seconds });
  }));

  /**
   * Point a number at this app, so calls to it actually arrive here.
   *
   * A number bought in Twilio rings nowhere useful until its voice webhook is
   * set, and doing that by hand in the console is both forgettable and easy to
   * typo. This is the same operation, named, repeatable, and recorded — one
   * action per new rep number rather than a console visit.
   *
   * Admin only, and deliberately explicit: it changes where a real phone line
   * rings, so it is never a side effect of assigning a number.
   */
  app.post('/api/phone-numbers/:id/configure', requireAuth, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const [row] = Number.isFinite(id) ? await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, id)) : [];
    if (!row) return res.status(404).json({ error: 'not found' });

    const base = baseUrl(req);
    if (!/^https:\/\//.test(base)) {
      // Twilio has to reach the URL from the public internet; a localhost
      // value here would configure the line to ring nowhere at all.
      return res.status(422).json({ error: 'APP_BASE_URL must be a public https URL before a number can be pointed at this app.' });
    }

    try {
      const client = getTwilioClient();
      const found = await client.findIncomingNumber(row.e164);
      if (!found) {
        return res.status(422).json({ error: `${row.e164} is not on the connected Twilio account. Check the credentials point at the account that owns it.` });
      }

      const applied = await client.configureIncomingNumber(found.sid, {
        voiceUrl: `${base}/api/voice/inbound`,
        statusCallback: `${base}/api/voice/status`,
        friendlyName: row.label,
      });

      // Remember the Twilio SID so later changes need no lookup.
      await db.update(phoneNumbers).set({ providerSid: applied.sid }).where(eq(phoneNumbers.id, id));

      res.json({
        ok: true,
        e164: row.e164,
        was: found.voiceUrl,
        now: applied.voiceUrl,
        note: 'Calls to this number will now reach the app.',
      });
    } catch (e) {
      return sendUpstreamFailure(res, e, 'Twilio', 'POST /api/phone-numbers/:id/configure');
    }
  }));

  /**
   * Call a client. Rings the rep first, then bridges.
   *
   * The row is written before Twilio is asked to dial, so a call that fails to
   * place still leaves a trace — a dial that vanishes because the provider
   * errored is exactly the call someone later swears they made.
   */
  app.post('/api/clients/:externalId/call', requireAuth, placeLimiter, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const [lead] = await db.select().from(leads).where(eq(leads.externalId, req.params.externalId));
    if (!lead) return res.status(404).json({ error: 'not found' });
    if (!(await ownsLead(user, lead.externalId!))) return res.status(404).json({ error: 'not found' });

    const to = toE164(lead.phone);
    if (!to) return res.status(422).json({ error: `There is no phone number on ${lead.firstName || 'this client'}'s record.` });

    // The rep's own phone. Theirs on file, or one they pass for this call.
    const [me] = await db.select().from(teamMembers).where(eq(teamMembers.email, user.email)).limit(1);
    const repNumber = toE164(req.body?.from) || toE164((me as any)?.phone);
    if (!repNumber) {
      return res.status(422).json({ error: 'We do not have your phone number. Add it on My Account, then try again.' });
    }

    const callerId = await callerIdFor();
    if (!callerId) return res.status(503).json({ error: 'No company number is set up yet, so there is nothing to call from.' });

    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'this client';

    // Written first, updated by the callbacks.
    const [row] = await db.insert(calls).values({
      provider: 'twilio',
      direction: 'outbound',
      fromE164: repNumber,
      toE164: to,
      ourNumber: callerId,
      leadId: lead.id,
      leadExternalId: lead.externalId,
      repName: user.name || user.email,
      status: 'queued',
      startedAt: new Date(),
    }).returning({ id: calls.id });

    try {
      const placed = await getTwilioClient().placeBridgedCall({
        to: repNumber,
        from: callerId,
        twimlUrl: `${baseUrl(req)}/api/voice/bridge/${row.id}`,
        statusCallback: `${baseUrl(req)}/api/voice/status`,
      });
      await db.update(calls).set({ providerSid: placed.sid, status: placed.status, updatedAt: new Date() })
        .where(eq(calls.id, row.id));
      res.json({ ok: true, callId: row.id, calling: repNumber, then: to, name });
    } catch (e) {
      await db.update(calls).set({ status: 'failed', updatedAt: new Date() }).where(eq(calls.id, row.id));
      return sendUpstreamFailure(res, e, 'Twilio', 'POST /api/clients/:externalId/call');
    }
  }));

  /**
   * The TwiML Twilio fetches once the rep answers. Public by necessity —
   * Twilio fetches it — and signature-checked, with the call id in the path
   * so it can only ever describe one call.
   */
  app.post('/api/voice/bridge/:callId', asyncHandler(async (req: Request, res: Response) => {
    if (!fromTwilio(req)) return res.status(403).type('text/plain').send('forbidden');

    const id = Number(req.params.callId);
    const [row] = Number.isFinite(id) ? await db.select().from(calls).where(eq(calls.id, id)) : [];
    if (!row) {
      // Say something rather than hanging up on whoever answered.
      return res.type('text/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">That call is no longer available.</Say></Response>',
      );
    }

    res.type('text/xml').send(bridgeTwiml({
      repNumber: row.fromE164,
      customerNumber: row.toE164,
      callerId: row.ourNumber || row.fromE164,
      whisper: `Connecting you to ${row.leadExternalId ? 'your client' : 'the number you dialled'}.`,
      announceRecording: true,
      recordingStatusCallback: `${baseUrl(req)}/api/voice/recording`,
      timeLimitSeconds: 3600,
    }));
  }));

  /** A call to one of our numbers. */
  app.post('/api/voice/inbound', asyncHandler(async (req: Request, res: Response) => {
    if (!fromTwilio(req)) return res.status(403).type('text/plain').send('forbidden');

    const from = toE164(req.body?.From);
    const to = toE164(req.body?.To);

    if (from && to && req.body?.CallSid) {
      const [lead] = await db.select({ id: leads.id, externalId: leads.externalId }).from(leads)
        .where(samePhone(leads.phone, from))
        .limit(1);
      await db.insert(calls).values({
        provider: 'twilio',
        providerSid: req.body.CallSid,
        direction: 'inbound',
        fromE164: from,
        toE164: to,
        ourNumber: to,
        leadId: lead?.id ?? null,
        leadExternalId: lead?.externalId ?? null,
        status: 'ringing',
        startedAt: new Date(),
      }).onConflictDoNothing({ target: calls.providerSid });
    }

    // Who owns the number that was dialled decides whose phone rings. The
    // decision is made in shared/phone-routing.ts so it can be tested without
    // ringing anybody, and so the same answer can be shown on screen.
    const owned = await db.select().from(phoneNumbers);
    const team = await db.select({ id: teamMembers.id, name: teamMembers.name, phone: teamMembers.phone, active: teamMembers.active })
      .from(teamMembers);

    const decision = routeInbound(
      to || '',
      owned.map((n) => ({ e164: n.e164, purpose: n.purpose, teamMemberId: n.teamMemberId, forwardsTo: toE164(n.forwardsTo), active: n.active, ringTo: n.ringTo, clientIdentity: n.clientIdentity })),
      team.map((t) => ({ id: t.id, name: t.name, phone: toE164(t.phone), active: t.active })),
      toE164(process.env.OFFICE_FORWARD_NUMBER),
    );

    // Recorded on the call, so "why did this go to voicemail" is answerable
    // afterwards instead of being reconstructed from the configuration.
    if (req.body?.CallSid) {
      await db.update(calls)
        .set({ teamMemberId: decision.forTeamMemberId, summary: `Routing: ${decision.reason}`, updatedAt: new Date() })
        .where(eq(calls.providerSid, req.body.CallSid));
    }
    if (decision.voicemail) {
      console.warn(`[voice] ${to} went to voicemail — ${decision.reason}`);
    }

    const ai = await aiFallbackNumber();
    const ringSeconds = await secondsBeforeAi();

    res.type('text/xml').send(inboundTwiml({
      forwardTo: decision.ring,
      ringClients: decision.ringClients,
      greeting: 'Thank you for calling Best Roofing Now.',
      announceRecording: true,
      recordingStatusCallback: `${baseUrl(req)}/api/voice/recording`,
      ringSeconds,
      // With an AI backstop configured the caller is handed over instead of
      // hearing a beep. Without one, they still get voicemail.
      noAnswerAction: ai ? `${baseUrl(req)}/api/voice/no-answer` : undefined,
    }));
  }));

  /**
   * Nobody picked up. Hand the caller to the AI service.
   *
   * Twilio posts here after <Dial> finishes, whatever the outcome — so this
   * checks *why* it finished. A call that was answered and has ended must not
   * be re-dialled at the AI; the caller has already hung up, and doing so
   * would ring the AI at a dead line on every completed call.
   */
  app.post('/api/voice/no-answer', asyncHandler(async (req: Request, res: Response) => {
    if (!fromTwilio(req)) return res.status(403).type('text/plain').send('forbidden');

    const outcome = req.body?.DialCallStatus;
    const sid = req.body?.CallSid;

    if (!nobodyAnswered(outcome)) {
      // Answered and finished. Say nothing further and let the call end.
      if (sid) {
        await db.update(calls).set({ outcome: 'connected', updatedAt: new Date() })
          .where(eq(calls.providerSid, sid));
      }
      return res.type('text/xml').send('<Response/>');
    }

    const ai = await aiFallbackNumber();
    if (!ai) {
      return res.type('text/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Sorry, we could not reach anyone. Please leave a message after the tone.</Say><Record maxLength="120" playBeep="true" /></Response>',
      );
    }

    if (sid) {
      await db.update(calls).set({
        outcome: 'handed_to_ai',
        answeredBy: 'ai',
        summary: `Nobody answered (${outcome}); handed to the AI service on ${ai}.`,
        updatedAt: new Date(),
      }).where(eq(calls.providerSid, sid));
    }
    console.warn(`[voice] ${sid || 'call'} not answered (${outcome}) — handing to AI on ${ai}`);

    res.type('text/xml').send(handoffTwiml(ai, toE164(req.body?.To) || undefined));
  }));

  /** Progress and outcome for a call. */
  app.post('/api/voice/status', asyncHandler(async (req: Request, res: Response) => {
    if (!fromTwilio(req)) return res.status(403).type('text/plain').send('forbidden');

    const u = statusToUpdate(req.body || {});
    if (!u) return res.type('text/xml').send('<Response/>');

    const patch: Record<string, unknown> = { status: u.status, updatedAt: new Date() };
    if (u.durationSeconds !== null) patch.durationSeconds = u.durationSeconds;
    if (u.answeredBy) patch.answeredBy = u.answeredBy === 'machine' ? 'machine' : 'human';
    if (u.endedAt) patch.endedAt = u.endedAt;
    // Twilio does not deliver status callbacks in order; a late "ringing" or
    // "in-progress" must not reopen a call that already ended.
    await db.update(calls).set(patch)
      .where(and(eq(calls.providerSid, u.providerSid), statusMayReplace(calls.status, u.status)));

    res.type('text/xml').send('<Response/>');
  }));

  /** The recording, once Twilio has finished writing it. */
  app.post('/api/voice/recording', asyncHandler(async (req: Request, res: Response) => {
    if (!fromTwilio(req)) return res.status(403).type('text/plain').send('forbidden');

    const u = statusToUpdate(req.body || {});
    if (!u?.recordingUrl) return res.type('text/xml').send('<Response/>');

    await db.update(calls).set({
      recordingUrl: u.recordingUrl,
      recordingSid: u.recordingSid,
      recordingSeconds: u.recordingSeconds,
      updatedAt: new Date(),
    }).where(eq(calls.providerSid, u.providerSid));

    res.type('text/xml').send('<Response/>');
  }));

  /**
   * Stream a recording to a signed-in person who may see that call.
   *
   * Proxied rather than linked: Twilio's recording URLs need the account
   * credentials, and handing those to a browser is not an option. This also
   * keeps rep scoping — a rep hears their own calls, not everyone's.
   */
  app.get('/api/calls/:id/recording', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const user = req.session.user! as SessionUser;
    const id = Number(req.params.id);
    const [row] = Number.isFinite(id) ? await db.select().from(calls).where(eq(calls.id, id)) : [];
    if (!row?.recordingUrl) return res.status(404).json({ error: 'not found' });
    if (!(await mayHearCall(user, row))) return res.status(404).json({ error: 'not found' });

    try {
      const audio = await getTwilioClient().fetchRecording(row.recordingUrl);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(Buffer.from(audio));
    } catch (e) {
      return sendUpstreamFailure(res, e, 'Twilio', 'GET /api/calls/:id/recording');
    }
  }));
}
