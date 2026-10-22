import type { BrainEvent } from './types';
import type { LoopInput } from './loop-store';
import { TEAM } from './types';
import { fetchMailboxDelta } from './gmail-delegated';
import { fetchGhlDelta } from './ghl-brain';
import { fetchJobtreadFindings } from './jobtread-brain';
import { getCursor, setCursor } from './cursor-store';

export function dedupeEvents(events: BrainEvent[]): BrainEvent[] {
  const byKey = new Map<string, BrainEvent>();
  for (const e of events) {
    const key = `${e.source}:${e.sourceRef}`;
    const prev = byKey.get(key);
    if (!prev || e.occurredAt > prev.occurredAt) byKey.set(key, e);
  }
  return [...byKey.values()];
}

/** A cursor a fetch produced, not yet saved. `previous` is where the fetch
 *  started — a held-back cursor never goes behind it. */
export interface PendingCursor { source: string; channel: string; cursor: string; previous?: string | null }

/**
 * Where an event sits in its source's cursor: the Gmail history record that
 * added it, or the GHL conversation's last-message time (the GHL cursor is
 * that time, in epoch ms). null when the event does not say.
 */
export function cursorPosition(ev: BrainEvent): bigint | null {
  try {
    if (ev.source === 'gmail') {
      const h = (ev.raw as { historyId?: unknown } | undefined)?.historyId;
      return typeof h === 'string' && /^\d+$/.test(h) ? BigInt(h) : null;
    }
    if (ev.source === 'ghl') {
      const t = Date.parse(ev.occurredAt);
      return Number.isNaN(t) ? null : BigInt(t);
    }
  } catch {
    return null;
  }
  return null;
}

/** Which pending cursor an event was read under. */
function cursorChannel(ev: BrainEvent): { source: string; channel: string } | null {
  if (ev.source === 'gmail') return ev.mailbox ? { source: 'gmail', channel: ev.mailbox } : null;
  if (ev.source === 'ghl') return { source: 'ghl', channel: '' };
  return null;
}

/**
 * Put events in the order triage should take them: oldest first within each
 * cursor, and the cursors taken in turn. Triage stops at its time budget and
 * hands back the tail, so the part it did reach is the oldest of every source —
 * the cursor can then be committed up to where it stopped and still make
 * progress. GHL comes back newest first; triaged in that order, a backlog
 * bigger than one sweep would re-read the same newest conversations forever.
 * Taking the sources in turn keeps a big mail backlog from starving GHL texts.
 */
