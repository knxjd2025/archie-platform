import type { Request } from 'express';

/** A request key: 8 to 200 plain characters. Absent is fine (no repeat protection); present and unusable is refused, never quietly ignored. */
export function readRequestKey(req: Request): { ok: true; key: string | null } | { ok: false } {
  const raw = req.get('idempotency-key');
  if (raw === undefined) return { ok: true, key: null };
  return /^[A-Za-z0-9_.:-]{8,200}$/.test(raw) ? { ok: true, key: raw } : { ok: false };
}
