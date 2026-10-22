import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrainEvent } from '../types';

// triage.ts pulls in ./llm (real network call to Groq) and ./loop-store (real db
// writes). Mock both so triageEvents/applyTriage are unit-testable in isolation.
vi.mock('../llm', () => ({
  completeJson: vi.fn(),
}));
vi.mock('../loop-store', () => ({
  upsertLoop: vi.fn(async () => ({ id: 1, created: true })),
  closeLoopByKey: vi.fn(async () => true),
  makeDedupeKey: (kind: string, source: string, sourceRef: string) => `${kind}:${source}:${sourceRef}`,
}));

import { parseTriageResponse, triageEvents, applyTriage } from '../triage';
import { completeJson } from '../llm';
import { upsertLoop, closeLoopByKey } from '../loop-store';

const ev = (ref: string, text = 'hi'): BrainEvent => ({
  source: 'ghl', sourceRef: ref, occurredAt: '2026-07-18T10:00:00Z', text,
});

describe('parseTriageResponse', () => {
  it('accepts a valid decision set', () => {
    const decisions = parseTriageResponse({
      decisions: [
        {
          action: 'open', kind: 'unanswered_inbound', sourceRef: 'conv1', source: 'ghl',
          summary: 'Jane asked if her estimate is ready; no human reply',
          owner: 'thomas', urgency: 'urgent', dueInHours: 4, quote: 'Is my estimate ready?',
        },
        { action: 'close', kind: 'unanswered_inbound', sourceRef: 'conv2', source: 'ghl', summary: 'Thomas replied', owner: 'thomas', urgency: 'normal' },
      ],
    });
    expect(decisions).toHaveLength(2);
    expect(decisions[0].action).toBe('open');
  });
  it('throws on malformed output', () => {
    expect(() => parseTriageResponse({ decisions: [{ action: 'explode' }] })).toThrow();
    expect(() => parseTriageResponse('not json object')).toThrow();
  });

  it('salvages dueInHours: 0 as absent instead of rejecting the batch (prod bug: every gmail batch parked)', () => {
    const decisions = parseTriageResponse({
      decisions: [{
        action: 'ignore', kind: 'custom', source: 'gmail', sourceRef: 't1',
        summary: 'Vendor newsletter', owner: 'james', urgency: 'low', dueInHours: 0,
      }],
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].dueInHours).toBeUndefined();
  });

  it('salvages malformed optional fields (null quote, numeric phone) without dropping the decision', () => {
    const decisions = parseTriageResponse({
      decisions: [{
        action: 'open', kind: 'unanswered_inbound', source: 'gmail', sourceRef: 't2',
        summary: 'Customer waiting on reply', owner: 'james', urgency: 'urgent',
        dueInHours: -3, quote: null, contactPhone: 7045551234,
      }],
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].dueInHours).toBeUndefined();
    expect(decisions[0].quote).toBeUndefined();
    expect(decisions[0].contactPhone).toBeUndefined();
  });

  it('degrades an out-of-enum kind to custom instead of parking the whole batch', () => {
    // Regression: the model invented kind "bid_invite_blast" (off the prompt's own
    // "bid-invite blasts" wording) while correctly ignoring PlanHub bid emails; a
    // strict kind enum failed validation and parked all 25 events of the batch.
    const decisions = parseTriageResponse({
      decisions: [
        {
          action: 'ignore', kind: 'bid_invite_blast', source: 'gmail', sourceRef: 'b1',
          summary: 'PlanHub bid blast', owner: 'james', urgency: 'low',
        },
        {
          action: 'open', kind: 'unanswered_inbound', source: 'gmail', sourceRef: 'b2',
          summary: 'Real lead waiting', owner: 'james', urgency: 'urgent',
        },
      ],
    });
    expect(decisions).toHaveLength(2);
    expect(decisions[0].kind).toBe('custom');   // unknown kind degraded, decision kept
    expect(decisions[0].action).toBe('ignore'); // the actual decision survives intact
    expect(decisions[1].kind).toBe('unanswered_inbound'); // valid decisions untouched
  });
});