export function orderForTriage(events: BrainEvent[]): BrainEvent[] {
  const groups = new Map<string, BrainEvent[]>();
  for (const ev of events) {
    const ch = cursorChannel(ev);
    const key = ch ? `${ch.source}:${ch.channel}` : `other:${ev.source}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }
  const sorted = [...groups.values()].map((list) => list
    .map((ev, i) => ({ ev, i, pos: cursorPosition(ev) }))
    .sort((a, b) => {
      if (a.pos !== null && b.pos !== null && a.pos !== b.pos) return a.pos < b.pos ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.ev));
  const out: BrainEvent[] = [];
  for (let i = 0; out.length < events.length; i++) {
    for (const list of sorted) if (i < list.length) out.push(list[i]);
  }
  return out;
}

export interface CursorPlan {
  /** What to save: each fetch's cursor, held back to just before the oldest
   *  event this sweep did not triage. */
  commits: PendingCursor[];
  /** Untriaged events the cursor still moves past, because they carry no
   *  position to hold it at. The caller must park these — they will not be
   *  read again. */
  unheld: BrainEvent[];
}

/**
 * Hold each cursor back so the events the sweep ran out of time for are read
 * again next sweep. These used to be parked as one "needs manual review" loop
 * each and the cursor moved past them: a backlog of 200 events was 200 loops
 * and 200 texts to James, and none of them were ever triaged. Both sources
 * resume after the saved position (Gmail: records after the history id; GHL:
 * conversations newer than the time), so the hold is the oldest untriaged
 * position less one. Triaged events newer than that are read and applied again,
 * which is harmless — loops are upserted by dedupe key.
 */
export function planCursorCommits(cursors: PendingCursor[], untriaged: BrainEvent[]): CursorPlan {
  const unheld: BrainEvent[] = [];
  const oldest = new Map<string, bigint>();
  for (const ev of untriaged) {
    const ch = cursorChannel(ev);
    const pos = cursorPosition(ev);
    if (!ch || pos === null) { unheld.push(ev); continue; }
    const key = `${ch.source}:${ch.channel}`;
    const prev = oldest.get(key);
    if (prev === undefined || pos < prev) oldest.set(key, pos);
  }
  const commits = cursors.map((c) => {
    const pos = oldest.get(`${c.source}:${c.channel}`);
    if (pos === undefined || !/^\d+$/.test(c.cursor)) return c;
    let held = pos - BigInt(1);
    if (c.previous && /^\d+$/.test(c.previous) && held < BigInt(c.previous)) held = BigInt(c.previous);
    if (held > BigInt(c.cursor)) held = BigInt(c.cursor);
    return { ...c, cursor: held.toString() };
  });
  // An untriaged event whose cursor the sweep did not produce (its fetch
  // failed) cannot be held either.
  for (const ev of untriaged) {
    const ch = cursorChannel(ev);
    if (ch && cursorPosition(ev) !== null && !cursors.some((c) => c.source === ch.source && c.channel === ch.channel)) unheld.push(ev);
  }
  return { commits, unheld };
}

export interface IngestResult {
  events: BrainEvent[];
  /** JobTread findings, already in loop form — they skip LLM triage. */
  jobtreadLoops: LoopInput[];
  /** Where Gmail/GHL would resume. Saved by commitCursors only once these
   *  events have been triaged and applied (or parked): saving them here, before
   *  triage, meant a sweep killed by the 300s limit lost every event it had
   *  read — the next sweep started after them. */
  cursors: PendingCursor[];
  errors: Array<{ source: string; message: string }>;
}

export async function commitCursors(cursors: PendingCursor[]): Promise<void> {
  for (const c of cursors) await setCursor(c.source, c.channel, c.cursor);
}

export async function runIngest(now: Date): Promise<IngestResult> {
  const events: BrainEvent[] = [];
  const cursors: PendingCursor[] = [];
  const errors: Array<{ source: string; message: string }> = [];
  let jobtreadLoops: LoopInput[] = [];

  for (const person of Object.keys(TEAM) as Array<keyof typeof TEAM>) {
    const mailbox = TEAM[person].email;
    try {
      const cursor = await getCursor('gmail', mailbox);
      const { events: evs, newCursor } = await fetchMailboxDelta(mailbox, cursor);
      events.push(...evs);
      cursors.push({ source: 'gmail', channel: mailbox, cursor: newCursor, previous: cursor });
    } catch (e: any) {
      const errorMessage = String(e?.message ?? e);
      // Stale cursor recovery: if error is 404 or mentions historyId, reset to latest
      // (Gmail's history API returns "Requested entity was not found." for expired cursors)
      if (errorMessage.includes('404') || errorMessage.includes('historyId') || errorMessage.toLowerCase().includes('not found')) {
        try {
          // Saved right away: a reset carries no events, so there is nothing
          // for a killed sweep to lose.
          const { newCursor } = await fetchMailboxDelta(mailbox, null);
          await setCursor('gmail', mailbox, newCursor);
          errors.push({ source: `gmail:${mailbox}`, message: `stale history cursor reset: ${errorMessage}` });
        } catch (recoveryError: any) {
          // Recovery failed, record original error
          errors.push({ source: `gmail:${mailbox}`, message: errorMessage });
        }
      } else {
        errors.push({ source: `gmail:${mailbox}`, message: errorMessage });
      }
    }
  }

  try {
    const cursor = await getCursor('ghl', '');
    const since = cursor ? Number(cursor) : now.getTime() - 86_400_000; // first run: 24h lookback
    const { events: evs, newCursor } = await fetchGhlDelta(since);
    events.push(...evs);
    cursors.push({ source: 'ghl', channel: '', cursor: newCursor, previous: String(since) });
  } catch (e: any) {
    errors.push({ source: 'ghl', message: String(e?.message ?? e) });
  }

  try {
    jobtreadLoops = await fetchJobtreadFindings(now);
  } catch (e: any) {
    errors.push({ source: 'jobtread', message: String(e?.message ?? e) });
  }

  return { events: orderForTriage(dedupeEvents(events)), jobtreadLoops, cursors, errors };
}
