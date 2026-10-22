import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../lib/api';
import PipelineBoard, { MoveControls, StageChecks, money, daysSince, type BoardStage } from '../components/PipelineBoard';

/**
 * The production board: eleven columns, one per pipeline stage, from the
 * homeowner's signature to the referral ask. Stage keys, trade order and the
 * move rules come from the server (shared/production-pipeline.ts) so the
 * board can never disagree with what the API will accept. Columns, drag/drop
 * and the bottom slider are PipelineBoard's, shared with Sales and Claims.
 */

type TradeDef = { key: string; label: string };
type CheckDef = { key: string; label: string };

interface Pipeline {
  hasRow: boolean;
  stage: string;
  trades: { key: string; done: boolean }[];
  checks: Record<string, boolean>;
  depositReceivedAt: string | null;
  stageEnteredAt: string | null;
  currentTrade: string | null;
  allTradesDone: boolean;
}

interface ProductionJob {
  externalId: string | null;
  customer: string | null;
  jobName: string | null;
  jobNumber: string | null;
  jtStage: string | null;
  projectManager: string | null;
  repName: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  projectedValue: number | null;
  insuranceClaim: boolean;
  pipeline: Pipeline;
  gates: { preconSubmitted: boolean; walkthroughSubmitted: boolean };
  nextBlocker: string | null;
  walkthrough: { state: 'due' | 'in_progress' | 'issues' | 'clean'; issueCount: number; submittedAt: string | null } | null;
}

interface BoardResponse {
  stages: BoardStage[];
  trades: TradeDef[];
  checks: Record<string, CheckDef[]>;
  jobs: ProductionJob[];
}

type Item = ProductionJob & { id: string; stage: string; value: number | null; blocker: string | null };