describe('triageEvents (fix 1a: per-batch error isolation)', () => {
  beforeEach(() => {
    vi.mocked(completeJson).mockReset();
  });

  it('returns decisions with no failures when every batch succeeds', async () => {
    vi.mocked(completeJson).mockResolvedValue({
      decisions: [{ action: 'open', kind: 'custom', source: 'ghl', sourceRef: 'c0', summary: 'ok', owner: 'james', urgency: 'normal' }],
    });
    const { decisions, failed } = await triageEvents([ev('c0')]);
    expect(decisions).toHaveLength(1);
    expect(failed).toHaveLength(0);
  });

  it('isolates a failing batch: its events are parked in `failed`, other batches still produce decisions', async () => {
    // 30 events -> batch 1 = events 0..24 (25 events), batch 2 = events 25..29 (5 events)
    const events: BrainEvent[] = Array.from({ length: 30 }, (_, i) => ev(`c${i}`));
    let call = 0;
    vi.mocked(completeJson).mockImplementation(async () => {
      call++;
      if (call === 1) {
        return { decisions: [{ action: 'open', kind: 'custom', source: 'ghl', sourceRef: 'c0', summary: 'ok', owner: 'james', urgency: 'normal' }] };
      }
      throw new Error('groq 500');
    });
    const { decisions, failed } = await triageEvents(events);
    expect(call).toBe(2);
    expect(decisions).toHaveLength(1);
    expect(failed).toHaveLength(5);
    expect(failed.map((e) => e.sourceRef)).toEqual(['c25', 'c26', 'c27', 'c28', 'c29']);
  });

  it('also isolates a batch whose completion is malformed (fails schema parsing)', async () => {
    const events: BrainEvent[] = Array.from({ length: 30 }, (_, i) => ev(`c${i}`));
    let call = 0;
    vi.mocked(completeJson).mockImplementation(async () => {
      call++;
      if (call === 1) return { decisions: [] };
      return { decisions: [{ action: 'explode' }] }; // fails zod parse inside triageEvents
    });
    const { decisions, failed } = await triageEvents(events);
    expect(decisions).toHaveLength(0);
    expect(failed).toHaveLength(5);
  });

  it('empty input never calls the LLM', async () => {
    const { decisions, failed } = await triageEvents([]);
    expect(decisions).toEqual([]);
    expect(failed).toEqual([]);
    expect(completeJson).not.toHaveBeenCalled();
  });
});

