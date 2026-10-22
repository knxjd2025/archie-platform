import type { BrainEvent } from './types';
import type { LoopInput } from './loop-store';

/**
 * Loops whose sourceRef starts with this are digest-only: they sit in the
 * daily digest email and the actor never nudges them. A sweep's own problems
 * (events it could not triage) are a status for James to read, not one text
 * per event — a 200-event backlog used to be 200 loops and 200 nudges.
 */
export const DIGEST_ONLY_REF_PREFIX = 'sweep-backlog:';

export function isDigestOnlyLoop(loop: { sourceRef: string }): boolean {
  return loop.sourceRef.startsWith(DIGEST_ONLY_REF_PREFIX);
}

export type BacklogKind = 'triage-failed' | 'not-triaged';

const SAMPLE = 20;

/**
 * ONE loop standing for every event a sweep could not triage, keyed by kind
 * so the next sweep updates it instead of adding another. It carries the
 * count and the first few events, so James can see what to look at. Returns
 * null when there is nothing to report.
 */
export function backlogLoop(kind: BacklogKind, events: BrainEvent[], now: Date): LoopInput | null {
  if (events.length === 0) return null;
  const what = kind === 'triage-failed' ? 'failed triage' : 'were not triaged';
  return {
    kind: 'custom',
    source: 'manual',
    sourceRef: `${DIGEST_ONLY_REF_PREFIX}${kind}`,
    summary: `${events.length} event(s) ${what} in the ${now.toISOString().slice(0, 16)}Z sweep — needs manual review`,
    owner: 'james',
    urgency: 'normal',
    evidence: {
      quotes: events.slice(0, SAMPLE).map((ev) => `${ev.source}:${ev.sourceRef}${ev.mailbox ? ` (${ev.mailbox})` : ''} — ${ev.text.slice(0, 140)}`),
    },
    // A new batch of failures reopens the loop after James closes the last one.
    occurredAt: now,
  };
}