/** The chip on a card. Opens the client page, where the walkthrough lives. */
const WALKTHROUGH_CHIP: Record<NonNullable<ProductionJob['walkthrough']>['state'], { label: (n: number) => string; cls: string; title: string }> = {
  due: { label: () => '🧲 Walkthrough due', cls: 'bg-amber-100 text-amber-800 hover:bg-amber-200', title: 'No final walkthrough yet — nail sweep, damage check, leftovers' },
  in_progress: { label: (n) => `🧲 Walkthrough in progress${n ? ` · ${n} issue${n === 1 ? '' : 's'}` : ''}`, cls: 'bg-amber-50 text-amber-700 hover:bg-amber-100', title: 'A draft walkthrough is open' },
  issues: { label: (n) => `⚠ Walked · ${n} issue${n === 1 ? '' : 's'}`, cls: 'bg-red-100 text-red-700 hover:bg-red-200', title: 'Walkthrough submitted with issues — each one is a follow-up' },
  clean: { label: () => '✓ Walked clean', cls: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200', title: 'Walkthrough submitted, nothing found' },
};

const dateRange = (start: string | null, end: string | null) => {
  const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return fmt(start);
  if (end) return fmt(end);
  return null;
};

export default function Production({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [trades, setTrades] = useState<TradeDef[]>([]);
  const [checks, setChecks] = useState<Record<string, CheckDef[]>>({});
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);

  const loadRequestId = useRef(0);

  // `silent` refreshes in place. After every stage move the board used to drop
  // to the skeleton and come back, throwing away the scroll position and any
  // open trades/note panel — so writes refresh silently, and a failed silent
  // refresh keeps the board on screen instead of swapping it for the error.
  const load = async ({ silent = false }: { silent?: boolean } = {}) => {
    // Toggling "Show closed" quickly fires overlapping requests with no
    // ordering guarantee — a slower stale response could land after the newer
    // one and show the wrong set of jobs. Only the latest request may apply.
    const id = ++loadRequestId.current;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await api.get<BoardResponse>(`/api/production${includeClosed ? '?all=true' : ''}`);
      if (id !== loadRequestId.current) return;
      setStages(res.stages || []);
      setTrades(res.trades || []);
      setChecks(res.checks || {});
      setJobs(res.jobs || []);
      setError(null);
    } catch (e: any) {
      if (id !== loadRequestId.current) return;
      if (silent) flash(`Couldn't refresh the board: ${e?.message || 'failed'}`);
      else setError(e?.message || 'Failed to load the production board');
    } finally {
      if (id === loadRequestId.current) setLoading(false);
    }
  };
  useEffect(() => { load(); }, [includeClosed]);

  const stageIndex = useMemo(() => new Map(stages.map((s, i) => [s.key, i])), [stages]);
  const stageLabel = (key: string) => stages.find((s) => s.key === key)?.label || key;
  const tradeLabel = (key: string) => trades.find((t) => t.key === key)?.label || key;

  // "Needs attention": blocked from advancing by something a person has to do.
  const [attentionOnly, setAttentionOnly] = useState(false);
  const needsAttention = (j: ProductionJob) => j.pipeline.stage !== 'closed_out' && (!!j.nextBlocker || (!!j.walkthrough && j.walkthrough.state !== 'clean'));
  const attentionCount = jobs.filter(needsAttention).length;

  const items: Item[] = jobs
    .filter((j) => !attentionOnly || needsAttention(j))
    .map((j, i) => ({ ...j, id: j.externalId || `unlinked:${i}`, stage: j.pipeline.stage, value: j.projectedValue, blocker: j.nextBlocker }));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [tradesFor, setTradesFor] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  const name = (j: ProductionJob) => j.customer || j.jobName || 'job';

  /** Every pipeline write returns the fresh pipeline; reload the board so gates and blockers refresh too. */
  const apply = async (job: ProductionJob, path: string, body: Record<string, unknown>, done: string) => {
    if (!job.externalId) return;
    setBusyId(job.externalId);
    try {
      const r = await api.post<{ ok: boolean; pipeline: Pipeline; jobtread?: { ok: boolean; error?: string } }>(`/api/production/${job.externalId}/pipeline/${path}`, body);
      setJobs((js) => js.map((j) => (j.externalId === job.externalId ? { ...j, pipeline: r.pipeline } : j)));
      flash(r.jobtread && !r.jobtread.ok ? `${done} — but JobTread didn't take the status: ${r.jobtread.error || 'write failed'}` : done);
      await load({ silent: true });
    } catch (e: any) {
      flash(`${name(job)}: ${e?.message || 'failed'}`);
    } finally {
      setBusyId(null);
    }
  };

  const moveTo = (job: ProductionJob, stage: string) => {
    if (stage === job.pipeline.stage) return;
    return apply(job, 'stage', { stage }, `${name(job)} → ${stageLabel(stage)}`);
  };

  const saveNote = async (job: ProductionJob) => {
    if (!job.externalId || !noteText.trim()) return;
    setBusyId(job.externalId);
    try {
      await api.post(`/api/jobs/${job.externalId}/note`, { message: noteText.trim() });
      flash(`Note added to ${name(job)}`);
      setNoteFor(null); setNoteText('');
    } catch (e: any) {
      flash(`Couldn't add note: ${e?.message || 'failed'}`);
    } finally {
      setBusyId(null);
    }
  };

  const advanceLabel = (j: ProductionJob): string => {
    const i = stageIndex.get(j.pipeline.stage);
    const next = i != null ? stages[i + 1] : undefined;
    if (!next) return '';
    if (j.pipeline.stage === 'waiting_dp') return 'Deposit received →';
    return `${next.label} →`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Production</h2>
          <p className="text-sm text-gray-500 mt-1">From signed to closed out{jobs.length ? ` · ${jobs.length} jobs` : ''}<span className="hidden sm:inline"> · drag a card to move it, or use the arrows on the card</span></p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
            Show closed
          </label>
          {attentionCount > 0 && (
            <button onClick={() => setAttentionOnly((v) => !v)} aria-pressed={attentionOnly}
              className={`px-3 py-1.5 text-sm rounded-lg border ${attentionOnly ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              title="Jobs that can't move on until someone does something">
              ⚑ Needs attention · {attentionCount}
            </button>
          )}
          <button onClick={() => load()} disabled={loading} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>
      )}

      {loading ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3, 4].map((c) => (
            <div key={c} className="flex-shrink-0 w-72 space-y-2">
              <div className="h-5 w-24 bg-gray-100 rounded animate-pulse" />
              {[0, 1].map((j) => <div key={j} className="h-24 bg-gray-100 rounded-lg border border-gray-200 animate-pulse" />)}
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-red-600 font-medium">Couldn't load the production board</p>
          <p className="text-xs text-gray-500 mt-1">{error}</p>
          <button onClick={() => load()} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
        </div>
      ) : jobs.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
          No jobs in production right now.
        </p>
      ) : (
        <PipelineBoard<Item>
          stages={stages}
          items={items}
          busyId={busyId}
          emptyHint="Drop a job here"
          canDrag={(j) => !!j.externalId}
          onMove={(item, stage) => moveTo(item, stage)}
          renderCard={(j, colIdx) => {
            const p = j.pipeline;
            const busy = busyId === j.externalId;
            const stuck = daysSince(p.stageEnteredAt);
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  {j.externalId && onOpenClient ? (
                    <button onClick={() => onOpenClient(j.externalId!)} className="font-medium text-sm text-blue-600 hover:underline truncate text-left">{j.customer || j.jobName || 'Unknown'}</button>
                  ) : (
                    <p className="font-medium text-sm text-gray-900 truncate">{j.customer || j.jobName || 'Unknown'}</p>
                  )}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {j.insuranceClaim && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 whitespace-nowrap">Claim</span>}
                    {money(j.projectedValue) && <span className="text-xs font-medium text-emerald-700 whitespace-nowrap">{money(j.projectedValue)}</span>}
                  </div>
                </div>
                {j.jobName && j.jobName !== j.customer && (
                  <p className="text-xs text-gray-400 truncate">{j.jobName}</p>
                )}
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500 gap-2">
                  <span className="truncate">{dateRange(j.scheduleStart, j.scheduleEnd) || (stuck != null && stuck > 0 ? `${stuck}d in stage` : '')}</span>
                  <span className="truncate">{j.projectManager || j.repName || ''}</span>
                </div>

                {/* Trades — the crew's order of work. Editable on any card; the install column drives it. */}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {p.trades.map((t) => (
                    <span key={t.key} title={t.done ? 'Done' : t.key === p.currentTrade && p.stage === 'install' ? 'In progress' : 'Up next'}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border ${t.done ? 'bg-emerald-50 border-emerald-200 text-emerald-700 line-through' : t.key === p.currentTrade && p.stage === 'install' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                      {t.done ? '✓ ' : ''}{tradeLabel(t.key)}
                    </span>
                  ))}
                  <button type="button" onClick={() => setTradesFor(tradesFor === j.externalId ? null : j.externalId)} className="text-[10px] text-gray-400 hover:text-blue-600 px-1" title="Which trades are on this job">edit</button>
                </div>
                {tradesFor === j.externalId && (
                  <div className="mt-1 p-2 rounded bg-gray-50 border border-gray-200 flex flex-wrap gap-2">
                    {trades.map((t) => {
                      const on = p.trades.some((x) => x.key === t.key);
                      return (
                        <label key={t.key} className="text-[11px] flex items-center gap-1">
                          <input type="checkbox" checked={on} disabled={busy}
                            onChange={() => {
                              const next = on ? p.trades.filter((x) => x.key !== t.key).map((x) => x.key) : [...p.trades.map((x) => x.key), t.key];
                              apply(j, 'trades', { trades: next }, `${name(j)}: trades updated`);
                            }} />
                          {t.label}
                        </label>
                      );
                    })}
                  </div>
                )}
                {p.stage === 'install' && p.currentTrade && (
                  <button type="button" disabled={busy} onClick={() => apply(j, 'trade-done', { trade: p.currentTrade }, `${name(j)}: ${tradeLabel(p.currentTrade!)} done`)}
                    className="mt-1.5 w-full text-[11px] px-2 py-1.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 disabled:opacity-50">
                    ✓ {tradeLabel(p.currentTrade)} finished
                  </button>
                )}

                {/* Stage facts + tick-boxes */}
                {p.stage === 'pre_production' && (
                  <button type="button" onClick={() => j.externalId && onOpenClient?.(j.externalId)}
                    className={`mt-1.5 text-[11px] px-1.5 py-0.5 rounded font-medium ${j.gates.preconSubmitted ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}>
                    {j.gates.preconSubmitted ? '✓ Pre-con checklist submitted' : '📋 Pre-con checklist needed'}
                  </button>
                )}
                {p.depositReceivedAt && p.stage !== 'approved' && p.stage !== 'waiting_dp' && (
                  <p className="mt-1 text-[10px] text-gray-400">Deposit received {new Date(p.depositReceivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                )}
                <StageChecks defs={checks[p.stage] || []} checks={p.checks} busy={busy}
                  onToggle={(key, value) => apply(j, 'check', { key, value }, `${name(j)}: ${checks[p.stage]?.find((c) => c.key === key)?.label || key}${value ? '' : ' (cleared)'}`)} />
                {j.walkthrough && (
                  <button
                    type="button"
                    onClick={() => j.externalId && onOpenClient?.(j.externalId)}
                    title={WALKTHROUGH_CHIP[j.walkthrough.state].title}
                    className={`mt-1.5 text-[11px] px-1.5 py-0.5 rounded font-medium ${WALKTHROUGH_CHIP[j.walkthrough.state].cls}`}
                  >
                    {WALKTHROUGH_CHIP[j.walkthrough.state].label(j.walkthrough.issueCount)}
                  </button>
                )}

                <MoveControls colIdx={colIdx} stages={stages} blocker={j.nextBlocker} busy={busy}
                  onBack={() => { const prev = stages[colIdx - 1]; if (prev) moveTo(j, prev.key); }}
                  onAdvance={() => { const next = stages[colIdx + 1]; if (next) moveTo(j, next.key); }}
                  advanceLabel={advanceLabel(j)} lastLabel="Closed out" />
                {j.jtStage && <p className="mt-1 text-[10px] text-gray-300 truncate" title="JobTread status">JT: {j.jtStage}</p>}

                {noteFor === j.externalId ? (
                  <div className="mt-2">
                    <textarea
                      autoFocus
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={2}
                      placeholder="Add a note to JobTread…"
                      className="w-full text-xs border border-gray-200 rounded p-1.5 focus:ring-1 focus:ring-blue-400"
                    />
                    <div className="flex gap-1.5 mt-1">
                      <button onClick={() => saveNote(j)} disabled={busy || !noteText.trim()} className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50">Save</button>
                      <button onClick={() => { if (noteText.trim() && !window.confirm('Discard this note?')) return; setNoteFor(null); setNoteText(''); }} className="text-[11px] px-2 py-1 rounded bg-gray-100 text-gray-600">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setNoteFor(j.externalId); setNoteText(''); }} className="mt-1 text-[11px] py-1 px-2 -mx-2 rounded text-gray-400 hover:text-blue-600 hover:bg-gray-50">＋ Note</button>
                )}
              </>
            );
          }}
        />
      )}
    </div>
  );
}
