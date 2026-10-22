import { describe, it, expect } from 'vitest';
import { openLoops, claims, nudges, brainRuns, watchCursors } from '../schema';

describe('brain schema', () => {
  it('exports the five brain tables with key columns', () => {
    expect(openLoops.dedupeKey).toBeDefined();
    expect(openLoops.owner).toBeDefined();
    expect(claims.stage).toBeDefined();
    expect(claims.nextActionDue).toBeDefined();
    expect(nudges.loopId).toBeDefined();
    expect(brainRuns.startedAt).toBeDefined();
    expect(watchCursors.cursor).toBeDefined();
  });
});
