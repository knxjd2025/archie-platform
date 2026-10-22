import { db } from '../db';
import { nudges, openLoops } from '../../shared/schema';
import { and, eq, gte, like, sql } from 'drizzle-orm';
import { TEAM, type Person } from './types';
import { getOpenLoops, upsertLoop } from './loop-store';
import { isQuietHours, nextEscalationLevel, underRateCap } from './escalate';
import { generateCustomerMessage } from './voice';
import { sendGhlSms, sendGhlEmail, getMessageStatus, getConversationContactId, getConversationIdByContact, upsertContactByPhone, GhlSendError } from './ghl-brain';
import { isDigestOnlyLoop } from './backlog';
import { sendAsMailbox, createDraftInMailbox } from './gmail-delegated';
import { easternMidnight, easternNow } from '../canvass/daily-reminder';

const DRY = () => process.env.BRAIN_DRY_RUN === '1';

export function classifyAction(loop: {
  kind: string;
  urgency: string;
  contact?: { phone?: string; email?: string } | null;
}): 'auto_customer' | 'team_nudge' | 'draft_only' {
  const hasContact = Boolean(loop.contact?.phone || loop.contact?.email);
  if (['claim_milestone', 'invoice_unpaid'].includes(loop.kind)) return 'draft_only';
  if (hasContact && ['estimate_stale', 'callback_requested', 'appointment_stale_confirmed'].includes(loop.kind)) {
    return 'auto_customer';
  }
  return 'team_nudge';
}

/**
 * Pure decision helper for the auto_customer path — deliberately has no db/network
 * dependency so it's cheaply unit-testable. Encodes two safety rules:
 *  - We only ever message a customer through a resolved GHL contactId. A loop with
 *    no resolved contactId (either because it isn't GHL-sourced at all — gmail/
 *    jobtread/calendar loops have no GHL contact to resolve — or because GHL lookup
 *    failed for a GHL-sourced loop) ALWAYS falls back to a team nudge. It must never
 *    attempt a GHL send with an empty contactId.
 *  - Customers are never texted during quiet hours. If the chosen channel is SMS and
 *    it's quiet, the whole loop is skipped for this sweep (no email downgrade, no
 *    partial send) — it will be picked up again on the next non-quiet sweep.
 */
export type CustomerSendPlan =
  | { type: 'fallback_team_nudge'; note: string }
  | { type: 'skip_quiet_hours' }
  | { type: 'send'; channel: 'sms' | 'email'; contactId: string };

/** A customer send that has failed this many times goes to the team instead. */
export const MAX_CUSTOMER_SEND_ATTEMPTS = 3;

export function resolveCustomerSendPlan(
  loop: { kind: string; contact?: { phone?: string; email?: string } | null },
  contactId: string | null,
  quiet: boolean,
  failedAttempts = 0,
): CustomerSendPlan {
  if (!contactId) {
    return {
      type: 'fallback_team_nudge',
      note: `couldn't resolve GHL contact for ${loop.kind} — needs manual customer follow-up`,
    };
  }
  // A failed send leaves the loop open to try again next sweep; a send that
  // keeps failing (an empty GHL wallet, a dead number) must reach a person
  // rather than retry, and burn an LLM call, every hour forever.
  if (failedAttempts >= MAX_CUSTOMER_SEND_ATTEMPTS) {
    return {
      type: 'fallback_team_nudge',
      note: `couldn't send the customer follow-up for ${loop.kind} after ${failedAttempts} tries — needs manual customer follow-up`,
    };
  }
  const channel: 'sms' | 'email' = loop.contact?.phone ? 'sms' : 'email';
  if (quiet && channel === 'sms') {
    return { type: 'skip_quiet_hours' };
  }
  return { type: 'send', channel, contactId };
}

/** unassigned loops escalate to James — he's the default owner of last resort. */
function resolveOwner(owner: Person): Exclude<Person, 'unassigned'> {
  return owner === 'unassigned' ? 'james' : owner;
}

