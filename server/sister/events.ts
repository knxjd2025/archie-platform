/**
 * Telling Roof Lee that something happened in Archie
 * (docs/archie/02-roof-lee-link.md; the agreement is "Events back to Roof Lee"
 * in docs/sisters/contract-v2.md in the Roof Lee repository).
 *
 *   lead.created   a new lead arrived that Roof Lee did not create
 *   job.finished   a job reached its finished stage on the production board
 *
 * The news is written to an outbox (outbound_events) when the thing happens,
 * sent right after, and tried again with growing waits until Roof Lee answers
 * that it has it. Roof Lee handles each event id once, so a repeat does no
 * harm; Archie still sends a delivered event no second time.
 *
 * OFF unless both SISTERS_ARCHIE_SECRET and ROOFLI_EVENTS_URL are set, and
 * then only for a live company that Roof Lee made. With either unset nothing
 * here touches the database or the network, for anyone.
 *
 * Nothing in this file may fail the work that caused the news: recording an
 * event never throws.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { waitUntil } from '@vercel/functions';
import { db } from '../db';
import { companies, leads, outboundEvents, type OutboundEvent } from '../../shared/schema';
import { isLiveCompany, LIVE_STATUSES } from '../../shared/company';
import { isPipelineStage, type PipelineStage } from '../../shared/production-pipeline';
import { currentCompanyId, runAsCompany, runAsSystem } from '../tenant/context';
import { getCurrentCompany } from '../tenant/companies';
import { pairSecret } from './door';
import { ROOFLI_LEAD_SOURCE } from './leads';
import { signRequest } from './verify';

/** Roof Lee's address for events. Its path is always this one, and it is what gets signed. */
export const EVENTS_PATH = '/api/sister/v1/events';
export const EVENTS_URL_ENV = 'ROOFLI_EVENTS_URL';
/** Which production stage means "finished" for Roof Lee. Unset or unknown: closed out. */
export const FINISHED_STAGE_ENV = 'ROOFLI_JOB_FINISHED_STAGE';
const DEFAULT_FINISHED_STAGE: PipelineStage = 'closed_out';

type Fetch = typeof fetch;

/**
 * Where events go, or null when the setting is missing or unusable. Accepts
 * Roof Lee's base address or the full events address; either way the request
 * goes to EVENTS_PATH on that host and nowhere else. Must be https (plain http
 * is allowed only to this machine, for tests).
 */
export function eventsUrl(): string | null {
  const raw = (process.env[EVENTS_URL_ENV] ?? '').trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== EVENTS_PATH) return null;
  return `${url.origin}${EVENTS_PATH}`;
}

/** True when this deployment sends news to Roof Lee at all. */
export function eventsOn(): boolean {
  return pairSecret() !== '' && eventsUrl() !== null;
}

/** The production stage that counts as a finished job. */
export function finishedStage(): PipelineStage {
  const chosen = (process.env[FINISHED_STAGE_ENV] ?? '').trim();
  return isPipelineStage(chosen) ? chosen : DEFAULT_FINISHED_STAGE;
}

/** Text as it is sent: trimmed, cut to length, or null when there is none. */
const words = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const tidy = value.trim().slice(0, max);
  return tidy || null;
};

/**
 * Puts one piece of news in the outbox for the current company and tries to
 * send it straight away. Does nothing when events are off, when there is no
 * company in context, or when the company is not one Roof Lee made.
 */
async function record(type: string, dedupeKey: string, occurredAt: Date, data: Record<string, unknown>): Promise<void> {
  try {
    if (!eventsOn()) return;
    const companyId = currentCompanyId();
    if (!companyId) return;
    const company = await getCurrentCompany();
    if (!company?.roofliCompanyId || !isLiveCompany(company)) return;
    const [row] = await db.insert(outboundEvents)
      .values({ id: `evt_${randomUUID().replace(/-/g, '')}`, dedupeKey, type, data, occurredAt })
      .onConflictDoNothing().returning({ id: outboundEvents.id });
    // Already told (or already waiting to be): one piece of news, one event.
    if (!row) return;
    // After the answer to whoever caused this, not before it.
    waitUntil(runAsCompany(companyId, () => deliverDue({ limit: 5 }), { loadProfile: false }).catch(() => {}));
  } catch (e) {
    const err = e as { name?: string; code?: string; cause?: { code?: string } } | null;
    console.error(`[sister] could not record ${type}: ${err?.name ?? 'error'}${err?.cause?.code ?? err?.code ? ` (${err?.cause?.code ?? err?.code})` : ''}`);
  }
}

