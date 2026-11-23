/**
 * model-call.ts: the one seam every paid text or vision call of the narrative
 * and the photo labels goes through.
 *
 * The library never records what a call cost. It hands each call to a
 * `ModelCaller`, and a caller returns the model's text together with the
 * token counts the provider reported. Archie later passes in a caller that
 * wraps this one and writes the cost; until then `anthropicCaller` just makes
 * the call. Nothing here knows about a ledger.
 *
 * A failure raises `ModelCallError`, whose message carries the status number
 * and nothing the provider said, so no provider text can reach a log or a
 * screen by accident.
 */

import { ROOF_REPORT_MODELS, type ModelRole } from './models.js';

export interface ModelCallRequest {
  /** Which job this call does. The model id comes from models.ts for this role. */
  role: ModelRole;
  /** The user message. */
  prompt: string;
  /** A system prompt, when the job has one apart from the user message. */
  system?: string;
  maxTokens: number;
  temperature?: number;
  /** Ask for one JSON object back, where the provider has a mode for it. */
  json?: boolean;
  /** One photo, as the original bytes or as base64 already. */
  image?: { base64: string; mediaType: string };
  /** The longest this one call may take. Every provider gets a limit; 60 s when not given. */
  timeoutMs?: number;
  /** The deadline for the whole request. Aborting it stops this call at once. */
  signal?: AbortSignal;
}

export interface ModelCallResult {
  text: string;
  /** Token counts the provider reported, when it reported them. */
  usage?: { inputTokens: number; outputTokens: number };
}

export type ModelCaller = (request: ModelCallRequest) => Promise<ModelCallResult>;

/** A failed call. `status` is the HTTP status, 0 when none was reached. Never carries provider text. */
export class ModelCallError extends Error {
  constructor(public readonly status: number, public readonly aborted = false) {
    super(aborted ? 'The model call timed out or was cancelled.' : `The model call failed with status ${status}.`);
    this.name = 'ModelCallError';
  }
}

/** A hung connection should not stall a whole report. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** The key each provider is called with. A provider without a key is never called. */
export interface ProviderKeys {
  groq?: string;
  google?: string;
  anthropic?: string;
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GOOGLE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

type Prepared = { url: string; headers: Record<string, string>; body: unknown };
type Reader = (data: unknown) => ModelCallResult;

function count(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}
function usageOf(input: unknown, output: unknown): ModelCallResult['usage'] {
  const i = count(input);
  const o = count(output);
  return i === null || o === null ? undefined : { inputTokens: i, outputTokens: o };
}

function groqRequest(model: string, key: string, r: ModelCallRequest): Prepared {
  const user = r.image
    ? [
        { type: 'text', text: r.prompt },
        { type: 'image_url', image_url: { url: `data:${r.image.mediaType};base64,${r.image.base64}` } },
      ]
    : r.prompt;
  return {
    url: GROQ_URL,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: {
      model,
      messages: [...(r.system ? [{ role: 'system', content: r.system }] : []), { role: 'user', content: user }],
      max_tokens: r.maxTokens,
      ...(r.temperature !== undefined && { temperature: r.temperature }),
      ...(r.json && { response_format: { type: 'json_object' } }),
    },
  };
}
const readGroq: Reader = (data) => {
  const d = data as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
  return { text: d?.choices?.[0]?.message?.content ?? '', usage: usageOf(d?.usage?.prompt_tokens, d?.usage?.completion_tokens) };
};

function googleRequest(model: string, key: string, r: ModelCallRequest): Prepared {
  const parts: unknown[] = [{ text: r.system ? `${r.system}\n\n${r.prompt}` : r.prompt }];
  if (r.image) parts.push({ inlineData: { data: r.image.base64, mimeType: r.image.mediaType } });
  return {
    url: `${GOOGLE_URL}${encodeURIComponent(model)}:generateContent`,
    // The key goes in a header, never in the address, so it cannot land in a log line.
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: {
      contents: [{ role: 'user', parts }],
      ...(r.json && { generationConfig: { responseMimeType: 'application/json' } }),
    },
  };
}
const readGoogle: Reader = (data) => {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  } | null;
  const text = (d?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('');
  const out = count(d?.usageMetadata?.candidatesTokenCount);
  // Thinking tokens are billed as output.
  const thoughts = count(d?.usageMetadata?.thoughtsTokenCount) ?? 0;
  return { text, usage: usageOf(d?.usageMetadata?.promptTokenCount, out === null ? null : out + thoughts) };
};

function anthropicRequest(model: string, key: string, r: ModelCallRequest): Prepared {
  const content: unknown[] = [{ type: 'text', text: r.prompt }];
  if (r.image) content.push({ type: 'image', source: { type: 'base64', media_type: r.image.mediaType, data: r.image.base64 } });
  return {
    url: ANTHROPIC_URL,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
    body: {
      model,
      max_tokens: r.maxTokens,
      ...(r.system && { system: r.system }),
      ...(r.temperature !== undefined && { temperature: r.temperature }),
      messages: [{ role: 'user', content }],
    },
  };
}
const readAnthropic: Reader = (data) => {
  const d = data as { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } } | null;
  return { text: d?.content?.find((b) => b.type === 'text')?.text ?? '', usage: usageOf(d?.usage?.input_tokens, d?.usage?.output_tokens) };
};

