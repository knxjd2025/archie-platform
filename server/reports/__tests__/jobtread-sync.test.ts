import { describe, it, expect } from 'vitest';
import { linesFingerprint, decideSync, isStale, staleFlag, type SyncState } from '../jobtread-sync';
import type { JobTreadDocLine } from '../../integrations/jobtread';

const line = (name: string, qty: number, price: number, cost?: number): JobTreadDocLine =>
  ({ name, quantity: qty, unitPrice: price, ...(cost != null ? { unitCost: cost } : {}) });

const LINES = [line('Shingle replacement', 30, 425), line('Ridge vent', 40, 12.5)];
const HASH = linesFingerprint(LINES);

const state = (o: Partial<SyncState> = {}): SyncState =>
  ({ documentId: null, pushedHash: null, docStatus: null, ...o });

describe('linesFingerprint', () => {
  it('ignores line order', () => {
    // A reshuffled estimate that prices identically is not a change.
    expect(linesFingerprint([...LINES].reverse())).toBe(HASH);
  });

  it('ignores case and padding in names', () => {
    expect(linesFingerprint([line('  SHINGLE REPLACEMENT ', 30, 425), line('Ridge vent', 40, 12.5)])).toBe(HASH);
  });

  it('changes when a price changes', () => {
    expect(linesFingerprint([line('Shingle replacement', 30, 450), LINES[1]])).not.toBe(HASH);
  });

  it('changes when a quantity changes', () => {
    expect(linesFingerprint([line('Shingle replacement', 31, 425), LINES[1]])).not.toBe(HASH);
  });

  it('changes when a line is added or removed', () => {
    expect(linesFingerprint([LINES[0]])).not.toBe(HASH);
    expect(linesFingerprint([...LINES, line('Drip edge', 10, 8)])).not.toBe(HASH);
  });

  it('catches a sub-dollar price change', () => {
    // Rounding to whole dollars would hide a cents-level change across a large
    // quantity — 30 squares at $0.50 is real money.
    expect(linesFingerprint([line('Shingle replacement', 30, 425.5), LINES[1]])).not.toBe(HASH);
  });
});

describe('decideSync', () => {
  it('creates when nothing has been pushed', () => {
    expect(decideSync(state(), HASH).action).toBe('create');
  });

  it('updates a draft in place', () => {
    // The whole point: a second push must not leave two proposals with two
    // different prices on one job.
    const v = decideSync(state({ documentId: 'd1', pushedHash: 'old', docStatus: 'draft' }), HASH);
    expect(v.action).toBe('update');
    expect(v).toHaveProperty('documentId', 'd1');
  });

  it('reports up to date when nothing changed', () => {
    expect(decideSync(state({ documentId: 'd1', pushedHash: HASH, docStatus: 'draft' }), HASH).action).toBe('up_to_date');
  });

  it('REFUSES to rewrite a proposal that was sent for signature', () => {
    const v = decideSync(state({ documentId: 'd1', pushedHash: 'old', docStatus: 'pending' }), HASH);
    expect(v.action).toBe('blocked');
    expect(v.reason).toMatch(/sent for signature/i);
  });

  it('REFUSES to rewrite a signed proposal', () => {
    // Changing pricing on a document the customer signed is not an update.
    const v = decideSync(state({ documentId: 'd1', pushedHash: 'old', docStatus: 'approved' }), HASH);
    expect(v.action).toBe('blocked');
    expect(v.reason).toMatch(/already signed/i);
  });

  it('trusts JobTread\'s live status over the stored one', () => {
    // A document can be sent from inside JobTread without this app knowing, so
    // a stored "draft" must never authorise rewriting a sent proposal.
    const v = decideSync(state({ documentId: 'd1', pushedHash: 'old', docStatus: 'draft' }), HASH, 'pending');
    expect(v.action).toBe('blocked');
  });

  it('creates a new one when the old document cannot be found', () => {
    // Never silently rewrite something whose state could not be confirmed.
    const v = decideSync(state({ documentId: 'gone', pushedHash: 'old', docStatus: null }), HASH, null);
    expect(v.action).toBe('create');
    expect(v.reason).toMatch(/could not be found/i);
  });

  it('allows a denied proposal to be rewritten', () => {
    // Denied is not customer-facing in the way pending/approved are — the
    // scope is being reworked, which is exactly when it gets pushed again.
    expect(decideSync(state({ documentId: 'd1', pushedHash: 'old', docStatus: 'denied' }), HASH).action).toBe('update');
  });
});

describe('isStale / staleFlag', () => {
  it('is not stale before anything is pushed', () => {
    expect(isStale(state(), HASH)).toBe(false);
    expect(staleFlag(state(), HASH).message).toBeNull();
  });

  it('is not stale when the fingerprint matches', () => {
    const f = staleFlag(state({ documentId: 'd1', pushedHash: HASH, docStatus: 'draft' }), HASH);
    expect(f.stale).toBe(false);
    expect(f.message).toBeNull();
  });

  it('flags a draft that drifted, and says it can be updated', () => {
    const f = staleFlag(state({ documentId: 'd1', pushedHash: 'old', docStatus: 'draft' }), HASH);
    expect(f.stale).toBe(true);
    expect(f.locked).toBe(false);
    expect(f.message).toMatch(/out of date/i);
  });

  it('flags a SENT proposal that drifted as locked', () => {
    // The most dangerous case: the customer holds numbers this report no
    // longer produces, and no button should quietly fix that.
    const f = staleFlag(state({ documentId: 'd1', pushedHash: 'old', docStatus: 'pending' }), HASH);
    expect(f.stale).toBe(true);
    expect(f.locked).toBe(true);
    expect(f.message).toMatch(/send a new version/i);
  });

  it('never claims staleness from a push with no recorded fingerprint', () => {
    // Rows pushed before this feature existed have a document but no hash;
    // guessing "stale" on those would flag every historic report at once.
    expect(isStale(state({ documentId: 'd1', pushedHash: null, docStatus: 'draft' }), HASH)).toBe(false);
  });
});