/**
 * Pure decision helper (fix 3: snoozed loops must wake up). `nextEscalationLevel`
 * only recognizes 'open' | 'nudged' | 'escalated' — a loop left in state 'snoozed'
 * maps to escalation level null forever, even after its snoozeUntil has passed.
 * The caller must UPDATE the loop to state 'open' the moment this returns true,
 * then treat it as 'open' for this sweep's escalation-level computation.
 */
export function shouldWakeFromSnooze(
  loop: { state: string; snoozeUntil: Date | null },
  now: Date,
): boolean {
  return loop.state === 'snoozed' && loop.snoozeUntil !== null && loop.snoozeUntil <= now;
}

// GHL SMS enforces a 1200-char cap (sendGhlSms throws above it) — pre-truncate.
const SMS_BODY_CAP = 1200;

/**
 * Insert a nudge row and return its id, or null if this (loopId, level[, keySuffix])
 * combo was already recorded (idempotency). keySuffix lets more than one distinct
 * nudge action share a loopId+level — e.g. a draft-ready email to the owner AND a
 * level-2 escalation SMS to James both fire for the same loop at the same level.
 */
async function recordNudge(
  loopId: number, toPerson: Person, channel: 'sms' | 'email', body: string,
  level: number, status: string, providerRef?: string, keySuffix?: string,
): Promise<number | null> {
  const rawKey = keySuffix ? `${loopId}:${level}:${keySuffix}` : `${loopId}:${level}`;
  // Dry-run nudges must NOT consume the real `${loopId}:${level}` idempotency key —
  // otherwise loops touched during dry-run week would look "already nudged at this
  // level" forever and never get a real send after go-live. Prefix so dry-run and
  // real keys live in disjoint namespaces; real sends after go-live get fresh keys.
  const idempotencyKey = DRY() ? `dry:${rawKey}` : rawKey;
  // Bare .returning() (no column projection) — the inserted row's id is read
  // off the array instead of a typed `.returning({ id: nudges.id })`.
  const res = await db
    .insert(nudges)
    .values({ loopId, toPerson, channel, body, idempotencyKey, escalationLevel: level, status: status as any, providerRef })
    .onConflictDoNothing({ target: nudges.idempotencyKey })
    .returning();
  return res.length > 0 ? res[0].id : null; // null = already sent this level(+key) for this loop
}

/**
 * Nudges are recorded BEFORE the send is attempted (that's what makes the
 * idempotency check race-safe). Once we know how the send actually went, we
 * come back and fill in the provider's message id, or mark the row failed.
 */
async function recordSendOutcome(nudgeId: number, providerRef: string | null): Promise<void> {
  if (providerRef !== null) {
    await db.update(nudges).set({ providerRef }).where(eq(nudges.id, nudgeId));
  } else {
    await db.update(nudges).set({ status: 'failed' as any }).where(eq(nudges.id, nudgeId));
  }
}

/**
 * A customer send that failed gives its idempotency slot back, so the next
 * sweep can try again. The row stays (renamed, still marked failed) as the
 * record of the attempt, and countFailedCustomerSends reads those.
 */
const FAILED_KEY_MARK = ':failed:';

export function failedSlotKey(loopId: number, level: number, nudgeId: number): string {
  return `${loopId}:${level}${FAILED_KEY_MARK}${nudgeId}`;
}

async function releaseFailedSlot(nudgeId: number, loopId: number, level: number): Promise<void> {
  // Dry-run keys carry a 'dry:' prefix and dry runs never fail a send, so only
  // real keys come through here.
  await db.update(nudges)
    .set({ status: 'failed' as any, idempotencyKey: failedSlotKey(loopId, level, nudgeId) })
    .where(eq(nudges.id, nudgeId));
}

async function countFailedCustomerSends(loopId: number, level: number): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(nudges)
    .where(and(eq(nudges.loopId, loopId), like(nudges.idempotencyKey, `${loopId}:${level}${FAILED_KEY_MARK}%`)));
  return rows[0]?.n ?? 0;
}

