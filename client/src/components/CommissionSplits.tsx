import { useState } from 'react';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import RepPicker, { type RepOption } from './RepPicker';
import {
  sharesBlocker, PAYOUT_KIND_LABEL, MAX_PAYOUT_REFERENCE, MAX_PAYOUT_NOTE,
  type JobCommissionStatus, type PayoutKind,
} from '../../../shared/job-commission';

/**
 * Who shares a job's commission, and every payment actually made to them.
 *
 * A job earns one pool and it is divided here, because the alternative — a
 * second commission record on the same job — would copy the job's revenue, and
 * revenue stored twice is revenue that ends up disagreeing with itself.
 *
 * The ledger under each rep is the whole of "what have we paid them": the
 * draws off each customer check as it lands, then the balance at the end.
 * There is no separate advances figure to keep in step with it.
 */
export interface SplitRow {
  id: number;
  teamMemberId: number | null;
  repName: string | null;
  sharePct: string;
  manualAmount: string | null;
  /** This rep's share of the pool, and what is left of it — written by the server on every change. */
  commissionAmount: string | null;
  balanceDue: string | null;
  status: JobCommissionStatus;
  notes: string | null;
  deniedReason: string | null;
}
export interface PayoutRow {
  id: number;
  amount: string;
  kind: string;
  reference: string | null;
  note: string | null;
  paidAt: string | null;
  paidBy: string;
}
export interface SplitWithPayouts {
  split: SplitRow;
  payouts: PayoutRow[];
  computed: { commission: number; isManual: boolean; paid: number; drawn: number; balanceDue: number; settled: boolean };
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const STATUS_STYLE: Record<JobCommissionStatus, string> = {
  open: 'bg-gray-100 text-gray-600',
  approved: 'bg-blue-50 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  denied: 'bg-red-100 text-red-700',
};

export default function CommissionSplits({ commissionId, pool, splits, isAdmin, canEditPeople, recordStatus, onChanged, flash }: {
  commissionId: number;
  pool: number;
  splits: SplitWithPayouts[];
  isAdmin: boolean;
  /** People and shares are editable until the job has been paid out. */
  canEditPeople: boolean;
  /** The job's own status, so adding a rep can say what it will cost. */
  recordStatus?: JobCommissionStatus;
  onChanged: (payload: { pool: number; splits: SplitWithPayouts[] }) => void;
  flash: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [payingFor, setPayingFor] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<PayoutKind>('draw');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [shareDraft, setShareDraft] = useState<Record<number, string>>({});

  const call = async (fn: () => Promise<{ pool: number; splits: SplitWithPayouts[] }>, done?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      onChanged({ pool: r.pool, splits: r.splits });
      if (done) flash(done);
      return true;
    } catch (e: any) {
      flash(e?.message || 'That did not save');
      return false;
    } finally { setBusy(false); }
  };

  const base = `/api/job-commissions/${commissionId}/splits`;
  const addRep = (m: RepOption | null) => {
    if (!m) return;
    setAdding(false);
    call(() => api.post(base, { teamMemberId: m.id }), `${m.name} added — shares evened out`);
  };
  const setShare = (splitId: number, pct: string) =>
    call(() => api.patch(`${base}/${splitId}`, { sharePct: Number(pct) || 0 }));
  const setManual = (splitId: number, value: string | null) =>
    call(() => api.patch(`${base}/${splitId}`, { manualAmount: value }));
  const removeRep = (s: SplitRow) =>
    call(() => api.delete(`${base}/${s.id}`), `${s.repName || 'Rep'} taken off this job`);
  const addPayout = (splitId: number) => {
    const n = Number(amount);
    if (!(n > 0)) return;
    setPayingFor(null);
    const body = { amount: n, kind, reference: reference.trim(), note: note.trim() };
    setAmount(''); setReference(''); setNote(''); setKind('draw');
    call(() => api.post(`${base}/${splitId}/payouts`, body), `${money(n)} recorded`);
  };
  const removePayout = (splitId: number, payoutId: number) =>
    call(() => api.delete(`${base}/${splitId}/payouts/${payoutId}`), 'Payout removed');

  const sharesWarning = sharesBlocker(splits.map((s) => ({
    sharePct: Number(s.split.sharePct) || 0,
    manualAmount: s.split.manualAmount == null ? null : Number(s.split.manualAmount),
  })));
  const totalPaid = splits.reduce((sum, s) => sum + s.computed.paid, 0);

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <div>
          <span className="text-xs font-semibold text-gray-700">
            Who gets paid {splits.length > 1 && <span className="font-normal text-gray-500">· {splits.length} reps</span>}
          </span>
          <p className="text-[11px] text-gray-500">
            {money(pool)} to share{totalPaid > 0 ? ` · ${money(totalPaid)} paid out so far` : ''}
          </p>
        </div>
        {isAdmin && canEditPeople && !adding && (
          <button type="button" disabled={busy} onClick={() => setAdding(true)}
            className="text-[11px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            ＋ Another rep
          </button>
        )}
      </div>

      {adding && (
        <div className="px-3 py-2 border-b border-gray-200 bg-blue-50/40">
          <span className="block text-[11px] font-semibold text-gray-600 mb-1">Who else worked this job?</span>
          {/* Adding a rep re-shares the pool, which moves a figure somebody has
              already signed off. Say so before it happens rather than after. */}
          {recordStatus && recordStatus !== 'open' && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1.5">
              This job is {recordStatus}. Adding a rep splits the pool between everyone, so the shares change and the job needs approving again.
              {splits.some((s) => s.computed.paid > 0) && ' Anyone already paid keeps the share they were paid on; only the rest is split.'}
            </p>
          )}
          <RepPicker teamMemberId={null} repName={null} disabled={busy} onPick={addRep} />
          <button type="button" onClick={() => setAdding(false)} className="mt-1 text-[11px] text-gray-500 hover:text-gray-800">Cancel</button>
        </div>
      )}

