export const money = (n?: number | null): string | null =>
  n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// (555) 555-1234 for US 10/11-digit numbers; otherwise returns the input unchanged.
export function formatPhone(p?: string | null): string {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return p;
}

export function timeAgo(s?: string | number | null): string {
  if (!s) return '';
  const ms = typeof s === 'number' ? s : new Date(s).getTime();
  if (!Number.isFinite(ms)) return '';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return 'just now';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a date for display.
 *
 * A date-only string ("2026-08-13" — how due dates and issue dates are stored)
 * parses as UTC midnight, which is the PREVIOUS day everywhere in the US. An
 * invoice issued the 13th read "Aug 12". Anchoring to local noon puts it safely
 * inside the intended day in every timezone.
 */
export const fmtDate = (s?: string | null) => {
  if (!s) return null;
  const d = localDay(s);
  if (!d) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Same anchoring as fmtDate, without the year — "Aug 13". */
export const fmtDay = (s?: string | null) => {
  if (!s) return null;
  const d = localDay(s);
  if (!d) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function localDay(s: string): Date | null {
  const d = new Date(s.length === 10 ? `${s}T12:00:00` : s);
  return isNaN(d.getTime()) ? null : d;
}
