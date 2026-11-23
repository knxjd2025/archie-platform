/**
 * safe-url.ts — URL scheme allowlist for hardening link hrefs.
 *
 * Assistant-generated Markdown (claims chat) can contain links. Rendering a
 * link whose href is `javascript:`, `data:`, `vbscript:`, or `file:` is an XSS
 * vector (a click executes script / loads attacker-controlled content). This
 * pure helper returns the URL only when its scheme is on a small safe allowlist
 * (http, https, mailto, tel) or when it is a scheme-less relative / anchor /
 * query URL. Anything else — including unknown schemes — is rejected and an
 * empty string is returned so the caller renders a non-navigable link.
 *
 * It is deliberately defensive against obfuscation: leading/trailing whitespace,
 * mixed case, and embedded control characters (tabs, newlines, NULs) inserted
 * into a scheme are normalized away before the scheme is checked, because
 * browsers historically ignore such characters when resolving `href`s
 * (e.g. `java\tscript:` and `jav ascript:` are treated as `javascript:`).
 */

/** Schemes that are safe to navigate to from rendered Markdown. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * Matches one-or-more "ignorable" characters: the ASCII control range
 * (0x00–0x1F), the regular space (0x20), and DEL (0x7F). Built from char-code
 * escapes so this source file contains no literal control characters. Browsers
 * strip these when resolving an href, so we strip them before scheme detection
 * to defeat tricks like `java\tscript:` or `jav ascript:`.
 */
const IGNORABLE_CHARS = new RegExp('[\\u0000-\\u0020\\u007F]+', 'g');

/** Leading scheme: a letter followed by scheme chars, then ':'. */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/;

function stripIgnorableChars(value: string): string {
  return value.replace(IGNORABLE_CHARS, '');
}

/**
 * Returns `url` unchanged if it is safe to use as a link target, otherwise
 * returns "" (empty string -> non-navigable). Safe means: an absolute URL with
 * an allowlisted scheme (http/https/mailto/tel), or a scheme-less relative,
 * anchor (#...), or query (?...) URL.
 *
 * @param url candidate URL (any runtime type is tolerated)
 */
export function sanitizeUrl(url: unknown): string {
  if (typeof url !== 'string') return '';

  const original = url;
  // Outer whitespace shouldn't change safety; empty after trim => nothing.
  const trimmed = url.trim();
  if (trimmed === '') return '';

  // Normalize for scheme detection only: remove control chars + spaces so
  // obfuscated schemes collapse to their real form, then lowercase.
  const normalized = stripIgnorableChars(trimmed).toLowerCase();

  const schemeMatch = normalized.match(SCHEME_RE);

  if (!schemeMatch) {
    // No scheme present (relative path, ./x, ../x, #anchor, ?query, plain) —
    // these are safe. A colon that appears only after '/', '?', or '#'
    // (e.g. "/a:b") is not a scheme and is correctly not matched here.
    return original;
  }

  const scheme = schemeMatch[1];
  if (SAFE_SCHEMES.has(scheme)) {
    return original;
  }

  // Known-dangerous or simply un-allowlisted scheme -> reject.
  return '';
}

export default sanitizeUrl;
