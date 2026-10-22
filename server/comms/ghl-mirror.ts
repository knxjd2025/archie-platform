/**
 * Copy GoHighLevel's calls and messages into our own tables.
 *
 * This runs *before* any cutover and is the reason the cutover is low-risk:
 * the app starts owning the call history while GHL is still the one placing
 * the calls, so by the time Twilio takes over, the screens, the reports and
 * the KPI counts are already reading from our tables and nothing about them
 * has to change.
 *
 * It is also worth doing on its own merits. The app has logged eleven contact
 * events in its entire life while GHL holds 6,055 conversations, so nobody can
 * currently answer "how did the cold caller do last week" without leaving the
 * app — and that history disappears the day the subscription lapses.
 *
 * Read-only against GHL. It never writes there.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { calls, commMessages, phoneNumbers } from '../../shared/schema';
import { ghlCallToRow, ghlMessageToRow, callOutcome, type GhlMessage } from '../../shared/comms';
import { fetchWithTimeout } from '../lib/fetch-timeout';
import { GHL_API_BASE, GhlNotConnectedError, ghlConnection, ghlHeaders } from '../integrations/ghl/connection';

/**
 * Pages of 100 messages to read from one conversation. A long-running
 * customer thread can run to thousands; this is far past any thread the
 * window would reach and stops a runaway loop on a cursor that never ends.
 */
const MAX_MESSAGE_PAGES = 20;

/** A GET against the current company's own GHL sub-account. */
async function ghl<T>(path: string): Promise<T> {
  const conn = await ghlConnection();
  const r = await fetchWithTimeout(`${GHL_API_BASE}${path}`, { headers: ghlHeaders(conn, '2021-04-15') });
  if (!r.ok) throw new Error(`GHL ${r.status} on ${path.split('?')[0]}`);
  return r.json() as Promise<T>;
}

/** The numbers we own, so a row can record which of ours was on the call. */
async function ourNumbers(): Promise<string[]> {
  const rows = await db.select({ e164: phoneNumbers.e164 }).from(phoneNumbers);
  if (rows.length) return rows.map((r) => r.e164);
  // Before the numbers table is seeded, fall back to GHL's own list so the
  // first mirror run still attributes calls correctly.
  try {
    const { locationId } = await ghlConnection();
    const j = await ghl<{ phoneNumbers?: Array<{ value?: string }> }>(
      `/phone-system/numbers?locationId=${locationId}`,
    );
    return (j.phoneNumbers || []).map((n) => n.value || '').filter(Boolean);
  } catch { return []; }
}

export interface MirrorResult {
  conversations: number;
  callsSeen: number; callsWritten: number;
  messagesSeen: number; messagesWritten: number;
  errors: string[];
}

/**
 * Mirror the conversations touched since `since`.
 *
 * Deliberately bounded by `maxConversations`: GHL pages 100 at a time and a
 * full backfill of 6,055 is thousands of requests, which is a thing to run
 * deliberately rather than something a half-hourly cron should stumble into.
 */
export async function mirrorFromGhl(opts: {
  since: Date;
  maxConversations?: number;
} ): Promise<MirrorResult> {
  const out: MirrorResult = { conversations: 0, callsSeen: 0, callsWritten: 0, messagesSeen: 0, messagesWritten: 0, errors: [] };
  let locationId: string;
  try {
    ({ locationId } = await ghlConnection());
  } catch (e) {
    if (e instanceof GhlNotConnectedError) { out.errors.push(e.message); return out; }
    throw e;
  }

  const ours = await ourNumbers();
  const cap = opts.maxConversations ?? 200;
  const sinceMs = opts.since.getTime();

  let cursor = '';
  while (out.conversations < cap) {
    const url = `/conversations/search?locationId=${locationId}&limit=100&sortBy=last_message_date&sort=desc`
      + (cursor ? `&startAfterDate=${encodeURIComponent(cursor)}` : '');
    let page: { conversations?: Array<{ id: string; lastMessageDate?: string }> };
    try { page = await ghl(url); } catch (e) { out.errors.push(String((e as Error).message)); break; }

    const convs = page.conversations || [];
    if (!convs.length) break;

    for (const cv of convs) {
      // Sorted newest-first, so the first conversation older than the window
      // means every one after it is too.
      const last = cv.lastMessageDate ? new Date(cv.lastMessageDate).getTime() : 0;
      if (last && last < sinceMs) return out;

      out.conversations++;
      try {
        const list = await conversationMessages(cv.id, sinceMs);
        for (const msg of list) {
          const at = new Date(msg.dateAdded || 0).getTime();
          if (at && at < sinceMs) continue;

          const call = ghlCallToRow(msg, ours);
          if (call) {
            out.callsSeen++;
            if (await upsertCall(call)) out.callsWritten++;
            continue;
          }
          const text = ghlMessageToRow(msg, ours);
          if (text) {
            out.messagesSeen++;
            if (await upsertMessage(text)) out.messagesWritten++;
          }
        }
      } catch (e) {
        out.errors.push(`conversation ${cv.id}: ${(e as Error).message}`);
      }
      if (out.conversations >= cap) break;
    }
    cursor = convs[convs.length - 1]?.lastMessageDate || '';
    if (!cursor) break;
  }
  return out;
}

