import { db } from '../db';
import { openLoops } from '../../shared/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Person, Urgency, LoopSource } from './types';

export interface LoopInput {
  kind: string;
  source: LoopSource;
  sourceRef: string;
  summary: string;
  owner?: Person;
  urgency?: Urgency;
  dueAt?: Date;
  contact?: { name?: string; phone?: string; email?: string };
  evidence?: { quotes: string[]; links?: string[] };
  claimId?: number;
  /** When the underlying signal happened (a message's own timestamp, the moment
   *  a deterministic condition became true). Only this can reopen a loop a
   *  person closed — see shouldReopen. Leave it out for a finding that is just
   *  being re-emitted. */
  occurredAt?: Date;
}

export function makeDedupeKey(kind: string, source: string, sourceRef: string): string {
  return `${kind}:${source}:${sourceRef}`.replace(/\s+/g, '_');
}

/** closedBy values written by the sweeps themselves, not by a person. */
const SELF_CLOSE_SUFFIX = ':self-close';

/**
 * Whether an upsert should reopen an existing loop. Pure, and mirrored by the
 * CASE in upsertLoop — keep the two in step.
 *
 * Deterministic findings (a stale estimate, a claim rule) are re-emitted every
 * hour for as long as the condition holds. Reopening every done/dismissed loop
 * on any upsert meant a loop James closed by texting DONE came back an hour
 * later, every hour. So:
 *  - dismissed stays dismissed: a person said this is not a real obligation.
 *  - a loop a sweep closed itself (the event moved, the team replied) reopens
 *    when the signal comes back — that is what self-close assumes.
 *  - a loop a person closed reopens only on something newer than the close:
 *    a new message after it, or the condition starting over.
 */
export function shouldReopen(
  existing: { state: string; closedAt: Date | null; closedBy: string | null },
  occurredAt?: Date,
): boolean {
  if (existing.state !== 'done') return false;
  if ((existing.closedBy ?? '').endsWith(SELF_CLOSE_SUFFIX)) return true;
  if (!occurredAt) return false;
  return !existing.closedAt || occurredAt.getTime() > new Date(existing.closedAt).getTime();
}

export async function upsertLoop(input: LoopInput): Promise<{ id: number; created: boolean }> {
  const dedupeKey = makeDedupeKey(input.kind, input.source, input.sourceRef);
  const occurredAtIso = input.occurredAt ? input.occurredAt.toISOString() : null;
  const [row] = await db
    .insert(openLoops)
    .values({
      kind: input.kind as any,
      source: input.source,
      sourceRef: input.sourceRef,
      dedupeKey,
      summary: input.summary,
      owner: input.owner ?? 'unassigned',
      urgency: input.urgency ?? 'normal',
      dueAt: input.dueAt,
      contact: input.contact,
      evidence: input.evidence,
      claimId: input.claimId,
    })
    .onConflictDoUpdate({
      target: [openLoops.companyId, openLoops.dedupeKey],
      set: {
        summary: input.summary,
        urgency: input.urgency ?? 'normal',
        lastEventAt: new Date(),
        // shouldReopen, in SQL. The timestamp is passed as an ISO string cast to
        // timestamp (no time zone), the same way Drizzle stores these columns —
        // a bare Date would be serialized in the server's local zone.
        state: sql`CASE WHEN ${openLoops.state} = 'done' AND (
          coalesce(${openLoops.closedBy}, '') LIKE ${'%' + SELF_CLOSE_SUFFIX}
          OR (${occurredAtIso}::timestamp IS NOT NULL AND (${openLoops.closedAt} IS NULL OR ${occurredAtIso}::timestamp > ${openLoops.closedAt}))
        ) THEN 'open'::loop_state ELSE ${openLoops.state} END`,
      },
    })
    .returning();
  const created = Date.now() - new Date(row.openedAt).getTime() < 5000;
  return { id: row.id, created };
}

const LIVE_STATES = ['open', 'nudged', 'escalated', 'snoozed'] as const;

export async function closeLoopByKey(dedupeKey: string, closedBy: string): Promise<boolean> {
  // Only a live loop: re-closing one a person already closed would overwrite
  // their closedBy with a sweep's, and a sweep-closed loop is one shouldReopen
  // lets the next signal reopen — so a dismissed loop could come back.
  const res = await db
    .update(openLoops)
    .set({ state: 'done', closedAt: new Date(), closedBy })
    .where(and(eq(openLoops.dedupeKey, dedupeKey), inArray(openLoops.state, [...LIVE_STATES])))
    .returning();
  return res.length > 0;
}

export async function getOpenLoops() {
  return db
    .select()
    .from(openLoops)
    .where(inArray(openLoops.state, [...LIVE_STATES]));
}
