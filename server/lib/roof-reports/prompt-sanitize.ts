/**
 * prompt-sanitize.ts — defensive hardening for user-taught text that gets
 * embedded into an LLM grounding/system prompt.
 *
 * User-supplied KnowledgeEntry items (taught via the assistant's "remember"
 * loop) are concatenated into Claude's system prompt for grounding. That text
 * is untrusted: it can carry ASCII control characters (terminal escapes,
 * NUL/BEL, etc.) used for prompt-injection / control-char tricks, or be
 * arbitrarily long. This module neutralizes those vectors without touching the
 * deterministic artifacts the assistant emits.
 *
 * Pure, dependency-free — safe to unit-test in isolation.
 */

/**
 * Sanitize a single piece of user-taught text before it is embedded into a
 * prompt. Strips ASCII control characters (0x00–0x1F except newline `\n` and
 * tab `\t`, plus DEL 0x7F), trims surrounding whitespace, collapses runs of
 * 3+ newlines down to a single blank line, and caps the result to `maxLen`.
 *
 * @param text   Untrusted input. Non-strings yield "".
 * @param maxLen Maximum length of the returned string (default 2000).
 * @returns      Sanitized text, or "" for non-string / empty input.
 */
export function sanitizePromptText(text: string, maxLen = 2000): string {
  if (typeof text !== 'string' || text.length === 0) return '';

  // Strip ASCII control chars 0x00–0x1F (keep \n 0x0A and \t 0x09) plus DEL 0x7F.
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');

  // Collapse 3+ consecutive newlines (allowing intervening spaces/tabs) into a
  // single blank-line separator, then trim outer whitespace.
  const collapsed = stripped.replace(/\n[ \t]*(?:\n[ \t]*){2,}/g, '\n\n').trim();

  if (collapsed.length === 0) return '';

  // Cap to maxLen. A non-positive / non-finite maxLen yields "".
  if (!Number.isFinite(maxLen) || maxLen <= 0) return '';
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen) : collapsed;
}
