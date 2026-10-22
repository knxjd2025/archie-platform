import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import {
  JOB_COMMISSION_STATUS_LABEL, jobCommissionBlockers, payoutAmount, payoutTotal, payoutsByRep,
  type JobCommissionStatus,
} from '../../../shared/job-commission';
import type { JobCommissionRecord } from '../components/JobCommission';
import type { SplitRow } from '../components/CommissionSplits';

type Tab = 'due' | 'progress' | 'denied' | 'paid';

interface Totals { count: number; amount: number }
interface ListResponse { commissions: JobCommissionRecord[]; totals: Record<JobCommissionStatus, Totals> }

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const money0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const who = (email: string | null) => (email || '').replace(/^system:\w+:/, '').split('@')[0];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const TABS: { key: Tab; label: string; status: JobCommissionStatus; blurb: string }[] = [
  { key: 'due', label: 'Due now', status: 'approved', blurb: 'Approved and not yet paid — this is what the company owes right now.' },
  { key: 'progress', label: 'In progress', status: 'open', blurb: "Sold jobs whose commission isn't settled yet. Open the client to enter costs, tick the boxes and approve." },
  { key: 'denied', label: 'Denied', status: 'denied', blurb: 'Decided against — nothing is owed on these unless someone reopens them.' },
  { key: 'paid', label: 'Paid', status: 'paid', blurb: 'Already paid out, most recent first.' },
];

/** The same four tabs, read by the person being paid rather than the one paying. */
const OWN_BLURB: Record<Tab, string> = {
  due: 'Approved and not yet paid — this is what you are owed right now.',
  progress: "Your sold jobs whose commission isn't settled yet. The reason each one is waiting is underneath it.",
  denied: 'Decided against — nothing is owed on these unless someone reopens them.',
  paid: 'Already paid to you, most recent first.',
};

/**
 * Payouts. An admin sees every commission the company owes, grouped by the rep
 * who gets paid, with the run-the-payroll actions in the same place: mark one
 * job paid, or a rep's whole batch at once. "Due" is approved-and-unpaid only;
 * jobs still missing costs or checkboxes sit under In progress with the reason
 * they're stuck, so nothing quietly counts as owed before it is.
 *
 * A rep opening the same page sees the same thing about THEMSELVES and nobody
 * else — their own jobs, their own totals — and none of the paying controls,
 * which are refused by the server for them anyway. The scoping is done there,
 * so a rep's browser is never sent a colleague's figures to hide.
 */
