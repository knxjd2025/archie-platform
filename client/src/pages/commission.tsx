import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { calculateCommission, OVERHEAD_RATES, type LeadSource, type JobType } from '../../../shared/commission';
import { JOB_COMMISSION_STATUS_LABEL, jobCommissionBlockers, type JobCommissionStatus } from '../../../shared/job-commission';
import type { JobCommissionRecord } from '../components/JobCommission';

interface CommissionRow {
  id: number;
  jobName: string;
  repName: string;
  leadSource: string;
  jobType: string;
  overheadPct: string;
  revenue: string;
  material: string;
  labor: string;
  other: string;
  profit: string;
  commissionAmount: string;
  status: 'draft' | 'approved';
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string | null;
}

const moneyPrecise = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const LABELS: Record<string, string> = {
  'self-retail': 'Self-Generated + Retail', 'self-insurance': 'Self-Generated + Insurance',
  'company-retail': 'Company-Provided + Retail', 'company-insurance': 'Company-Provided + Insurance',
};

export default function Commission({ onOpenClient, onNavigate }: { onOpenClient?: (externalId: string) => void; onNavigate?: (page: string) => void }) {
  const { user } = useAuth();
  const isManagerPlus = user?.role === 'admin' || user?.role === 'manager';
  const isAdmin = user?.role === 'admin';

  const [jobName, setJobName] = useState('');
  const [repName, setRepName] = useState(user?.name || '');
  const [leadSource, setLeadSource] = useState<LeadSource>('self');
  const [jobType, setJobType] = useState<JobType>('retail');
  const [override, setOverride] = useState(false);
  const [manualPct, setManualPct] = useState('10');
  const [revenue, setRevenue] = useState('');
  const [material, setMaterial] = useState('');
  const [labor, setLabor] = useState('');
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  // A swallowed failure rendered an empty table with no explanation, so a rep
  // reads "I have earned nothing" when the truth is "this did not load".
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = () => api.get<{ commissions: CommissionRow[] }>('/api/commissions')
    .then((r) => { setRows(r.commissions || []); setLoadError(null); })
    .catch((e: any) => setLoadError(e?.message || 'Could not load your commissions.'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const result = useMemo(() => calculateCommission({
    leadSource, jobType,
    revenue: Number(revenue) || 0, material: Number(material) || 0, labor: Number(labor) || 0, other: Number(other) || 0,
    manualOverheadPct: override ? Number(manualPct) || 0 : null,
  }), [leadSource, jobType, revenue, material, labor, other, override, manualPct]);

  const save = async () => {
    if (!jobName.trim() || !repName.trim() || saving) return;
    setSaving(true);
    try {
      await api.post('/api/commissions', {
        jobName, repName, leadSource, jobType,
        revenue: Number(revenue) || 0, material: Number(material) || 0, labor: Number(labor) || 0, other: Number(other) || 0,
        manualOverheadPct: override ? Number(manualPct) || 0 : undefined,
      });
      flash('Saved as draft ✅');
      setJobName(''); setRevenue(''); setMaterial(''); setLabor(''); setOther('');
      await load();
    } catch (e: any) { flash(`Couldn't save: ${e?.message || 'failed'}`); }
    finally { setSaving(false); }
  };

  const [approvingId, setApprovingId] = useState<number | null>(null);
  const approve = async (id: number) => {
    // This commits a payout-affecting change with no way to un-approve from
    // here — every other consequential action on this page (nothing else,
    // really) gets less scrutiny than this deserves.
    const row = draft.find((r) => r.id === id);
    if (row && !window.confirm(`Approve ${moneyPrecise(Number(row.commissionAmount))} commission for ${row.repName} on ${row.jobName}?`)) return;
    setApprovingId(id);
    try { await api.post(`/api/commissions/${id}/approve`, {}); await load(); }
    catch (e: any) { flash(`Couldn't approve: ${e?.message || 'failed'}`); }
    finally { setApprovingId(null); }
  };

  const draft = rows.filter((r) => r.status === 'draft');
  const approved = rows.filter((r) => r.status === 'approved');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Commission Calculator</h1>
        <p className="text-sm text-gray-500 mt-1">Fill in the job numbers, review the commission, {isManagerPlus ? 'approve below.' : 'a manager approves before payout.'}</p>
      </div>

      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>}

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Job Name / Address</label>
            <input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="123 Main St" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Sales Rep Name</label>
            <input value={repName} onChange={(e) => setRepName(e.target.value)} placeholder="Rep name" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span id="comm-lead-source" className="block text-xs font-semibold text-gray-600 mb-1">Lead Source</span>
            <div role="group" aria-labelledby="comm-lead-source" className="flex gap-2">
              {(['self', 'company'] as const).map((v) => (
                <button key={v} onClick={() => setLeadSource(v)} aria-pressed={leadSource === v} className={`flex-1 text-sm px-3 py-2 rounded-lg border font-medium ${leadSource === v ? 'bg-ink text-white border-ink' : 'bg-white border-gray-200 text-gray-600'}`}>
                  {v === 'self' ? 'Self-Generated' : 'Company-Provided'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span id="comm-job-type" className="block text-xs font-semibold text-gray-600 mb-1">Job Type</span>
            <div role="group" aria-labelledby="comm-job-type" className="flex gap-2">
              {(['retail', 'insurance'] as const).map((v) => (
                <button key={v} onClick={() => setJobType(v)} aria-pressed={jobType === v} className={`flex-1 text-sm px-3 py-2 rounded-lg border font-medium capitalize ${jobType === v ? 'bg-ink text-white border-ink' : 'bg-white border-gray-200 text-gray-600'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600">
          Overhead rate: <b className="text-ink">{override ? Number(manualPct) || 0 : OVERHEAD_RATES[`${leadSource}-${jobType}`]}%</b> {override ? '(manual override)' : `(${LABELS[`${leadSource}-${jobType}`]})`}
        </div>

        {isManagerPlus && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Override overhead % manually (special case)
            </label>
            {override && (
              <input type="number" inputMode="decimal" value={manualPct} onChange={(e) => setManualPct(e.target.value)} step="0.1" min="0" className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2" />
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Total Job Revenue ($)</label>
            <input type="number" inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="0.00" step="0.01" min="0" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Material Cost ($)</label>
            <input type="number" inputMode="decimal" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="0.00" step="0.01" min="0" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Labor Cost ($)</label>
            <input type="number" inputMode="decimal" value={labor} onChange={(e) => setLabor(e.target.value)} placeholder="0.00" step="0.01" min="0" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Other Expenses ($)</label>
            <input type="number" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} placeholder="0.00" step="0.01" min="0" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            <tr><td className="py-2 text-gray-600">Total Job Revenue</td><td className="py-2 text-right font-medium">{moneyPrecise(Number(revenue) || 0)}</td></tr>
            <tr><td className="py-2 text-gray-600">Overhead ({result.overheadPct}% of revenue)</td><td className="py-2 text-right text-red-600">−{moneyPrecise(result.overheadAmount)}</td></tr>
            <tr><td className="py-2 text-gray-600">Material Cost</td><td className="py-2 text-right text-red-600">−{moneyPrecise(Number(material) || 0)}</td></tr>
            <tr><td className="py-2 text-gray-600">Labor Cost</td><td className="py-2 text-right text-red-600">−{moneyPrecise(Number(labor) || 0)}</td></tr>
            <tr><td className="py-2 text-gray-600">Other Expenses</td><td className="py-2 text-right text-red-600">−{moneyPrecise(Number(other) || 0)}</td></tr>
            <tr className="border-t-2 border-ink"><td className="pt-3 font-bold text-ink">Job Profit</td><td className={`pt-3 text-right font-bold ${result.profit < 0 ? 'text-red-600' : 'text-ink'}`}>{moneyPrecise(result.profit)}</td></tr>
          </tbody>
        </table>
        {result.profit < 0 && (
          <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ This job is currently unprofitable — costs and overhead exceed revenue. Double-check the numbers before saving.
          </p>
        )}
        <div className="mt-4 bg-ink rounded-xl px-5 py-4 flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs uppercase tracking-wide text-brand-accent">Sales Rep Commission (50% of Job Profit)</span>
          <span className={`text-2xl font-bold ${result.profit < 0 ? 'text-red-300' : 'text-white'}`}>{moneyPrecise(result.commission)}</span>
        </div>
        <button onClick={save} disabled={saving || !jobName.trim() || !repName.trim()} className="mt-4 text-sm px-4 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">
          {saving ? 'Saving…' : 'Save as Draft'}
        </button>
      </div>

      {isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-sm font-semibold text-gray-800">Sold-job commissions live on Payouts</h2>
            <p className="text-xs text-gray-500">What's owed to each rep, what's still waiting on costs, and paying it out.</p>
          </div>
          <button onClick={() => onNavigate?.('payouts')} className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white font-medium">Open Payouts →</button>
        </div>
      )}

      {!loading && isManagerPlus && draft.length > 0 && (
        <CommissionTable title={`Pending approval (${draft.length})`} rows={draft} onApprove={approve} showApprove approvingId={approvingId} />
      )}
      {!loading && loadError && (
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <p className="text-sm text-red-600 font-medium">Couldn't load your commissions</p>
          <p className="text-xs text-gray-500 mt-1">{loadError}</p>
          <button onClick={load} className="mt-2 text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">Retry</button>
        </div>
      )}
      {!loading && !loadError && rows.length === 0 && (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 px-4 py-6 text-center">No commissions recorded yet.</p>
      )}
      {!loading && rows.length > 0 && (
        <CommissionTable title={isManagerPlus ? 'All commission history' : 'Your commission history'} rows={isManagerPlus ? approved : rows} />
      )}
    </div>
  );
}

function CommissionTable({ title, rows, onApprove, showApprove, approvingId }: { title: string; rows: CommissionRow[]; onApprove?: (id: number) => void; showApprove?: boolean; approvingId?: number | null }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-4 py-2 font-medium">Job</th>
              <th className="px-4 py-2 font-medium">Rep</th>
              <th className="px-4 py-2 font-medium text-right">Commission</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {showApprove && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {/* A manager with drafts but nothing approved yet passes an empty
                list here. Bare headers read as a failed load, so say it plainly. */}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showApprove ? 6 : 5} className="px-4 py-6 text-center text-sm text-gray-400">Nothing here yet.</td>
              </tr>
            )}
            {rows.map((r) => {
              const isApproving = approvingId === r.id;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-gray-900">{r.jobName}</td>
                  <td className="px-4 py-2 text-gray-600">{r.repName}</td>
                  <td className="px-4 py-2 text-right font-medium">{moneyPrecise(Number(r.commissionAmount))}</td>
                  <td className="px-4 py-2 text-gray-500">{fmtDate(r.createdAt) || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${r.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                  </td>
                  {showApprove && (
                    <td className="px-4 py-2 text-right">
                      {r.status === 'draft' && onApprove && (
                        <button onClick={() => onApprove(r.id)} disabled={isApproving} className="text-xs text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed">
                          {isApproving ? 'Approving…' : 'Approve'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
