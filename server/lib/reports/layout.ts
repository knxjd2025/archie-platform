/**
 * Section layout for every report type.
 *
 * Each renderer builds its document as a list of named sections and hands
 * them here; the rep's saved layout (report.data.layout) decides which are
 * shown and in what order. The same function serves preview and save, and
 * the editor lists exactly what the renderer produced — so the editor can
 * never offer a section the document doesn't have, or hide one it can't.
 */

export interface ReportSection {
  /** Stable key, e.g. 'storm'. Saved in the layout, so never rename casually. */
  key: string;
  /** What the editor shows. */
  label: string;
  html: string;
  /** Hero/footer: always shown, never moved. */
  fixed?: boolean;
  /** Always shown, but free to move — a chapter the document may not go out without. */
  required?: boolean;
  /**
   * Always the last thing before the closing fixed sections (the footer),
   * whatever order the rep saved — the full photo list. It can still be
   * switched off; it cannot be dragged.
   */
  last?: boolean;
}

export interface ReportLayout {
  /** Section keys in display order. Keys not listed keep their default position. */
  order?: string[];
  /** Section keys the rep has switched off. */
  hidden?: string[];
}

export interface SectionInfo {
  key: string;
  label: string;
  /** False when the renderer had nothing to put in it for this report. */
  present: boolean;
  hidden: boolean;
  fixed: boolean;
  /** True when the rep may move it but not switch it off. */
  required: boolean;
  /** True when it always sits at the end of the document. */
  last: boolean;
}

const MAX_KEYS = 80;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Accept only well-formed keys from a client. Unknown keys are harmless (ignored at render). */
export function normalizeLayout(input: unknown): ReportLayout | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const keys = (v: unknown) => (Array.isArray(v) ? v.map((k) => String(k)).filter((k) => KEY_RE.test(k)).slice(0, MAX_KEYS) : undefined);
  const order = keys(o.order);
  const hidden = keys(o.hidden);
  if (!order && !hidden) return null;
  return { ...(order ? { order: Array.from(new Set(order)) } : {}), ...(hidden ? { hidden: Array.from(new Set(hidden)) } : {}) };
}

/**
 * Apply a layout. Fixed sections stay where they are; the movable ones
 * between them follow `order`. A section the layout doesn't mention keeps its
 * place relative to its neighbours, so a newly added chapter shows up where
 * the template puts it rather than falling to the end. Sections marked
 * `last` (the full photo list) always go at the end, before the footer.
 */
export function arrangeSections(sections: ReportSection[], layout?: ReportLayout | null): ReportSection[] {
  const ordered = arrangeMovable(sections.filter((s) => !s.last), layout);
  const tail = sections.filter((s) => s.last && s.html && (s.required || !new Set(layout?.hidden ?? []).has(s.key)));
  if (!tail.length) return ordered;
  // The end of the document is before the trailing run of fixed sections (the footer).
  let at = ordered.length;
  while (at > 0 && ordered[at - 1].fixed) at--;
  return [...ordered.slice(0, at), ...tail, ...ordered.slice(at)];
}

function arrangeMovable(sections: ReportSection[], layout?: ReportLayout | null): ReportSection[] {
  const hidden = new Set(layout?.hidden ?? []);
  const order = layout?.order ?? [];
  const visible = sections.filter((s) => s.html && (s.fixed || s.required || !hidden.has(s.key)));
  if (!order.length) return visible;

  const rank = new Map(order.map((k, i) => [k, i]));
  const movable = visible.filter((s) => !s.fixed);
  const mentioned = movable.filter((s) => rank.has(s.key)).sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
  // Walk the default order; the first mentioned slot emits every mentioned
  // section in layout order, unmentioned ones stay put.
  const placed: ReportSection[] = [];
  let emitted = false;
  for (const s of movable) {
    if (rank.has(s.key)) {
      if (!emitted) { placed.push(...mentioned); emitted = true; }
    } else {
      placed.push(s);
    }
  }
  // Re-thread the fixed sections at their original indexes.
  const out: ReportSection[] = [];
  let mi = 0;
  for (const s of visible) {
    if (s.fixed) out.push(s);
    else out.push(placed[mi++]);
  }
  return out;
}

/**
 * Hold a document to a minimum length.
 *
 * A commercial proposal that a rep has trimmed to four chapters is not the
 * document the building owner was promised. When hiding sections would leave
 * fewer than `min` on the page, the most recently hidden ones are put back —
 * in the template's own order, so what returns is what the template leads
 * with. Returns the layout to render with; the saved layout is not rewritten,
 * so un-hiding something else later lets the rep's choice take effect again.
 */
export function enforceMinimumSections(sections: ReportSection[], layout: ReportLayout | null | undefined, min: number): ReportLayout | null {
  const hidden = new Set(layout?.hidden ?? []);
  if (!hidden.size) return layout ?? null;
  const present = sections.filter((s) => s.html);
  const shown = present.filter((s) => s.fixed || s.required || !hidden.has(s.key));
  let short = min - shown.length;
  if (short <= 0) return layout ?? null;
  for (const s of present) {
    if (short <= 0) break;
    if (hidden.has(s.key) && !s.fixed && !s.required) { hidden.delete(s.key); short--; }
  }
  return { ...(layout ?? {}), hidden: [...hidden] };
}

/** What the editor lists: every section the renderer knows, present or not, with its state. */
export function describeSections(sections: ReportSection[], layout?: ReportLayout | null): SectionInfo[] {
  const hidden = new Set(layout?.hidden ?? []);
  const arranged = arrangeSections(sections, layout);
  const pos = new Map(arranged.map((s, i) => [s.key, i]));
  return sections
    .map((s) => ({ key: s.key, label: s.label, present: !!s.html, hidden: !s.fixed && !s.required && hidden.has(s.key), fixed: !!s.fixed, required: !!s.required, last: !!s.last }))
    .sort((a, b) => (pos.get(a.key) ?? 1e6) - (pos.get(b.key) ?? 1e6));
}

/** Wrap a document-style section so the editor can point at it. */
export function tagSection(s: ReportSection): string {
  if (!s.html) return '';
  // Scroll documents are <section id="ch-…"> already; tag the element itself
  // rather than wrapping (the page script pairs nav links to sections by index).
  if (/^\s*<section[\s>]/.test(s.html)) return s.html.replace(/^\s*<section/, `<section data-section="${s.key}"`);
  return `<div class="rpt-sec" id="sec-${s.key}" data-section="${s.key}">${s.html}</div>`;
}

export function joinSections(sections: ReportSection[]): string {
  return sections.map(tagSection).filter(Boolean).join('\n');
}
