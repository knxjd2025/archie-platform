/**
 * One pending-changes object for the whole report.
 *
 * Editing used to be three disconnected endpoints — pricing, photos, prose —
 * each saving on its own. That made a live preview impossible (there was no
 * single "what the report would look like"), and it meant a rep making three
 * related changes wrote to the document three times, with a customer
 * potentially watching.
 *
 * A draft is applied to the report data to PREVIEW it, and applied again to
 * SAVE it. Exactly the same function both times, so what a rep approves is
 * what gets written — the preview cannot drift from the result.
 */
import { setEstimateLines, type CustomLineInput } from '../lib/reports/estimate-editing';
import { applyPhotoAdds, applyPhotoEdits, orderPhotos, withPhotos, isSafeImageUrl, type PhotoAdd, type PhotoEdit } from './photo-editing';
import { isCommercialReport } from '../lib/reports/commercial-context';
import type { AssemblyEdits, SystemKind } from '../lib/reports/sections/assembly-diagram';
import type { CustomSection } from '../lib/reports/sections/commercial-chapters';
import { summaryText } from './refine';
import { normalizeLayout, type ReportLayout } from '../lib/reports/layout';
import { serviceTierRateOk } from '../../shared/addon-pricing';

export interface ReportDraft {
  title?: string;
  executiveSummary?: string;
  inspectorNotes?: string;
  /** Finding id -> new label/description, or remove it from its photo. */
  findings?: Record<string, { label?: string; description?: string; remove?: boolean }>;
  /** Photo id -> its finding ids in the new order. */
  findingOrder?: Record<string, string[]>;
  photos?: PhotoEdit[];
  /** Photos to add from the job's pool (id is addedPhotoId(url) on both sides). */
  addPhotos?: PhotoAdd[];
  /** Photo ids in display order — listed first, unlisted keep their order after. */
  photoOrder?: string[];
  /** Which sections show, and in what order. Whole replacement. */
  layout?: ReportLayout | null;
  /** Good/Better/Best pricing and which tier the document opens on. */
  tiers?: {
    selectedTier?: 'good' | 'better' | 'best';
    rates?: Partial<Record<'good' | 'better' | 'best', { ratePerSquare?: number; squares?: number }>>;
  };
  /** Whole replacement list for the estimate. */
  lines?: CustomLineInput[];
  /** The property-specific narrative chapters (report-narrative.ts), editable before sending. */
  narrativeFindings?: string;
  narrativeSolution?: string;

  /* ---- commercial Proposal / Presentation only; ignored on any other document ---- */

  /** The paragraph The Short Version leads with. Empty restores the inspector's own summary. */
  commercialSummary?: string;
  /** Chapter key -> a note pinned to the end of that chapter. Empty removes it. Merged per key. */
  sectionNotes?: Record<string, string>;
  /** Chapters the rep wrote. Whole replacement list. */
  customSections?: CustomSection[];
  /** Wording, layer fates, note and photo on the layer diagram. Whole replacement; null resets it. */
  assembly?: AssemblyEdits | null;
  /** The editable lines of Before We Start. Whole replacement; null restores the standard list. */
  beforeStartTerms?: string[] | null;
}

export interface AppliedDraft {
  data: any;
  /** Human-readable list of what this draft changes, for the approval step. */
  changes: string[];
  /** Photos whose analysis was dropped because their image was replaced. */
  clearedFindings: string[];
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const MAX = {
  title: 200, summary: 4000, notes: 6000, label: 200, description: 2000, narrative: 20000,
  sectionNote: 1500, sectionNotes: 40, customSections: 8, customTitle: 120, customBody: 6000,
  layerLabel: 120, layerDetail: 160, layers: 40, assemblyNote: 600, photoCaption: 200,
  terms: 12, term: 300, commercialSummary: 2000,
};

const SECTION_KEY_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const CUSTOM_ID_RE = /^[a-z0-9]{1,24}$/;
const LAYER_ID_RE = /^[tn]-[a-z0-9_-]{1,40}$/;
const SYSTEMS: SystemKind[] = ['tear_off', 'layover', 'coating'];
const FATES = ['removed', 'stays', 'repaired'] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function cleanCustomSections(list: unknown): CustomSection[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CustomSection[] = [];
  for (const c of list) {
    const id = String(c?.id ?? '');
    const title = clean(c?.title, MAX.customTitle);
    const body = cleanMultiline(c?.body, MAX.customBody);
    const photoUrl = isSafeImageUrl(c?.photoUrl) ? String(c.photoUrl).trim() : undefined;
    if (!CUSTOM_ID_RE.test(id) || seen.has(id) || !title || (!body && !photoUrl)) continue;
    seen.add(id);
    out.push({ id, title, body, ...(photoUrl ? { photoUrl } : {}) });
    if (out.length >= MAX.customSections) break;
  }
  return out;
}

/** Accept only well-formed diagram edits; anything else is dropped rather than stored. */
function cleanAssembly(input: unknown): AssemblyEdits | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as Record<string, any>;
  const out: AssemblyEdits = {};

