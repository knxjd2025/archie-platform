import { resetSessionExpiredNotice } from './api';

const API_BASE = import.meta.env.VITE_API_URL || '';
const GENERIC = 'Something went wrong. Try again.';

/**
 * POST to a sign-in route and return its error text, or null on success.
 *
 * Not the shared api client: that treats any 401 as "your session timed out",
 * and a wrong password is a 401 from somebody who was never signed in.
 */
export async function postAuth(path: string, body: unknown): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  } catch {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (res.ok) {
    resetSessionExpiredNotice();
    return null;
  }
  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    const s = Number(data?.retryAfterSeconds);
    if (Number.isFinite(s) && s > 0) {
      const wait = s > 90 ? `${Math.ceil(s / 60)} minutes` : `${Math.ceil(s)} seconds`;
      return `Too many tries. Try again in about ${wait}.`;
    }
    return 'Too many tries. Wait a little and try again.';
  }
  return typeof data?.error === 'string' && data.error.trim() ? data.error : GENERIC;
}
