import { inArray } from 'drizzle-orm';
import { getDelegatedCalendar } from '../brain/calendar-brain';
import { appointments, teamMembers } from '../../shared/schema';
import { db } from '../db';
import { upsertBySourceId } from './run';
import { mapAppointment, type RawGEvent } from './calendar-map';

// Fallback if the roster query returns nothing — the working calendars from the
// caught-up audit: sales (Banning), office (Admin), owner (James). Syncing zero
// mailboxes would silently empty the team schedule, which reads as "nobody has
// any appointments" rather than as a failure.
const FALLBACK_SOURCES = [
  'banning@bestroofingnow.com',
  'admin@bestroofingnow.com',
  'james@bestroofingnow.com',
];

/**
 * Which mailboxes to sweep. Derived from the team roster rather than hard-coded
 * so a new hire's calendar appears without a code change — the previous fixed
 * list silently omitted Thomas, whose appointments were invisible to the whole
 * app even though delegation worked for his mailbox.
 */
export function calendarMailboxes(
  members: Array<{ email: string | null; active: boolean | null }>,
): string[] {
  const seen = new Set<string>();
  for (const m of members) {
    if (!m.active) continue;
    const email = (m.email || '').trim().toLowerCase();
    if (email.includes('@')) seen.add(email);
  }
  return seen.size ? Array.from(seen).sort() : [...FALLBACK_SOURCES];
}

export interface StoredAppointment { sourceId: string; calendarSource: string | null; start: Date | null }

/**
 * The stored rows a finished sweep proves are gone from Google — i.e. cancelled
 * or deleted. Pure, because the safety rules are the whole point and they are
 * worth testing without a calendar or a database:
 *
 *  - only mailboxes whose listing actually completed (`swept`). A mailbox whose
 *    events.list threw tells us nothing, and treating its silence as "every
 *    appointment was cancelled" would wipe that rep's schedule on a blip.
 *  - only rows inside the window we asked Google about. Anything older or
 *    further out was never a candidate, so its absence means nothing.
 *  - rows with no start are never pruned: we cannot place them in the window.
 */
export function prunableSourceIds(
  stored: StoredAppointment[],
  seen: Set<string>,
  swept: string[],
  window: { from: Date; to: Date },
): string[] {
  const sweptSet = new Set(swept);
  return stored
    .filter((r) => r.calendarSource !== null && sweptSet.has(r.calendarSource))
    .filter((r) => r.start !== null && r.start >= window.from && r.start <= window.to)
    .filter((r) => !seen.has(r.sourceId))
    .map((r) => r.sourceId);
}

/**
 * Every event in the window for one mailbox, following Google's paging to the end.
 *
 * Paging is not an optimisation here: a truncated listing is indistinguishable
 * from a pile of cancellations to the prune below. James's calendar alone holds
 * ~300 events in this window against a 250 page size, so a single-page read
 * would hand the prune 50 live appointments to delete every hour.
 */
async function listAllEvents(mailbox: string, timeMin: string, timeMax: string): Promise<RawGEvent[]> {
  const cal = getDelegatedCalendar(mailbox);
  const out: RawGEvent[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({ calendarId: mailbox, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 250, pageToken });
    out.push(...((res.data.items ?? []) as RawGEvent[]));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export async function syncCalendar(now: Date = new Date()): Promise<Record<string, number>> {
  const from = new Date(now.getTime() - 14 * 864e5);
  const to = new Date(now.getTime() + 30 * 864e5);
  const timeMin = from.toISOString();
  const timeMax = to.toISOString();
  const roster = await db.select().from(teamMembers);
  const rows: any[] = [];
  const seen = new Set<string>();
  const swept: string[] = [];
  let failed = 0;
  for (const mailbox of calendarMailboxes(roster)) {
    try {
      for (const ev of await listAllEvents(mailbox, timeMin, timeMax)) {
        const row = mapAppointment(ev, mailbox);
        if (!row) continue;
        rows.push(row);
        seen.add(row.sourceId);
      }
      swept.push(mailbox);
    } catch (e: any) {
      // One mailbox without a calendar (or missing from the delegation grant)
      // must not abort the sweep and drop everyone else's appointments. It is
      // also left out of `swept`, so nothing of its is pruned below.
      failed++;
      console.warn(`[calendar-sync] ${mailbox}: ${e?.message || 'events.list failed'}`);
    }
  }
  const n = await upsertBySourceId(appointments, rows);
  const removed = await pruneCancelled(seen, swept, { from, to });
  return {
    appointments: n,
    ...(removed ? { removed } : {}),
    ...(failed ? { failedMailboxes: failed } : {}),
  };
}

/**
 * Drop the rows whose Google event has gone. Without this a cancelled
 * appointment lived in the app forever — upserting alone can only ever add.
 */
async function pruneCancelled(seen: Set<string>, swept: string[], window: { from: Date; to: Date }): Promise<number> {
  if (!swept.length) return 0;
  // The whole table, deliberately: it holds a 44-day window across the roster
  // (low thousands of rows), and reading it whole keeps every rule about what
  // may be deleted inside the one pure function above.
  const stored: StoredAppointment[] = await db
    .select({ sourceId: appointments.sourceId, calendarSource: appointments.calendarSource, start: appointments.start })
    .from(appointments);
  const gone = prunableSourceIds(stored, seen, swept, window);
  for (let i = 0; i < gone.length; i += 200) {
    await db.delete(appointments).where(inArray(appointments.sourceId, gone.slice(i, i + 200)));
  }
  return gone.length;
}
