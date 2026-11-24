/** What a log line may say about a failure: its name or database code, never its message (a message can carry an address or a provider's words). */
export function kindOf(error: unknown): string {
  const e = error as { cause?: { code?: unknown }; code?: unknown; name?: unknown } | null | undefined;
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === 'string' && /^[\w.-]{1,16}$/.test(code)) return code;
  return typeof e?.name === 'string' && /^\w{1,40}$/.test(e.name) ? e.name : 'unknown';
}
