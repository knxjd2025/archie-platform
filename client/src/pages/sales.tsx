import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { formatPhone } from '../lib/format';
import PipelineBoard, { MoveControls, StageChecks, money, daysSince, type BoardStage } from '../components/PipelineBoard';
import { SALES_LOST_REASONS, salesLostReasonLabel, lostReasonBlocker, MAX_LOST_NOTE } from '../../../shared/sales-pipeline';

/**
 * The sales board: Inspection → Report → Sit Down Close → Follow Up →
 * Approved → DP Received → Reviews & Referrals, then Lost on the end.
 * Approved opens the job on the Production board; DP Received moves it to
 * Pre-Production there. Lost is off the progression — a card is put there
 * from wherever it died, and Reopen sends it back to that same step — so the
 * advance arrow never points at it.
 */
const LOST = 'lost';

interface Pipeline {
  hasRow: boolean; stage: string; checks: Record<string, boolean>; stageEnteredAt: string | null; done: boolean;
  /** Where Reopen would put a lost deal back. */
  reopenTo: string | null;
  lostReason: string | null;
  lostNote: string | null;
}

interface SalesJob {
  externalId: string;
  customer: string | null;
  jobName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  jtStage: string | null;
  repName: string | null;
  source: string;
  projectedValue: number | null;
  insuranceClaim: boolean;
  createdAt: string | null;
  pipeline: Pipeline;
  gates: { reportGenerated: boolean; productionStage: string | null; reports: number };
  nextBlocker: string | null;
}

type Item = SalesJob & { id: string; stage: string; value: number | null; blocker: string | null };