/**
 * Start of today in Eastern time — the team's day. `setHours(0)` on the server
 * meant UTC midnight, so the daily SMS cap reset at 8 PM Eastern (7 in winter):
 * evening nudges counted against a "day" that was nearly over.
 */
export function startOfEasternDay(now: Date): Date {
  return easternMidnight(easternNow(now).dateIso);
}

async function sentTodayCount(person: Person, now: Date): Promise<number> {
  const midnight = startOfEasternDay(now);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(nudges)
    .where(and(eq(nudges.toPerson, person), eq(nudges.channel, 'sms'), gte(nudges.sentAt, midnight)));
  return rows[0]?.n ?? 0;
}

async function hoursSinceLastNudge(loopId: number): Promise<number> {
  const rows = await db.select().from(nudges).where(eq(nudges.loopId, loopId)).orderBy(sql`sent_at DESC`).limit(1);
  if (rows.length === 0) return Infinity;
  return (Date.now() - new Date(rows[0].sentAt).getTime()) / 3_600_000;
}

/**
 * How a GHL send went. A failure is `not_sent` only when GHL certainly did not
 * take the message: the body was refused before any request, GHL answered 4xx,
 * or the connection was never made. A timeout or a 5xx can come after GHL has
 * already queued the text — retrying those sent the customer the same message
 * twice — so they are `unknown`, and the caller must not retry them.
 */
export type GhlSendResult =
  | { ok: true; messageId: string }
  | { ok: false; outcome: 'not_sent' | 'unknown' };

/** Errors fetch raises when it never reached GHL (DNS, refused connection). */
const NEVER_CONNECTED = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_INVALID_URL']);

export function classifySendFailure(e: unknown): 'not_sent' | 'unknown' {
  if (e instanceof GhlSendError) return e.status >= 400 && e.status < 500 ? 'not_sent' : 'unknown';
  const code = (e as any)?.cause?.code ?? (e as any)?.code;
  if (typeof code === 'string' && NEVER_CONNECTED.has(code)) return 'not_sent';
  return 'unknown';
}

/** Wrap a GHL send so a synchronous throw (sendGhlSms throws on >1200-char bodies,
 *  before returning a promise) and an async rejection are both handled the same way. */
async function trySendGhlSms(contactId: string, body: string): Promise<GhlSendResult> {
  let pending: Promise<{ messageId: string }>;
  try {
    pending = sendGhlSms(contactId, body);
  } catch (e: any) {
    // Thrown before any request went out.
    console.error('[actor] GHL SMS refused before sending:', e?.message || e);
    return { ok: false, outcome: 'not_sent' };
  }
  try {
    return { ok: true, ...(await pending) };
  } catch (e: any) {
    // Swallowed on purpose (caller records the row as failed either way) —
    // but the row alone can't say WHY (auth expired vs rate-limited vs bad
    // number), so at least get it into the logs.
    const outcome = classifySendFailure(e);
    console.error(`[actor] GHL SMS send failed (${outcome}):`, e?.message || e);
    return { ok: false, outcome };
  }
}

async function trySendGhlEmail(
  contactId: string, emailTo: string, subject: string, html: string,
): Promise<GhlSendResult> {
  try {
    return { ok: true, ...(await sendGhlEmail(contactId, emailTo, subject, html)) };
  } catch (e: any) {
    const outcome = classifySendFailure(e);
    console.error(`[actor] GHL email send failed (${outcome}):`, e?.message || e);
    return { ok: false, outcome };
  }
}

function teamNudgeBody(loop: { id: number; urgency: string; summary: string; contact?: { name?: string; phone?: string } | null }, extra?: string): string {
  return `[BRN Brain] ${loop.urgency.toUpperCase()}: ${loop.summary}` +
    (extra ? ` — ${extra}` : '') +
    (loop.contact?.phone ? ` — ${loop.contact.name ?? ''} ${loop.contact.phone}` : '') +
    ` (reply DONE ${loop.id} / SNOOZE ${loop.id} 2d)`;
}