  const layers: NonNullable<AssemblyEdits['layers']> = {};
  for (const [id, v] of Object.entries(a.layers ?? {}).slice(0, MAX.layers)) {
    if (!LAYER_ID_RE.test(id) || !v || typeof v !== 'object') continue;
    const label = typeof (v as any).label === 'string' ? clean((v as any).label, MAX.layerLabel) : undefined;
    const detail = typeof (v as any).detail === 'string' ? clean((v as any).detail, MAX.layerDetail) : undefined;
    if (label || detail !== undefined) layers[id] = { ...(label ? { label } : {}), ...(detail !== undefined ? { detail } : {}) };
  }
  if (Object.keys(layers).length) out.layers = layers;

  const actions: NonNullable<AssemblyEdits['actions']> = {};
  for (const sys of SYSTEMS) {
    const fates: Record<string, (typeof FATES)[number]> = {};
    for (const [id, v] of Object.entries(a.actions?.[sys] ?? {}).slice(0, MAX.layers)) {
      // Only an existing layer has a fate to change; a new layer is always new.
      if (id.startsWith('t-') && LAYER_ID_RE.test(id) && (FATES as readonly string[]).includes(String(v))) fates[id] = v as (typeof FATES)[number];
    }
    if (Object.keys(fates).length) actions[sys] = fates;
  }
  if (Object.keys(actions).length) out.actions = actions;

  const note = cleanMultiline(a.note, MAX.assemblyNote);
  if (note) out.note = note;
  if (isSafeImageUrl(a.photoUrl)) {
    out.photoUrl = String(a.photoUrl).trim();
    const caption = clean(a.photoCaption, MAX.photoCaption);
    if (caption) out.photoCaption = caption;
  }
  return Object.keys(out).length ? out : null;
}

// Narrative keeps its line breaks — headers and bullets are the structure.
const cleanMultiline = (v: unknown, max: number) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, max);

export function isEmptyDraft(d: ReportDraft | null | undefined): boolean {
  if (!d) return true;
  return !d.title && !d.executiveSummary && !d.inspectorNotes
    && !Object.keys(d.findings ?? {}).length
    && !Object.keys(d.findingOrder ?? {}).length
    && !(d.photos ?? []).length
    && !(d.addPhotos ?? []).length
    && !(d.photoOrder ?? []).length
    && d.layout === undefined
    && !d.tiers
    && !d.lines
    && d.narrativeFindings === undefined && d.narrativeSolution === undefined
    && d.commercialSummary === undefined
    && !Object.keys(d.sectionNotes ?? {}).length
    && d.customSections === undefined
    && d.assembly === undefined
    && d.beforeStartTerms === undefined;
}

/**
 * Apply a draft to report data. Pure — never touches the database, so the same
 * call serves preview and save.
 */
