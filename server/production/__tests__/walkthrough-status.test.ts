import { describe, it, expect } from 'vitest';
import { latestWalkthroughByJob, walkthroughSummary } from '../walkthrough-status';

const row = (jobExternalId: string, status: 'draft' | 'submitted', issueCount: number, createdAt: string, submittedAt: string | null = null) =>
  ({ jobExternalId, status, issueCount, createdAt, submittedAt });

describe('latestWalkthroughByJob', () => {
  it('keeps only the newest row per job', () => {
    const m = latestWalkthroughByJob([
      row('j1', 'submitted', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      row('j1', 'draft', 2, '2026-09-10T00:00:00Z'),
      row('j2', 'submitted', 3, '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z'),
    ]);
    expect(m.get('j1')!.status).toBe('draft');
    expect(m.get('j2')!.issueCount).toBe(3);
  });
});

describe('walkthroughSummary', () => {
  it('is silent before the crew is on the roof, and "due" from in-production through closed', () => {
    expect(walkthroughSummary('pre', undefined)).toBeNull();
    expect(walkthroughSummary('scheduled', undefined)).toBeNull();
    expect(walkthroughSummary('in_production', undefined)!.state).toBe('due');
    expect(walkthroughSummary('wrapping', undefined)!.state).toBe('due');
    expect(walkthroughSummary('closed', undefined)!.state).toBe('due'); // called done without one — a gap worth seeing
    expect(walkthroughSummary(null, undefined)).toBeNull();
  });

  it('reports a draft, a clean submit, and a submit with issues', () => {
    expect(walkthroughSummary('wrapping', row('j', 'draft', 1, '2026-09-10T00:00:00Z'))).toEqual({ state: 'in_progress', issueCount: 1, submittedAt: null });
    expect(walkthroughSummary('pre', row('j', 'submitted', 0, '2026-09-10T00:00:00Z', '2026-09-11T00:00:00Z'))).toEqual({ state: 'clean', issueCount: 0, submittedAt: '2026-09-11T00:00:00.000Z' });
    expect(walkthroughSummary('closed', row('j', 'submitted', 2, '2026-09-10T00:00:00Z', '2026-09-11T00:00:00Z'))!.state).toBe('issues');
  });
});
