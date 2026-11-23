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
  prompt: string;
  maxTokens: number;
  /** One photo, as the original bytes or as base64 already. */
  image?: { base64: string; mediaType: string };
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

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/** A hung connection should not stall a whole report. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** The default caller: Anthropic's Messages API with the given key. Sends no sampling settings. */
export function anthropicCaller(apiKey: string): ModelCaller {
  return async (request) => {
    const model = ROOF_REPORT_MODELS[request.role];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const content: unknown[] = [{ type: 'text', text: request.prompt }];
      if (request.image) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: request.image.mediaType, data: request.image.base64 },
        });
      }
      let response: Response;
      try {
        response = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: model.id,
            max_tokens: request.maxTokens,
            messages: [{ role: 'user', content }],
          }),
          signal: controller.signal,
        });
      } catch {
        throw new ModelCallError(0, controller.signal.aborted);
      }
      if (!response.ok) throw new ModelCallError(response.status);
      const data = (await response.json().catch(() => null)) as {
        content?: { type?: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      } | null;
      const text = data?.content?.find((b) => b.type === 'text')?.text ?? '';
      const usage =
        typeof data?.usage?.input_tokens === 'number' && typeof data?.usage?.output_tokens === 'number'
          ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
          : undefined;
      return { text, usage };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  };
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
  /** Used to build the default caller when `call` is not given. */
  apiKey?: string;
  /** The seam. Archie passes one that also records the cost. */
  call?: ModelCaller;
  signal?: AbortSignal;
}

/** The caller these options stand for, or null when there is neither a caller nor a key. */
export function callerFor(opts: ModelOptions): ModelCaller | null {
  if (opts.call) return opts.call;
  if (opts.apiKey) return anthropicCaller(opts.apiKey);
  return null;
}