export default function Sales({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [checks, setChecks] = useState<Record<string, { key: string; label: string }[]>>({});
  const [jobs, setJobs] = useState<SalesJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  // Flipping "show done" while a load is out, or a card move's reload racing
  // the toggle's, let the older board land last and show the wrong set.
  const loadRequestId = useRef(0);
  const load = async () => {
    const id = ++loadRequestId.current;
    setLoading(true); setError(null);
    try {
      const r = await api.get<{ stages: BoardStage[]; checks: Record<string, { key: string; label: string }[]>; jobs: SalesJob[] }>(`/api/sales${includeDone ? '?all=true' : ''}`);
      if (id !== loadRequestId.current) return;
      setStages(r.stages || []); setChecks(r.checks || {}); setJobs(r.jobs || []);
    } catch (e: any) {
      if (id !== loadRequestId.current) return;
      setError(e?.message || 'Failed to load the sales board');
    } finally { if (id === loadRequestId.current) setLoading(false); }
  };
  useEffect(() => { load(); }, [includeDone]);

  const name = (j: SalesJob) => j.customer || j.jobName || 'job';
  const stageLabel = (k: string) => stages.find((s) => s.key === k)?.label || k;

  const apply = async (job: SalesJob, path: string, body: Record<string, unknown>, done: string) => {
    setBusyId(job.externalId);
    try {
      const r = await api.post<{ ok: boolean; pipeline: Pipeline; jobtread?: { ok: boolean; error?: string }; handoff?: string | null }>(`/api/sales/${job.externalId}/${path}`, body);
      const extra = [r.handoff, r.jobtread && !r.jobtread.ok ? `JobTread didn't take the status: ${r.jobtread.error || 'write failed'}` : null].filter(Boolean).join(' · ');
      flash(extra ? `${done} · ${extra}` : done);
      await load();
    } catch (e: any) {
      flash(`${name(job)}: ${e?.message || 'failed'}`);
    } finally { setBusyId(null); }
  };
  const moveTo = (job: SalesJob, stage: string, extra: Record<string, unknown> = {}) => {
    if (stage !== job.pipeline.stage) apply(job, 'stage', { stage, ...extra }, `${name(job)} → ${stageLabel(stage)}`);
  };

  // Which card has the "why did we lose it" panel open, and what's in it.
  const [losing, setLosing] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [lostNote, setLostNote] = useState('');
  const openLosing = (id: string) => { setLosing(id); setLostReason(''); setLostNote(''); };
  const confirmLost = (job: SalesJob) => {
    if (lostReasonBlocker(lostReason, lostNote)) return;
    setLosing(null);
    moveTo(job, LOST, { lostReason, lostNote: lostNote.trim() || undefined });
  };

  // Lost cards are parked, not stuck: they never count as needing attention.
  const progression = stages.filter((st) => st.key !== LOST);
  const attention = (j: SalesJob) => !!j.nextBlocker && j.pipeline.stage !== LOST;
  const attentionCount = jobs.filter(attention).length;
  const items: Item[] = jobs
    .filter((j) => !attentionOnly || attention(j))
    .map((j) => ({ ...j, id: j.externalId, stage: j.pipeline.stage, value: j.projectedValue, blocker: j.nextBlocker }));

  const PRODUCTION_LABEL: Record<string, string> = {
    approved: 'Approved', waiting_dp: 'Waiting for DP', pre_production: 'Pre-Production', schedule: 'Schedule Job', material_check: 'Material Check',
    install: 'Install / Production', final_walkthrough: 'Final Walk Through', final_invoice: 'Final Invoice', final_payment: 'Final Payment', warranty: 'Warranty', closed_out: 'Closed Out',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sales Pipeline</h2>
          <p className="text-sm text-gray-500 mt-1">Inspection to the referral ask{jobs.length ? ` · ${jobs.length} jobs` : ''}<span className="hidden sm:inline"> · drag a card to move it, or use the arrows on the card</span></p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
            Show finished
          </label>
          {attentionCount > 0 && (
            <button onClick={() => setAttentionOnly((v) => !v)} aria-pressed={attentionOnly}
              className={`px-3 py-1.5 text-sm rounded-lg border ${attentionOnly ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              title="Jobs that can't move on until someone does something">
              ⚑ Needs attention · {attentionCount}
            </button>
          )}
          <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>}

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
          <p className="text-sm text-red-600 font-medium">Couldn't load the sales board</p>
          <p className="text-xs text-gray-500 mt-1">{error}</p>
          <button onClick={load} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
        </div>
      ) : jobs.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">Nothing in the sales pipeline right now.</p>
      ) : (
        <PipelineBoard<Item>
          stages={stages}
          items={items}
          busyId={busyId}
          // Dropping a card on Lost asks why, the same as the button does —
          // otherwise the quickest way to lose a deal is the one that records
          // nothing about it.
          onMove={(item, stage) => (stage === LOST ? openLosing(item.externalId) : moveTo(item, stage))}
          renderCard={(j, colIdx) => {
            const busy = busyId === j.externalId;
            const p = j.pipeline;
            const stuck = daysSince(p.stageEnteredAt || j.createdAt);
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  {onOpenClient ? (
                    <button onClick={() => onOpenClient(j.externalId)} className="font-medium text-sm text-blue-600 hover:underline truncate text-left">{name(j)}</button>
                  ) : (
                    <p className="font-medium text-sm text-gray-900 truncate">{name(j)}</p>
                  )}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {j.insuranceClaim && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 whitespace-nowrap">Claim</span>}
                    {money(j.projectedValue) && <span className="text-xs font-medium text-emerald-700 whitespace-nowrap">{money(j.projectedValue)}</span>}
                  </div>
                </div>
                {(j.address || j.city) && <p className="text-xs text-gray-400 truncate">{j.address || j.city}</p>}
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500 gap-2">
                  <span className="truncate">{j.phone ? <a href={`tel:${j.phone}`} className="text-blue-600 hover:underline">{formatPhone(j.phone)}</a> : ''}</span>
                  <span className="truncate">{j.repName || ''}{stuck != null && stuck > 0 ? ` · ${stuck}d` : ''}</span>
                </div>

                {(p.stage === 'report' || p.stage === 'sit_down_close') && (
                  <button type="button" onClick={() => onOpenClient?.(j.externalId)}
                    className={`mt-1.5 text-[11px] px-1.5 py-0.5 rounded font-medium ${j.gates.reportGenerated ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}>
                    {j.gates.reportGenerated ? `✓ ${j.gates.reports} report${j.gates.reports === 1 ? '' : 's'} generated` : '📄 Report needed'}
                  </button>
                )}
                {j.gates.productionStage && (
                  <p className="mt-1 text-[10px] text-indigo-600">🏗️ Production: {PRODUCTION_LABEL[j.gates.productionStage] || j.gates.productionStage}</p>
                )}
                <StageChecks defs={checks[p.stage] || []} checks={p.checks} busy={busy}
                  onToggle={(key, value) => apply(j, 'check', { key, value }, `${name(j)}: ${checks[p.stage]?.find((c) => c.key === key)?.label || key}${value ? '' : ' (cleared)'}`)} />

                {p.stage === LOST ? (
                  <>
                    {p.lostReason && (
                      <p className="mt-1.5 text-[11px] text-red-800 bg-red-50 border border-red-100 rounded px-1.5 py-1">
                        ✕ {salesLostReasonLabel(p.lostReason)}
                        {p.lostNote && <span className="block text-[10px] text-red-700/80 mt-0.5">{p.lostNote}</span>}
                      </p>
                    )}
                    <button type="button" disabled={busy} onClick={() => moveTo(j, p.reopenTo || 'follow_up')}
                      title={`Put it back in ${stageLabel(p.reopenTo || 'follow_up')}`}
                      className="mt-2 w-full text-[11px] px-2 py-1 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 truncate">
                      ↩︎ Reopen in {stageLabel(p.reopenTo || 'follow_up')}
                    </button>
                  </>
                ) : losing === j.externalId ? (
                  <div className="mt-2 rounded border border-red-200 bg-red-50/60 p-2">
                    <p className="text-[11px] font-medium text-gray-700 mb-1">Why did we lose it?</p>
                    <div className="space-y-0.5">
                      {SALES_LOST_REASONS.map((r) => (
                        <label key={r.key} className="flex items-start gap-1.5 text-[11px] text-gray-700">
                          <input type="radio" name={`lost-${j.externalId}`} className="mt-0.5" checked={lostReason === r.key}
                            onChange={() => setLostReason(r.key)} />
                          <span>{r.label}{r.hint && <span className="block text-[10px] text-gray-400 leading-tight">{r.hint}</span>}</span>
                        </label>
                      ))}
                    </div>
                    <textarea value={lostNote} onChange={(e) => setLostNote(e.target.value.slice(0, MAX_LOST_NOTE))} rows={2}
                      placeholder={lostReason === 'other' ? 'Say what happened (required)' : 'Anything worth knowing (optional)'}
                      className="mt-1.5 w-full text-[11px] border border-gray-200 rounded p-1.5 focus:ring-1 focus:ring-red-300" />
                    <div className="flex gap-1.5 mt-1">
                      <button type="button" onClick={() => confirmLost(j)} disabled={busy || !!lostReasonBlocker(lostReason, lostNote)}
                        title={lostReasonBlocker(lostReason, lostNote) || 'Move it to Lost'}
                        className="text-[11px] px-2 py-1 rounded bg-red-700 text-white hover:bg-red-800 disabled:bg-gray-200 disabled:text-gray-500">Mark lost</button>
                      <button type="button" onClick={() => setLosing(null)} className="text-[11px] px-2 py-1 rounded bg-white border border-gray-200 text-gray-600">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* The progression only — Lost is the column after it, and
                        advancing must never walk into it. */}
                    <MoveControls colIdx={colIdx} stages={progression} blocker={j.nextBlocker} busy={busy}
                      onBack={() => { const prev = progression[colIdx - 1]; if (prev) moveTo(j, prev.key); }}
                      onAdvance={() => { const next = progression[colIdx + 1]; if (next) moveTo(j, next.key); }}
                      advanceLabel={p.stage === 'follow_up' ? 'Signed & approved →' : p.stage === 'approved' ? 'Deposit received →' : undefined}
                      lastLabel={p.done ? 'Finished' : 'Follow up'} />
                    <button type="button" disabled={busy} onClick={() => openLosing(j.externalId)}
                      title="Didn't close — say why and park it in Lost; you can reopen it later"
                      className="mt-1 text-[11px] py-1 px-2 -mx-2 rounded text-gray-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-50">
                      ✕ Mark lost
                    </button>
                  </>
                )}
                {j.jtStage && <p className="mt-1 text-[10px] text-gray-300 truncate" title="JobTread status">JT: {j.jtStage}</p>}
              </>
            );
          }}
        />
      )}
    </div>
  );
}
