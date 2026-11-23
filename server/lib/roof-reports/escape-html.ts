/**
 * HTML escaper — pure module (no side effects, no imports).
 *
 * Escapes the five HTML-significant characters so user-controlled values can
 * be safely interpolated into generated report HTML. These roof-analysis
 * reports are exported to R2 / shared links, so an injected "<script>" must
 * never execute.
 *
 * Ampersand is encoded FIRST (via the regex alternation order + single-pass
 * replace) so existing output is never double-encoded.
 *
 * - Returns "" for null / undefined.
 * - Coerces non-string values to string (callers may pass JSONB numbers, etc.).
 */
const ESCAPE_HTML_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

// `&` is listed first in the character class; a single-pass replace visits
// each source character once, so an already-present `&` is encoded exactly
// once (no double-encoding).
const ESCAPE_HTML_REGEX = /[&<>"']/g;

export function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(ESCAPE_HTML_REGEX, (ch) => ESCAPE_HTML_MAP[ch]);
}
