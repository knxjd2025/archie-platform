/**
 * Groq chat call used by the enhanced photo analysis. Copied from the old
 * program's assistant helper: only `groqChat` and its two shapes, nothing
 * else from that file. The call itself goes through the ModelCaller seam
 * (model-call.ts), and the model id comes from models.ts.
 */
import { ROOF_REPORT_MODELS } from './models.js';
import { providerCaller, type ModelCaller } from './model-call.js';

const GROQ_REQUEST_TIMEOUT_MS = 30_000;

/** What a failed chat says. The provider's own words are never kept. */
const CHAT_FAILED_MESSAGE = 'The model could not be reached.';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  success: boolean;
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: string;
}

/**
 * Send a chat completion request to Groq
 */
export async function groqChat(
  messages: ChatMessage[],
  apiKey: string,
  options: {
    /** Only the id written in models.ts for this job. Any other value is refused. */
    model?: string;
    temperature?: number;
    max_tokens?: number;
    json_mode?: boolean;
    /** The seam. Archie passes one that also records the call's cost. */
    call?: ModelCaller;
    /** The request-wide deadline. */
    signal?: AbortSignal;
  } = {}
): Promise<AIResponse> {
  const model = ROOF_REPORT_MODELS.enhancement.id;
  const failed = (): AIResponse => ({ success: false, content: '', model, error: CHAT_FAILED_MESSAGE });

  if (options.model !== undefined && options.model !== model) return failed();
  const call = options.call ?? (apiKey ? providerCaller({ groq: apiKey }) : null);
  if (!call) return failed();

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const prompt = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');

  try {
    const reply = await call({
      role: 'enhancement',
      ...(system && { system }),
      prompt,
      maxTokens: options.max_tokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      json: options.json_mode === true,
      timeoutMs: GROQ_REQUEST_TIMEOUT_MS,
      signal: options.signal,
    });
    return {
      success: true,
      content: reply.text,
      model,
      usage: reply.usage
        ? {
            prompt_tokens: reply.usage.inputTokens,
            completion_tokens: reply.usage.outputTokens,
            total_tokens: reply.usage.inputTokens + reply.usage.outputTokens,
          }
        : undefined,
    };
  } catch {
    return failed();
  }
}
