import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseJsonResponse, completeJson } from '../llm';

describe('parseJsonResponse', () => {
  it('parses plain JSON', () => {
    expect(parseJsonResponse('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a ```json fenced block', () => {
    const text = '```json\n{"a":1}\n```';
    expect(parseJsonResponse(text)).toEqual({ a: 1 });
  });

  it('parses a plain ``` fenced block', () => {
    const text = '```\n{"a":1}\n```';
    expect(parseJsonResponse(text)).toEqual({ a: 1 });
  });

  it('tolerates surrounding whitespace', () => {
    const text = '\n\n   {"a":1}   \n\n';
    expect(parseJsonResponse(text)).toEqual({ a: 1 });
  });

  it('tolerates whitespace around a fenced block', () => {
    const text = '  \n```json\n{"a": 1}\n```\n  ';
    expect(parseJsonResponse(text)).toEqual({ a: 1 });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonResponse('not json')).toThrow();
  });

  it('throws on invalid JSON inside a fence', () => {
    expect(() => parseJsonResponse('```json\nnot json\n```')).toThrow();
  });
});

describe('completeJson timeout (a hung call must not hold the hourly sweep)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('aborts a call that never answers and says so', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    await expect(completeJson('sys', 'user', 20)).rejects.toThrow(/timed out/);
  });

  it('passes a normal answer through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"a":1}' }], stop_reason: 'end_turn' }),
    })));
    await expect(completeJson('sys', 'user', 1_000)).resolves.toEqual({ a: 1 });
  });
});
