// JSON completions from Claude (Anthropic), mirroring server/agents/base-agent.ts's
// raw-fetch pattern (no SDK, for Vercel bundling).
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Default must be a model that exists: 'claude-opus-4-8' never did, so with
// neither env var set every triage and digest call 404'd in silence.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 8192;

/**
 * Strip a leading ```json / ``` fence and trailing ``` if present, then parse.
 * Pure — no network calls, safe to unit test directly.
 */
export function parseJsonResponse(text: string): unknown {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

// With no timeout here, one slow completion could hold the hourly sweep until
// Vercel killed it at 300s ("Task timed out after 300 seconds" every hour). A 25-event
// triage batch can legitimately take most of a minute to write, so the cap sits
// above that rather than at it — a batch cut off early is parked for manual
// review, which is worse than waiting for a good answer.
export const LLM_TIMEOUT_MS = 90_000;

export async function completeJson(system: string, user: string, timeoutMs = LLM_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let data: any;
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: system + '\n\nRespond with ONLY a single valid JSON object. No markdown fences, no prose before or after.',
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);

    // Still inside the timer: a response whose headers arrive but whose body
    // stalls would otherwise hang just the same.
    data = await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`Claude timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = (data.content || [])
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text || '')
    .join('');

  if (data.stop_reason === 'refusal' || !text) {
    throw new Error(`Claude returned no usable content (stop_reason: ${data.stop_reason})`);
  }

  return parseJsonResponse(text);
}
