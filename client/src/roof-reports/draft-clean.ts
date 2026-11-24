/**
 * Clearing the browser's roof report drafts. A draft holds a homeowner's name,
 * email, phone and address and the inspector's notes, so it must not outlive
 * the sign-in it belongs to: it goes on sign-out, when a session ends, when
 * someone else signs in on the same browser, and, for any draft of anyone that
 * is past its day, whenever the roof reports page loads.
 *
 * Plain functions over a storage with `length` and `key(i)` (the browser's own
 * has both). Every read and write is inside try and catch: blocked storage
 * means there is nothing to clear, said to nobody. Kept apart from draft.ts so
 * the sign-in code can use it without pulling in the wizard's draft shape.
 */
export const DRAFT_PREFIX = 'archie.roofReportDraft.';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** A draft saved by a clock this far ahead of ours is not believed. */
export const FUTURE_SLACK_MS = 5 * 60 * 1000;
export const DRAFT_VERSION = 1;

export interface ClearableStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

const OPEN_SUFFIX = '.open';

/** Every key this feature keeps a draft or an "it was open" marker under. */
function draftKeys(storage: ClearableStorage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k === 'string' && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
  } catch { /* blocked storage: nothing to find */ }
  return keys;
}

function remove(storage: ClearableStorage, key: string): boolean {
  try { storage.removeItem(key); return true; } catch { return false; }
}

/** Removes every roof report draft key, and the open markers. Returns how many it removed. */
export function forgetAllDrafts(storage: ClearableStorage | null): number {
  if (!storage) return 0;
  return draftKeys(storage).filter((k) => remove(storage, k)).length;
}

/** The email a draft key belongs to (keys are `prefix.v1.<company>.<email>`, with `.open` after it for a marker), as the two readings the suffix allows. */
function emailsOf(key: string): string[] {
  const m = /^archie\.roofReportDraft\.v\d+\.[^.]+\.(.+)$/.exec(key);
  if (!m) return [];
  const rest = m[1].toLowerCase();
  return rest.endsWith(OPEN_SUFFIX) ? [rest, rest.slice(0, -OPEN_SUFFIX.length)] : [rest];
}

/** Removes the drafts of everyone but this person (in any of their companies). With no one signed in, removes them all. */
export function forgetDraftsOfOthers(storage: ClearableStorage | null, email: string | null | undefined): number {
  if (!storage) return 0;
  const me = (email ?? '').trim().toLowerCase();
  return draftKeys(storage).filter((k) => !(me && emailsOf(k).includes(me)) && remove(storage, k)).length;
}

/** Removes every draft, of anyone, that is past its day, dated by a clock far ahead, not readable or of another version. Returns how many. */
export function sweepExpiredDrafts(storage: ClearableStorage | null, now: number = Date.now()): number {
  if (!storage) return 0;
  let removed = 0;
  for (const key of draftKeys(storage)) {
    if (key.endsWith(OPEN_SUFFIX)) continue;
    let keep = false;
    try {
      const raw = storage.getItem(key);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      const p = parsed as { v?: unknown; savedAt?: unknown } | null;
      keep = !!p && typeof p === 'object' && p.v === DRAFT_VERSION && typeof p.savedAt === 'number' && Number.isFinite(p.savedAt)
        && p.savedAt <= now + FUTURE_SLACK_MS && now - p.savedAt < DRAFT_TTL_MS;
    } catch { keep = false; }
    if (!keep && remove(storage, key)) removed++;
  }
  return removed;
}

function browser(kind: 'localStorage' | 'sessionStorage'): ClearableStorage | null {
  try { return typeof window !== 'undefined' ? window[kind] : null; } catch { return null; }
}

/** The person signed out or the session ended: every draft in this browser goes, and this tab's "wizard was open" markers. */
export function forgetRoofReportDrafts(): void {
  forgetAllDrafts(browser('localStorage'));
  forgetAllDrafts(browser('sessionStorage'));
}

/** Someone signed in: anyone else's draft left on this browser goes. */
export function forgetRoofReportDraftsOfOthers(email: string | null | undefined): void {
  forgetDraftsOfOthers(browser('localStorage'), email);
  forgetDraftsOfOthers(browser('sessionStorage'), email);
}

/** The roof reports page loaded: drafts past their day go, whoever they belong to. */
export function sweepExpiredRoofReportDrafts(): void {
  sweepExpiredDrafts(browser('localStorage'));
}