describe('applyTriage (fix 5: sourceRef whitelist)', () => {
  beforeEach(() => {
    vi.mocked(upsertLoop).mockClear();
    vi.mocked(closeLoopByKey).mockClear();
  });

  it('applies a decision whose source:sourceRef was actually in the input batch', async () => {
    const events = [ev('conv1')];
    const decisions = [
      { action: 'open' as const, kind: 'unanswered_inbound' as const, source: 'ghl' as const, sourceRef: 'conv1', summary: 'ok', owner: 'james' as const, urgency: 'normal' as const },
    ];
    const result = await applyTriage(decisions, new Date(), events);
    expect(result).toEqual({ opened: 1, closed: 0, skipped: 0 });
    expect(upsertLoop).toHaveBeenCalledTimes(1);
  });

  it('rejects (skips, counts) a decision whose sourceRef was swapped/fabricated by the LLM', async () => {
    const events = [ev('conv1')];
    const decisions = [
      { action: 'open' as const, kind: 'unanswered_inbound' as const, source: 'ghl' as const, sourceRef: 'conv1', summary: 'ok', owner: 'james' as const, urgency: 'normal' as const },
      // conv-999 was never in the batch we sent to the LLM — must not become a loop.
      { action: 'open' as const, kind: 'unanswered_inbound' as const, source: 'ghl' as const, sourceRef: 'conv-999', summary: 'customer B message sent to customer A thread', owner: 'james' as const, urgency: 'normal' as const },
    ];
    const result = await applyTriage(decisions, new Date(), events);
    expect(result.opened).toBe(1);
    expect(result.skipped).toBe(1);
    expect(upsertLoop).toHaveBeenCalledTimes(1);
  });

  it('rejects a decision whose source differs even if sourceRef matches (source:sourceRef pair must match exactly)', async () => {
    const events = [ev('conv1')]; // source: 'ghl'
    const decisions = [
      { action: 'open' as const, kind: 'unanswered_inbound' as const, source: 'gmail' as const, sourceRef: 'conv1', summary: 'wrong source', owner: 'james' as const, urgency: 'normal' as const },
    ];
    const result = await applyTriage(decisions, new Date(), events);
    expect(result.opened).toBe(0);
    expect(result.skipped).toBe(1);
    expect(upsertLoop).not.toHaveBeenCalled();
  });

  it('close decisions are also whitelist-checked', async () => {
    const events = [ev('conv1')];
    const decisions = [
      { action: 'close' as const, kind: 'unanswered_inbound' as const, source: 'ghl' as const, sourceRef: 'conv-not-in-batch', summary: 'x', owner: 'james' as const, urgency: 'normal' as const },
    ];
    const result = await applyTriage(decisions, new Date(), events);
    expect(result.closed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(closeLoopByKey).not.toHaveBeenCalled();
  });
});

describe('triageEvents (time budget and parallel batches)', () => {
  beforeEach(() => {
    vi.mocked(completeJson).mockReset();
  });

  it('starts no batch once the deadline has passed, and hands every event back as deferred', async () => {
    const events: BrainEvent[] = Array.from({ length: 30 }, (_, i) => ev(`c${i}`));
    const { decisions, failed, deferred } = await triageEvents(events, { deadline: Date.now() - 1 });
    expect(completeJson).not.toHaveBeenCalled();
    expect(decisions).toEqual([]);
    expect(failed).toEqual([]);
    expect(deferred.map((e) => e.sourceRef)).toEqual(events.map((e) => e.sourceRef));
  });

  it('defers only the batches after the deadline passes mid-run', async () => {
    const events: BrainEvent[] = Array.from({ length: 60 }, (_, i) => ev(`c${i}`)); // 3 batches
    let clock = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    vi.mocked(completeJson).mockImplementation(async () => {
      clock = 5_000; // the first batch uses up the budget
      return { decisions: [] };
    });
    const res = await triageEvents(events, { deadline: 2_000, concurrency: 1 });
    nowSpy.mockRestore();
    expect(completeJson).toHaveBeenCalledTimes(1);
    expect(res.deferred).toHaveLength(35);
    expect(res.deferred[0].sourceRef).toBe('c25');
  });

  it('runs up to `concurrency` batches at once and still isolates a failing one', async () => {
    const events: BrainEvent[] = Array.from({ length: 75 }, (_, i) => ev(`c${i}`)); // 3 batches
    let inFlight = 0;
    let peak = 0;
    let call = 0;
    vi.mocked(completeJson).mockImplementation(async () => {
      const mine = ++call;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (mine === 2) throw new Error('Claude timed out after 90s');
      return { decisions: [] };
    });
    const { failed, failureMessages, deferred } = await triageEvents(events, { concurrency: 3 });
    expect(peak).toBe(3);
    expect(failed).toHaveLength(25);
    expect(failed[0].sourceRef).toBe('c25');
    expect(failureMessages[0]).toMatch(/^batch 1: Claude timed out/);
    expect(deferred).toEqual([]);
  });
});

describe('applyTriage passes the message time so only newer mail reopens a closed loop', () => {
  beforeEach(() => {
    vi.mocked(upsertLoop).mockClear();
  });

  it('sets occurredAt from the event', async () => {
    const events = [ev('conv1')];
    await applyTriage([
      { action: 'open', kind: 'unanswered_inbound', source: 'ghl', sourceRef: 'conv1', summary: 'ok', owner: 'james', urgency: 'normal' },
    ], new Date(), events);
    expect(vi.mocked(upsertLoop).mock.calls[0][0].occurredAt?.toISOString()).toBe('2026-07-18T10:00:00.000Z');
  });
});