type LeadRow = typeof leads.$inferSelect;

/**
 * A new lead arrived. Call it wherever Archie makes a lead of its own (typed
 * in by a person, or come in from a form or a text). Never for a lead Roof
 * Lee itself added.
 *
 * The JobTread sync (server/sync) must never call this: it rewrites its
 * copies on every run. That is kept by not calling it there, not by looking
 * at the source, because a lead a person types in is also filed under
 * 'jobtread' once the company's own JobTread has accepted it.
 */
export async function emitLeadCreated(lead: Pick<LeadRow, 'id' | 'source' | 'firstName' | 'lastName' | 'jobName' | 'phone' | 'email' | 'notes' | 'serviceType' | 'city' | 'createdAt'>): Promise<void> {
  if (!eventsOn()) return;
  if (lead.source === ROOFLI_LEAD_SOURCE) return;
  const name = [lead.firstName, lead.lastName].filter((x) => x && x !== 'null').join(' ').trim() || lead.jobName;
  await record('lead.created', `lead.created:${lead.id}`, lead.createdAt ?? new Date(), {
    leadId: String(lead.id),
    source: words(lead.source, 80),
    name: words(name, 200),
    phone: words(lead.phone, 40),
    email: words(lead.email, 254),
    message: words(lead.notes, 4000),
    jobType: words(lead.serviceType, 80),
    town: words(lead.city, 80),
  });
}

/**
 * A job reached its finished stage. Called from inside the move itself
 * (server/production/pipeline.ts), so a move made by automation is caught as
 * well as one made by a person. A job is finished once: moving it out of the
 * stage and back tells Roof Lee nothing new.
 */
export async function emitJobFinished(jobExternalId: string, finishedAt: Date): Promise<void> {
  if (!eventsOn()) return;
  try {
    const [lead] = await db.select().from(leads).where(eq(leads.externalId, jobExternalId));
    if (!lead) return;
    await record('job.finished', `job.finished:${lead.id}`, finishedAt, {
      jobId: String(lead.id),
      jobType: words(lead.serviceType, 80),
      town: words(lead.city, 80),
      // Archie keeps no record of a customer agreeing to their photos being
      // used, so it never says they did (that comes with task A8).
      photoConsent: false,
      finishedAt: finishedAt.toISOString(),
    });
  } catch {
    // Never fails the move.
  }
}

// ---- Sending ---------------------------------------------------------------

/** How long to wait after the nth failed try. The last one repeats. */
const WAITS_MINUTES = [1, 5, 15, 60, 180, 360, 720, 1440];
/** A try is given this long before another run may take the row again. */
const LEASE_MINUTES = 2;
/** Roof Lee has ten seconds to answer. */
const TIMEOUT_MS = 10_000;
/** News older than this is no longer sent. Roof Lee has stopped caring by then. */
const MAX_AGE_DAYS = 7;

export const waitAfter = (attempts: number): number => WAITS_MINUTES[Math.min(Math.max(attempts, 1), WAITS_MINUTES.length) - 1];

export type SendOutcome = 'delivered' | 'retry' | 'rejected';

