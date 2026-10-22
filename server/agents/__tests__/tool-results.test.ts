import { describe, it, expect } from 'vitest';
import { MAX_TOOL_RESULT_CHARS, redactForLog, shouldTryOpenFallback, toolResultContent } from '../base-agent';

describe('toolResultContent', () => {
  it('passes a small result through as plain JSON', () => {
    expect(toolResultContent({ count: 2, rows: ['a', 'b'] })).toBe('{"count":2,"rows":["a","b"]}');
  });

  it('serializes undefined as null rather than leaving the tool message empty', () => {
    expect(toolResultContent(undefined)).toBe('null');
  });

  it('cuts an oversized result to the limit and says so', () => {
    const big = { rows: Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `customer "${i}"` })) };
    const full = JSON.stringify(big);
    const out = toolResultContent(big);
    expect(out.startsWith(full.slice(0, MAX_TOOL_RESULT_CHARS))).toBe(true);
    expect(out).toMatch(/\[TRUNCATED: this result was \d+ characters/);
    expect(out).toMatch(/narrower filter/);
    expect(out.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 300);
  });

  it('honours a custom limit', () => {
    const out = toolResultContent({ text: 'x'.repeat(100) }, 10);
    expect(out.split('\n')[0]).toBe('{"text":"x');
  });

  it('turns an unserializable result into an error the model can read', () => {
    const cyclic: any = {}; cyclic.self = cyclic;
    expect(JSON.parse(toolResultContent(cyclic)).error).toMatch(/could not be serialized/);
  });
});

describe('redactForLog', () => {
  it('replaces message bodies with their length', () => {
    expect(redactForLog({ leadId: 4, message: 'Hi Mrs. Lee, your roof is booked for Friday' })).toEqual({ leadId: 4, message: '[43 chars]' });
  });

  it('masks phone numbers anywhere, keeping the last four digits', () => {
    expect(redactForLog({ to: '+1 (704) 555-0199' })).toEqual({ to: '***0199' });
    expect(redactForLog({ query: 'call 704-555-0123 tomorrow' })).toEqual({ query: 'call ***0123 tomorrow' });
  });

  it('leaves ids, dates and short numbers alone', () => {
    const args = { leadId: 12345, dueInHours: 2, date: '2026-10-15', status: 'won' };
    expect(redactForLog(args)).toEqual(args);
  });

  it('walks nested objects and arrays', () => {
    expect(redactForLog({ items: [{ body: 'secret' }, { phone: '7045550100' }] })).toEqual({ items: [{ body: '[6 chars]' }, { phone: '***0100' }] });
  });
});

describe('shouldTryOpenFallback', () => {
  it('does not retry after a timeout', () => {
    expect(shouldTryOpenFallback({ name: 'APIConnectionTimeoutError', message: 'Request timed out.' })).toBe(false);
    expect(shouldTryOpenFallback({ name: 'TimeoutError', message: 'The operation was aborted due to timeout' })).toBe(false);
  });

  it('does not retry a 4xx, except the 404 a retired model slug gets', () => {
    expect(shouldTryOpenFallback({ status: 400, message: 'bad request' })).toBe(false);
    expect(shouldTryOpenFallback({ status: 401, message: 'unauthorized' })).toBe(false);
    expect(shouldTryOpenFallback({ status: 429, message: 'rate limited' })).toBe(false);
    expect(shouldTryOpenFallback({ status: 404, message: 'model not found' })).toBe(true);
  });

  it('retries a provider outage or a dropped connection', () => {
    expect(shouldTryOpenFallback({ status: 502, message: 'bad gateway' })).toBe(true);
    expect(shouldTryOpenFallback({ name: 'APIConnectionError', message: 'Connection error.' })).toBe(true);
  });
});
