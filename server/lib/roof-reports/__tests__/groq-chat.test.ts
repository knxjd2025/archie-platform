import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groqChat } from '../groq-chat';
import { deepImageAnalysis } from '../enhanced-vision-analysis';
import { ModelCallError, type ModelCallRequest, type ModelCaller } from '../model-call';
import { ROOF_REPORT_MODELS } from '../models';

const fetchMock = vi.fn(() => { throw new Error('direct fetch is not allowed here'); });
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MESSAGES = [
  { role: 'system' as const, content: 'SYSTEM TEXT' },
  { role: 'user' as const, content: 'USER TEXT' },
];

describe('groqChat goes through the seam', () => {
  it('sends the enhancement role with system and user text, JSON mode and a limit, and returns the tokens', async () => {
    const calls: ModelCallRequest[] = [];
    const call: ModelCaller = async (r) => { calls.push(r); return { text: '{"ok":1}', usage: { inputTokens: 11, outputTokens: 4 } }; };
    const deadline = new AbortController();
    const result = await groqChat(MESSAGES, '', { json_mode: true, temperature: 0.3, call, signal: deadline.signal });
    expect(result).toMatchObject({ success: true, content: '{"ok":1}', model: ROOF_REPORT_MODELS.enhancement.id });
    expect(result.usage).toEqual({ prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ role: 'enhancement', system: 'SYSTEM TEXT', prompt: 'USER TEXT', json: true, temperature: 0.3 });
    expect(calls[0].timeoutMs).toBeGreaterThan(0);
    expect(calls[0].signal).toBe(deadline.signal);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a model id that is not the one written in models.ts, calling nothing', async () => {
    const call = vi.fn();
    for (const model of ['gpt-4o', 'qwen/qwen3-32b', '', ROOF_REPORT_MODELS.vision.id]) {
      const result = await groqChat(MESSAGES, '', { model, call });
      expect(result.success).toBe(false);
      expect(result.content).toBe('');
    }
    expect(call).not.toHaveBeenCalled();
  });

  it('a failure says only that it failed: no status text, no provider words', async () => {
    for (const error of [new ModelCallError(500), new ModelCallError(0, true), new Error('SECRET-PROVIDER-WORDS {"error":1}')]) {
      const result = await groqChat(MESSAGES, '', { call: async () => { throw error; } });
      expect(result.success).toBe(false);
      expect(result.error).toBe('The model could not be reached.');
      expect(JSON.stringify(result)).not.toContain('SECRET');
    }
  });

  it('through the default caller: a 500 with an error body shows nothing of that body', async () => {
    fetchMock.mockImplementation((() => Promise.resolve(new Response(JSON.stringify({ error: 'SECRET-PROVIDER-WORDS' }), { status: 500 }))) as never);
    const result = await groqChat(MESSAGES, 'groq-key', {});
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url).host).toBe('api.groq.com');
  });
});

describe('the enhanced photo analysis passes the seam and the deadline down', () => {
  it('both its calls, the vision call and the enhancement call, reach the one caller', async () => {
    const calls: ModelCallRequest[] = [];
    const call: ModelCaller = async (r) => {
      calls.push(r);
      return { text: JSON.stringify({ image_quality: 'good', damages: [], overall_condition: 'good', severity_score: 5, summary: 'fine' }) };
    };
    const deadline = new AbortController();
    await deepImageAnalysis('data:image/png;base64,QUJD', '', undefined, { call, signal: deadline.signal });
    expect(calls.map((c) => c.role)).toEqual(['visionAlternative', 'enhancement']);
    for (const c of calls) expect(c.signal).toBe(deadline.signal);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
