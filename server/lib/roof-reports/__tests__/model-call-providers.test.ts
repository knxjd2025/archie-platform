/**
 * The seam (model-call.ts) is the one place a model provider is called. It
 * speaks to all three United States providers, returns the tokens each one
 * reports, gives every call a timeout, and never lets a provider's own words
 * out in an error. Nothing here reaches a network: fetch is replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelCallError, providerCaller, describeModelError } from '../model-call';
import { ROOF_REPORT_MODELS, roleForModelId } from '../models';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
const KEYS = { groq: 'groq-key', google: 'google-key', anthropic: 'anthropic-key' };
const IMAGE = { base64: 'QUJD', mediaType: 'image/png' };

describe('providerCaller: one call, three providers', () => {
  it('Groq: right host and model, system + user with the photo, JSON mode, and the tokens it reports', async () => {
    fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }));
    const result = await providerCaller(KEYS)({ role: 'vision', system: 'SYS', prompt: 'USER', image: IMAGE, maxTokens: 500, temperature: 0.1, json: true });
    expect(result).toEqual({ text: '{"a":1}', usage: { inputTokens: 120, outputTokens: 30 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer groq-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(ROOF_REPORT_MODELS.vision.id);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'USER' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ]);
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.1);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('Groq without a photo sends plain text messages', async () => {
    fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: 'x' } }] }));
    await providerCaller(KEYS)({ role: 'enhancement', system: 'S', prompt: 'U', maxTokens: 10 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe(ROOF_REPORT_MODELS.enhancement.id);
    expect(body.messages).toEqual([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
    expect(body.response_format).toBeUndefined();
  });

  it('Google: key in the header, photo inline, and thinking tokens counted as output', async () => {
    fetchMock.mockResolvedValue(ok({
      candidates: [{ content: { parts: [{ text: 'hello ' }, { text: 'world' }] } }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 60 },
    }));
    const result = await providerCaller(KEYS)({ role: 'visionFallback', system: 'SYS', prompt: 'USER', image: IMAGE, maxTokens: 500, json: true });
    expect(result).toEqual({ text: 'hello world', usage: { inputTokens: 200, outputTokens: 100 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${ROOF_REPORT_MODELS.visionFallback.id}:generateContent`);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('google-key');
    expect(String(url)).not.toContain('google-key');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0].text).toBe('SYS\n\nUSER');
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { data: 'QUJD', mimeType: 'image/png' } });
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
  });

  it('Anthropic: key in the header and the tokens it reports', async () => {
    fetchMock.mockResolvedValue(ok({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 9, output_tokens: 3 } }));
    const result = await providerCaller(KEYS)({ role: 'visionLastResort', system: 'SYS', prompt: 'USER', image: IMAGE, maxTokens: 700 });
    expect(result).toEqual({ text: 'ok', usage: { inputTokens: 9, outputTokens: 3 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('anthropic-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(ROOF_REPORT_MODELS.visionLastResort.id);
    expect(body.system).toBe('SYS');
    expect(body.max_tokens).toBe(700);
  });

  it('a reply with no token counts returns no usage rather than a guess', async () => {
    fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: 'x' } }] }));
    expect((await providerCaller(KEYS)({ role: 'vision', prompt: 'U', maxTokens: 1 })).usage).toBeUndefined();
  });

  it('refuses a provider it has no key for, without calling anything', async () => {
    await expect(providerCaller({ anthropic: 'k' })({ role: 'vision', prompt: 'U', maxTokens: 1 })).rejects.toBeInstanceOf(ModelCallError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('failures carry a status and never the provider\'s words', () => {
  it.each(['vision', 'visionFallback', 'visionLastResort'] as const)('%s: an error reply becomes a status only', async (role) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'SECRET-PROVIDER-WORDS' } }), { status: 503 }));
    const error = await providerCaller(KEYS)({ role, prompt: 'U', maxTokens: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelCallError);
    expect((error as ModelCallError).status).toBe(503);
    expect(String((error as Error).message)).not.toContain('SECRET');
    expect(describeModelError(error)).toBe('status 503');
  });

  it('a network failure is status 0, not the system error text', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1 SECRET'));
    const error = await providerCaller(KEYS)({ role: 'vision', prompt: 'U', maxTokens: 1 }).catch((e: unknown) => e);
    expect((error as ModelCallError).status).toBe(0);
    expect(String((error as Error).message)).not.toContain('SECRET');
  });
});

describe('every call has a timeout', () => {
  /** A fetch that never answers on its own and rejects when its signal aborts. */
  const hang = (_url: unknown, init: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));

  it.each(['vision', 'visionFallback', 'visionLastResort', 'narrative'] as const)('%s times out at its own limit', async (role) => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(hang);
    const run = providerCaller(KEYS)({ role, prompt: 'U', maxTokens: 1, timeoutMs: 1000 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1001);
    const error = (await run) as ModelCallError;
    expect(error).toBeInstanceOf(ModelCallError);
    expect(error.aborted).toBe(true);
  });

  it('gives a default limit when none is asked for (Gemini and Haiku included)', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(hang);
    const run = providerCaller(KEYS)({ role: 'visionFallback', prompt: 'U', maxTokens: 1 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(((await run) as ModelCallError).aborted).toBe(true);
  });

  it('stops at once when the shared deadline fires, whatever the call\'s own limit', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(hang);
    const deadline = new AbortController();
    const run = providerCaller(KEYS)({ role: 'vision', prompt: 'U', maxTokens: 1, timeoutMs: 600_000, signal: deadline.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    deadline.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(((await run) as ModelCallError).aborted).toBe(true);
  });

  it('does not even start when the deadline has already passed', async () => {
    const deadline = AbortSignal.abort();
    const error = await providerCaller(KEYS)({ role: 'vision', prompt: 'U', maxTokens: 1, signal: deadline }).catch((e: unknown) => e);
    expect((error as ModelCallError).aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('roleForModelId', () => {
  it('maps an id to a role only among the roles asked about', () => {
    expect(roleForModelId(ROOF_REPORT_MODELS.vision.id, ['vision', 'visionAlternative'])).toBe('vision');
    expect(roleForModelId(ROOF_REPORT_MODELS.visionAlternative.id, ['vision', 'visionAlternative'])).toBe('visionAlternative');
    expect(roleForModelId(ROOF_REPORT_MODELS.visionFallback.id, ['vision', 'visionAlternative'])).toBeNull();
    for (const bad of ['', 'gpt-4o', 'meta-llama/llama-4-scout-17b-16e-instruct ', undefined, null, 5]) {
      expect(roleForModelId(bad as never, ['vision', 'visionAlternative'])).toBeNull();
    }
  });
});
