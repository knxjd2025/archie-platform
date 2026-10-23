import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../lib/api';
import { addedPhotoId } from '../../../shared/report-photos';

/**
 * The doc builder: change a finished report and watch it change.
 *
 * Left rail holds what you can change; the right side is the actual rendered
 * document. Every edit — dragged, typed or spoken — goes into ONE pending
 * draft, previewed by the same function that saves it, so what a rep
 * approves is exactly what gets written. Nothing is saved until Save.
 *
 * Works the same on every report type: sections can be dragged into a new
 * order or switched off, photos dragged into order or in from the job's
 * pool, findings dragged within their photo or removed, price lines dragged,
 * and the Good/Better/Best tiers re-priced. Undo is one tap away.
 *
 * A commercial Proposal or Presentation adds its own tab: the summary it
 * leads with, the layer diagram (wording, what happens to each layer, a note
 * and a photo), the Before We Start list, and chapters the rep writes — plus
 * a note that can be pinned to any chapter from the Layout tab.
 */

type Tab = 'layout' | 'text' | 'photos' | 'findings' | 'pricing' | 'commercial';

interface PhotoRow { id: string; url: string; caption: string; findings: number; analyzed: boolean }
interface FindingRow { id: string; photoId: string; label: string; description: string; severity: string | null }
interface LineRow { name: string; quantity: number; unit: string; unitPrice: number }
interface SectionInfo { key: string; label: string; present: boolean; hidden: boolean; fixed: boolean; required?: boolean; last?: boolean }
type Fate = 'removed' | 'stays' | 'repaired';
type SystemKind = 'tear_off' | 'layover' | 'coating';
interface AssemblyEdits {
  layers?: Record<string, { label?: string; detail?: string }>;
  actions?: Partial<Record<SystemKind, Record<string, Fate>>>;
  note?: string; photoUrl?: string; photoCaption?: string;
}
interface CustomSection { id: string; title: string; body: string; photoUrl?: string }
interface EditableLayer { id: string; side: 'today' | 'new'; label: string; detail: string; action: Fate | 'new' }
interface CommercialState {
  minChapters: number; summary: string;
  terms: string[]; termsEdited: boolean; defaultTerms: string[];
  sectionNotes: Record<string, string>; customSections: CustomSection[];
  assembly: { system: SystemKind | null; layers: EditableLayer[]; edits: AssemblyEdits | null };
  openingProduct: string | null;
  photoScan: { requested: number; scanned: number; withIssues: number; scannedAt: string } | null;
}
interface TierRow { tier: 'good' | 'better' | 'best'; product: string | null; ratePerSquare: number; squares: number; total: number }
interface Editor {
  reportType: string; editable: boolean; title: string; executiveSummary: string; inspectorNotes: string;
  narrativeFindings?: string; narrativeSolution?: string;
  photos: PhotoRow[]; available: Array<{ url: string; caption: string }>;
  lines: LineRow[]; total: number; findings: FindingRow[];
  sections: SectionInfo[]; layout: { order?: string[]; hidden?: string[] } | null;
  tiers: TierRow[]; selectedTier: 'good' | 'better' | 'best' | null;
  /** Set on a commercial Proposal / Presentation only — it is what shows the Commercial tab. */
  commercial?: CommercialState | null;
}
interface Draft {
  title?: string; executiveSummary?: string; inspectorNotes?: string;
  narrativeFindings?: string; narrativeSolution?: string;
  findings?: Record<string, { label?: string; description?: string; remove?: boolean }>;
  findingOrder?: Record<string, string[]>;
  photos?: Array<{ id: string; url?: string; caption?: string; remove?: boolean }>;
  addPhotos?: Array<{ url: string; caption?: string }>;
  photoOrder?: string[];
  lines?: LineRow[];
  layout?: { order?: string[]; hidden?: string[] } | null;
  tiers?: { selectedTier?: 'good' | 'better' | 'best'; rates?: Partial<Record<'good' | 'better' | 'best', { ratePerSquare?: number; squares?: number }>> };
  commercialSummary?: string;
  sectionNotes?: Record<string, string>;
  customSections?: CustomSection[];
  assembly?: AssemblyEdits | null;
  beforeStartTerms?: string[] | null;
}

const FATE_LABEL: Record<Fate | 'new', string> = { removed: 'Comes off', stays: 'Stays', repaired: 'Repaired', new: 'New' };
const SYSTEM_LABEL: Record<SystemKind, string> = { tear_off: 'tear-off', layover: 'layover', coating: 'restoration coating' };
const newSectionId = () => Math.random().toString(36).slice(2, 10);

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'layout', label: 'Layout', icon: '📑' },
  { key: 'text', label: 'Text', icon: '📝' },
  { key: 'photos', label: 'Photos', icon: '🖼' },
  { key: 'findings', label: 'Findings', icon: '🔍' },
  { key: 'pricing', label: 'Pricing', icon: '💲' },
  { key: 'commercial', label: 'Commercial', icon: '🏢' },
];
const TIER_LABEL = { good: 'Good', better: 'Better', best: 'Best' } as const;

/** Message names between this editor and the preview page's script, which the server writes (server/reports/routes.ts). */
const PREVIEW_SECTION_MSGS: unknown[] = ['report:section'];
const PREVIEW_SCROLL_MSGS = ['report:scrollTo'];