/** Sends one event, signed over the method, the address and the body. Never throws. */
async function send(row: OutboundEvent, roofliCompanyId: string, http: Fetch): Promise<{ outcome: SendOutcome; note: string | null }> {
  const url = eventsUrl();
  const secret = pairSecret();
  if (!url || !secret) return { outcome: 'retry', note: 'not set up' };
  const body = JSON.stringify({
    id: row.id,
    product: 'archie',
    roofliCompanyId,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    data: row.data,
  });
  const at = Date.now();
  try {
    const res = await http(url, {
      method: 'POST',
      // Never follow a redirect: a signed request goes only where it was sent.
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        'x-roofli-timestamp': String(at),
        'x-roofli-signature': signRequest('POST', EVENTS_PATH, body, at, secret),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.arrayBuffer().catch(() => {});
    if (res.status >= 200 && res.status <= 299) return { outcome: 'delivered', note: null };
    // "I cannot read this": sending the same thing again will not help.
    if (res.status === 400) return { outcome: 'rejected', note: 'answered 400' };
    return { outcome: 'retry', note: `answered ${res.status}` };
  } catch {
    return { outcome: 'retry', note: 'no answer' };
  }
}

export interface DeliveryRun { delivered: number; failed: number; rejected: number; unanswered: number }

/**
 * Sends the current company's news that is due, oldest first. Must run as the
 * company. Each row is taken (its next try pushed forward) before it is sent,
 * so two runs at once never send the same row together.
 */
export async function deliverDue(opts: { limit?: number; http?: Fetch; deadline?: number } = {}): Promise<DeliveryRun> {
  const run: DeliveryRun = { delivered: 0, failed: 0, rejected: 0, unanswered: 0 };
  if (!eventsOn()) return run;
  const company = await getCurrentCompany();
  if (!company?.roofliCompanyId || !isLiveCompany(company)) return run;
  const http = opts.http ?? fetch;

  // Too old to be news any more.
  await db.update(outboundEvents).set({ gaveUpAt: sql`now()`, lastError: 'too old to send' })
    .where(sql`${outboundEvents.deliveredAt} IS NULL AND ${outboundEvents.gaveUpAt} IS NULL AND ${outboundEvents.createdAt} < now() - make_interval(days => ${MAX_AGE_DAYS})`);

  const due = await db.select({ id: outboundEvents.id }).from(outboundEvents)
    .where(sql`${outboundEvents.deliveredAt} IS NULL AND ${outboundEvents.gaveUpAt} IS NULL AND ${outboundEvents.nextAttemptAt} <= now()`)
    .orderBy(asc(outboundEvents.nextAttemptAt), asc(outboundEvents.createdAt)).limit(opts.limit ?? 25);

  for (const { id } of due) {
    if (opts.deadline && Date.now() >= opts.deadline) break;
    // Take it: only if it is still due. Whoever loses this simply moves on.
    const [row] = await db.update(outboundEvents)
      .set({ attempts: sql`${outboundEvents.attempts} + 1`, nextAttemptAt: sql`now() + make_interval(mins => ${LEASE_MINUTES})` })
      .where(sql`${outboundEvents.id} = ${id} AND ${outboundEvents.deliveredAt} IS NULL AND ${outboundEvents.gaveUpAt} IS NULL AND ${outboundEvents.nextAttemptAt} <= now()`)
      .returning();
    if (!row) continue;
    const { outcome, note } = await send(row, company.roofliCompanyId, http);
    if (outcome === 'delivered') {
      await db.update(outboundEvents).set({ deliveredAt: sql`now()`, lastError: null }).where(eq(outboundEvents.id, id));
      run.delivered++;
    } else if (outcome === 'rejected') {
      await db.update(outboundEvents).set({ gaveUpAt: sql`now()`, lastError: note }).where(eq(outboundEvents.id, id));
      run.rejected++;
    } else {
      await db.update(outboundEvents)
        .set({ nextAttemptAt: sql`now() + make_interval(mins => ${waitAfter(row.attempts)})`, lastError: note })
        .where(eq(outboundEvents.id, id));
      run.failed++;
      if (note === 'no answer') {
        run.unanswered++;
        // Roof Lee is not answering. Everything else here goes to the same place: stop.
        break;
      }
    }
  }
  return run;
}

/**
 * The scheduled run: sends every live Roof Lee company's due news, each as
 * that company. Stops early when Roof Lee stops answering or time runs short,
 * and picks up where it left off next time.
 */
export async function runEventDelivery(opts: { http?: Fetch; budgetMs?: number } = {}): Promise<{ on: boolean; companies: number } & DeliveryRun> {
  const total = { on: eventsOn(), companies: 0, delivered: 0, failed: 0, rejected: 0, unanswered: 0 };
  if (!total.on) return total;
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  // Only companies that have something due. Only their ids are read.
  const waiting = await runAsSystem('sister: find the Roof Lee companies with news waiting to be sent', () =>
    db.selectDistinct({ id: companies.id }).from(companies)
      .innerJoin(outboundEvents, eq(outboundEvents.companyId, companies.id))
      .where(and(
        isNotNull(companies.roofliCompanyId),
        inArray(companies.status, [...LIVE_STATUSES]),
        isNull(outboundEvents.deliveredAt), isNull(outboundEvents.gaveUpAt),
        sql`${outboundEvents.nextAttemptAt} <= now()`,
      )));
  for (const { id } of waiting) {
    if (Date.now() >= deadline || total.unanswered >= 2) break;
    try {
      const run = await runAsCompany(id, () => deliverDue({ http: opts.http, deadline }), { loadProfile: false });
      total.companies++;
      total.delivered += run.delivered; total.failed += run.failed; total.rejected += run.rejected; total.unanswered += run.unanswered;
    } catch (e) {
      console.error(`[sister] sending news failed for one company: ${(e as Error)?.name ?? 'error'}`);
    }
  }
  return total;
}
