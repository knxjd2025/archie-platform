/**
 * A rep's own labels for a door, beside its status.
 *
 * Status says what happened at the door (one value). Labels say what the rep
 * noticed (any number): the damage they saw, what to know before knocking
 * again. The suggested set covers the common ones in one tap; a rep can still
 * type their own.
 */

export interface LabelOption {
  value: string;
  label: string;
  /** A label that should stop anyone knocking again is shown in red. */
  tone: 'damage' | 'info' | 'warn';
}

export const SUGGESTED_LABELS: readonly LabelOption[] = [
  { value: 'hail damage', label: 'Hail damage', tone: 'damage' },
  { value: 'wind damage', label: 'Wind damage', tone: 'damage' },
  { value: 'missing shingles', label: 'Missing shingles', tone: 'damage' },
  { value: 'old roof', label: 'Old roof', tone: 'damage' },
  { value: 'leak', label: 'Leak', tone: 'damage' },
  { value: 'insurance claim', label: 'Insurance claim', tone: 'info' },
  { value: 'come back evening', label: 'Come back evening', tone: 'info' },
  { value: 'come back weekend', label: 'Come back weekend', tone: 'info' },
  { value: 'spouse decides', label: 'Spouse decides', tone: 'info' },
  { value: 'renter', label: 'Renter', tone: 'info' },
  { value: 'dog', label: 'Dog', tone: 'warn' },
  { value: 'no soliciting', label: 'No soliciting', tone: 'warn' },
  { value: 'do not knock', label: 'Do not knock', tone: 'warn' },
];

export const MAX_LABELS = 12;
export const MAX_LABEL_LENGTH = 30;

/**
 * Clean a label list from a request: trimmed, lower-cased, de-duplicated,
 * bounded. Anything that is not a string is dropped rather than rejected — a
 * label is a note, and one bad entry should not lose the rest.
 */
export function normalizeLabels(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const v = raw.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_LABEL_LENGTH);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

export function labelMeta(value: string): LabelOption {
  return SUGGESTED_LABELS.find((l) => l.value === value)
    ?? { value, label: value.charAt(0).toUpperCase() + value.slice(1), tone: 'info' };
}

/**
 * A follow-up date from a request: `null` clears it, a YYYY-MM-DD date or an
 * ISO timestamp sets it, anything else is `undefined` (invalid — the caller
 * rejects it). A bare date is stored at noon UTC, which is that same calendar
 * day in Eastern time on either side of daylight saving — so a follow-up set
 * for "the 12th" is due on the 12th's reminder, not the 11th's.
 */
export function parseFollowUp(input: unknown): Date | null | undefined {
  if (input === null || input === '') return null;
  if (typeof input !== 'string') return undefined;
  const s = input.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  const year = d.getUTCFullYear();
  return year < 2000 || year > 2100 ? undefined : d;
}
