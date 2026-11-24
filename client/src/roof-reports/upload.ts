/**
 * Sending one report photo, and keeping several going without flooding the
 * connection. The photo is redrawn as a JPEG in the browser first (see
 * ./photo-prepare.ts), then sent as the raw body of POST /api/roof-reports/photos
 * with progress events, which the app's JSON client cannot give.
 *
 * What a failure says is the server's own plain sentence when it sent one, else
 * "The photo couldn't be saved. Please try again." Never a status code or markup.
 */
import { BILLING_LOCKED_EVENT, SESSION_EXPIRED_EVENT } from '../lib/api';
import { BILLING_LOCKED_CODE } from '../../../shared/billing/status';
import { RR, plainMessage } from './words';

const API_BASE = import.meta.env.VITE_API_URL || '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UPLOAD_TIMEOUT_MS = 120_000;
/** Photos sent at the same time. */
export const UPLOADS_AT_ONCE = 3;

/** The address a photo is sent to, naming what it shows only when that was said. */
export const photoPath = (category: string | null | undefined): string =>
  category ? `/api/roof-reports/photos?category=${encodeURIComponent(category)}` : '/api/roof-reports/photos';

export type UploadAnswer = { ok: true; id: string } | { ok: false; error: string };

/** What the server said, as the photo's id or a sentence to show. */
export function readUploadAnswer(status: number, body: string): UploadAnswer {
  let parsed: unknown = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
  const field = (name: string): unknown => (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[name] : undefined);
  const id = field('id');
  if (status >= 200 && status < 300 && typeof id === 'string' && UUID_RE.test(id)) return { ok: true, id };
  const sentence = typeof field('error') === 'string' ? plainMessage({ message: field('error') }, RR.photos.notSaved) : RR.photos.notSaved;
  return { ok: false, error: sentence };
}

/** Runs `worker` over `items`, at most `limit` at a time. One failing does not stop the others. */
export async function runLimited<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await worker(item); } catch { /* the worker reports its own failure */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}

/** Sends one JPEG. Resolves with the server's id for it; rejects with an Error whose message is a sentence to show. */
export function uploadJpeg(jpeg: Blob, category: string | null, onProgress: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${photoPath(category)}`);
    xhr.withCredentials = true;
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader('Content-Type', 'image/jpeg');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress((e.loaded / e.total) * 100); };
    xhr.onload = () => {
      // The same two announcements the app's own client makes, so a lapsed sign-in or a locked company is noticed here too.
      if (xhr.status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      if (xhr.status === 402) {
        try { if (JSON.parse(xhr.responseText)?.code === BILLING_LOCKED_CODE) window.dispatchEvent(new CustomEvent(BILLING_LOCKED_EVENT)); } catch { /* not ours to announce */ }
      }
      const answer = readUploadAnswer(xhr.status, xhr.responseText);
      if (answer.ok) resolve(answer.id); else reject(new Error(answer.error));
    };
    xhr.onerror = () => reject(new Error(RR.photos.notSaved));
    xhr.ontimeout = () => reject(new Error(RR.photos.tooSlow));
    xhr.onabort = () => reject(new Error(RR.photos.notSaved));
    xhr.send(jpeg);
  });
}