export default function Payouts({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const { user } = useAuth();
  const canPay = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('due');
  const [rows, setRows] = useState<Array<JobCommissionRecord & { splits?: SplitRow[] }>>([]);
  const [totals, setTotals] = useState<Record<JobCommissionStatus, Totals> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ key: string; label: string; ids: number[]; amount: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000); };

  const load = () => {
    setLoading(true);
    api.get<ListResponse>('/api/job-commissions')
      .then((r) => { setRows(r.commissions || []); setTotals(r.totals || null); setError(null); })
      .catch((e: any) => setError(e?.message || 'Could not load commissions.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const current = TABS.find((t) => t.key === tab)!;

  /**
   * One row per rep per job, not one per job. A job worked by two people owes
   * two people, and each of them has their own share, their own status and
   * their own balance — so the board has to list them separately or half the
   * money on it belongs to somebody whose name isn't on the row.
   *
   * The status filter runs on the rep's status, not the job's: a denied rep on
   * an otherwise approved job belongs under Denied, and the rep still owed on
   * a job where their colleague has been paid belongs under Due.
   *
   * With one exception. A rep approved on a job that has since gone back to
   * open — somebody was added after sign-off — can't be paid until the job is
   * approved again, so they sit under In progress saying so, not under Due
   * with a button the server would refuse.
   */
  const expanded = useMemo(() => rows.flatMap((r) => {
    if (!r.splits?.length) return [{ ...r, rowKey: `c${r.id}`, splitCount: 1, splitId: null as number | null, awaitingReapproval: false }];
    return r.splits.map((sp) => {
      const awaitingReapproval = sp.status === 'approved' && r.status !== 'approved';
      const earned = Number(sp.commissionAmount) || 0;
      return {
        ...r,
        rowKey: `c${r.id}s${sp.id}`,
        splitCount: r.splits!.length,
        splitId: sp.id as number | null,
        awaitingReapproval,
        repName: sp.repName,
        teamMemberId: sp.teamMemberId,
        commissionAmount: sp.commissionAmount,
        balanceDue: sp.balanceDue,
        // This rep's own payments so far, not the whole job's — the job's
        // figure would put a colleague's draws on this row.
        advancesPaid: sp.balanceDue == null ? '0.00' : (earned - (Number(sp.balanceDue) || 0)).toFixed(2),
        status: (awaitingReapproval ? 'open' : sp.status) as JobCommissionStatus,
        deniedReason: sp.deniedReason ?? r.deniedReason,
      };
    });
  }), [rows]);

  const shown = useMemo(() => {
    const of = expanded.filter((r) => r.status === current.status);
    return tab === 'paid'
      ? [...of].sort((a, b) => String(b.paidAt || '').localeCompare(String(a.paidAt || '')))
      : of;
  }, [expanded, current.status, tab]);
  const groups = useMemo(() => payoutsByRep(shown), [shown]);

  const due = totals?.approved ?? { count: 0, amount: 0 };
  // The page of rows can be capped server-side; the headline numbers can't be.
  const countOf = (s: JobCommissionStatus) => totals?.[s]?.count ?? rows.filter((r) => r.status === s).length;

  // Pays the reps named, by their split — never the whole job a row sits on,
  // which would pay everybody else on it too.
  const pay = async (key: string, splitIds: number[]) => {
    setPaying(key); setConfirm(null);
    try {
      const r = await api.post<{ paid: number; amount: number; skipped: { id: number; reason: string }[] }>('/api/job-commissions/pay', { splitIds });
      flash(
        `${plural(r.paid, 'commission')} marked paid — ${money(r.amount)}.`
        + (r.skipped.length ? ` ${plural(r.skipped.length, 'record')} skipped (${[...new Set(r.skipped.map((s) => s.reason))].join(', ')}).` : ''),
      );
      load();
    } catch (e: any) {
      flash(`Couldn't mark paid: ${e?.message || 'failed'}`);
    } finally { setPaying(null); }
  };

  const askPay = (key: string, label: string, ids: number[], amount: number) => setConfirm({ key, label, ids, amount });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>
          <p className="text-sm text-gray-500">Commission owed on sold jobs, by rep.</p>
        </div>
        <button onClick={load} disabled={loading} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-brand text-on-brand rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-white/70">Due now</p>
          <p className="text-3xl font-bold mt-0.5">{money0(due.amount)}</p>
          <p className="text-xs text-white/80 mt-0.5">{plural(due.count, 'job')} approved, waiting to be paid</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">In progress</p>
          <p className="text-2xl font-semibold text-gray-900 mt-0.5">{money0(totals?.open?.amount ?? 0)}</p>
          <p className="text-xs text-gray-500 mt-0.5">{plural(totals?.open?.count ?? 0, 'sold job')} not settled yet</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Paid to date</p>
          <p className="text-2xl font-semibold text-gray-900 mt-0.5">{money0(totals?.paid?.amount ?? 0)}</p>
          <p className="text-xs text-gray-500 mt-0.5">{plural(totals?.paid?.count ?? 0, 'job')} paid out</p>
        </div>
      </div>

      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2">{toast}</div>}

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`text-sm px-3 py-1.5 rounded-full ${tab === t.key ? 'bg-ink text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {t.label} ({countOf(t.status)})
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 -mt-2">{canPay ? current.blurb : OWN_BLURB[tab]}</p>

      {error ? (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-4 flex items-center justify-between gap-3">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={load} className="text-xs text-blue-600 hover:underline">Retry</button>
        </div>
      ) : loading && !rows.length ? (
        <p className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
          {tab === 'due' ? 'Nothing is waiting to be paid. 🎉' : tab === 'progress' ? 'No sold job is mid-settlement.' : 'Nothing has been paid out yet.'}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const payable = g.rows.filter((r) => r.status === 'approved' && r.splitId != null);
            const batchKey = `rep:${g.key}`;
            return (
              <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-2">
                  <div className="mr-auto">
                    <h2 className="text-sm font-semibold text-gray-900">{g.repName}</h2>
                    <p className="text-xs text-gray-500">{plural(g.rows.length, 'job')} · {money(g.total)}{g.key === 'unassigned' ? ' · no rep on the job yet' : ''}</p>
                  </div>
                  {canPay && tab === 'due' && payable.length > 1 && g.key !== 'unassigned' && (
                    <button
                      onClick={() => askPay(batchKey, `${plural(payable.length, 'job')} for ${g.repName}`, payable.map((r) => r.splitId!), payoutTotal(payable))}
                      disabled={!!paying}
                      className="text-xs px-3 py-1.5 rounded-lg bg-ink text-white font-medium hover:bg-ink/90 disabled:opacity-50"
                    >
                      {paying === batchKey ? 'Marking…' : `Mark all ${payable.length} paid`}
                    </button>
                  )}
                </div>

                {confirm?.key === batchKey && (
                  <ConfirmBar
                    text={`Mark ${confirm.label} paid — ${money(confirm.amount)}. This stamps who paid and when; you can still reopen a record afterwards.`}
                    onConfirm={() => pay(confirm.key, confirm.ids)}
                    onCancel={() => setConfirm(null)}
                  />
                )}

                <div className="divide-y divide-gray-50">
                  {g.rows.map((r) => {
                    const rowKey = `row:${r.rowKey}`;
                    const blockers = r.status === 'open'
                      ? [
                        ...(r.awaitingReapproval ? ['the job approving again — a rep was added after it was approved'] : []),
                        ...jobCommissionBlockers({
                          leadSource: r.leadSource, jobType: r.jobType,
                          revenue: Number(r.revenue) || 0, material: Number(r.material) || 0,
                          labor: Number(r.labor) || 0, other: Number(r.other) || 0,
                          manualOverheadPct: r.manualOverheadPct == null ? null : Number(r.manualOverheadPct),
                          checks: r.checks,
                        }),
                      ]
                      : [];
                    return (
                      <div key={r.rowKey}>
                        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <button
                            onClick={() => onOpenClient?.(r.jobExternalId)}
                            disabled={!onOpenClient}
                            className="text-sm text-left font-medium text-blue-600 hover:underline disabled:text-gray-900 disabled:no-underline mr-auto min-w-0 truncate"
                            title={r.jobName || r.jobExternalId}
                          >
                            {r.jobName || r.jobExternalId}
                          </button>
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {r.status === 'paid'
                              ? `Paid ${fmtDate(r.paidAt) || '—'}${r.paidBy ? ` by ${who(r.paidBy)}` : ''}`
                              : r.status === 'approved'
                                ? `Approved ${fmtDate(r.approvedAt) || '—'}${r.approvedBy ? ` by ${who(r.approvedBy)}` : ''}`
                                : `Revenue ${money0(Number(r.revenue) || 0)}`}
                          </span>
                          <span className="text-sm font-semibold text-gray-900 tabular-nums w-24 text-right"
                            title={Number(r.advancesPaid) > 0
                              ? `${money(Number(r.commissionAmount) || 0)} earned, less ${money(Number(r.advancesPaid))} already drawn during the job`
                              : undefined}>
                            {r.commissionAmount != null ? money(payoutAmount(r)) : '—'}
                            {Number(r.advancesPaid) > 0 && (
                              <span className="block text-[10px] font-normal text-gray-400">after draws</span>
                            )}
                          </span>
                          {canPay && r.status === 'approved' && r.splitId != null ? (
                            <button
                              onClick={() => askPay(rowKey, `${r.repName || 'this rep'} on ${r.jobName || 'this job'}`, [r.splitId!], payoutAmount(r))}
                              disabled={!!paying}
                              className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                            >
                              {paying === rowKey ? 'Marking…' : 'Mark paid'}
                            </button>
                          ) : (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${r.status === 'paid' ? 'bg-ink text-white' : 'bg-amber-100 text-amber-700'}`}>
                              {JOB_COMMISSION_STATUS_LABEL[r.status]}
                            </span>
                          )}
                        </div>
                        {blockers.length > 0 && (
                          <p className="px-4 pb-2 -mt-1 text-xs text-amber-700">Waiting on: {blockers.join(' · ')}</p>
                        )}
                        {confirm?.key === rowKey && (
                          <ConfirmBar
                            text={`Mark ${confirm.label} paid — ${money(confirm.amount)}. This stamps who paid and when; you can still reopen it afterwards.`}
                            onConfirm={() => pay(confirm.key, confirm.ids)}
                            onCancel={() => setConfirm(null)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400">
        A commission record opens by itself the moment a job is sold. The rep confirms the sale and the lead source, an admin enters the final
        revenue and costs and approves it — only then does it show as due here.
      </p>
    </div>
  );
}

function ConfirmBar({ text, onConfirm, onCancel }: { text: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="px-4 py-2.5 bg-amber-50 border-y border-amber-100 flex flex-wrap items-center gap-2">
      <p className="text-xs text-amber-900 mr-auto">{text}</p>
      <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700">Cancel</button>
      <button onClick={onConfirm} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark">Yes, mark paid</button>
    </div>
  );
}
