import { z } from 'zod';
import type { BrainEvent } from './types';
import { completeJson } from './llm';
import { upsertLoop, closeLoopByKey, makeDedupeKey } from './loop-store';

const KINDS = [
  'unanswered_inbound', 'new_lead_untouched', 'promise_made', 'claim_milestone',
  'estimate_stale', 'invoice_unpaid', 'appointment_conflict', 'appointment_stale_confirmed',
  'callback_requested', 'custom',
] as const;

// Optional fields carry .catch(undefined): a model quirk on a nice-to-have field
// (dueInHours: 0 was observed on EVERY gmail batch — .positive() rejected it and
// one bad field parked all 25 events of the batch, every sweep) must degrade to
// "field absent", never poison the whole batch. Required fields stay strict.
export const TriageDecisionSchema = z.object({
  decisions: z.array(z.object({
    action: z.enum(['open', 'close', 'ignore']),
    // kind is only meaningful when OPENING a loop. The model sometimes invents a
    // label off the prompt's own wording (e.g. "bid_invite_blast" for PlanHub bid
    // blasts it's correctly ignoring). A strict enum here parked all 25 events of
    // the batch on one out-of-list value — same failure mode the .catch()s below
    // guard against. Degrade an unknown kind to 'custom' so the decision (esp.
    // ignore) still lands instead of poisoning the whole batch.
    kind: z.enum(KINDS).catch('custom'),
    source: z.enum(['gmail', 'ghl', 'jobtread', 'calendar', 'sms']),
    sourceRef: z.string().min(1),
    summary: z.string().min(1),
    owner: z.enum(['james', 'thomas', 'banning', 'admin', 'unassigned']),
    urgency: z.enum(['emergency', 'urgent', 'normal', 'low']),
    dueInHours: z.number().positive().optional().catch(undefined),
    quote: z.string().optional().catch(undefined),
    contactName: z.string().optional().catch(undefined),
    contactPhone: z.string().optional().catch(undefined),
    contactEmail: z.string().optional().catch(undefined),
  })),
});

export type TriageDecision = z.infer<typeof TriageDecisionSchema>['decisions'][number];

export function parseTriageResponse(raw: unknown): TriageDecision[] {
  return TriageDecisionSchema.parse(raw).decisions;
}

const SYSTEM = `You are the operations triage engine for Best Roofing Now, a roofing company in Charlotte NC.
Team: james (owner), thomas (sales), banning (sales), admin (office).
You receive a batch of recent activity events (emails, SMS conversations, job-system findings).
For each event decide: open a loop (something a human must do), close a loop (the event shows a prior obligation was resolved — e.g. a team member replied, an invoice got paid), or ignore (newsletters, vendor spam, bid-invite blasts, robocalls, internal notifications with no action).
Loop kinds: unanswered_inbound (customer wrote, no human reply), new_lead_untouched (lead only got bot responses), promise_made (someone on the team promised an action — "I'll send that over"), estimate_stale, invoice_unpaid, appointment_conflict, appointment_stale_confirmed, callback_requested, claim_milestone, custom.
Assign the owner whose mailbox/conversation it is, or james if unclear. Urgency: emergency = same-hour (active leak, angry churn risk, failed delivery to a hot lead); urgent = same-day; normal = 1-2 days; low = this week.
Reply with JSON: {"decisions":[{"action","kind","source","sourceRef","summary","owner","urgency","dueInHours","quote","contactName","contactPhone","contactEmail"}]}.
sourceRef MUST be copied exactly from the event. Quote the customer's own words in "quote" when opening loops.
dueInHours: include ONLY when action is "open" and there is a real deadline; it must be greater than 0; otherwise omit the field entirely.`;

export interface TriageResult {
  decisions: TriageDecision[];
  /** Events whose batch blew up (LLM call or JSON parse failure). Never dropped —
   *  the route parks each one as a manual-review loop instead of losing it. */
  failed: BrainEvent[];
  /** Why each failed batch failed — surfaced into brain_runs.errors so a recurring
   *  failure is diagnosable from the run log instead of being a silent count. */
  failureMessages: string[];
  /** Events never sent to the model because the sweep ran out of time. Parked
   *  by the route the same way failed ones are. */
  deferred: BrainEvent[];
}

