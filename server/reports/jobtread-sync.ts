/**
 * Keeps a report's JobTread proposal in step with the report.
 *
 * Before this, pushing a report always CREATED a document. Push twice and the
 * job had two proposals with two different prices; refine a report after a
 * push and JobTread silently kept the old numbers. Neither was visible
 * anywhere.
 *
 * The rule, which is a business rule and not a technical one:
 *   draft            → update it in place. Nobody has seen it.
 *   pending/approved → REFUSE. It has gone to the customer for signature, or
 *                      they have signed it. Rewriting the pricing underneath
 *                      someone is not an update; it is a different document,
 *                      and it needs a new, clearly-named version.
 *
 * Staleness is measured on the LINE ITEMS, not the whole report, so tightening
 * a sentence does not nag about an out-of-date proposal while a price change
 * does.
 */
import { createHash } from 'crypto';
import type { JobTreadDocLine } from '../integrations/jobtread';

/** Statuses whose document may still be rewritten. */
export const EDITABLE_STATUSES = ['draft'] as const;
/** Statuses that mean a customer is relying on the document as it stands. */
export const CUSTOMER_FACING_STATUSES = ['pending', 'approved'] as const;

/**
 * Fingerprint of what was actually sent to JobTread.
 *
 * Deliberately covers name, quantity and prices only — the fields that change
 * what a customer pays. Order is normalised so a reshuffled estimate that
 * prices identically does not read as a change.
 */
export function linesFingerprint(lines: JobTreadDocLine[]): string {
  const norm = lines
    .map((l) => [
      String(l.name || '').trim().toLowerCase(),
      Number(l.quantity) || 0,
      Math.round((Number(l.unitPrice) || 0) * 100),
      Math.round((Number(l.unitCost) || 0) * 100),
    ].join('|'))
    .sort();
  return createHash('sha1').update(JSON.stringify(norm)).digest('hex').slice(0, 16);
}

export interface SyncState {
  documentId: string | null;
  pushedHash: string | null;
  docStatus: string | null;
}

export type SyncVerdict =
  | { action: 'create'; reason: string }
  | { action: 'update'; documentId: string; reason: string }
  | { action: 'up_to_date'; documentId: string; reason: string }
  | { action: 'blocked'; documentId: string; status: string; reason: string };

/**
 * What should happen if this report is pushed now?
 *
 * `liveStatus` is JobTread's answer right now — a document can be sent from
 * inside JobTread without this app knowing, so the stored status is a hint and
 * the live one decides.
 */
export function decideSync(
  state: SyncState,
  currentHash: string,
  liveStatus?: string | null,
): SyncVerdict {
  if (!state.documentId) {
    return { action: 'create', reason: 'No proposal in JobTread for this report yet.' };
  }
  const status = (liveStatus ?? state.docStatus ?? '').toLowerCase();

  if ((CUSTOMER_FACING_STATUSES as readonly string[]).includes(status)) {
    return {
      action: 'blocked',
      documentId: state.documentId,
      status,
      reason:
        status === 'approved'
          ? 'That proposal is already signed. Changing its pricing now would alter a document the customer agreed to — create a new version instead.'
          : 'That proposal has been sent for signature. Update it and the customer could be looking at different numbers than the ones they were sent — create a new version instead.',
    };
  }

  // An unknown/missing status means the document may be gone from JobTread, or
  // unreadable. Creating a fresh one is the safe answer — never silently
  // rewrite something whose state we could not confirm.
  if (!status) {
    return { action: 'create', reason: 'The previous proposal could not be found in JobTread — a new one will be created.' };
  }

  if (state.pushedHash && state.pushedHash === currentHash) {
    return { action: 'up_to_date', documentId: state.documentId, reason: 'JobTread already matches this report.' };
  }
  return { action: 'update', documentId: state.documentId, reason: 'The proposal in JobTread is still a draft and will be updated to match.' };
}

/**
 * Is the JobTread copy behind the report? Drives the "out of date" flag on the
 * reports list — pure, so the list needs no JobTread round trip.
 */
export function isStale(state: SyncState, currentHash: string): boolean {
  if (!state.documentId || !state.pushedHash) return false; // never pushed
  return state.pushedHash !== currentHash;
}

export interface StaleFlag {
  pushed: boolean;
  stale: boolean;
  /** True when the drift can no longer be pushed automatically. */
  locked: boolean;
  documentId: string | null;
  status: string | null;
  message: string | null;
}

/** The shape the reports list and detail screens render. */
export function staleFlag(state: SyncState, currentHash: string): StaleFlag {
  const pushed = !!state.documentId;
  const stale = isStale(state, currentHash);
  const status = state.docStatus ?? null;
  const locked = stale && (CUSTOMER_FACING_STATUSES as readonly string[]).includes((status || '').toLowerCase());
  return {
    pushed,
    stale,
    locked,
    documentId: state.documentId,
    status,
    message: !pushed
      ? null
      : !stale
        ? null
        : locked
          ? 'This report changed after the proposal was sent. JobTread still has the old numbers — send a new version if the customer should see these.'
          : 'This report changed after it was pushed. The JobTread proposal is out of date.',
  };
}
