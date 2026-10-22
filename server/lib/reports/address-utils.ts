/**
 * Pure address helpers for the report pipeline. No I/O, no heavy imports, so they
 * are trivially unit-testable.
 */

/** A usable street address has a number — "Springfield, IL" alone is not one. */
export function hasRealStreet(address?: string): boolean {
  return /\d/.test((address || '').trim());
}

/** Tolerant US address split: "123 Main St, Springfield, IL 62701[, USA]". */
export function parseUsAddress(full: string): { address: string; city?: string; state?: string; zip?: string } {
  const parts = full.split(',').map(s => s.trim()).filter(Boolean);
  // Drop a trailing country token (JobTread appends ", USA") so it isn't mistaken
  // for the state/zip segment.
  if (parts.length > 1 && /^(usa|united states|us)$/i.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0) return { address: full.trim() };
  const stateZip = parts.length >= 2 ? parts[parts.length - 1] : '';
  const m = stateZip.match(/^([A-Za-z]{2})\s*(\d{5})?$/);
  if (m && parts.length >= 3) {
    return { address: parts.slice(0, parts.length - 2).join(', '), city: parts[parts.length - 2], state: m[1].toUpperCase(), zip: m[2] };
  }
  if (m && parts.length === 2) {
    return { address: parts[0], state: m[1].toUpperCase(), zip: m[2] };
  }
  return { address: parts[0], city: parts[1], state: parts[2], zip: parts[3] };
}