/**
 * The messages in one conversation since `sinceMs`, newest first.
 *
 * Only the first 100 were ever read, so any conversation with more than 100
 * messages in the window — a busy customer thread, the office line — lost
 * the rest from the call history and the KPI counts without a trace. Follows
 * GHL's `lastMessageId` cursor until a page reaches past the window.
 */
export async function conversationMessages(
  conversationId: string,
  sinceMs: number,
  fetchPage: (path: string) => Promise<any> = ghl,
): Promise<GhlMessage[]> {
  const all: GhlMessage[] = [];
  let lastMessageId = '';
  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const m = await fetchPage(
      `/conversations/${conversationId}/messages?limit=100`
        + (lastMessageId ? `&lastMessageId=${encodeURIComponent(lastMessageId)}` : ''),
    );
    const list: GhlMessage[] = m?.messages?.messages || (Array.isArray(m?.messages) ? m.messages : []);
    all.push(...list);

    const oldest = list[list.length - 1];
    const oldestAt = oldest?.dateAdded ? new Date(oldest.dateAdded).getTime() : 0;
    const next = m?.messages?.lastMessageId || oldest?.id || '';
    if (list.length < 100 || m?.messages?.nextPage === false || !next || next === lastMessageId) break;
    if (oldestAt && oldestAt < sinceMs) break;
    lastMessageId = next;
  }
  return all;
}

/**
 * Insert, or leave alone if we already have it.
 *
 * `DO NOTHING` rather than `DO UPDATE` on purpose: once Twilio is placing the
 * calls it will write richer rows (recording, transcript, who answered), and a
 * re-run of the mirror must not overwrite those with GHL's thinner version.
 */
async function upsertCall(row: ReturnType<typeof ghlCallToRow>): Promise<boolean> {
  if (!row?.providerSid) return false;
  const r = await db.insert(calls).values({
    provider: row.provider,
    providerSid: row.providerSid,
    direction: row.direction,
    fromE164: row.fromE164,
    toE164: row.toE164,
    ourNumber: row.ourNumber,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    answeredBy: row.answeredBy,
    outcome: callOutcome(row),
  }).onConflictDoNothing({ target: calls.providerSid }).returning({ id: calls.id });
  return r.length > 0;
}

async function upsertMessage(row: NonNullable<ReturnType<typeof ghlMessageToRow>>): Promise<boolean> {
  if (!row.providerSid) return false;
  const r = await db.insert(commMessages).values({
    provider: row.provider,
    providerSid: row.providerSid,
    channel: row.channel,
    direction: row.direction,
    fromAddr: row.fromAddr,
    toAddr: row.toAddr,
    ourNumber: row.ourNumber,
    subject: row.subject,
    body: row.body,
    status: row.status,
    sentAt: row.sentAt,
  }).onConflictDoNothing({ target: commMessages.providerSid }).returning({ id: commMessages.id });
  return r.length > 0;
}

/** Link mirrored rows to leads by phone number, for the ones we can match. */
export async function linkCallsToLeads(): Promise<number> {
  const r = await db.execute(sql`
    UPDATE calls c
       SET lead_id = l.id, lead_external_id = l.external_id
      FROM leads l
     WHERE c.lead_id IS NULL
       AND l.phone IS NOT NULL
       AND regexp_replace(l.phone, '\\D', '', 'g') <> ''
       AND right(regexp_replace(l.phone, '\\D', '', 'g'), 10)
           = right(regexp_replace(CASE WHEN c.direction = 'outbound' THEN c.to_e164 ELSE c.from_e164 END, '\\D', '', 'g'), 10)
  `);
  return (r as any)?.rowCount ?? 0;
}