export interface TriageOptions {
  /** Epoch ms. No new batch starts after this; what is left comes back as `deferred`. */
  deadline?: number;
  /** Batches in flight at once. */
  concurrency?: number;
}

const BATCH_SIZE = 25;

async function triageBatch(batch: BrainEvent[]): Promise<TriageDecision[]> {
  const user = JSON.stringify(batch.map((e) => ({
    source: e.source, sourceRef: e.sourceRef, mailbox: e.mailbox,
    occurredAt: e.occurredAt, direction: e.direction, contact: e.contact, text: e.text.slice(0, 1500),
  })));
  return parseTriageResponse(await completeJson(SYSTEM, user));
}

export async function triageEvents(events: BrainEvent[], opts: TriageOptions = {}): Promise<TriageResult> {
  const decisions: TriageDecision[] = [];
  const failed: BrainEvent[] = [];
  const failureMessages: string[] = [];
  const deferred: BrainEvent[] = [];
  if (events.length === 0) return { decisions, failed, failureMessages, deferred };
  const batches: BrainEvent[][] = [];
  for (let i = 0; i < events.length; i += BATCH_SIZE) batches.push(events.slice(i, i + BATCH_SIZE));
  // A few batches at a time: one after another, a busy hour's batches alone
  // outlasted the 300s function. Kept small so a burst stays inside the
  // model's rate limits.
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  for (let g = 0; g < batches.length; g += concurrency) {
    // The sweep's time budget: stop starting batches once it has passed, and
    // hand the rest back so nothing is lost to Vercel killing the function.
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) {
      deferred.push(...batches.slice(g).flat());
      break;
    }
    const group = batches.slice(g, g + concurrency);
    // Per-batch error isolation: one batch's LLM call blowing up (bad completion,
    // JSON that fails schema validation, network error, timeout, etc.) must not
    // sink every other batch in the sweep. We isolate the failure to this batch's
    // events and keep going — those events get parked for manual review by the
    // caller instead of being silently dropped.
    const settled = await Promise.allSettled(group.map(triageBatch));
    settled.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        decisions.push(...r.value);
      } else {
        failed.push(...group[j]);
        failureMessages.push(`batch ${g + j}: ${String(r.reason?.message ?? r.reason).slice(0, 200)}`);
      }
    });
  }
  return { decisions, failed, failureMessages, deferred };
}

/** An event's timestamp as a Date, or undefined when it does not parse. */
export function eventTime(ev: Pick<BrainEvent, 'occurredAt'>): Date | undefined {
  const t = new Date(ev.occurredAt);
  return Number.isNaN(t.getTime()) ? undefined : t;
}

export async function applyTriage(
  decisions: TriageDecision[],
  now: Date,
  events: BrainEvent[],
): Promise<{ opened: number; closed: number; skipped: number }> {
  // Whitelist of source:sourceRef pairs that were actually in the batch we asked
  // the LLM to triage. A decision referencing anything else means the model
  // fabricated or swapped a sourceRef — acting on it could send one customer's
  // message to another customer's thread. Reject and count, don't act.
  const validRefs = new Map(events.map((e) => [`${e.source}:${e.sourceRef}`, e]));
  let opened = 0;
  let closed = 0;
  let skipped = 0;
  for (const d of decisions) {
    const ev = validRefs.get(`${d.source}:${d.sourceRef}`);
    if (!ev) {
      skipped++;
      continue;
    }
    if (d.action === 'ignore') continue;
    if (d.action === 'close') {
      if (await closeLoopByKey(makeDedupeKey(d.kind, d.source, d.sourceRef), 'triage:self-close')) closed++;
      continue;
    }
    const { created } = await upsertLoop({
      kind: d.kind,
      source: d.source,
      sourceRef: d.sourceRef,
      summary: d.summary,
      owner: d.owner,
      urgency: d.urgency,
      dueAt: d.dueInHours ? new Date(now.getTime() + d.dueInHours * 3_600_000) : undefined,
      contact: { name: d.contactName, phone: d.contactPhone, email: d.contactEmail },
      evidence: d.quote ? { quotes: [d.quote] } : undefined,
      // The message's own time: a closed loop reopens only for a message that
      // arrived after it was closed.
      occurredAt: eventTime(ev),
    });
    if (created) opened++;
  }
  return { opened, closed, skipped };
}
