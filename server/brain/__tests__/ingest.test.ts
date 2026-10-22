import { describe, it, expect } from 'vitest';
import { dedupeEvents } from '../ingest';
import type { BrainEvent } from '../types';

const ev = (ref: string, at: string, text: string): BrainEvent => ({
  source: 'ghl', sourceRef: ref, occurredAt: at, text,
});

describe('dedupeEvents', () => {
  it('keeps the newest event per source:sourceRef', () => {
    const out = dedupeEvents([
      ev('c1', '2026-07-18T10:00:00Z', 'old'),
      ev('c1', '2026-07-18T11:00:00Z', 'new'),
      ev('c2', '2026-07-18T10:30:00Z', 'other'),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.sourceRef === 'c1')?.text).toBe('new');
  });
});