/** Send a team nudge, honoring quiet hours (SMS suppressed, email substituted) and the daily SMS rate cap. */
async function sendTeamNudge(
  loop: { id: number },
  target: Exclude<Person, 'unassigned'>,
  body: string,
  level: number,
  quiet: boolean,
  now: Date,
  keySuffix?: string,
): Promise<boolean> {
  const useSms = !quiet && underRateCap(await sentTodayCount(target, now));
  const status = DRY() ? 'dry_run' : quiet ? 'queued_quiet_hours' : 'sent';
  const nudgeId = await recordNudge(loop.id, target, useSms ? 'sms' : 'email', body, level, status, undefined, keySuffix);
  if (nudgeId !== null && !DRY()) {
    if (useSms && TEAM[target].phone) {
      // Team SMS goes out through GHL conversations (the business number) — same pipe
      // as customer sends, so replies land back in GHL where the sweep reads control
      // commands. No contactId resolved -> providerRef stays null -> row marked failed.
      let providerRef: string | null = null;
      const contactId = await upsertContactByPhone(`${target} (BRN team)`, TEAM[target].phone);
      if (contactId) {
        const result = await trySendGhlSms(contactId, body.slice(0, SMS_BODY_CAP));
        const send = result.ok ? result : null;
        providerRef = send ? send.messageId : null;
        // Customer sends already check actual carrier delivery and escalate on
        // failure (below) — team nudges got a `providerRef` on any successful
        // GHL API call and stopped there, so a send that GHL accepted but the
        // carrier silently dropped was recorded 'sent' forever with no one
        // ever finding out the team member never got it.
        if (send) {
          const convId = await getConversationIdByContact(contactId);
          const status = convId ? await getMessageStatus(convId, send.messageId) : 'pending';
          if (status === 'failed') {
            await upsertLoop({
              kind: 'integration_failure', source: 'ghl', sourceRef: `send-${send.messageId}`,
              summary: `Team nudge to ${target} FAILED to deliver — check GHL wallet/limits`,
              owner: 'james', urgency: 'emergency',
            });
          }
        }
      }
      await recordSendOutcome(nudgeId, providerRef);
    } else {
      // Quiet hours suppress SMS only — email is fine at night, so it always goes out here.
      let providerRef: string | null = null;
      try {
        providerRef = await sendAsMailbox(TEAM.james.email, TEAM[target].email, `Action needed: ${loop.id}`, `<p>${body}</p>`);
      } catch (e: any) {
        // leave providerRef null -> recordSendOutcome marks the row failed
        console.error('[actor] team-nudge email send failed:', e?.message || e);
      }
      await recordSendOutcome(nudgeId, providerRef);
    }
  }
  return nudgeId !== null;
}

export interface ActStats { nudgesSent: number; draftsCreated: number; customerSends: number; loopsDeferred: number }

/**
 * `deadline` (epoch ms) is the sweep's time budget: once it passes, the loops
 * not reached are left exactly as they are for the next sweep — nothing about
 * a loop changes until it is acted on.
 */