export default function ReportEditor({
  externalId, reportId, onBack,
}: { externalId: string; reportId: string; onBack: () => void }) {
  const [src, setSrc] = useState<Editor | null>(null);
  const [draft, setDraftState] = useState<Draft>({});
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [tab, setTab] = useState<Tab>('layout');
  const [html, setHtml] = useState('');
  // The preview loads from a blob URL rather than an inline srcdoc document.
  // Both give the sandboxed frame an opaque origin; the blob form is the one
  // every engine handles the same way when the content is swapped repeatedly
  // (Safari and the iOS web view included).
  const [frameUrl, setFrameUrl] = useState<string>('');
  useEffect(() => {
    if (!html) { setFrameUrl(''); return; }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setFrameUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);
  const [changes, setChanges] = useState<string[]>([]);
  const [cleared, setCleared] = useState<string[]>([]);
  const [invisible, setInvisible] = useState<string[]>([]);
  const [sections, setSections] = useState<SectionInfo[]>([]);
  /** Set by "Reset to the standard layout": the next preview takes the server's
   *  order verbatim instead of preserving the rep's drag order. */
  const takeServerOrder = useRef(false);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [chatLog, setChatLog] = useState<Array<{ me: boolean; text: string }>>([]);
  const [thinking, setThinking] = useState(false);
  const [filter, setFilter] = useState('');
  const [poolOpen, setPoolOpen] = useState(false);
  /** The chapter whose pinned note is open for editing on the Layout tab. */
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const previewTimer = useRef<number | null>(null);
  // Which preview request is the latest. A slow render of an older draft used
  // to land after a newer one, showing stale text and clearing `changes` —
  // which let Esc close the editor over edits that were never saved.
  const previewSeq = useRef(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const dirtyRef = useRef(false);

  /** Every change goes through here so undo/redo see it. */
  const setDraft = useCallback((updater: (d: Draft) => Draft) => {
    setDraftState((cur) => {
      const next = updater(cur);
      if (next === cur) return cur;
      setPast((p) => [...p.slice(-49), cur]);
      setFuture([]);
      return next;
    });
  }, []);
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setDraftState((cur) => { setFuture((f) => [cur, ...f]); return prev; });
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setDraftState((cur) => { setPast((p) => [...p, cur]); return next; });
      return f.slice(1);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<Editor>(`/api/clients/${externalId}/reports/${reportId}/editor`);
      setSrc(r);
      setSections(r.sections || []);
      setDraftState({}); setPast([]); setFuture([]);
      if (!r.sections?.length) setTab(r.photos?.length ? 'photos' : 'text');
    } catch (e: any) {
      setError(e?.message || 'Could not open that report.');
    } finally { setLoading(false); }
  }, [externalId, reportId]);
  useEffect(() => { load(); }, [load]);

  // Lock the page behind while the editor is open; restore scroll on close.
  useEffect(() => {
    const y = window.scrollY;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; window.scrollTo(0, y); };
  }, []);

  // Esc closes (never over unsaved work); Cmd/Ctrl+Z undoes, with Shift redoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (e.key === 'Escape' && !dirtyRef.current) { onBack(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, undo, redo]);

  // The document tells us which section the rep clicked.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data || {};
      if (PREVIEW_SECTION_MSGS.includes(d.type) && typeof d.key === 'string') { setTab('layout'); setFlashKey(d.key); setTimeout(() => setFlashKey(null), 1500); }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const scrollPreviewTo = (key: string) => {
    for (const type of PREVIEW_SCROLL_MSGS) frameRef.current?.contentWindow?.postMessage({ type, key }, '*');
  };

  // Re-render the preview as the draft changes (debounced).
  useEffect(() => {
    if (!src) return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(async () => {
      const seq = ++previewSeq.current;
      setPreviewing(true);
      try {
        const r = await api.post<{ html: string; changes: string[]; clearedFindings: string[]; invisible?: string[]; sections?: SectionInfo[] }>(
          `/api/clients/${externalId}/reports/${reportId}/preview`, { draft },
        );
        if (seq !== previewSeq.current) return;
        setHtml(r.html || '');
        setChanges(r.changes || []);
        setCleared(r.clearedFindings || []);
        setInvisible(r.invisible || []);
        // Keep our drag order; take the server's word on what's present.
        if (r.sections?.length) setSections((cur) => {
          if (takeServerOrder.current) { takeServerOrder.current = false; return r.sections!; }
          const byKey = new Map(r.sections!.map((s) => [s.key, s]));
          const merged = cur.map((s) => ({ ...s, present: byKey.get(s.key)?.present ?? s.present }));
          for (const s of r.sections!) if (!byKey.has(s.key) || !cur.some((c) => c.key === s.key)) merged.push(s);
          return merged;
        });
        setError(null);
      } catch (e: any) {
        if (seq !== previewSeq.current) return;
        setError(e?.message || 'Could not render that change.');
      } finally { if (seq === previewSeq.current) setPreviewing(false); }
    }, 450);
    return () => { if (previewTimer.current) window.clearTimeout(previewTimer.current); };
  }, [draft, src, externalId, reportId]);

  const dirty = changes.length > 0;
  dirtyRef.current = dirty;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const r = await api.put<{ changes: string[] }>(`/api/clients/${externalId}/reports/${reportId}/draft`, { draft });
      setChatLog((l) => [...l, { me: false, text: `Saved ${r.changes.length} change${r.changes.length === 1 ? '' : 's'}.` }]);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally { setSaving(false); }
  };

  const ask = async () => {
    const text = msg.trim();
    if (!text || thinking) return;
    setChatLog((l) => [...l, { me: true, text }]);
    setMsg(''); setThinking(true);
    try {
      const r = await api.post<{ reply: string; draft: Draft }>(`/api/clients/${externalId}/reports/${reportId}/chat`, { message: text, draft });
      setChatLog((l) => [...l, { me: false, text: r.reply }]);
      if (r.draft && Object.keys(r.draft).length) setDraft((d) => ({ ...d, ...r.draft }));
    } catch (e: any) {
      setChatLog((l) => [...l, { me: false, text: e?.message || "Couldn't do that." }]);
    } finally { setThinking(false); }
  };

  // ---- derived views ----------------------------------------------------
  const q = filter.trim().toLowerCase();
  const lines = draft.lines ?? src?.lines ?? [];
  const total = lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0), 0);

  /** Report photos + any added from the pool, in the current drag order. */
  const photoList = useMemo(() => {
    if (!src) return [] as Array<PhotoRow & { added?: boolean }>;
    const added = (draft.addPhotos ?? []).map((a) => ({ id: addedPhotoId(a.url), url: a.url, caption: a.caption ?? '', findings: 0, analyzed: false, added: true }));
    const all: Array<PhotoRow & { added?: boolean }> = [...src.photos, ...added];
    const order = draft.photoOrder;
    if (!order?.length) return all;
    const byId = new Map(all.map((p) => [p.id, p]));
    const out: typeof all = [];
    for (const id of order) { const p = byId.get(id); if (p && !out.includes(p)) out.push(p); }
    for (const p of all) if (!out.includes(p)) out.push(p);
    return out;
  }, [src, draft.addPhotos, draft.photoOrder]);
  const photoView = (p: PhotoRow & { added?: boolean }) => {
    const e = draft.photos?.find((x) => x.id === p.id);
    const a = draft.addPhotos?.find((x) => addedPhotoId(x.url) === p.id);
    return { url: e?.url ?? p.url, caption: p.added ? (a?.caption ?? '') : (e?.caption ?? p.caption), removed: !!e?.remove, swapped: !!e?.url && e.url !== p.url };
  };
  const patchPhoto = (p: PhotoRow & { added?: boolean }, patch: Partial<{ url: string; caption: string; remove: boolean }>) =>
    setDraft((d) => {
      if (p.added) {
        if (patch.remove) return { ...d, addPhotos: (d.addPhotos ?? []).filter((x) => addedPhotoId(x.url) !== p.id) };
        return { ...d, addPhotos: (d.addPhotos ?? []).map((x) => addedPhotoId(x.url) === p.id ? { ...x, ...(patch.caption !== undefined ? { caption: patch.caption } : {}) } : x) };
      }
      const rest = (d.photos ?? []).filter((x) => x.id !== p.id);
      const cur = (d.photos ?? []).find((x) => x.id === p.id) ?? { id: p.id };
      return { ...d, photos: [...rest, { ...cur, ...patch }] };
    });
  const onReport = new Set(photoList.map((p) => photoView(p).url));
  const pool = (src?.available ?? []).filter((a) => !onReport.has(a.url));
  const addFromPool = (url: string, caption?: string) => {
    if (onReport.has(url)) return;
    setDraft((d) => ({ ...d, addPhotos: [...(d.addPhotos ?? []), { url, caption: caption || '' }], photoOrder: [...photoList.map((p) => p.id), addedPhotoId(url)] }));
  };

  /** Findings grouped by photo, in the photo order, each in its current drag order. */
  const findingGroups = useMemo(() => {
    if (!src) return [];
    return photoList.filter((p) => !p.added).map((p) => {
      const mine = src.findings.filter((f) => f.photoId === p.id);
      const order = draft.findingOrder?.[p.id];
      const sorted = order?.length ? [...mine].sort((a, b) => { const ia = order.indexOf(a.id), ib = order.indexOf(b.id); return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib); }) : mine;
      return { photo: p, findings: sorted };
    }).filter((g) => g.findings.length && (!q || g.findings.some((f) => `${f.label} ${f.description}`.toLowerCase().includes(q))));
  }, [src, photoList, draft.findingOrder, q]);
  const findingView = (f: FindingRow) => ({ label: draft.findings?.[f.id]?.label ?? f.label, description: draft.findings?.[f.id]?.description ?? f.description, removed: !!draft.findings?.[f.id]?.remove });
  const patchFinding = (id: string, patch: { label?: string; description?: string; remove?: boolean }) =>
    setDraft((d) => ({ ...d, findings: { ...d.findings, [id]: { ...d.findings?.[id], ...patch } } }));

  // ---- commercial tools: one draft, same as everything else ---------------
  const com = src?.commercial ?? null;
  const asm: AssemblyEdits = (draft.assembly !== undefined ? draft.assembly : com?.assembly.edits) ?? {};
  const setAsm = (fn: (a: AssemblyEdits) => AssemblyEdits) =>
    setDraft((d) => ({ ...d, assembly: fn((d.assembly !== undefined ? d.assembly : com?.assembly.edits) ?? {}) }));
  const patchLayer = (id: string, patch: { label?: string; detail?: string }) =>
    setAsm((a) => ({ ...a, layers: { ...a.layers, [id]: { ...a.layers?.[id], ...patch } } }));
  const setFate = (id: string, fate: Fate | 'auto') => {
    const sys = com?.assembly.system;
    if (!sys) return;
    setAsm((a) => {
      const forSys = { ...(a.actions?.[sys] ?? {}) };
      if (fate === 'auto') delete forSys[id]; else forSys[id] = fate;
      return { ...a, actions: { ...a.actions, [sys]: forSys } };
    });
  };
  const terms = draft.beforeStartTerms === undefined ? (com?.terms ?? []) : (draft.beforeStartTerms ?? com?.defaultTerms ?? []);
  const setTerms = (next: string[]) => setDraft((d) => ({ ...d, beforeStartTerms: next }));
  const customList = draft.customSections ?? com?.customSections ?? [];
  const setCustom = (next: CustomSection[]) => setDraft((d) => ({ ...d, customSections: next }));
  const noteFor = (key: string) => draft.sectionNotes?.[key] ?? com?.sectionNotes?.[key] ?? '';
  const setNote = (key: string, text: string) => setDraft((d) => ({ ...d, sectionNotes: { ...d.sectionNotes, [key]: text } }));
  /** Every photo a rep could put beside the diagram or in a chapter: the report's own, then the rest of the job's. */
  const photoChoices = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ url: string; caption: string }> = [];
    for (const p of [...(src?.photos ?? []), ...(src?.available ?? [])]) {
      if (!p.url || seen.has(p.url)) continue;
      seen.add(p.url); out.push({ url: p.url, caption: p.caption ?? '' });
    }
    return out;
  }, [src]);

  // A `last` section (the full photo list) always prints at the end: it can be switched off, not dragged.
  const movable = sections.filter((s) => !s.fixed && !s.last);
  const setLayoutFrom = (next: SectionInfo[]) =>
    setDraft((d) => ({ ...d, layout: { order: next.filter((s) => !s.fixed).map((s) => s.key), hidden: next.filter((s) => s.hidden).map((s) => s.key) } }));
  const toggleHidden = (key: string) => { const next = sections.map((s) => s.key === key ? { ...s, hidden: !s.hidden } : s); setSections(next); setLayoutFrom(next); };

  const tiers = src?.tiers ?? [];
  const tierView = (t: TierRow) => {
    const r = draft.tiers?.rates?.[t.tier];
    const rate = r?.ratePerSquare ?? t.ratePerSquare;
    const squares = r?.squares ?? t.squares;
    return { rate, squares, total: Math.round(rate * squares * 100) / 100 };
  };
  const patchTier = (tier: TierRow['tier'], patch: { ratePerSquare?: number; squares?: number }) =>
    setDraft((d) => ({ ...d, tiers: { ...d.tiers, rates: { ...d.tiers?.rates, [tier]: { ...d.tiers?.rates?.[tier], ...patch } } } }));
  const selectedTier = draft.tiers?.selectedTier ?? src?.selectedTier ?? null;

  // ---- drag sensors: a handle-only pointer drag, long-press on touch so the list still scrolls ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onSectionDrag = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = movable.map((s) => s.key);
    const next = arrayMove(movable, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    // Fixed sections keep their own slots; the movable ones fill the rest in the new order.
    let k = 0;
    const merged = sections.map((s) => (s.fixed || s.last ? s : next[k++]));
    setSections(merged); setLayoutFrom(merged);
  };
  const onPhotoDrag = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const aid = String(active.id);
    if (aid.startsWith('pool:')) { addFromPool(aid.slice(5)); return; }
    if (aid === String(over.id)) return;
    const ids = photoList.map((p) => p.id);
    const to = ids.indexOf(String(over.id));
    if (to < 0) return;
    setDraft((d) => ({ ...d, photoOrder: arrayMove(ids, ids.indexOf(aid), to) }));
  };
  const onFindingDrag = (photoId: string) => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const g = findingGroups.find((x) => x.photo.id === photoId);
    if (!g) return;
    const ids = g.findings.map((f) => f.id);
    setDraft((d) => ({ ...d, findingOrder: { ...d.findingOrder, [photoId]: arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))) } }));
  };
  const onLineDrag = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = Number(String(active.id).slice(5)), to = Number(String(over.id).slice(5));
    setDraft((d) => ({ ...d, lines: arrayMove(lines, from, to) }));
  };

  if (loading) return <div className="p-6"><div className="h-64 bg-gray-100 rounded-xl animate-pulse" /></div>;
  if (!src) return <div className="p-6"><p className="text-sm text-red-600">{error || 'Report not found.'}</p><button onClick={onBack} className="mt-3 text-sm text-blue-600">← Back</button></div>;

  const tabs = TABS.filter((t) =>
    (t.key !== 'layout' || sections.length > 0)
    && (t.key !== 'findings' || src.findings.length > 0)
    && (t.key !== 'pricing' || lines.length > 0 || tiers.length > 0)
    && (t.key !== 'commercial' || !!com));
  const input = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-blue-400';
  const small = 'text-xs border border-gray-200 rounded-lg px-2 py-1 focus:ring-1 focus:ring-blue-400';

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col">
      <header className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <button onClick={onBack} className="text-sm text-gray-600 hover:text-gray-900 px-1">← Back</button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{draft.title ?? src.title ?? 'Report'}</p>
          <p className="text-[11px] text-gray-500 capitalize">
            {src.reportType}
            {previewing && <span className="ml-1.5 text-gray-400">· updating…</span>}
            {dirty && !previewing && <span className="ml-1.5 text-amber-700">· {changes.length} unsaved change{changes.length === 1 ? '' : 's'}</span>}
          </p>
        </div>
        <button onClick={undo} disabled={!past.length} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" className="text-sm px-2 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30">↶</button>
        <button onClick={redo} disabled={!future.length} title="Redo (Shift+Ctrl/Cmd+Z)" aria-label="Redo" className="text-sm px-2 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30">↷</button>
        {dirty && <button onClick={load} disabled={saving} className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-700">Discard</button>}
        <button onClick={save} disabled={!dirty || saving}
          className="text-sm px-4 py-1.5 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {!src.editable && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-2">
          This report was generated before editing was supported for its type. You can read it here; generate it again to edit it.
        </div>
      )}

      <div className="flex-1 flex min-h-0 flex-col lg:flex-row">
        <aside className="w-full max-h-[55vh] lg:max-h-none lg:w-[27rem] lg:flex-shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col min-h-0">
          {/* Six tabs do not fit one row of the rail; they take two rows of three rather than hide the last one off the edge. */}
          <nav className={`gap-1 p-2 border-b border-gray-100 flex-shrink-0 ${tabs.length > 5 ? 'grid grid-cols-3' : 'flex overflow-x-auto'}`}>
            {tabs.map((t) => (
              <button key={t.key} onClick={() => { setTab(t.key); setFilter(''); }}
                className={`flex-1 text-sm px-2 py-2 rounded-lg font-medium whitespace-nowrap ${tab === t.key ? 'bg-brand text-on-brand' : 'text-gray-600 hover:bg-gray-100'}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {/* ---------------- Layout ---------------- */}
            {tab === 'layout' && (
              <>
                <p className="text-xs text-gray-500">Drag <span className="font-mono">⠿</span> to reorder. Tap the eye to hide a section from the customer. Tap a name to jump to it in the preview, or tap the document to find it here.</p>
                {com && (
                  <p className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5">
                    A commercial report always runs at least {com.minChapters} chapters. 📌 chapters are always shown. Tap 📝 to pin a note of your own to a chapter.
                  </p>
                )}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDrag}>
                  <SortableContext items={movable.map((s) => s.key)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-1">
                      {sections.map((s) => (
                        <SortableRow key={s.key} id={s.key} disabled={s.fixed || s.last} className={flashKey === s.key ? 'ring-2 ring-brand-accent' : ''}>
                          {(handle) => (
                            <>
                            <div className={`flex items-center gap-2 px-2 py-2 rounded-lg border ${s.hidden ? 'bg-gray-50 border-dashed border-gray-200 text-gray-400' : 'bg-white border-gray-100'} ${!s.present ? 'opacity-60' : ''}`}>
                              {s.fixed ? <span className="w-5 text-center text-gray-300" title="Always shown">🔒</span>
                                : s.last ? <span className="w-5 text-center text-gray-300" title="Always at the end of the report" aria-label="Always at the end">⤓</span> : handle}
                              <button onClick={() => scrollPreviewTo(s.key)} disabled={!s.present || s.hidden} className="flex-1 min-w-0 text-left text-sm truncate disabled:cursor-default">
                                <span className={s.hidden ? 'line-through' : ''}>{s.label}</span>
                                {!s.present && <span className="ml-1.5 text-[10px] text-gray-400">nothing to show on this report</span>}
                              </button>
                              {com && s.present && !s.hidden && s.key !== 'layers' && (
                                <button onClick={() => setNoteOpen((k) => (k === s.key ? null : s.key))} aria-label={`Note on ${s.label}`} title="Pin a note of your own to this chapter"
                                  className={`text-base px-1 rounded hover:bg-gray-100 ${noteFor(s.key) ? '' : 'opacity-40'}`}>📝</button>
                              )}
                              {s.required && <span className="text-base px-1" title="Always shown on a commercial report" aria-label="Always shown">📌</span>}
                              {!s.fixed && !s.required && (
                                <button onClick={() => toggleHidden(s.key)} aria-label={s.hidden ? `Show ${s.label}` : `Hide ${s.label}`} title={s.hidden ? 'Show this section' : 'Hide this section'}
                                  className="text-base px-1 rounded hover:bg-gray-100">{s.hidden ? '🙈' : '👁'}</button>
                              )}
                            </div>
                            {noteOpen === s.key && (
                              <textarea rows={3} value={noteFor(s.key)} onChange={(e) => setNote(s.key, e.target.value)} aria-label={`Note on ${s.label}`}
                                placeholder="A note from you at the end of this chapter. Leave it empty to remove it."
                                className={`mt-1 ${input}`} />
                            )}
                            </>
                          )}
                        </SortableRow>
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
                {(draft.layout !== undefined || src.layout) && (
                  <button onClick={() => { takeServerOrder.current = true; setDraft((d) => ({ ...d, layout: null })); }}
                    className="text-xs text-blue-600 hover:underline">Reset to the standard layout</button>
                )}
              </>
            )}

            {/* ---------------- Text ---------------- */}
            {tab === 'text' && (
              <>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">Title</span>
                  <input value={draft.title ?? src.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className={`mt-1 ${input}`} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">Executive summary</span>
                  <textarea rows={7} value={draft.executiveSummary ?? src.executiveSummary}
                    onChange={(e) => setDraft((d) => ({ ...d, executiveSummary: e.target.value }))} className={`mt-1 ${input}`} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">Inspector notes</span>
                  <textarea rows={5} value={draft.inspectorNotes ?? src.inspectorNotes}
                    onChange={(e) => setDraft((d) => ({ ...d, inspectorNotes: e.target.value }))} className={`mt-1 ${input}`} />
                </label>
                {(src.narrativeFindings !== undefined || src.narrativeSolution !== undefined) && (
                  <>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600">Your Roof, Specifically — the write-up</span>
                      <textarea rows={14} value={draft.narrativeFindings ?? src.narrativeFindings ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, narrativeFindings: e.target.value }))} className={`mt-1 ${input} font-mono`} />
                      <span className="block mt-1 text-[11px] text-gray-400">Lines starting with "## " become headings, "- " become bullets.</span>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600">Our recommended solution</span>
                      <textarea rows={9} value={draft.narrativeSolution ?? src.narrativeSolution ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, narrativeSolution: e.target.value }))} className={`mt-1 ${input} font-mono`} />
                    </label>
                  </>
                )}
              </>
            )}

            {/* ---------------- Photos ---------------- */}
            {tab === 'photos' && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onPhotoDrag}>
                <p className="text-xs text-gray-500">Drag <span className="font-mono">⠿</span> to put photos in the order the customer sees them. Add more from the job's photos below — drag one in, or tap ＋.</p>
                {src.photos.length > 20 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by caption…" className={input} />}
                <PhotoDropZone>
                  <SortableContext items={photoList.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-1.5">
                      {photoList.filter((p) => !q || photoView(p).caption.toLowerCase().includes(q)).map((p, i) => {
                        const v = photoView(p);
                        return (
                          <SortableRow key={p.id} id={p.id}>
                            {(handle) => (
                              <div className={`flex gap-2 p-2 rounded-lg border ${v.removed ? 'opacity-40 border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
                                {handle}
                                <div className="relative flex-shrink-0">
                                  <img src={v.url} alt="" loading="lazy" className="w-14 h-14 object-cover rounded bg-gray-100" />
                                  <span className="absolute -top-1 -left-1 text-[9px] px-1 rounded bg-gray-900 text-white">{i + 1}</span>
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <input value={v.caption} placeholder="Caption" disabled={v.removed} onChange={(e) => patchPhoto(p, { caption: e.target.value })} className={`w-full ${small}`} />
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {p.added && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">new</span>}
                                    {p.findings > 0 && !v.swapped && <span className="text-[10px] text-gray-400">{p.findings} finding{p.findings === 1 ? '' : 's'}</span>}
                                    {!p.added && (
                                      <SwapMenu current={v.url} options={src.available} disabled={v.removed} onPick={(url) => patchPhoto(p, { url })} />
                                    )}
                                    <button onClick={() => patchPhoto(p, { remove: !v.removed })} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{v.removed ? 'Keep' : p.added ? '✕ Remove' : '✕ Remove'}</button>
                                    {v.swapped && p.findings > 0 && <span className="text-[11px] text-amber-700">findings cleared</span>}
                                  </div>
                                </div>
                              </div>
                            )}
                          </SortableRow>
                        );
                      })}
                      {!photoList.length && <li className="text-sm text-gray-400 py-4 text-center">No photos on this report yet — add some below.</li>}
                    </ul>
                  </SortableContext>
                </PhotoDropZone>
                <div className="pt-2 border-t border-gray-100">
                  <button onClick={() => setPoolOpen((v) => !v)} className="text-xs font-semibold text-gray-600">
                    {poolOpen ? '▾' : '▸'} Job photos not on this report ({pool.length})
                  </button>
                  {poolOpen && (
                    pool.length ? (
                      <div className="grid grid-cols-4 gap-1.5 mt-2 max-h-64 overflow-y-auto">
                        {pool.map((a) => <PoolPhoto key={a.url} url={a.url} caption={a.caption} onAdd={() => addFromPool(a.url, a.caption)} />)}
                      </div>
                    ) : <p className="text-xs text-gray-400 mt-1">Every job photo is already on this report.</p>
                  )}
                </div>
              </DndContext>
            )}

            {/* ---------------- Findings ---------------- */}
            {tab === 'findings' && (
              <>
                <p className="text-xs text-gray-500">Drag <span className="font-mono">⠿</span> to reorder findings under a photo — the first one leads its card. Remove one the customer shouldn't see.</p>
                {src.findings.length > 20 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter findings…" className={input} />}
                {findingGroups.map((g) => (
                  <div key={g.photo.id} className="rounded-lg border border-gray-100 overflow-hidden">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50">
                      <img src={photoView(g.photo).url} alt="" loading="lazy" className="w-8 h-8 object-cover rounded bg-gray-100" />
                      <p className="text-xs text-gray-600 truncate flex-1">{photoView(g.photo).caption || 'Photo'}</p>
                      <span className="text-[10px] text-gray-400">{g.findings.length}</span>
                    </div>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onFindingDrag(g.photo.id)}>
                      <SortableContext items={g.findings.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                        <ul className="p-1.5 space-y-1">
                          {g.findings.map((f) => {
                            const v = findingView(f);
                            return (
                              <SortableRow key={f.id} id={f.id}>
                                {(handle) => (
                                  <div className={`flex gap-1.5 p-1.5 rounded-lg border ${v.removed ? 'opacity-40 border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
                                    {handle}
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <div className="flex items-center gap-1.5">
                                        <input value={v.label} disabled={v.removed} onChange={(e) => patchFinding(f.id, { label: e.target.value })} className={`flex-1 min-w-0 font-medium ${small}`} />
                                        {f.severity && <span className="text-[10px] text-gray-400 capitalize whitespace-nowrap">{f.severity}</span>}
                                        <button onClick={() => patchFinding(f.id, { remove: !v.removed })} aria-label={v.removed ? 'Restore finding' : 'Remove finding'} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{v.removed ? 'Keep' : '✕'}</button>
                                      </div>
                                      <textarea rows={2} value={v.description} disabled={v.removed} onChange={(e) => patchFinding(f.id, { description: e.target.value })} className={`w-full ${small}`} />
                                    </div>
                                  </div>
                                )}
                              </SortableRow>
                            );
                          })}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  </div>
                ))}
                {!findingGroups.length && <p className="text-sm text-gray-400">No findings{q ? ' match' : ' on this report'}.</p>}
              </>
            )}

            {/* ---------------- Pricing ---------------- */}
            {tab === 'pricing' && (
              <>
                {tiers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-600">Good / Better / Best</p>
                    {tiers.map((t) => {
                      const v = tierView(t);
                      return (
                        <div key={t.tier} className={`p-2 rounded-lg border ${selectedTier === t.tier ? 'border-ink bg-blue-50/40' : 'border-gray-100'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                              <input type="radio" name="tier" checked={selectedTier === t.tier} onChange={() => setDraft((d) => ({ ...d, tiers: { ...d.tiers, selectedTier: t.tier } }))} />
                              {TIER_LABEL[t.tier]} <span className="text-xs font-normal text-gray-500">{t.product || ''}</span>
                            </label>
                            <span className="text-sm font-semibold text-gray-900">${money(v.total)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-600">
                            <span>$</span><input type="number" inputMode="decimal" value={v.rate} min={0} step="1" aria-label={`${TIER_LABEL[t.tier]} rate per square`} onChange={(e) => patchTier(t.tier, { ratePerSquare: Number(e.target.value) || 0 })} className={`w-20 ${small}`} />
                            <span>/ sq ×</span><input type="number" inputMode="decimal" value={v.squares} min={0} step="0.1" aria-label={`${TIER_LABEL[t.tier]} squares`} onChange={(e) => patchTier(t.tier, { squares: Number(e.target.value) || 0 })} className={`w-16 ${small}`} />
                            <span>sq</span>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-gray-400">The dot marks the tier the document opens on.</p>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-semibold text-gray-600">Line items</span>
                  <span className="text-sm font-semibold text-gray-900">${money(total)}</span>
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLineDrag}>
                  <SortableContext items={lines.map((_, i) => `line-${i}`)} strategy={verticalListSortingStrategy}>
                    <ul className="space-y-1">
                      {lines.map((l, i) => (
                        <SortableRow key={`line-${i}`} id={`line-${i}`}>
                          {(handle) => (
                            <div className="flex gap-1 items-center bg-white">
                              {handle}
                              <input value={l.name} placeholder="Item" onChange={(e) => setDraft((d) => ({ ...d, lines: lines.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} className={`flex-1 min-w-0 ${small}`} />
                              <input value={l.quantity} inputMode="decimal" aria-label="Quantity" onChange={(e) => setDraft((d) => ({ ...d, lines: lines.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) || 0 } : x) }))} className={`w-12 ${small}`} />
                              <input value={l.unit} aria-label="Unit" onChange={(e) => setDraft((d) => ({ ...d, lines: lines.map((x, j) => j === i ? { ...x, unit: e.target.value } : x) }))} className={`w-12 ${small}`} />
                              <input value={l.unitPrice} inputMode="decimal" aria-label="Price each" onChange={(e) => setDraft((d) => ({ ...d, lines: lines.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) || 0 } : x) }))} className={`w-20 ${small}`} />
                              <button onClick={() => setDraft((d) => ({ ...d, lines: lines.filter((_, j) => j !== i) }))} aria-label="Remove line" className="text-xs text-gray-400 hover:text-red-600 px-0.5">✕</button>
                            </div>
                          )}
                        </SortableRow>
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
                {lines.some((l) => l.name.trim() && !(Number(l.quantity) > 0)) && (
                  <p className="text-[11px] text-red-600">A line with a quantity of 0 cannot be saved — set how many, or remove the line.</p>
                )}
                <button onClick={() => setDraft((d) => ({ ...d, lines: [...lines, { name: '', quantity: 1, unit: 'ea', unitPrice: 0 }] }))} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600">＋ Add line</button>
                {!lines.length && !tiers.length && <p className="text-xs text-gray-400">No pricing on this report type yet — add a line to start an estimate.</p>}
              </>
            )}
            {/* ---------------- Commercial ---------------- */}
            {tab === 'commercial' && com && (
              <>
                <p className="text-xs text-gray-500">
                  For commercial proposals and presentations. The inspection, the product, company information and the Before We Start page are on every one.
                </p>
                {com.photoScan && (
                  <p className="text-[11px] text-gray-600 bg-gray-50 rounded-lg px-2 py-1.5">
                    AI read {com.photoScan.scanned} of {com.photoScan.requested} photos before this report was written
                    {com.photoScan.withIssues ? `, and noted something in ${com.photoScan.withIssues}` : ''}. Edit or remove anything it wrote on the Findings tab.
                  </p>
                )}

                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">The Short Version: the summary the report leads with</span>
                  <textarea rows={5} value={draft.commercialSummary ?? com.summary}
                    onChange={(e) => setDraft((d) => ({ ...d, commercialSummary: e.target.value }))} className={`mt-1 ${input}`} />
                  <span className="block mt-1 text-[11px] text-gray-400">Starts as the inspector's own summary. Clear the box to go back to theirs.</span>
                </label>

                {/* Layer diagram */}
                <div className="rounded-lg border border-gray-100 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-600">Layer diagram</p>
                    <button onClick={() => scrollPreviewTo('layers')} className="text-[11px] text-blue-600 hover:underline">Show in preview</button>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {com.assembly.system
                      ? <>Shown for <span className="font-medium">{com.openingProduct}</span> ({SYSTEM_LABEL[com.assembly.system]}), the option the report opens on. Wording applies to every option; what happens to a layer applies to {SYSTEM_LABEL[com.assembly.system]} options.</>
                      : 'Reword any layer. What happens to each layer is confirmed with a core cut, so it is not set here.'}
                  </p>
                  {(['today', 'new'] as const).map((side) => {
                    const list = com.assembly.layers.filter((l) => l.side === side);
                    if (!list.length) return null;
                    return (
                      <div key={side} className="space-y-1.5">
                        <p className="text-[11px] uppercase tracking-wide text-gray-400">{side === 'today' ? 'On the roof today, top to bottom' : 'New layers, top to bottom'}</p>
                        {list.map((l) => {
                          const fate = com.assembly.system ? asm.actions?.[com.assembly.system]?.[l.id] : undefined;
                          return (
                            <div key={l.id} className="p-1.5 rounded-lg border border-gray-100 space-y-1">
                              <input value={asm.layers?.[l.id]?.label ?? l.label} aria-label="Layer name" placeholder={l.label}
                                onChange={(e) => patchLayer(l.id, { label: e.target.value })} className={`w-full font-medium ${small}`} />
                              <div className="flex gap-1.5">
                                <input value={asm.layers?.[l.id]?.detail ?? l.detail} aria-label="Layer detail" placeholder="Short detail (optional)"
                                  onChange={(e) => patchLayer(l.id, { detail: e.target.value })} className={`flex-1 min-w-0 ${small}`} />
                                {side === 'today' && com.assembly.system && (
                                  <select value={fate ?? 'auto'} aria-label="What happens to this layer" onChange={(e) => setFate(l.id, e.target.value as Fate | 'auto')} className={small}>
                                    <option value="auto">Standard: {FATE_LABEL[l.action]}</option>
                                    <option value="removed">Comes off</option>
                                    <option value="stays">Stays</option>
                                    <option value="repaired">Repaired</option>
                                  </select>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  <label className="block">
                    <span className="text-[11px] text-gray-500">Note under the diagram</span>
                    <textarea rows={2} value={asm.note ?? ''} placeholder="e.g. what the core cut showed"
                      onChange={(e) => setAsm((a) => ({ ...a, note: e.target.value }))} className={`mt-0.5 w-full ${small}`} />
                  </label>
                  <PhotoPick label="Photo beside the diagram (usually the core cut)" value={asm.photoUrl} options={photoChoices}
                    onPick={(url) => setAsm((a) => ({ ...a, photoUrl: url || undefined, ...(url ? {} : { photoCaption: undefined }) }))} />
                  {asm.photoUrl && (
                    <input value={asm.photoCaption ?? ''} placeholder="Photo caption" aria-label="Diagram photo caption"
                      onChange={(e) => setAsm((a) => ({ ...a, photoCaption: e.target.value }))} className={`w-full ${small}`} />
                  )}
                  {(draft.assembly !== undefined ? !!draft.assembly : !!com.assembly.edits) && (
                    <button onClick={() => setDraft((d) => ({ ...d, assembly: null }))} className="text-xs text-blue-600 hover:underline">Reset the diagram to the inspection</button>
                  )}
                </div>

                {/* Before We Start */}
                <div className="rounded-lg border border-gray-100 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-600">Before We Start</p>
                    <button onClick={() => scrollPreviewTo('before-start')} className="text-[11px] text-blue-600 hover:underline">Show in preview</button>
                  </div>
                  <p className="text-[11px] text-gray-500">🔒 Always printed, word for word: the COI and W-9 are provided before any work starts, and every required permit is pulled before the start of work. The lines below are yours to change.</p>
                  {terms.map((t, i) => (
                    <div key={i} className="flex gap-1 items-start">
                      <textarea rows={2} value={t} aria-label={`Line ${i + 1}`} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? e.target.value : x)))} className={`flex-1 min-w-0 ${small}`} />
                      <button onClick={() => setTerms(terms.filter((_, j) => j !== i))} aria-label="Remove line" className="text-xs text-gray-400 hover:text-red-600 px-1 pt-1">✕</button>
                    </div>
                  ))}
                  <div className="flex items-center gap-3">
                    <button onClick={() => setTerms([...terms, ''])} disabled={terms.length >= 12} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 disabled:opacity-40">＋ Add a line</button>
                    {(draft.beforeStartTerms !== undefined ? draft.beforeStartTerms !== null : com.termsEdited) && (
                      <button onClick={() => setDraft((d) => ({ ...d, beforeStartTerms: null }))} className="text-xs text-blue-600 hover:underline">Restore the standard list</button>
                    )}
                  </div>
                </div>

                {/* Your own chapters */}
                <div className="rounded-lg border border-gray-100 p-2.5 space-y-2">
                  <p className="text-xs font-semibold text-gray-600">Your own chapters</p>
                  <p className="text-[11px] text-gray-500">Add a chapter of your own: a phasing plan, a tenant schedule, an alternate. It goes before the last chapter; drag it anywhere on the Layout tab.</p>
                  {customList.map((c, i) => (
                    <div key={c.id} className="p-1.5 rounded-lg border border-gray-100 space-y-1">
                      <div className="flex gap-1 items-center">
                        <input value={c.title} placeholder="Chapter title" aria-label="Chapter title"
                          onChange={(e) => setCustom(customList.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={`flex-1 min-w-0 font-medium ${small}`} />
                        <button onClick={() => setCustom(customList.filter((_, j) => j !== i))} aria-label="Remove chapter" className="text-xs text-gray-400 hover:text-red-600 px-1">✕</button>
                      </div>
                      <textarea rows={5} value={c.body} placeholder="What you want the owner to read"
                        onChange={(e) => setCustom(customList.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} className={`w-full ${small}`} />
                      <PhotoPick label="Photo (optional)" value={c.photoUrl} options={photoChoices}
                        onPick={(url) => setCustom(customList.map((x, j) => (j === i ? { ...x, photoUrl: url || undefined } : x)))} />
                    </div>
                  ))}
                  <button onClick={() => setCustom([...customList, { id: newSectionId(), title: '', body: '' }])} disabled={customList.length >= 8}
                    className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 disabled:opacity-40">＋ Add a chapter</button>
                  <p className="text-[11px] text-gray-400">A chapter shows once it has a title and some text. Lines starting with "## " become headings, "- " become bullets.</p>
                </div>
              </>
            )}
          </div>

          {/* Chat: same draft, spoken instead of typed */}
          <div className="border-t border-gray-200 p-2.5 space-y-2 flex-shrink-0">
            {chatLog.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1.5">
                {chatLog.slice(-6).map((m, i) => (
                  <p key={i} className={`text-[11px] ${m.me ? 'text-gray-500' : 'text-gray-800 bg-gray-50 rounded-lg px-2 py-1'}`}>{m.me ? `You: ${m.text}` : m.text}</p>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input value={msg} onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
                placeholder='"shorten the summary", "add ridge vent 40 lf at 12.50"'
                className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
              <button onClick={ask} disabled={thinking || !msg.trim()} className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white font-medium disabled:opacity-40">{thinking ? '…' : 'Tell it'}</button>
            </div>
            <p className="text-[10px] text-gray-400">Changes show in the preview for you to check — nothing saves until you hit Save.</p>
          </div>
        </aside>

        {/* Right: the document itself */}
        <main className="flex-1 min-h-[45vh] lg:min-h-0 bg-gray-100 relative">
          {error && <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-1.5 rounded-lg shadow-sm">{error}</div>}
          {invisible.length > 0 && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-blue-50 border border-blue-200 text-blue-800 text-xs px-3 py-1.5 rounded-lg shadow-sm max-w-md text-center">
              A {src.reportType} doesn't display {invisible.join(' or ')} — this edit saves, but the customer won't see it here.
            </div>
          )}
          {cleared.length > 0 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-1.5 rounded-lg shadow-sm">
              {cleared.length} swapped photo{cleared.length === 1 ? "'s" : "s'"} findings will be cleared on save
            </div>
          )}
          {/* Sandboxed to scripts only — an opaque origin with no access to the
              app's session. Scripts are allowed so the scroll documents behave
              as they will for the customer and the click-to-find bridge works. */}
          {frameUrl
            ? <iframe ref={frameRef} title="Report preview" src={frameUrl} sandbox="allow-scripts" className="w-full h-full border-0 bg-white" />
            : <div className="w-full h-full flex items-center justify-center text-sm text-gray-400">{error ? 'The preview could not be rendered.' : 'Rendering preview…'}</div>}
        </main>
      </div>
    </div>
  );
}

/** A row in a sortable list, with a handle the row's content places where it wants. */
function SortableRow({ id, disabled, className, children }: { id: string; disabled?: boolean; className?: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const handle = (
    <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="Drag to reorder" title="Drag to reorder"
      className="w-5 flex-shrink-0 self-stretch flex items-center justify-center text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none select-none text-base">⠿</button>
  );
  return <li ref={setNodeRef} style={style} className={`${isDragging ? 'shadow-lg z-10 relative' : ''} ${className || ''}`}>{children(handle)}</li>;
}

/** The report's photo list is a drop target for photos dragged in from the pool. */
function PhotoDropZone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'report-photos' });
  return <div ref={setNodeRef} className={`rounded-lg transition-colors ${isOver ? 'bg-emerald-50 ring-2 ring-emerald-300' : ''}`}>{children}</div>;
}

/** A job photo not yet on the report: drag it into the list, or tap ＋. */
function PoolPhoto({ url, caption, onAdd }: { url: string; caption: string; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `pool:${url}` });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-100 group touch-none">
      <img src={url} alt={caption} loading="lazy" className="w-full h-full object-cover cursor-grab active:cursor-grabbing" {...attributes} {...listeners} />
      <button onClick={onAdd} aria-label="Add photo to report" title={caption || 'Add to report'}
        className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-white/90 text-gray-800 text-sm font-bold shadow flex items-center justify-center">＋</button>
    </div>
  );
}

/** Choose one of the job's photos for a spot on the document, or clear it. */
function PhotoPick({ label, value, options, onPick }: { label: string; value?: string; options: Array<{ url: string; caption: string }>; onPick: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {value && <img src={value} alt="" className="w-10 h-10 object-cover rounded bg-gray-100" />}
        <span className="flex-1 min-w-0 text-[11px] text-gray-500">{label}</span>
        <button onClick={() => setOpen((v) => !v)} disabled={!options.length} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 disabled:opacity-40">{value ? 'Change' : 'Choose'}</button>
        {value && <button onClick={() => { onPick(''); setOpen(false); }} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Remove</button>}
      </div>
      {open && (
        <div className="grid grid-cols-6 gap-1 max-h-32 overflow-y-auto">
          {options.map((a) => (
            <button key={a.url} onClick={() => { onPick(a.url); setOpen(false); }} title={a.caption}
              className={`aspect-square rounded overflow-hidden border-2 ${a.url === value ? 'border-brand' : 'border-transparent'}`}>
              <img src={a.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Swap the image under an existing photo (keeps the caption; clears any findings). */
function SwapMenu({ current, options, disabled, onPick }: { current: string; options: Array<{ url: string; caption: string }>; disabled: boolean; onPick: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen((v) => !v)} disabled={disabled} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">⇄ Swap</button>
      {open && (
        <div className="w-full grid grid-cols-6 gap-1 max-h-32 overflow-y-auto pt-1">
          {options.map((a) => (
            <button key={a.url} onClick={() => { onPick(a.url); setOpen(false); }} title={a.caption}
              className={`aspect-square rounded overflow-hidden border-2 ${a.url === current ? 'border-brand' : 'border-transparent'}`}>
              <img src={a.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
