/**
 * Groq chat call used by the enhanced photo analysis. Copied from the old
 * program's assistant helper: only `groqChat` and its two shapes, nothing
 * else from that file. Model ids come from models.ts.
 */
import { ROOF_REPORT_MODELS } from './models.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_REQUEST_TIMEOUT_MS = 30_000;

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
    model?: string;
    temperature?: number;
    max_tokens?: number;
    json_mode?: boolean;
  } = {}
): Promise<AIResponse> {
  const model = options.model || ROOF_REPORT_MODELS.enhancement.id;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_REQUEST_TIMEOUT_MS);

  try {
    const fetchResponse = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 4096,
        ...(options.json_mode && { response_format: { type: 'json_object' } }),
      }),
      signal: controller.signal,
    });
    const response = fetchResponse as any;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Groq API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return {
      success: true,
      content: data.choices?.[0]?.message?.content || '',
      model,
      usage: data.usage,
    };
  } catch (error: unknown) {
    const err = error as Error;
    const isAbort = err?.name === 'AbortError';
    return {
      success: false,
      content: '',
      model,
      error: isAbort
        ? `Groq request timed out after ${GROQ_REQUEST_TIMEOUT_MS}ms`
        : err.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