      {sharesWarning && splits.length > 0 && (
        <p className="mx-3 mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          ⚑ {sharesWarning} The job can't be approved until they do.
        </p>
      )}

      <div className="divide-y divide-gray-100">
        {splits.length === 0 && (
          <p className="px-3 py-4 text-xs text-amber-700">Nobody is set to be paid for this job yet.</p>
        )}
        {splits.map(({ split, payouts, computed }) => {
          const onFigure = split.manualAmount != null;
          return (
            <div key={split.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {split.repName || <span className="text-amber-700">Nobody chosen</span>}
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full align-middle ${STATUS_STYLE[split.status]}`}>{split.status}</span>
                  </p>
                  {split.deniedReason && <p className="text-[11px] text-red-700 mt-0.5">Denied: {split.deniedReason}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{money(computed.commission)}</p>
                  <p className="text-[11px] text-gray-500">
                    {computed.paid > 0 ? `${money(computed.paid)} paid · ` : ''}
                    <span className={computed.balanceDue < 0 ? 'text-red-600' : computed.settled ? 'text-emerald-600' : ''}>
                      {computed.balanceDue < 0
                        ? `${money(Math.abs(computed.balanceDue))} overpaid`
                        : computed.settled ? 'settled' : `${money(computed.balanceDue)} owed`}
                    </span>
                  </p>
                </div>
              </div>

              {isAdmin && canEditPeople && (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px]">
                  {/* An approved share is what was signed off; the server
                      refuses to move it, so it isn't offered as an input. */}
                  {split.status === 'approved' ? (
                    <span className="text-gray-500">
                      {onFigure ? `Agreed figure ${money(Number(split.manualAmount) || 0)}` : `Share ${Number(split.sharePct)}%`} · approved — reopen the job to change it
                    </span>
                  ) : onFigure ? (
                    <>
                      <label className="text-gray-500">Agreed figure</label>
                      <input type="number" step="0.01" min="0" defaultValue={split.manualAmount ?? ''} disabled={busy}
                        onBlur={(e) => setManual(split.id, e.target.value)}
                        className="w-28 border border-gray-200 rounded px-2 py-1" />
                      <button type="button" disabled={busy} onClick={() => setManual(split.id, null)} className="text-gray-400 hover:text-blue-700">use a share instead</button>
                    </>
                  ) : (
                    <>
                      <label className="text-gray-500">Share</label>
                      <input type="number" step="0.01" min="0" max="100" disabled={busy}
                        value={shareDraft[split.id] ?? split.sharePct}
                        onChange={(e) => setShareDraft((d) => ({ ...d, [split.id]: e.target.value }))}
                        onBlur={(e) => { setShareDraft((d) => { const n = { ...d }; delete n[split.id]; return n; }); if (e.target.value !== split.sharePct) setShare(split.id, e.target.value); }}
                        className="w-20 border border-gray-200 rounded px-2 py-1" />
                      <span className="text-gray-500">%</span>
                      <button type="button" disabled={busy} onClick={() => setManual(split.id, String(computed.commission))} className="text-gray-400 hover:text-blue-700">set a figure instead</button>
                    </>
                  )}
                  {splits.length > 1 && computed.paid === 0 && (
                    <button type="button" disabled={busy} onClick={() => removeRep(split)} className="ml-auto text-gray-400 hover:text-red-700">remove</button>
                  )}
                </div>
              )}

              {/* The ledger: every payment made to this rep on this job. */}
              {(payouts.length > 0 || (isAdmin && split.status !== 'open' && split.status !== 'denied')) && (
                <div className="mt-2 rounded bg-gray-50 border border-gray-100 p-2">
                  {payouts.length > 0 ? (
                    <table className="w-full text-[11px]">
                      <tbody>
                        {payouts.map((p) => (
                          <tr key={p.id} className="text-gray-600">
                            <td className="py-0.5 whitespace-nowrap">{p.paidAt ? fmtDate(p.paidAt) : ''}</td>
                            <td className="py-0.5">{PAYOUT_KIND_LABEL[(p.kind as PayoutKind)] ?? p.kind}</td>
                            <td className="py-0.5 text-gray-400 truncate max-w-[10rem]" title={p.note || ''}>{p.reference || ''}</td>
                            <td className="py-0.5 text-right font-medium text-gray-800 whitespace-nowrap">{money(Number(p.amount))}</td>
                            {isAdmin && (
                              <td className="py-0.5 text-right">
                                <button type="button" disabled={busy} onClick={() => removePayout(split.id, p.id)}
                                  title="Remove this payout" className="text-gray-300 hover:text-red-700 px-1">✕</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-[11px] text-gray-400">Nothing paid out yet.</p>
                  )}

                  {isAdmin && split.status !== 'open' && split.status !== 'denied' && (
                    payingFor === split.id ? (
                      <div className="mt-1.5 flex flex-wrap items-end gap-1.5">
                        <div>
                          <label className="block text-[10px] text-gray-500">Amount</label>
                          <input autoFocus type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                            placeholder={computed.balanceDue > 0 ? computed.balanceDue.toFixed(2) : '0.00'}
                            className="w-24 text-[11px] border border-gray-200 rounded px-2 py-1" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500">Kind</label>
                          <select value={kind} onChange={(e) => setKind(e.target.value as PayoutKind)} className="text-[11px] border border-gray-200 rounded px-2 py-1">
                            <option value="draw">Draw off a check</option>
                            <option value="balance">Balance</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500">Check</label>
                          <input value={reference} onChange={(e) => setReference(e.target.value.slice(0, MAX_PAYOUT_REFERENCE))} placeholder="ck 4471"
                            className="w-24 text-[11px] border border-gray-200 rounded px-2 py-1" />
                        </div>
                        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, MAX_PAYOUT_NOTE))} placeholder="Note (optional)"
                          className="flex-1 min-w-[8rem] text-[11px] border border-gray-200 rounded px-2 py-1" />
                        <button type="button" disabled={busy || !(Number(amount) > 0)} onClick={() => addPayout(split.id)}
                          className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white disabled:bg-gray-200 disabled:text-gray-500">Record</button>
                        <button type="button" onClick={() => setPayingFor(null)} className="text-[11px] px-2 py-1 rounded bg-white border border-gray-200 text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => { setPayingFor(split.id); setAmount(''); setKind(computed.paid === 0 ? 'draw' : 'balance'); setReference(''); setNote(''); }}
                        className="mt-1 text-[11px] text-blue-700 hover:underline disabled:opacity-50">
                        ＋ Record a payout
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