/**
 * The default caller: speaks to Groq, Google and Anthropic as the role asks,
 * with the key for that provider. A provider with no key is refused before
 * anything is sent. Every call has a time limit and also stops when the
 * request-wide deadline (`signal`) fires.
 */
export function providerCaller(keys: ProviderKeys): ModelCaller {
  return async (request) => {
    const model = ROOF_REPORT_MODELS[request.role];
    const key = keys[model.provider];
    if (!key) throw new ModelCallError(0);
    if (request.signal?.aborted) throw new ModelCallError(0, true);

    const own = new AbortController();
    const timer = setTimeout(() => own.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = request.signal ? AbortSignal.any([own.signal, request.signal]) : own.signal;
    try {
      const prepared =
        model.provider === 'groq' ? groqRequest(model.id, key, request)
        : model.provider === 'google' ? googleRequest(model.id, key, request)
        : anthropicRequest(model.id, key, request);
      const read: Reader = model.provider === 'groq' ? readGroq : model.provider === 'google' ? readGoogle : readAnthropic;
      let response: Response;
      try {
        response = await fetch(prepared.url, { method: 'POST', headers: prepared.headers, body: JSON.stringify(prepared.body), signal });
      } catch {
        throw new ModelCallError(0, signal.aborted);
      }
      if (!response.ok) throw new ModelCallError(response.status);
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      return read(data);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The Anthropic-only caller the narrative and the photo labels were first written against. */
export function anthropicCaller(apiKey: string): ModelCaller {
  return providerCaller({ anthropic: apiKey });
}

/** What a failed call may say in a log: the status or the word aborted, never the provider's text. */
export function describeModelError(error: unknown): string {
  if (error instanceof ModelCallError) return error.aborted ? 'timed out' : `status ${error.status}`;
  return 'unexpected error';
}

/** Em dashes are not used in anything a person reads. Replace one with a comma. */
export function plainDashes(text: string): string {
  return text.replace(/\s*—\s*/g, ', ');
}

export interface ModelOptions {
  /** Used to build the default caller when `call` is not given: the Anthropic key. */
  apiKey?: string;
  /** Keys for the other providers, when the default caller is to use them. */
  keys?: ProviderKeys;
  /** The seam. Archie passes one that also records the cost. */
  call?: ModelCaller;
  signal?: AbortSignal;
}

/** The caller these options stand for, or null when there is neither a caller nor a key. */
export function callerFor(opts: ModelOptions): ModelCaller | null {
  if (opts.call) return opts.call;
  const keys: ProviderKeys = { ...opts.keys, ...(opts.apiKey ? { anthropic: opts.apiKey } : {}) };
  return keys.groq || keys.google || keys.anthropic ? providerCaller(keys) : null;
}
