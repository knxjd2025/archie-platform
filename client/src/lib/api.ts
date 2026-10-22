import { addTrail, endpointShape, reportCaughtError } from './bug-monitor';

const API_BASE = import.meta.env.VITE_API_URL || '';

// A hung request previously had no way to resolve — every `busy`/`loading`
// flag downstream of this client stayed stuck forever until a page reload.
// 60s covers virtually every call; report generation (which legitimately
// runs 1-3 minutes) passes its own longer timeoutMs.
const DEFAULT_TIMEOUT_MS = 60_000;

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

export const SESSION_EXPIRED_EVENT = 'archie:session-expired';

// Fired once per expiry, not once per failed request: a dashboard makes a
// dozen calls, and a dozen identical prompts is worse than none.
let announced = false;
function notifySessionExpired() {
  if (announced) return;
  announced = true;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}
/** Called after a successful sign-in so a later expiry is announced again. */
export function resetSessionExpiredNotice() { announced = false; }

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init.headers,
        },
        credentials: 'include',
        signal: controller.signal,
      });
    } catch (e: any) {
      const timedOut = e?.name === 'AbortError';
      const method = init.method || 'GET';
      addTrail('api', `${method} ${endpointShape(endpoint)} → ${timedOut ? 'timed out' : (e?.message || 'failed')}`);
      // The server never saw a request that timed out or never arrived, so it
      // cannot have recorded it — this is the only place that can.
      if (timedOut) reportCaughtError(new Error(`Request timed out: ${method} ${endpointShape(endpoint)}`), 'api-timeout', { timeoutMs });
      throw new Error(timedOut ? 'Request timed out — try again.' : (e?.message || 'Request failed'));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // A session that expires mid-shift used to surface as a different error
      // on every screen — "Not authenticated" in one panel, an empty list in
      // another — with nothing telling the rep to sign in again. Announce it
      // once, centrally, and let the app show a single honest prompt.
      if (response.status === 401) notifySessionExpired();
      // Routes answer with `{ error }` — around 330 of them — and a handful
      // with `{ message }`. Reading only `.message` threw the written-for-a-
      // human sentence away and showed the rep "HTTP 400" instead of "Dana
      // Whitfield's email doesn't look right." Take whichever the route sent.
      const body = await response.json().catch(() => null);
      const detail = typeof body?.error === 'string' ? body.error
        : typeof body?.message === 'string' ? body.message
          : '';
      addTrail('api', `${init.method || 'GET'} ${endpointShape(endpoint)} → ${response.status}${detail ? ` ${detail}` : ''}`);
      throw new Error(detail || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const api = new ApiClient(API_BASE);
