import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { canSeeMoney } from '../../../shared/rbac';
import { OVERHEAD_RATES, type JobType, type LeadSource } from '../../../shared/commission';
import {
  COMMISSION_LINES, COMMISSION_LINE_LABEL, JOB_COMMISSION_CHECKS, JOB_COMMISSION_STATUS_LABEL,
  canEditJobCommissionMoney, canTickJobCommissionCheck, computeJobCommission, jobCommissionBlockers, resolveLine,
  type ChecksState, type CommissionLine, type CommissionSource, type CommissionSources, type JobCommissionStatus,
} from '../../../shared/job-commission';
import RepPicker, { type RepOption } from './RepPicker';
import CommissionMoneyLine, { type CommissionDoc } from './CommissionMoneyLine';
import CommissionSplits, { type SplitWithPayouts } from './CommissionSplits';

export interface JobCommissionRecord {
  id: number;
  jobExternalId: string;
  jobName: string | null;
  /** The roster member who gets paid, when the job's rep resolved to one. */
  teamMemberId: number | null;
  repName: string | null;
  leadSource: LeadSource | null;
  jobType: JobType;
  manualOverheadPct: string | null;
  overheadPct: string | null;
  revenue: string;
  material: string;
  labor: string;
  other: string;
  profit: string | null;
  commissionAmount: string | null;
  checks: ChecksState;
  /** Per-line breakdown; a line with entries is worth their sum. */
  sources: CommissionSources | null;
  /** Draws already paid to the rep during the job. */
  advancesPaid: string | null;
  /** commissionAmount − advancesPaid: what is still owed. */
  balanceDue: string | null;
  /** A commission agreed rather than calculated; null means use the formula. */
  manualCommission: string | null;
  deniedReason: string | null;
  deniedBy: string | null;
  deniedAt: string | null;
  notes: string | null;
  status: JobCommissionStatus;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  paidBy: string | null;
  paidAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const moneyPrecise = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const who = (email: string) => email.replace(/^system:\w+:/, '').split('@')[0];
const STATUS_STYLE: Record<JobCommissionStatus, string> = {
  open: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  denied: 'bg-red-100 text-red-700',
  paid: 'bg-ink text-white',
};

/**
 * The per-job commission record on a client profile. Auto-created server-side
 * when the job is sold; the rep sets lead source / job type and ticks their
 * boxes, the admin enters costs, ticks theirs, approves, and marks it paid.
 * The rep's free-form Commission Calculator page is a separate tool.
 */
export default function JobCommission({ externalId }: { externalId: string }) {
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = !!role && canEditJobCommissionMoney(role);

  const [rec, setRec] = useState<JobCommissionRecord | null>(null);
  const [sold, setSold] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

  // Admin's money inputs are edited locally and saved with a button — typing a
  // cost digit by digit must not fire a PATCH per keystroke.
  const [money, setMoney] = useState({ revenue: '', material: '', labor: '', other: '' });
  const [sources, setSources] = useState<CommissionSources>({});
  // The reps on this job and every payment made to them. `advancesPaid` on the
  // record is the roll-up of those payments — nobody types it any more, so
  // there is no second figure that can disagree with the ledger.
  const [splits, setSplits] = useState<SplitWithPayouts[]>([]);
  const [pool, setPool] = useState(0);
  const [customPay, setCustomPay] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [denying, setDenying] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [manualPct, setManualPct] = useState('');
  const [notes, setNotes] = useState('');
  const syncLocal = (r: JobCommissionRecord | null) => {
    if (!r) return;
    setMoney({ revenue: r.revenue, material: r.material, labor: r.labor, other: r.other });
    setSources(r.sources || {});
    setCustomPay(r.manualCommission != null);
    setCustomAmount(r.manualCommission ?? '');
    setOverride(r.manualOverheadPct != null);
    setManualPct(r.manualOverheadPct ?? '');
    setNotes(r.notes || '');
  };

  // The job's JobTread documents, fetched the first time someone opens a
  // picker rather than on every profile view — most visits never need them.
  const [docs, setDocs] = useState<CommissionDoc[]>([]);
  const [docsState, setDocsState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'none'>('idle');
  const loadDocs = () => {
    if (docsState !== 'idle' && docsState !== 'error') return;
    setDocsState('loading');
    api.get<{ documents: CommissionDoc[]; reason?: string }>(`/api/clients/${externalId}/commission-documents`)
      .then((r) => {
        setDocs(r.documents || []);
        setDocsState(r.reason === 'not-a-jobtread-job' ? 'none' : 'ready');
      })
      .catch(() => setDocsState('error'));
  };
  const setLineSources = (line: CommissionLine, next: CommissionSource[]) =>
    setSources((prev) => ({ ...prev, [line]: next }));

  const load = () => {
    setLoading(true); setError(null);
    api.get<{ commission: JobCommissionRecord | null; sold: boolean; pool?: number; splits?: SplitWithPayouts[] }>(`/api/clients/${externalId}/commission`)
      .then((r) => { setRec(r.commission); setSold(r.sold); syncLocal(r.commission); setPool(r.pool ?? 0); setSplits(r.splits ?? []); })
      .catch((e: any) => setError(e?.message || 'Could not load the commission record.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [externalId]);

  const apply = (r: JobCommissionRecord) => { setRec(r); syncLocal(r); };

  /**
   * Save some fields. Only the money save resets the inputs to what the server
   * now holds; ticking a box or picking the lead source updates the record and
   * leaves the admin's half-typed costs where they were, rather than wiping
   * them because an unrelated field was saved.
   */
  const patch = async (body: Record<string, unknown>, label: string, resetInputs = false): Promise<JobCommissionRecord | null> => {
    if (!rec) return null;
    setBusy(label);
    try {
      const r = await api.patch<{ commission: JobCommissionRecord; pool?: number; splits?: SplitWithPayouts[] }>(`/api/job-commissions/${rec.id}`, body);
      if (resetInputs) apply(r.commission); else setRec(r.commission);
      if (r.splits) { setPool(r.pool ?? 0); setSplits(r.splits); }
      return r.commission;
    } catch (e: any) { flash(`Couldn't save: ${e?.message || 'failed'}`); return null; }
    finally { setBusy(null); }
  };

  const createNow = async () => {
    setBusy('create');
    try {
      const r = await api.post<{ commission: JobCommissionRecord }>(`/api/clients/${externalId}/commission`, {});
      apply(r.commission);
    } catch (e: any) { flash(`Couldn't create: ${e?.message || 'failed'}`); }
    finally { setBusy(null); }
  };

  const saveMoney = () => patch({
    revenue: Number(money.revenue) || 0, material: Number(money.material) || 0,
    labor: Number(money.labor) || 0, other: Number(money.other) || 0,
    sources,
    manualCommission: customPay ? (Number(customAmount) || 0) : null,
    manualOverheadPct: override ? (Number(manualPct) || 0) : null,
    notes,
  }, 'money', true);

  const transition = async (action: 'approve' | 'paid' | 'reopen' | 'deny', body: Record<string, unknown> = {}) => {
    if (!rec) return;
    const preview = live ? moneyPrecise(live.balanceDue) : '—';
    const who = splits.length > 1 ? `${splits.length} reps` : (rec.repName || 'the rep');
    const owed = splits.length ? splits.reduce((sum, x) => sum + Math.max(0, x.computed.balanceDue), 0) : (live?.balanceDue ?? 0);
    const msg = action === 'approve' ? `Approve ${moneyPrecise(owed)} across ${who}? This locks the record.`
      : action === 'paid' ? `Pay the outstanding ${moneyPrecise(owed)} to ${who}? It goes on each rep's ledger.`
      : action === 'deny' ? 'Deny this commission? Nothing will be paid on it until someone reopens it.'
      : 'Reopen this commission for editing? Approval, denial and paid stamps will be cleared.';
    if (!window.confirm(msg)) return;

    // Approving used to be refused while the numbers were unsaved, with the
    // reason hidden in a tooltip on a dead button — so the click did nothing
    // and nothing said why. Save first instead: the intent is obvious.
    if (action === 'approve' && moneyDirty) {
      const savedRec = await saveMoney();
      if (!savedRec) return;
    }

    setBusy(action);
    try {
      const r = await api.post<{ commission: JobCommissionRecord; pool?: number; splits?: SplitWithPayouts[] }>(`/api/job-commissions/${rec.id}/${action}`, body);
      apply(r.commission);
      if (r.splits) { setPool(r.pool ?? 0); setSplits(r.splits); }
      setDenying(null);
      flash(action === 'approve' ? 'Commission approved ✅ — it is on the Payouts board under Due now'
        : action === 'paid' ? 'Marked paid 💸'
        : action === 'deny' ? 'Commission denied'
        : 'Reopened for editing');
    } catch (e: any) { flash(`Couldn't ${action}: ${e?.message || 'failed'}`); }
    finally { setBusy(null); }
  };

  /** File the statement on the JobTread job, where the rest of the job's paperwork lives. */
  const savePdf = async () => {
    if (!rec) return;
    setBusy('pdf');
    try {
      const r = await api.post<{ name: string }>(`/api/job-commissions/${rec.id}/pdf`, {});
      flash(`Saved “${r.name}” to the job's files 📄`);
    } catch (e: any) { flash(`Couldn't save the PDF: ${e?.message || 'failed'}`); }
    finally { setBusy(null); }
  };

  /**
   * What a line is worth right now. An itemised line is the sum of its pieces;
   * only a bare line falls back to the typed figure. Admins see their unsaved
   * edits, everyone else sees what is stored.
   */
  const lineValue = (line: CommissionLine): number => {
    if (!rec) return 0;
    const live = isAdmin ? sources : (rec.sources || {});
    const typedValue = Number(isAdmin ? money[line] : rec[line]) || 0;
    return resolveLine(line, live, typedValue);
  };

  // Live preview from whatever is in the inputs (admin) or the saved figures.
  const live = useMemo(() => {
    if (!rec) return null;
    return computeJobCommission({
      leadSource: rec.leadSource, jobType: rec.jobType,
      revenue: lineValue('revenue'), material: lineValue('material'),
      labor: lineValue('labor'), other: lineValue('other'),
      manualOverheadPct: isAdmin ? (override ? Number(manualPct) || 0 : null) : (rec.manualOverheadPct == null ? null : Number(rec.manualOverheadPct)),
      advancesPaid: Number(rec.advancesPaid) || 0,
      manualCommission: isAdmin
        ? (customPay ? Number(customAmount) || 0 : null)
        : (rec.manualCommission == null ? null : Number(rec.manualCommission)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, money, sources, override, manualPct, customPay, customAmount, isAdmin]);

  /**
   * The figures the commission box shows. An admin sees the whole job. A rep
   * on a shared job sees their own share and their own payments — the server
   * only sends them their split — so their balance is what they are owed, not
   * the job's pool less what they alone have been paid.
   */
  const ownShare = !isAdmin && splits.length > 0;
  const shown = useMemo(() => {
    if (!live || !ownShare) return live;
    const sum = (pick: (c: SplitWithPayouts['computed']) => number) =>
      Math.round(splits.reduce((t, s) => t + pick(s.computed), 0) * 100) / 100;
    return {
      ...live,
      commission: sum((c) => c.commission),
      advancesPaid: sum((c) => c.paid),
      balanceDue: sum((c) => c.balanceDue),
      isManual: splits.some((s) => s.computed.isManual),
    };
  }, [live, ownShare, splits]);

  const moneyDirty = !!rec && isAdmin && (
    Number(money.revenue) !== Number(rec.revenue) || Number(money.material) !== Number(rec.material)
    || Number(money.labor) !== Number(rec.labor) || Number(money.other) !== Number(rec.other)
    || JSON.stringify(sources) !== JSON.stringify(rec.sources || {})
    || (customPay ? (Number(customAmount) || 0) : null) !== (rec.manualCommission == null ? null : Number(rec.manualCommission))
    || (override ? (Number(manualPct) || 0) : null) !== (rec.manualOverheadPct == null ? null : Number(rec.manualOverheadPct))
    || (notes || '') !== (rec.notes || '')
  );

  if (!role || !canSeeMoney(role, 'commissions')) return null;

  if (loading) return <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse"><div className="h-4 w-40 bg-gray-100 rounded" /></div>;
  if (error) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-red-600">Couldn't load the commission record — {error}</p>
        <button onClick={load} className="text-xs text-blue-600 hover:underline flex-shrink-0">Retry</button>
      </div>
    );
  }

  if (!rec) {
    // Not sold yet. A rep sees nothing; the admin can start one early.
    if (!isAdmin) return null;
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">💰 Job commission</h3>
          <p className="text-xs text-gray-500 mt-0.5">{sold ? 'This job is sold but has no record yet.' : 'Opens automatically once this job is sold. Start it early if you already know the numbers.'}</p>
        </div>
        <button onClick={createNow} disabled={busy === 'create'} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50">{busy === 'create' ? 'Creating…' : 'Start commission record'}</button>
      </div>
    );
  }

  const open = rec.status === 'open';
  const saved = rec.sources || {};
  const blockers = jobCommissionBlockers({
    leadSource: rec.leadSource, jobType: rec.jobType,
    revenue: resolveLine('revenue', saved, Number(rec.revenue) || 0),
    material: resolveLine('material', saved, Number(rec.material) || 0),
    labor: resolveLine('labor', saved, Number(rec.labor) || 0),
    other: resolveLine('other', saved, Number(rec.other) || 0),
    manualOverheadPct: rec.manualOverheadPct == null ? null : Number(rec.manualOverheadPct),
    manualCommission: rec.manualCommission == null ? null : Number(rec.manualCommission),
    checks: rec.checks,
  });
  const ready = open && blockers.length === 0;
  const rateLabel = rec.leadSource ? `${override && isAdmin ? Number(manualPct) || 0 : (rec.manualOverheadPct != null ? Number(rec.manualOverheadPct) : OVERHEAD_RATES[`${rec.leadSource}-${rec.jobType}`])}%` : '—';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">💰 Job commission</h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ready ? 'bg-blue-100 text-blue-700' : STATUS_STYLE[rec.status]}`}>
            {ready ? 'Ready for approval' : JOB_COMMISSION_STATUS_LABEL[rec.status]}
          </span>
        </div>
        <p className="text-xs text-gray-400">
          {rec.createdBy.startsWith('system:') ? 'auto-created' : `started by ${who(rec.createdBy)}`}{rec.createdAt ? ` ${fmtDate(rec.createdAt)}` : ''}
        </p>
      </div>

      {toast && <div className="mx-4 mt-3 rounded-lg bg-gray-900 text-white text-sm px-3 py-2">{toast}</div>}

      <div className="p-4 space-y-4">
        {/* Who gets paid, in what proportion, and everything already handed to
            them. One pool, divided — the job's money is never copied per rep. */}
        {splits.length === 0 && isAdmin && open ? (
          <div className="sm:max-w-xs">
            <span className="block text-xs font-semibold text-gray-600 mb-1">
              Sales rep <span className="font-normal text-gray-400">(admin)</span>
            </span>
            <RepPicker
              teamMemberId={rec.teamMemberId}
              repName={rec.repName}
              disabled={!(isAdmin && open)}
              onPick={(m: RepOption | null) => patch({ teamMemberId: m ? m.id : null, ...(m ? {} : { repName: null }) }, 'rep')}
            />
            <p className="text-xs text-amber-600 mt-1">Nobody is set to be paid for this job yet.</p>
          </div>
        ) : (
          <CommissionSplits
            commissionId={rec.id}
            pool={live ? live.commission : pool}
            splits={splits}
            isAdmin={isAdmin}
            // Who worked the job is editable until the money has gone out, not
            // until the figures are agreed. Finding out a second rep was on it
            // does not make the costs wrong — it changes who shares the pool —
            // and making that need a full reopen (which clears everyone's
            // approval) is a heavy price for a fact that was always true.
            canEditPeople={rec.status !== 'paid'}
            recordStatus={rec.status}
            onChanged={(p) => { setPool(p.pool); setSplits(p.splits); }}
            flash={flash}
          />
        )}

        {/* Rep's part: where the lead came from and what kind of job it is. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span id="jc-lead-source" className="block text-xs font-semibold text-gray-600 mb-1">Lead source <span className="font-normal text-gray-400">(rep)</span></span>
            <div role="group" aria-labelledby="jc-lead-source" className="flex gap-2">
              {(['self', 'company'] as const).map((v) => (
                <button key={v} type="button" disabled={!open || busy === 'leadSource'} onClick={() => patch({ leadSource: v }, 'leadSource')} aria-pressed={rec.leadSource === v}
                  className={`flex-1 text-sm px-3 py-2 rounded-lg border font-medium disabled:opacity-60 ${rec.leadSource === v ? 'bg-ink text-white border-ink' : 'bg-white border-gray-200 text-gray-600'}`}>
                  {v === 'self' ? 'Self-Generated' : 'Company-Provided'}
                </button>
              ))}
            </div>
            {!rec.leadSource && open && <p className="text-xs text-amber-600 mt-1">Pick one — the overhead rate depends on it.</p>}
          </div>
          <div>
            <span id="jc-job-type" className="block text-xs font-semibold text-gray-600 mb-1">Job type <span className="font-normal text-gray-400">(rep)</span></span>
            <div role="group" aria-labelledby="jc-job-type" className="flex gap-2">
              {(['retail', 'insurance'] as const).map((v) => (
                <button key={v} type="button" disabled={!open || busy === 'jobType'} onClick={() => patch({ jobType: v }, 'jobType')} aria-pressed={rec.jobType === v}
                  className={`flex-1 text-sm px-3 py-2 rounded-lg border font-medium capitalize disabled:opacity-60 ${rec.jobType === v ? 'bg-ink text-white border-ink' : 'bg-white border-gray-200 text-gray-600'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Admin's part: the money. Each line is either a typed figure or a
            stack of JobTread documents and hand-entered amounts. Reps see it
            read-only. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {COMMISSION_LINES.map((k) => (
            <CommissionMoneyLine
              key={k}
              line={k}
              label={COMMISSION_LINE_LABEL[k]}
              typed={isAdmin ? money[k] : (rec[k] ?? '')}
              onTyped={(v) => setMoney({ ...money, [k]: v })}
              sources={(isAdmin ? sources : (rec.sources || {}))[k] || []}
              onSources={(next) => setLineSources(k, next)}
              documents={docs}
              docsState={docsState}
              onNeedDocs={loadDocs}
              editable={isAdmin && open}
              by={user?.email || ''}
            />
          ))}
        </div>

        {isAdmin && open && (
          <div className="space-y-2">
            <div className="border border-gray-200 rounded-lg p-3">
              <label className="flex items-center gap-2 text-sm text-gray-700 font-medium">
                <input type="checkbox" checked={customPay} onChange={(e) => setCustomPay(e.target.checked)} />
                Write the commission in myself
              </label>
              <p className="text-[11px] text-gray-500 mt-0.5">
                For a job settled on something other than half the profit. Everything above stays as it is —
                the lead source, the job type and the costs are still recorded, and the sheet shows both
                what was agreed and what the formula would have paid.
              </p>
              {customPay && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input type="number" inputMode="decimal" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)}
                    step="0.01" min="0" placeholder="0.00" aria-label="Commission set by hand"
                    className="w-40 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400" />
                  {!!live && (
                    <span className="text-[11px] text-gray-500">
                      the formula would pay {moneyPrecise(live.calculatedCommission)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Override overhead % manually (special case)
            </label>
            {override && <input type="number" inputMode="decimal" value={manualPct} onChange={(e) => setManualPct(e.target.value)} step="0.1" min="0" max="100" placeholder="e.g. 12" className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2" />}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes for this commission (optional)" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400" />
            {moneyDirty && (
              <div className="flex items-center gap-2">
                <button onClick={saveMoney} disabled={busy === 'money'} className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">{busy === 'money' ? 'Saving…' : 'Save numbers'}</button>
                <button onClick={() => syncLocal(rec)} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Discard</button>
              </div>
            )}
          </div>
        )}
        {!isAdmin && rec.notes && <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 whitespace-pre-wrap">{rec.notes}</p>}
        {rec.manualOverheadPct != null && !(isAdmin && open) && <p className="text-xs text-gray-500">Overhead rate manually set to {Number(rec.manualOverheadPct)}%.</p>}

        {/* Breakdown */}
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            <tr><td className="py-1.5 text-gray-600">Revenue</td><td className="py-1.5 text-right font-medium">{moneyPrecise(lineValue('revenue'))}</td></tr>
            <tr><td className="py-1.5 text-gray-600">Overhead ({rateLabel} of revenue)</td><td className="py-1.5 text-right text-red-600">{live ? `−${moneyPrecise(live.overheadAmount)}` : '—'}</td></tr>
            <tr><td className="py-1.5 text-gray-600">Material</td><td className="py-1.5 text-right text-red-600">−{moneyPrecise(lineValue('material'))}</td></tr>
            <tr><td className="py-1.5 text-gray-600">Labor</td><td className="py-1.5 text-right text-red-600">−{moneyPrecise(lineValue('labor'))}</td></tr>
            <tr><td className="py-1.5 text-gray-600">Other</td><td className="py-1.5 text-right text-red-600">−{moneyPrecise(lineValue('other'))}</td></tr>
            <tr className="border-t-2 border-ink"><td className="pt-2 font-bold text-ink">Job profit</td><td className={`pt-2 text-right font-bold ${live && live.profit < 0 ? 'text-red-600' : 'text-ink'}`}>{live ? moneyPrecise(live.profit) : '—'}</td></tr>
          </tbody>
        </table>
        {live && live.profit < 0 && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠️ Costs and overhead exceed revenue — this job pays no commission as entered.</p>
        )}
        <div className="bg-ink rounded-xl px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs uppercase tracking-wide text-brand-accent">
              {ownShare ? 'Your share of the commission' : shown?.isManual ? 'Rep commission (set by hand)' : 'Rep commission (50% of job profit)'}
            </span>
            <span className={`text-lg font-bold ${live && live.profit < 0 ? 'text-red-300' : 'text-white'}`}>{shown ? moneyPrecise(shown.commission) : 'Set lead source'}</span>
          </div>
          {!!shown && shown.isManual && !ownShare && (
            <p className="text-[11px] text-white/60">The formula would have paid {moneyPrecise(shown.calculatedCommission)}.</p>
          )}
          {!!shown && shown.advancesPaid > 0 && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2 text-white/70">
                <span className="text-xs">Already paid to the rep during the job</span>
                <span className="text-sm">−{moneyPrecise(shown.advancesPaid)}</span>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2 border-t border-white/20 pt-1.5">
                <span className="text-xs uppercase tracking-wide text-brand-accent">
                  {shown.balanceDue < 0 ? 'Overpaid — to recover' : 'Still owed to the rep'}
                </span>
                <span className={`text-xl font-bold ${shown.balanceDue < 0 ? 'text-red-300' : 'text-white'}`}>
                  {moneyPrecise(Math.abs(shown.balanceDue))}
                </span>
              </div>
            </>
          )}
        </div>
        {!!shown && shown.balanceDue < 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            The draws already paid come to more than this job finally earned. {moneyPrecise(Math.abs(shown.balanceDue))} needs
            recovering from a later job rather than paid out here.
          </p>
        )}

        {/* Checklist — the "so the system knows" part. */}
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1.5">Before this can be approved</p>
          <ul className="space-y-1.5">
            {JOB_COMMISSION_CHECKS.map((c) => {
              const done = rec.checks?.[c.key];
              const may = open && canTickJobCommissionCheck(role, c);
              return (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  <input id={`jc-${c.key}`} type="checkbox" checked={!!done} disabled={!may || busy === c.key}
                    onChange={(e) => patch({ checks: { [c.key]: e.target.checked } }, c.key)} className="mt-0.5" />
                  <label htmlFor={`jc-${c.key}`} className={`flex-1 ${done ? 'text-gray-500 line-through' : 'text-gray-800'} ${!may ? 'cursor-default' : ''}`}>
                    {c.label} <span className="text-[10px] uppercase text-gray-400 no-underline">{c.who}</span>
                    {c.hint && !done && <span className="block text-xs text-gray-400 no-underline">{c.hint}</span>}
                    {done && <span className="block text-[11px] text-gray-400">✓ {who(done.by)} · {fmtDate(done.at)}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Approval / payout — admin. Everyone sees the stamps. */}
        {(rec.approvedAt || rec.paidAt) && (
          <p className="text-xs text-gray-500">
            {rec.approvedAt && <>Approved by {who(rec.approvedBy || '')} on {fmtDate(rec.approvedAt)}. </>}
            {rec.paidAt && <>Paid by {who(rec.paidBy || '')} on {fmtDate(rec.paidAt)}.</>}
          </p>
        )}
        {rec.deniedAt && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Denied by {who(rec.deniedBy || '')} on {fmtDate(rec.deniedAt)}
            {rec.deniedReason ? <> — {rec.deniedReason}</> : null}
          </p>
        )}
        {isAdmin && open && blockers.length > 0 && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <span className="font-semibold">Can't approve yet:</span>{' '}
            {blockers.join(' · ')}
          </div>
        )}
        {isAdmin && denying != null && (
          <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
            <label htmlFor="jc-deny" className="block text-xs font-semibold text-red-800">Why is this being denied?</label>
            <textarea id="jc-deny" autoFocus rows={2} value={denying} onChange={(e) => setDenying(e.target.value)}
              placeholder="e.g. job lost money after the supplement was withdrawn"
              className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-red-400" />
            <div className="flex items-center gap-2">
              <button onClick={() => transition('deny', { reason: denying })} disabled={!denying.trim() || !!busy}
                className="text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium disabled:opacity-40">
                {busy === 'deny' ? 'Denying…' : 'Deny commission'}
              </button>
              <button onClick={() => setDenying(null)} className="text-sm px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600">Cancel</button>
            </div>
          </div>
        )}
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {open && (
              <button onClick={() => transition('approve')} disabled={blockers.length > 0 || !!busy}
                className="text-sm px-4 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">
                {busy === 'approve' ? 'Approving…' : moneyDirty ? 'Save & approve' : 'Approve commission'}
              </button>
            )}
            {open && (
              <button onClick={() => setDenying(denying == null ? '' : null)} disabled={!!busy}
                className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-700 font-medium hover:bg-red-50 disabled:opacity-50">
                Deny
              </button>
            )}
            {rec.status === 'approved' && (
              <button onClick={() => transition('paid')} disabled={!!busy} className="text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'paid' ? 'Saving…' : 'Mark paid'}
              </button>
            )}
            {!open && (
              <button onClick={() => transition('reopen')} disabled={!!busy} className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50">
                {busy === 'reopen' ? '…' : 'Reopen to edit'}
              </button>
            )}
            <button onClick={savePdf} disabled={!!busy || moneyDirty} title={moneyDirty ? 'Save the numbers first' : 'Save this statement as a PDF on the job'}
              className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50">
              {busy === 'pdf' ? 'Saving…' : '📄 Save PDF to job'}
            </button>
            <a href={`/api/job-commissions/${rec.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Preview</a>

          </div>
        )}
      </div>
    </div>
  );
}
