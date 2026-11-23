/** The price arithmetic of the metered call, with no database. */
import { describe, it, expect } from 'vitest';
import { estimateCents } from '../metered';

describe('estimateCents', () => {
  it('prices a confirmed model from the published per-million prices', () => {
    // claude-sonnet-5: 200 cents in and 1000 cents out per million tokens.
    expect(estimateCents('claude-sonnet-5', { input: 1_000_000, output: 100_000 })).toEqual({ cents: 300, priced: true });
    expect(estimateCents('claude-haiku-4-5', { input: 2_000, output: 500 })).toEqual({ cents: 0.45, priced: true });
  });

  it('never invents a price for a model whose price is not confirmed', () => {
    expect(estimateCents('gemini-2.5-flash', { input: 5_000, output: 900 })).toEqual({ cents: 0, priced: false });
    expect(estimateCents('meta-llama/llama-4-scout-17b-16e-instruct', { input: 5_000, output: 900 })).toEqual({ cents: 0, priced: false });
    expect(estimateCents('some-unknown-id', { input: 1, output: 1 })).toEqual({ cents: 0, priced: false });
  });

  it('cannot price a call whose tokens were not reported', () => {
    expect(estimateCents('claude-sonnet-5', undefined)).toEqual({ cents: 0, priced: false });
  });

  it('rounds to four decimal places, the width of the column', () => {
    expect(estimateCents('claude-haiku-4-5', { input: 1, output: 1 }).cents).toBe(0.0006);
  });
});
