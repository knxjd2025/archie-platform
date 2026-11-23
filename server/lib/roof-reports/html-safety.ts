/**
 * html-safety.ts: the small set of checks every report renderer uses before a
 * value is written into a page. Pure module, no imports.
 *
 * Escaping a value is the right defence for text and for quoted attributes
 * (`escapeHtml`). Three kinds of value need a different one, because escaping
 * does not make them safe:
 *   - a colour goes into CSS, where `;}` ends the rule;
 *   - a link goes where a browser will run `javascript:` if it is allowed to;
 *   - JSON placed inside a <script> block ends the block at `</script>`.
 * Each helper here answers with something safe or with the fallback, never with
 * a clever repair of what it was given.
 */

/** `#abc`, `#aabbcc`, or either with an alpha pair. Nothing else is a colour here. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function safeColor(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const t = raw.trim();
  return HEX_COLOR.test(t) ? t : fallback;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** http, https, mailto and tel links only. Anything else, or anything odd, is "". */
export function safeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (t === '' || CONTROL_CHARS.test(t)) return '';
  return /^(?:https?:\/\/[^\s]|mailto:[^\s]|tel:[^\s])/i.test(t) ? t : '';
}

/** http and https only: for a picture's `src`. */
export function safeHttpUrl(raw: unknown): string {
  const u = safeUrl(raw);
  return /^https?:/i.test(u) ? u : '';
}

/** A picture source: an http(s) address, or an inline PNG, JPEG, WebP or GIF. Nothing else. */
export function safeImageSrc(raw: unknown): string {
  const http = safeHttpUrl(raw);
  if (http) return http;
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(t) ? t : '';
}

/** A chapter or element id: lowercase letters, digits and hyphens, starting with a letter. */
export const SAFE_ID = /^[a-z][a-z0-9-]{1,40}$/;
export function isSafeId(raw: unknown): raw is string {
  return typeof raw === 'string' && SAFE_ID.test(raw);
}

/** A finite number inside [min, max], otherwise the fallback. Strings that are plain numbers count. */
export function boundedNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * JSON that is safe to write inside a <script> element: `<`, `>` and `&` can
 * never open a tag or a comment, and the two line separators that older
 * parsers treat as a newline inside a string are written out.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