export async function actOnLoops(now: Date, opts: { deadline?: number } = {}): Promise<ActStats> {
  const stats: ActStats = { nudgesSent: 0, draftsCreated: 0, customerSends: 0, loopsDeferred: 0 };
  const loops = await getOpenLoops();
  for (const [i, loop] of loops.entries()) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) {
      stats.loopsDeferred = loops.length - i;
      break;
    }
    if (loop.state === 'snoozed' && loop.snoozeUntil && loop.snoozeUntil > now) continue;
    // A sweep's own backlog summary is read in the digest, never texted.
    if (isDigestOnlyLoop(loop)) continue;

    // Fix 3: a snooze whose snoozeUntil has passed must wake up. nextEscalationLevel
    // only knows 'open' | 'nudged' | 'escalated' — a loop stuck at state 'snoozed'
    // maps to escalation level null forever, even past its wake time. So: persist
    // the wake as state 'open' first, then use 'open' for THIS sweep's computation.
    let effectiveState = loop.state;
    if (shouldWakeFromSnooze(loop, now)) {
      await db.update(openLoops).set({ state: 'open' }).where(eq(openLoops.id, loop.id));
      effectiveState = 'open';
    }

    const level = nextEscalationLevel({ ...loop, state: effectiveState }, await hoursSinceLastNudge(loop.id));
    if (level === null) continue;
    const action = classifyAction(loop);
    const owner = resolveOwner(loop.owner);
    const target: Exclude<Person, 'unassigned'> = level === 2 ? 'james' : owner;
    // Team nudges: emergency-urgency loops are exempt from quiet hours.
    const quiet = isQuietHours(now) && loop.urgency !== 'emergency';
    // Fix 4: customers get NO emergency exemption — an LLM-labeled 'emergency'
    // must never text a customer at 3 AM. Quiet hours apply unconditionally.
    const customerQuiet = isQuietHours(now);

    if (action === 'draft_only') {
      // Fix 2 & 7: recordNudge (the idempotency gate) fires FIRST, before any LLM
      // call or Gmail draft is created. Only a fresh (non-null) nudge id unlocks the
      // LLM generation + draft creation + owner notification below — otherwise an
      // already-escalated loop would burn an LLM call and create a duplicate Gmail
      // draft on every single sweep forever.
      const canDraft = Boolean(loop.contact?.email);
      const nudgeBody = canDraft
        ? `Draft ready in your Gmail: ${loop.summary}`
        : `No customer email on file — draft NOT created; handle manually: ${loop.summary}`;
      const nudgeId = await recordNudge(loop.id, owner, 'email', nudgeBody, level, DRY() ? 'dry_run' : 'sent');
      if (nudgeId !== null) {
        if (!DRY()) {
          try {
            if (canDraft) {
              const msg = await generateCustomerMessage({
                intent: `Draft for ${loop.kind}: ${loop.summary}`,
                context: (loop.evidence?.quotes ?? []).join('\n'),
                channel: 'email',
                customerName: loop.contact?.name,
              });
              await createDraftInMailbox(TEAM[owner].email, loop.contact!.email!, msg.subject ?? 'Following up', msg.body);
            }
            const providerRef = await sendAsMailbox(
              TEAM.james.email, TEAM[owner].email, `Draft ready: ${loop.summary.slice(0, 60)}`,
              canDraft
                ? `<p>${loop.summary}</p><p>A draft is in your Gmail drafts — review and send.</p>`
                : `<p>${loop.summary}</p><p>No customer email on file — draft NOT created; handle manually.</p>`,
            );
            await recordSendOutcome(nudgeId, providerRef);
          } catch (e: any) {
            // Generation, draft creation, or the notification email blew up after we'd
            // already reserved this idempotency slot — mark it failed so it's visible,
            // rather than silently leaving it recorded as sent with nothing done.
            console.error('[actor] draft-notify pipeline failed:', e?.message || e);
            await recordSendOutcome(nudgeId, null);
          }
        }
        if (canDraft) stats.draftsCreated++;
      }
      // Global rule: level 2 = SMS James. Draft-only loops aren't exempt — if a draft
      // has sat unactioned long enough to hit level 2, James also gets an escalation
      // SMS (subject to the same quiet-hours/rate-cap handling as any team nudge).
      // Keyed distinctly so it doesn't collide with the owner's draft-ready nudge above.
      if (level === 2) {
        const escalationBody = teamNudgeBody(loop, `draft still awaiting send by ${owner} — level 2 escalation`);
        if (await sendTeamNudge(loop, 'james', escalationBody, level, quiet, now, 'draft-escalation')) stats.nudgesSent++;
      }
    } else if (action === 'auto_customer' && level === 0) {
      // GHL sends need a real contact id — open_loops has no `raw` column, so for
      // GHL-sourced loops we resolve it live from the conversation. ANY loop without
      // a resolved contactId (non-GHL source, or GHL lookup failure) falls back to a
      // team nudge — never attempt a GHL send with an empty contactId.
      const contactId = loop.source === 'ghl' ? await getConversationContactId(loop.sourceRef) : null;
      const failedAttempts = contactId ? await countFailedCustomerSends(loop.id, level) : 0;
      const plan = resolveCustomerSendPlan(loop, contactId, customerQuiet, failedAttempts);

      if (plan.type === 'fallback_team_nudge') {
        const body = teamNudgeBody(loop, plan.note);
        if (await sendTeamNudge(loop, owner, body, level, quiet, now)) stats.nudgesSent++;
      } else if (plan.type === 'skip_quiet_hours') {
        // Customers never get texted at night. No nudge record, no state change —
        // this loop is untouched and will be reconsidered on the next sweep.
        continue;
      } else {
        // Fix 2: reserve the idempotency slot BEFORE burning an LLM call. `plan.channel`
        // is already known (resolveCustomerSendPlan decided it) — we don't need the
        // LLM's output just to record which loop/level/channel this nudge is for.
        const nudgeId = await recordNudge(loop.id, owner, plan.channel, '(generating…)', level, DRY() ? 'dry_run' : 'sent');
        if (nudgeId !== null) {
          // Whether a message actually left. A failed send used to still count
          // as a customer send and move the loop to 'nudged' — which never
          // retries level 0 — so the customer silently got nothing.
          let delivered = false;
          try {
            const msg = await generateCustomerMessage({
              intent: `Friendly follow-up for ${loop.kind}: ${loop.summary}`,
              context: (loop.evidence?.quotes ?? []).join('\n'),
              channel: plan.channel,
              customerName: loop.contact?.name,
            });
            await db.update(nudges).set({ channel: msg.channel, body: msg.body }).where(eq(nudges.id, nudgeId));
            if (!DRY()) {
              const convId = loop.source === 'ghl' ? loop.sourceRef : '';
              const result: GhlSendResult = msg.channel === 'sms'
                ? await trySendGhlSms(plan.contactId, msg.body)
                : loop.contact?.email
                  ? await trySendGhlEmail(plan.contactId, loop.contact.email, msg.subject ?? 'Best Roofing Now', msg.body)
                  : { ok: false, outcome: 'not_sent' };
              const send = result.ok ? result : null;
              await recordSendOutcome(nudgeId, send ? send.messageId : null);
              // A send that may have gone out keeps its slot and counts as
              // sent: the loop moves on to the team's follow-up like any sent
              // message, rather than texting the customer the same thing again.
              delivered = result.ok || result.outcome === 'unknown';
              if (send && convId) {
                const status = await getMessageStatus(convId, send.messageId);
                if (status === 'failed') {
                  await upsertLoop({
                    kind: 'integration_failure', source: 'ghl', sourceRef: `send-${send.messageId}`,
                    summary: `Message to ${loop.contact?.name ?? loop.sourceRef} FAILED to deliver — check GHL wallet/limits`,
                    owner: 'james', urgency: 'emergency',
                  });
                }
              }
            } else {
              delivered = true; // dry run: counted as before, nothing to retry
            }
          } catch (e: any) {
            // Message generation or the send pipeline blew up after we'd already
            // reserved this idempotency slot — mark it failed rather than leaving a
            // "sent" row with a placeholder body and no actual customer message.
            console.error('[actor] customer-send pipeline failed:', e?.message || e);
            // Past the send (the delivery check threw), the message is out:
            // keep the row as it is so the slot is not released and re-sent.
            if (!delivered) await recordSendOutcome(nudgeId, null);
          }
          if (!delivered) {
            // Give the slot back and leave the loop as it is, so the next sweep
            // tries again (until MAX_CUSTOMER_SEND_ATTEMPTS hands it to the team).
            if (!DRY()) await releaseFailedSlot(nudgeId, loop.id, level);
            continue;
          }
          stats.customerSends++;
        }
      }
    } else {
      // team nudge
      const body = teamNudgeBody(loop);
      if (await sendTeamNudge(loop, target, body, level, quiet, now)) stats.nudgesSent++;
    }
    await db.update(openLoops)
      .set({ state: level >= 1 ? 'escalated' : 'nudged' })
      .where(eq(openLoops.id, loop.id));
  }
  return stats;
}
