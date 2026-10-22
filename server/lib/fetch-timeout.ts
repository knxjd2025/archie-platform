/**
 * `fetch` that gives up.
 *
 * Node's fetch has no default timeout, so one integration that stopped
 * answering (GHL, CompanyCam, Everee, Vapi, a JobTread upload URL) held the
 * request open until Vercel killed the whole function at its limit — the
 * user saw a blank failure after a minute, and a webhook caller saw a timeout
 * and retried, doing the work twice. This aborts after `timeoutMs` and throws
 * an error whose message says "timeout", which classifyUpstream already maps
 * to "couldn't reach the provider".
 */

/** Long enough for a slow provider, well short of a serverless function's limit. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A caller's own signal still cancels the request.
  const outer = init.signal;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !outer?.aborted) {
      const host = (() => { try { return new URL(String(input)).host; } catch { return 'upstream'; } })();
      throw new Error(`Request to ${host} timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}
