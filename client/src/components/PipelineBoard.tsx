import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

/**
 * The column layout every pipeline board shares (Sales, Claims, Production):
 * one column per stage in order, drag a card to a column to move it, column
 * headers with a count, a value total and a "waiting on something" count.
 *
 * Boards are wider than any screen, so the board owns two ways of getting
 * around: a slider bar pinned along the bottom (named stage buttons over a
 * drag-anywhere track) and a minimize button on every column, so the stages
 * you aren't working today fold down to a spine and the rest fit at once.
 * What a card says and does is the page's business (renderCard); this only
 * owns columns, drag/drop and getting around them.
 */
export interface BoardStage { key: string; label: string; hint: string }

export interface BoardItem {
  id: string;
  stage: string;
  value?: number | null;
  /** Why it can't take its next step; drives the header's "waiting" count and the amber card edge. */
  blocker?: string | null;
}

export const money = (n: number | null | undefined) =>
  n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const daysSince = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d < 0 ? 0 : d;
};

export default function PipelineBoard<T extends BoardItem>({
  stages, items, onMove, renderCard, busyId, emptyHint = 'Drop a card here', width = 'w-72', canDrag,
}: {
  stages: BoardStage[];
  items: T[];
  onMove: (item: T, stage: string) => void;
  renderCard: (item: T, colIdx: number) => ReactNode;
  busyId: string | null;
  emptyHint?: string;
  width?: string;
  /** Cards that can't be dragged (a job with no id to write back to). Default: all can. */
  canDrag?: (item: T) => boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  // What's OPEN, not what's folded — so the board starts as a row of spines
  // you read across and opens the stage you're working, with no frame of
  // full-width columns before a default could be applied.
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [rail, setRail] = useState<{ left: number; view: number; total: number; cols: { key: string; start: number; end: number }[] }>(
    { left: 0, view: 0, total: 0, cols: [] },
  );

  const minSig = stages.map((s) => (opened[s.key] ? '1' : '0')).join('');

  const toggle = (key: string) => {
    setOpened((o) => {
      const next = { ...o, [key]: !o[key] };
      if (!next[key]) delete next[key];
      return next;
    });
  };
  /** Fold every stage away, or open every one. */
  const setAll = (minimize: boolean) =>
    setOpened(minimize ? {} : Object.fromEntries(stages.map((s) => [s.key, true])));

  /** Where the board is scrolled to, and where each column sits inside it — the slider reads both. */
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const cols = stages.map((s) => {
      const node = colRefs.current[s.key];
      return { key: s.key, start: node ? node.offsetLeft : 0, end: node ? node.offsetLeft + node.offsetWidth : 0 };
    });
    setRail((prev) => {
      const next = { left: el.scrollLeft, view: el.clientWidth, total: el.scrollWidth, cols };
      const same = prev.left === next.left && prev.view === next.view && prev.total === next.total
        && prev.cols.length === cols.length && prev.cols.every((c, i) => c.key === cols[i].key && c.start === cols[i].start && c.end === cols[i].end);
      return same ? prev : next;
    });
  }, [stages]);

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure, minSig, width, items.length]);

  const maxScroll = Math.max(0, rail.total - rail.view);
  const canScroll = maxScroll > 4;
  const thumbPct = rail.total > 0 ? Math.min(100, Math.max(10, (rail.view / rail.total) * 100)) : 100;
  const thumbLeftPct = maxScroll > 0 ? (rail.left / maxScroll) * (100 - thumbPct) : 0;
  const activeKey = [...rail.cols].reverse().find((c) => c.start <= rail.left + 8)?.key ?? stages[0]?.key;

  const scrollToStage = (key: string) => {
    if (!opened[key]) toggle(key);
    // Let React commit the re-opened column to full width before we measure
    // where to land. A timeout, not rAF: rAF is paused in a background tab.
    window.setTimeout(() => {
      colRefs.current[key]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    }, 0);
  };

  /** ‹ / › — one column at a time, so a step always lands on a stage. */
  const step = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = dir === 1
      ? rail.cols.find((c) => c.start > el.scrollLeft + 8)
      : [...rail.cols].reverse().find((c) => c.start < el.scrollLeft - 8);
    el.scrollTo({ left: target ? target.start : dir === 1 ? el.scrollWidth : 0, behavior: 'smooth' });
  };

  const [sliding, setSliding] = useState(false);
  const slideTo = (clientX: number) => {
    const el = scrollRef.current, track = trackRef.current;
    if (!el || !track) return;
    const r = track.getBoundingClientRect();
    const thumbW = (thumbPct / 100) * r.width;
    const travel = r.width - thumbW;
    const frac = travel > 0 ? (clientX - r.left - thumbW / 2) / travel : 0;
    el.scrollLeft = Math.min(1, Math.max(0, frac)) * (el.scrollWidth - el.clientWidth);
  };

  /** Dragging a card to a column that's off-screen: creep sideways near either edge. */
  const edgeTimer = useRef<number | null>(null);
  const edgeDir = useRef(0);
  const stopEdge = useCallback(() => {
    if (edgeTimer.current != null) { window.clearInterval(edgeTimer.current); edgeTimer.current = null; }
    edgeDir.current = 0;
  }, []);
  const edgeScroll = (clientX: number) => {
    const el = scrollRef.current;
    if (!el || !clientX) return;
    const r = el.getBoundingClientRect();
    const zone = 80;
    edgeDir.current = clientX < r.left + zone ? -1 : clientX > r.right - zone ? 1 : 0;
    if (edgeDir.current && edgeTimer.current == null) {
      edgeTimer.current = window.setInterval(() => {
        const s = scrollRef.current;
        if (!s || !edgeDir.current) return stopEdge();
        s.scrollLeft += edgeDir.current * 20;
      }, 16);
    } else if (!edgeDir.current) stopEdge();
  };
  useEffect(() => stopEdge, [stopEdge]);

  const endDrag = () => { setDragId(null); setDragOverCol(null); stopEdge(); };

  const handleDrop = (stageKey: string) => {
    const item = items.find((i) => i.id === dragId);
    endDrag();
    if (item && item.stage !== stageKey) onMove(item, stageKey);
  };

  const openCount = stages.filter((s) => opened[s.key]).length;

  return (
    <div className="relative">
      {stages.length > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-1 mb-1.5 text-[11px]">
          <span className={`mr-1 ${openCount === 0 ? 'text-gray-500' : 'hidden sm:inline text-gray-400'}`}>
            {openCount === 0 ? 'Click a stage to open it' : `${openCount} of ${stages.length} stages open`}
          </span>
          <button type="button" onClick={() => setAll(true)} disabled={openCount === 0}
            className="px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40">⊟ Minimize all</button>
          <button type="button" onClick={() => setAll(false)} disabled={openCount === stages.length}
            className="px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40">⊞ Open all</button>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={measure}
        onDragOver={(e) => edgeScroll(e.clientX)}
        onDrop={stopEdge}
        className="flex gap-3 overflow-x-auto pb-4"
      >
        {stages.map((col, colIdx) => {
          const colItems = items.filter((i) => i.stage === col.key);
          const value = colItems.reduce((s, i) => s + (i.value || 0), 0);
          const blocked = colItems.filter((i) => i.blocker).length;
          const isMin = !opened[col.key];
          const dropProps = {
            onDragOver: (e: DragEvent) => { if (dragId) { e.preventDefault(); setDragOverCol(col.key); } },
            onDragLeave: () => setDragOverCol((c) => (c === col.key ? null : c)),
            onDrop: () => handleDrop(col.key),
          };

          if (isMin) {
            return (
              <div
                key={col.key}
                ref={(n) => { colRefs.current[col.key] = n; }}
                {...dropProps}
                className={`flex-shrink-0 w-11 self-start rounded-xl border transition-colors ${dragOverCol === col.key ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-300' : 'bg-gray-50 border-gray-200'}`}
              >
                <button
                  type="button"
                  onClick={() => toggle(col.key)}
                  aria-expanded={false}
                  aria-label={`Open the ${col.label} stage`}
                  title={`Open ${col.label}`}
                  className="w-full h-52 flex flex-col items-center gap-2 py-2 text-gray-500 hover:text-blue-700 hover:bg-white rounded-xl transition-colors"
                >
                  <span aria-hidden className="text-sm leading-none">⊞</span>
                  <span className="flex items-center gap-1 leading-none">
                    <span className="text-[11px] text-gray-500 bg-white border border-gray-200 rounded-full px-1.5 py-0.5">{colItems.length}</span>
                    {blocked > 0 && <span className="text-[10px] text-amber-600" title={`${blocked} waiting on something`}>⚑</span>}
                  </span>
                  <span className="[writing-mode:vertical-rl] rotate-180 flex-1 min-h-0 text-xs font-semibold text-gray-600 overflow-hidden">
                    <span className="text-gray-300 mr-1">{colIdx + 1}</span>{col.label}
                  </span>
                </button>
              </div>
            );
          }

          return (
            <div
              key={col.key}
              ref={(n) => { colRefs.current[col.key] = n; }}
              {...dropProps}
              className={`flex-shrink-0 ${width} rounded-xl transition-colors ${dragOverCol === col.key ? 'bg-blue-50 ring-2 ring-blue-300' : ''}`}
            >
              <div className="flex items-start justify-between mb-2 px-1 pt-1">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-700"><span className="text-gray-300 mr-1">{colIdx + 1}</span>{col.label}</h3>
                  <p className="text-[11px] text-gray-400 leading-tight">{col.hint}</p>
                  {value > 0 && <p className="text-[11px] text-emerald-600 mt-0.5">{money(value)}</p>}
                  {blocked > 0 && <p className="text-[11px] text-amber-700">⚑ {blocked} waiting on something</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{colItems.length}</span>
                  <button type="button" onClick={() => toggle(col.key)} aria-expanded aria-label={`Minimize the ${col.label} stage`} title={`Minimize ${col.label}`}
                    className="text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded leading-none px-1 py-0.5">⊟</button>
                </div>
              </div>
              <div className="space-y-2 min-h-[3rem] px-0.5 pb-1">
                {colItems.length === 0 ? (
                  <div className="text-xs text-gray-300 px-2 py-6 text-center border border-dashed border-gray-200 rounded-lg">{emptyHint}</div>
                ) : (
                  colItems.map((item) => {
                    const draggable = canDrag ? canDrag(item) : true;
                    return (
                      <div
                        key={item.id}
                        draggable={draggable}
                        onDragStart={() => setDragId(item.id)}
                        onDrag={(e) => edgeScroll(e.clientX)}
                        onDragEnd={endDrag}
                        className={`bg-white rounded-lg border p-3 shadow-sm ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${item.blocker ? 'border-amber-200' : 'border-gray-200'} ${busyId === item.id ? 'opacity-60' : ''} ${dragId === item.id ? 'opacity-40' : ''}`}
                      >
                        {renderCard(item, colIdx)}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Right-edge fade: a wordless cue that more columns are scrollable off-screen. */}
      {canScroll && <div className="pointer-events-none absolute top-0 right-0 bottom-16 w-8 bg-gradient-to-l from-white to-transparent" />}

      {/* The slider. Sticks to the bottom of the screen while the board is in
          view, clearing the mobile tab bar, so it's in reach without scrolling
          down past every card. */}
      {stages.length > 1 && (
        <div className="sticky z-30 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] md:bottom-2 mt-1">
          <div className="rounded-xl border border-gray-200 bg-white/95 backdrop-blur shadow-lg px-2 py-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => step(-1)} disabled={!canScroll || rail.left <= 4} aria-label="Previous stage"
                className="flex-shrink-0 w-7 h-7 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30">‹</button>

              <div className="flex-1 min-w-0">
                <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {stages.map((s, i) => {
                    const c = rail.cols.find((x) => x.key === s.key);
                    const visible = !!c && c.end > rail.left + 4 && c.start < rail.left + rail.view - 4;
                    const count = items.filter((it) => it.stage === s.key).length;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => scrollToStage(s.key)}
                        aria-current={s.key === activeKey ? 'true' : undefined}
                        title={opened[s.key] ? `Jump to ${s.label}` : `${s.label} — folded, click to open`}
                        className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                          s.key === activeKey
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : visible
                              ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100'
                              : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        <span className={s.key === activeKey ? 'text-blue-200' : 'text-gray-300'}>{i + 1}</span>
                        <span className="whitespace-nowrap max-w-[9rem] truncate">{s.label}</span>
                        {count > 0 && (
                          <span className={`rounded-full px-1 leading-none ${s.key === activeKey ? 'bg-blue-500/60' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                        )}
                        {!opened[s.key] && <span aria-hidden title="Folded">⊟</span>}
                      </button>
                    );
                  })}
                </div>

                <div
                  ref={trackRef}
                  role="scrollbar"
                  aria-orientation="horizontal"
                  aria-label="Scroll the board sideways"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(maxScroll > 0 ? (rail.left / maxScroll) * 100 : 0)}
                  tabIndex={canScroll ? 0 : -1}
                  onPointerDown={(e) => { if (!canScroll) return; e.currentTarget.setPointerCapture(e.pointerId); setSliding(true); slideTo(e.clientX); }}
                  onPointerMove={(e) => { if (sliding) slideTo(e.clientX); }}
                  onPointerUp={(e) => { setSliding(false); try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ } }}
                  onPointerCancel={() => setSliding(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
                    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
                    else if (e.key === 'Home') { e.preventDefault(); scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' }); }
                    else if (e.key === 'End') { e.preventDefault(); scrollRef.current?.scrollTo({ left: maxScroll, behavior: 'smooth' }); }
                  }}
                  className={`relative mt-1.5 h-3 rounded-full touch-none select-none ${canScroll ? 'bg-gray-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400' : 'bg-gray-100'}`}
                >
                  <div
                    className={`absolute inset-y-0 rounded-full ${canScroll ? (sliding ? 'bg-blue-700' : 'bg-blue-600') : 'bg-gray-200'}`}
                    style={{ left: `${thumbLeftPct}%`, width: `${thumbPct}%` }}
                  />
                </div>
              </div>

              <button type="button" onClick={() => step(1)} disabled={!canScroll || rail.left >= maxScroll - 4} aria-label="Next stage"
                className="flex-shrink-0 w-7 h-7 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30">›</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ← / Advance → controls shared by the boards. */
export function MoveControls({ colIdx, stages, blocker, busy, onBack, onAdvance, advanceLabel, lastLabel = 'Done' }: {
  colIdx: number; stages: BoardStage[]; blocker: string | null | undefined; busy: boolean;
  onBack: () => void; onAdvance: () => void; advanceLabel?: string; lastLabel?: string;
}) {
  const last = colIdx >= stages.length - 1;
  return (
    <>
      <div className="mt-2 flex items-center gap-1">
        <button type="button" disabled={busy || colIdx === 0} onClick={onBack} title={colIdx > 0 ? `Back to ${stages[colIdx - 1].label}` : ''}
          className="text-[11px] px-2 py-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-40">←</button>
        {!last ? (
          <button type="button" disabled={busy || !!blocker} onClick={onAdvance} title={blocker || `Move to ${stages[colIdx + 1].label}`}
            className="flex-1 text-[11px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500 truncate">
            {advanceLabel || `${stages[colIdx + 1].label} →`}
          </button>
        ) : (
          <span className="flex-1 text-[11px] text-center text-emerald-700">{lastLabel}</span>
        )}
      </div>
      {blocker && <p className="mt-1 text-[10px] text-amber-700 leading-tight">⚑ {blocker}</p>}
    </>
  );
}

/** Tick-boxes a stage asks for. */
export function StageChecks({ defs, checks, busy, onToggle }: {
  defs: { key: string; label: string }[]; checks: Record<string, boolean>; busy: boolean; onToggle: (key: string, value: boolean) => void;
}) {
  if (!defs.length) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {defs.map((c) => (
        <label key={c.key} className="flex items-start gap-1.5 text-[11px] text-gray-700">
          <input type="checkbox" className="mt-0.5" checked={!!checks[c.key]} disabled={busy} onChange={(e) => onToggle(c.key, e.target.checked)} />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  );
}
