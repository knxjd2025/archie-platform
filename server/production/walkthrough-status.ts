/**
 * The final walkthrough's state for a production-board card, derived from
 * the job's newest walkthrough row and where the job sits on the board.
 *
 *  - 'due'         — in production or wrapping up, and nobody has started one
 *  - 'in_progress' — a draft exists
 *  - 'issues'      — submitted with Issues (each already a follow-up)
 *  - 'clean'       — submitted, nothing found
 *  - null          — too early on the board for it to be expected yet
 */
import type { ProductionColumnKey } from './columns';

export type WalkthroughState = 'due' | 'in_progress' | 'issues' | 'clean';

export interface WalkthroughRow {
  jobExternalId: string;
  status: 'draft' | 'submitted';
  issueCount: number;
  submittedAt: Date | string | null;
  createdAt: Date | string | null;
}

export interface WalkthroughSummary {
  state: WalkthroughState;
  issueCount: number;
  submittedAt: string | null;
}

/** Columns where a walkthrough is expected; earlier columns show nothing. */
const EXPECTED_IN = new Set<ProductionColumnKey | null>(['in_production', 'wrapping', 'closed']);

const ts = (d: Date | string | null) => (d ? new Date(d).getTime() : 0);

/** Newest row per job — the board only ever cares about the latest attempt. */
export function latestWalkthroughByJob(rows: WalkthroughRow[]): Map<string, WalkthroughRow> {
  const out = new Map<string, WalkthroughRow>();
  for (const r of rows) {
    const cur = out.get(r.jobExternalId);
    if (!cur || ts(r.createdAt) > ts(cur.createdAt)) out.set(r.jobExternalId, r);
  }
  return out;
}

export function walkthroughSummary(column: ProductionColumnKey | null, latest: WalkthroughRow | undefined): WalkthroughSummary | null {
  if (latest?.status === 'submitted') {
    return {
      state: latest.issueCount > 0 ? 'issues' : 'clean',
      issueCount: latest.issueCount,
      submittedAt: latest.submittedAt ? new Date(latest.submittedAt).toISOString() : null,
    };
  }
  if (latest?.status === 'draft') return { state: 'in_progress', issueCount: latest.issueCount, submittedAt: null };
  // Nothing started: only worth flagging once the crew is on or off the roof.
  // 'closed' with no walkthrough is a gap too — the job was called done without one.
  if (EXPECTED_IN.has(column)) return { state: 'due', issueCount: 0, submittedAt: null };
  return null;
}