export function applyDraft(data: any, draft: ReportDraft): AppliedDraft {
  let next = { ...(data ?? {}) };
  const changes: string[] = [];
  let clearedFindings: string[] = [];

  const title = clean(draft.title, MAX.title);
  if (draft.title !== undefined && title && title !== next.title) {
    next.title = title;
    changes.push('title');
  }

  const notes = clean(draft.inspectorNotes, MAX.notes);
  if (draft.inspectorNotes !== undefined && notes !== (next.inspectorNotes ?? '')) {
    next.inspectorNotes = notes;
    changes.push('inspector notes');
  }

  const summary = clean(draft.executiveSummary, MAX.summary);
  if (draft.executiveSummary !== undefined && summary && summary !== summaryText(next)) {
    // The report renders this from damageAnalysis.aiSummary. Writing only
    // `executiveSummary` would report success while the document was unchanged.
    next.damageAnalysis = { ...(next.damageAnalysis ?? {}), aiSummary: summary };
    next.executiveSummary = summary;
    changes.push('executive summary');
  }

  if (draft.findings && Object.keys(draft.findings).length) {
    const photos: any[] = next?.damageAnalysis?.photos ?? [];
    let touched = 0;
    let removed = 0;
    const updated = photos.map((p) => ({
      ...p,
      damages: (p.damages ?? []).flatMap((d: any) => {
        const patch = draft.findings?.[d?.id];
        if (!patch) return [d];
        if (patch.remove) { removed++; return []; }
        const label = patch.label !== undefined ? clean(patch.label, MAX.label) : d.label;
        const description = patch.description !== undefined ? clean(patch.description, MAX.description) : d.description;
        if (label === d.label && description === d.description) return [d];
        touched++;
        return [{ ...d, label, description }];
      }),
    }));
    if (touched || removed) {
      next.damageAnalysis = { ...(next.damageAnalysis ?? {}), photos: updated };
      if (touched) changes.push(`${touched} finding${touched === 1 ? '' : 's'}`);
      if (removed) changes.push(`removed ${removed} finding${removed === 1 ? '' : 's'}`);
    }
  }

  if (draft.findingOrder && Object.keys(draft.findingOrder).length) {
    const photos: any[] = next?.damageAnalysis?.photos ?? [];
    let moved = 0;
    const updated = photos.map((p) => {
      const order = draft.findingOrder?.[p.id];
      if (!Array.isArray(order) || !order.length) return p;
      const byId = new Map((p.damages ?? []).map((d: any) => [d.id, d]));
      const seen = new Set<string>();
      const out: any[] = [];
      for (const id of order) { const d = byId.get(id); if (d && !seen.has(id)) { out.push(d); seen.add(id); } }
      for (const d of p.damages ?? []) if (!seen.has(d.id)) out.push(d);
      if (out.some((d, i) => d.id !== p.damages?.[i]?.id)) { moved++; return { ...p, damages: out }; }
      return p;
    });
    if (moved) {
      next.damageAnalysis = { ...(next.damageAnalysis ?? {}), photos: updated };
      changes.push(`finding order on ${moved} photo${moved === 1 ? '' : 's'}`);
    }
  }

  if (draft.photos?.length) {
    const current = next?.damageAnalysis?.photos ?? [];
    const applied = applyPhotoEdits(current, draft.photos);
    if (applied.changed.length) {
      next = withPhotos(next, applied.photos);
      changes.push(...applied.changed);
      clearedFindings = applied.clearedFindings;
    }
  }

  if (draft.addPhotos?.length) {
    const added = applyPhotoAdds(next?.damageAnalysis?.photos ?? [], draft.addPhotos);
    if (added.added.length) {
      next = withPhotos(next, added.photos);
      changes.push(`added ${added.added.length} photo${added.added.length === 1 ? '' : 's'}`);
    }
  }

  if (draft.photoOrder?.length) {
    const ordered = orderPhotos(next?.damageAnalysis?.photos ?? [], draft.photoOrder);
    if (ordered.changed) {
      next = withPhotos(next, ordered.photos);
      changes.push('photo order');
    }
  }

  if (draft.layout !== undefined) {
    const layout = normalizeLayout(draft.layout);
    const before = JSON.stringify(next.layout ?? null);
    const after = JSON.stringify(layout);
    if (before !== after) {
      next.layout = layout;
      const hidden = layout?.hidden?.length ?? 0;
      changes.push(hidden ? `section layout (${hidden} hidden)` : 'section layout');
    }
  }

  if (draft.tiers && Array.isArray(next.replacementOptions) && next.replacementOptions.length) {
    const TIERS = ['good', 'better', 'best'] as const;
    let repriced = 0;
    const options = next.replacementOptions.map((o: any) => {
      const r = draft.tiers?.rates?.[o?.tier as typeof TIERS[number]];
      if (!r) return o;
      let rate = r.ratePerSquare != null && Number.isFinite(Number(r.ratePerSquare)) && Number(r.ratePerSquare) >= 0 ? Number(r.ratePerSquare) : o.ratePerSquare;
      // A tune-up or cleaning stays inside its $29–$99 band; an edit outside it is ignored.
      if (o?.product?.category === 'service' && !serviceTierRateOk(rate)) rate = o.ratePerSquare;
      const squares = r.squares != null && Number.isFinite(Number(r.squares)) && Number(r.squares) > 0 ? Number(r.squares) : o.squares;
      if (rate === o.ratePerSquare && squares === o.squares) return o;
      repriced++;
      return { ...o, ratePerSquare: rate, squares, total: Math.round(rate * squares * 100) / 100 };
    });
    if (repriced) {
      next.replacementOptions = options;
      if (next.roofDetails && options[0]?.squares) next.roofDetails = { ...next.roofDetails, squares: options[0].squares };
      changes.push(`tier pricing (${repriced} tier${repriced === 1 ? '' : 's'})`);
    }
    const sel = draft.tiers.selectedTier;
    if (sel && TIERS.includes(sel) && sel !== next.selectedTier) {
      next.selectedTier = sel;
      changes.push(`opens on ${sel}`);
    }
  }

  if (draft.narrativeFindings !== undefined || draft.narrativeSolution !== undefined) {
    const cur = next.narrative ?? {};
    const findings = draft.narrativeFindings !== undefined ? cleanMultiline(draft.narrativeFindings, MAX.narrative) : cur.findings;
    const solution = draft.narrativeSolution !== undefined ? cleanMultiline(draft.narrativeSolution, MAX.narrative) : cur.solution;
    if (findings !== (cur.findings ?? '') || solution !== (cur.solution ?? '')) {
      // Emptying both removes the chapters; the renderer skips a missing narrative.
      next.narrative = (findings || solution) ? { ...cur, findings: findings || '', solution: solution || null, editedAt: new Date().toISOString() } : null;
      if (findings !== (cur.findings ?? '')) changes.push('roof narrative');
      if (solution !== (cur.solution ?? '')) changes.push('recommended solution');
    }
  }

  // The commercial documents' own editing tools. On any other document these
  // would save and show nothing, so they are not applied at all.
  if (isCommercialReport(next)) {
    if (draft.commercialSummary !== undefined) {
      const text = cleanMultiline(draft.commercialSummary, MAX.commercialSummary).replace(/\s*\n\s*/g, ' ');
      const cur = String(next.commercialEdits?.summary ?? '');
      // Typing the inspector's own summary back in is not an edit.
      const inspectors = String(next.commercial?.damageSummary ?? '').trim();
      const value = text === inspectors ? '' : text;
      if (value !== cur) {
        next.commercialEdits = { ...(next.commercialEdits ?? {}), summary: value };
        changes.push('summary');
      }
    }

    if (draft.sectionNotes && Object.keys(draft.sectionNotes).length) {
      const notes: Record<string, string> = { ...(next.sectionNotes ?? {}) };
      for (const [key, v] of Object.entries(draft.sectionNotes).slice(0, MAX.sectionNotes)) {
        if (!SECTION_KEY_RE.test(key) || typeof v !== 'string') continue;
        const text = cleanMultiline(v, MAX.sectionNote);
        // The ceiling is on what is stored, not on one request — notes merge,
        // so without it repeated saves could grow the report without bound.
        if (text && (key in notes || Object.keys(notes).length < MAX.sectionNotes)) notes[key] = text;
        else if (!text) delete notes[key];
      }
      if (!same(notes, next.sectionNotes ?? {})) {
        next.sectionNotes = notes;
        const n = Object.keys(notes).length;
        changes.push(n ? `chapter notes (${n})` : 'chapter notes removed');
      }
    }

    if (draft.customSections !== undefined) {
      const list = cleanCustomSections(draft.customSections);
      if (!same(list, next.customSections ?? [])) {
        next.customSections = list;
        changes.push(list.length ? `your own chapters (${list.length})` : 'your own chapters removed');
      }
    }

    if (draft.assembly !== undefined) {
      const edits = cleanAssembly(draft.assembly);
      if (!same(edits, next.assemblyEdits ?? null)) {
        next.assemblyEdits = edits;
        changes.push(edits ? 'layer diagram' : 'layer diagram reset');
      }
    }

    if (draft.beforeStartTerms !== undefined) {
      const terms = Array.isArray(draft.beforeStartTerms)
        ? draft.beforeStartTerms.map((t) => clean(t, MAX.term)).filter(Boolean).slice(0, MAX.terms)
        : null;
      if (!same(terms, next.beforeStartTerms ?? null)) {
        if (terms) next.beforeStartTerms = terms; else delete next.beforeStartTerms;
        changes.push(terms ? `before-we-start list (${terms.length})` : 'before-we-start list reset');
      }
    }
  }

  if (draft.lines) {
    const before = next?.repairEstimate?.total ?? 0;
    next = setEstimateLines(next, draft.lines);
    const after = next?.repairEstimate?.total ?? 0;
    if (after !== before || draft.lines.length !== (data?.repairEstimate?.lineItems?.length ?? 0)) {
      changes.push(`estimate ($${before.toLocaleString()} → $${after.toLocaleString()})`);
    }
  }

  return { data: next, changes, clearedFindings };
}
