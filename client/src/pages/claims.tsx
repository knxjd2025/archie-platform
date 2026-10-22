import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { fmtDate, formatPhone } from '../lib/format';
import { dueDay, isDueDayPast } from '../lib/due-date';
import ContactActions from '../components/ContactActions';
import PipelineBoard, { MoveControls, StageChecks, money, daysSince, type BoardStage } from '../components/PipelineBoard';

/**
 * The claims board: Inspect → File Claim → SA Signed → Inspection Report →
 * Adjuster Inspection → Waiting Results → Supplement → Disputing (with its
 * own steps) → Approved → Post-Supplementing → Request Depreciation → Closed.
 */
interface Amounts { deductible?: number; acv?: number; rcv?: number; firstCheck?: number; supplements?: number }
interface Contact { phone?: string; email?: string }
interface Adjuster { name?: string; phone?: string; email?: string }

interface Claim {
  id: number;
  customerName: string;
  contact: Contact | null;
  jobtreadJobId: string | null;
  jtStage: string | null;
  carrier: string | null;
  policyNumber: string | null;
  claimNumber: string | null;
  dateOfLoss: string | null;
  adjuster: Adjuster | null;
  amounts: Amounts | null;
  stage: string;
  disputeSteps: { key: string; done: boolean }[];
  currentDisputeStep: string | null;
  checks: Record<string, boolean>;
  gates: { inspectionReport: boolean };
  nextBlocker: string | null;
  stageEnteredAt: string;
  nextAction: string;
  nextActionOwner: string;
  nextActionDue: string;
}

type Item = Omit<Claim, 'id'> & { id: string; claimId: number; value: number | null; blocker: string | null };

/**
 * Who owns a claim's next action. The server stores a fixed set of person keys
 * (brain_person in shared/schema.ts) rather than a team member, so the only
 * keys offered here are the role-shaped ones every company has. A claim that
 * already carries a person key keeps it: ownerChoices() adds it to its own
 * select, and ownerLabel() shows it, so editing never silently changes it.
 */
const OWNER_LABEL: Record<string, string> = { admin: 'Admin', unassigned: 'Unassigned' };
const OWNERS = ['admin', 'unassigned'];
const ownerLabel = (key: string) => OWNER_LABEL[key] || (key ? key[0].toUpperCase() + key.slice(1) : 'Unassigned');
const ownerChoices = (current: string) => (current && !OWNERS.includes(current) ? [current, ...OWNERS] : OWNERS);


const emptyForm = {
  customerName: '', phone: '', email: '', jobtreadJobId: '',
  carrier: '', policyNumber: '', claimNumber: '', dateOfLoss: '',
  nextAction: '', nextActionOwner: 'unassigned', nextActionDue: '',
};

const emptyEdit = {
  carrier: '', policyNumber: '', claimNumber: '', dateOfLoss: '', jobtreadJobId: '',
  phone: '', email: '', adjusterName: '', adjusterPhone: '', adjusterEmail: '',
  deductible: '', acv: '', rcv: '', firstCheck: '', supplements: '',
  nextAction: '', nextActionOwner: 'unassigned', nextActionDue: '',
};

export default function Claims({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [disputeSteps, setDisputeSteps] = useState<{ key: string; label: string }[]>([]);
  const [checks, setChecks] = useState<Record<string, { key: string; label: string }[]>>({});
  const [items, setItems] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  // Toggling "include closed" twice quickly can land the responses out of
  // order, leaving the board showing the set the toggle says it isn't showing.
  const requestId = useRef(0);

  const load = async () => {
    const id = ++requestId.current;
    setLoading(true); setError(null);
    try {
      const res = await api.get<{ stages: BoardStage[]; disputeSteps: { key: string; label: string }[]; checks: Record<string, { key: string; label: string }[]>; claims: Claim[] }>(`/api/claims${includeClosed ? '?all=true' : ''}`);
      if (id !== requestId.current) return;
      setStages(res.stages || []); setDisputeSteps(res.disputeSteps || []); setChecks(res.checks || {});
      setItems(res.claims || []);
    } catch (e: any) {
      if (id !== requestId.current) return;
      setError(e?.message || 'Failed to load claims');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };
  useEffect(() => { load(); }, [includeClosed]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState(emptyEdit);
  const [showNew, setShowNew] = useState(false);
  const [nf, setNf] = useState(emptyForm);
  const [creating, setCreating] = useState(false);

  const stageLabel = (k: string) => stages.find((s) => s.key === k)?.label || k;
  const stepLabel = (k: string) => disputeSteps.find((s) => s.key === k)?.label || k;

  const patchClaim = (updated: Claim) => setItems((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));

  const write = async (claim: Claim, req: () => Promise<{ claim: Claim; jobtread?: { ok: boolean; error?: string } }>, done: string) => {
    setBusyId(claim.id);
    try {
      const r = await req();
      patchClaim(r.claim);
      flash(r.jobtread && !r.jobtread.ok ? `${done} — but JobTread didn't take the status: ${r.jobtread.error || 'write failed'}` : done);
    } catch (e: any) {
      flash(`${claim.customerName}: ${e?.message || 'failed'}`);
    } finally { setBusyId(null); }
  };
  const moveTo = (claim: Claim, stage: string) => {
    if (stage === claim.stage) return;
    write(claim, () => api.patch(`/api/claims/${claim.id}/stage`, { stage }), `${claim.customerName} → ${stageLabel(stage)}`);
  };

  const startEdit = (c: Claim) => {
    setEditId(c.id);
    setEdit({
      carrier: c.carrier || '', policyNumber: c.policyNumber || '', claimNumber: c.claimNumber || '',
      dateOfLoss: c.dateOfLoss ? c.dateOfLoss.slice(0, 10) : '', jobtreadJobId: c.jobtreadJobId || '',
      phone: c.contact?.phone || '', email: c.contact?.email || '',
      adjusterName: c.adjuster?.name || '', adjusterPhone: c.adjuster?.phone || '', adjusterEmail: c.adjuster?.email || '',
      deductible: c.amounts?.deductible?.toString() || '', acv: c.amounts?.acv?.toString() || '', rcv: c.amounts?.rcv?.toString() || '',
      firstCheck: c.amounts?.firstCheck?.toString() || '', supplements: c.amounts?.supplements?.toString() || '',
      nextAction: c.nextAction, nextActionOwner: c.nextActionOwner, nextActionDue: dueDay(c.nextActionDue) ?? '',
    });
  };

  const saveEdit = async (c: Claim) => {
    setBusyId(c.id);
    try {
      const r = await api.patch<{ claim: Claim }>(`/api/claims/${c.id}`, {
        carrier: edit.carrier, policyNumber: edit.policyNumber, claimNumber: edit.claimNumber,
        dateOfLoss: edit.dateOfLoss || null, jobtreadJobId: edit.jobtreadJobId,
        phone: edit.phone, email: edit.email,
        adjusterName: edit.adjusterName, adjusterPhone: edit.adjusterPhone, adjusterEmail: edit.adjusterEmail,
        amounts: { deductible: edit.deductible, acv: edit.acv, rcv: edit.rcv, firstCheck: edit.firstCheck, supplements: edit.supplements },
        nextAction: edit.nextAction, nextActionOwner: edit.nextActionOwner, nextActionDue: edit.nextActionDue,
      });
      patchClaim(r.claim);
      setEditId(null);
      flash('Saved');
    } catch (e: any) {
      flash(`Couldn't save: ${e?.message || 'failed'}`);
    } finally { setBusyId(null); }
  };

  const createClaim = async () => {
    if (!nf.customerName.trim()) { flash('Customer name is required.'); return; }
    setCreating(true);
    try {
      await api.post('/api/claims', nf);
      flash(`Claim opened for ${nf.customerName}`);
      setShowNew(false); setNf(emptyForm);
      load();
    } catch (e: any) {
      flash(`Couldn't create claim: ${e?.message || 'failed'}`);
    } finally { setCreating(false); }
  };

  // The due date is a calendar day: overdue the morning after, not at 8pm the night before.
  const isOverdue = (due: string) => isDueDayPast(due);
  const attention = (c: Claim) => !!c.nextBlocker || (c.stage !== 'closed' && isOverdue(c.nextActionDue));
  const attentionCount = items.filter(attention).length;
  const boardItems: Item[] = items
    .filter((c) => !attentionOnly || attention(c))
    .map((c) => ({ ...c, id: String(c.id), claimId: c.id, value: c.amounts?.rcv ?? null, blocker: c.nextBlocker }));

  const input = 'text-sm border border-gray-200 rounded-lg px-2.5 py-2';
  const small = 'text-[11px] border border-gray-200 rounded px-1.5 py-1';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Claims</h2>
          <p className="text-sm text-gray-500 mt-1">
            From the first inspection to depreciation in hand{items.length ? ` · ${items.length} ${includeClosed ? 'claims' : 'open'}` : ''}
            <span className="hidden sm:inline"> · drag a card to move it, or use the arrows on the card</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
            Show closed
          </label>
          {attentionCount > 0 && (
            <button onClick={() => setAttentionOnly((v) => !v)} aria-pressed={attentionOnly}
              className={`px-3 py-1.5 text-sm rounded-lg border ${attentionOnly ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              title="Claims blocked on something, or with an overdue next action">
              ⚑ Needs attention · {attentionCount}
            </button>
          )}
          <button onClick={() => setShowNew((v) => !v)} className="px-3 py-1.5 text-sm bg-brand text-on-brand rounded-lg font-medium hover:bg-brand-dark">＋ New claim</button>
          <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>}

      {showNew && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">Open a new claim</p>
          <p className="text-xs text-gray-500">Starts at Inspect. Jobs already in a claim status in JobTread land here on their own every hour.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input value={nf.customerName} onChange={(e) => setNf({ ...nf, customerName: e.target.value })} placeholder="Customer name *" className={input} />
            <input value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} placeholder="(555) 555-5555" className={input} />
            <input value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="Email" className={input} />
            <input value={nf.carrier} onChange={(e) => setNf({ ...nf, carrier: e.target.value })} placeholder="Carrier (State Farm, Allstate…)" className={input} />
            <input value={nf.policyNumber} onChange={(e) => setNf({ ...nf, policyNumber: e.target.value })} placeholder="Policy number" className={input} />
            <input value={nf.claimNumber} onChange={(e) => setNf({ ...nf, claimNumber: e.target.value })} placeholder="Claim number" className={input} />
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">Date of loss</label>
              <input type="date" value={nf.dateOfLoss} onChange={(e) => setNf({ ...nf, dateOfLoss: e.target.value })} className={`w-full ${input}`} />
            </div>
            <input value={nf.jobtreadJobId} onChange={(e) => setNf({ ...nf, jobtreadJobId: e.target.value })} placeholder="JobTread job ID (optional)" className={input} />
            <select value={nf.nextActionOwner} onChange={(e) => setNf({ ...nf, nextActionOwner: e.target.value })} className={input} aria-label="Next action owner">
              {OWNERS.map((o) => <option key={o} value={o}>{ownerLabel(o)}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={createClaim} disabled={creating || !nf.customerName.trim()} className="px-3 py-1.5 text-sm bg-brand text-on-brand rounded-lg font-medium hover:bg-brand-dark disabled:opacity-50">
              {creating ? 'Creating…' : 'Create claim'}
            </button>
            <button onClick={() => { setShowNew(false); setNf(emptyForm); }} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3, 4, 5].map((c) => (
            <div key={c} className="flex-shrink-0 w-72 space-y-2">
              <div className="h-5 w-24 bg-gray-100 rounded animate-pulse" />
              {[0, 1].map((j) => <div key={j} className="h-24 bg-gray-100 rounded-lg border border-gray-200 animate-pulse" />)}
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-red-600 font-medium">Couldn't load claims</p>
          <p className="text-xs text-gray-500 mt-1">{error}</p>
          <button onClick={load} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
          No claims open right now. Tap "＋ New claim" to start one.
        </p>
      ) : (
        <PipelineBoard<Item>
          stages={stages}
          items={boardItems}
          busyId={busyId != null ? String(busyId) : null}
          onMove={(item, stage) => moveTo({ ...item, id: item.claimId }, stage)}
          width="w-80"
          renderCard={(c, colIdx) => {
            const claim: Claim = { ...c, id: c.claimId };
            const busy = busyId === c.claimId;
            const stuck = daysSince(c.stageEnteredAt);
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  {c.jobtreadJobId && onOpenClient ? (
                    <button onClick={() => onOpenClient(c.jobtreadJobId!)} className="font-medium text-sm text-blue-600 hover:underline truncate text-left">{c.customerName}</button>
                  ) : (
                    <p className="font-medium text-sm text-gray-900 truncate">{c.customerName}</p>
                  )}
                  {c.contact?.phone && (
                    <span className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className="text-[11px] text-gray-500 whitespace-nowrap">{formatPhone(c.contact.phone)}</span>
                      <ContactActions externalId={c.jobtreadJobId} phone={c.contact.phone} email={c.contact.email} size="xs" flash={flash} />
                    </span>
                  )}
                </div>
                {(c.carrier || c.claimNumber || (stuck != null && stuck > 0)) && (
                  <p className="text-xs text-gray-400 truncate">{[c.carrier, c.claimNumber && `#${c.claimNumber}`, stuck != null && stuck > 0 ? `${stuck}d in stage` : null].filter(Boolean).join(' · ')}</p>
                )}
                {(c.amounts?.rcv || c.amounts?.deductible) && (
                  <p className="mt-1 text-[11px] text-emerald-700">
                    {[c.amounts?.rcv && `RCV ${money(c.amounts.rcv)}`, c.amounts?.deductible && `Ded ${money(c.amounts.deductible)}`].filter(Boolean).join(' · ')}
                  </p>
                )}

                {(c.stage === 'inspection_report' || c.stage === 'adjuster_appt') && (
                  <button type="button" onClick={() => c.jobtreadJobId && onOpenClient?.(c.jobtreadJobId)}
                    className={`mt-1.5 text-[11px] px-1.5 py-0.5 rounded font-medium ${c.gates.inspectionReport ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}>
                    {c.gates.inspectionReport ? '✓ Inspection report generated' : c.jobtreadJobId ? '📄 Inspection report needed' : '📄 Link the JobTread job to generate the report'}
                  </button>
                )}

                {/* Disputing steps, in order */}
                {c.stage === 'disputing' && (
                  <div className="mt-1.5 space-y-0.5">
                    {c.disputeSteps.map((s, i) => {
                      const current = s.key === c.currentDisputeStep;
                      return (
                        <button key={s.key} type="button" disabled={busy} title={s.done ? 'Done — click to come back to this step' : current ? 'In progress' : 'Jump here'}
                          onClick={() => write(claim, () => api.post(`/api/claims/${c.claimId}/dispute-step`, { step: s.key }), `${c.customerName}: ${stepLabel(s.key)}`)}
                          className={`w-full text-left text-[11px] px-1.5 py-0.5 rounded ${s.done ? 'text-emerald-700 line-through' : current ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                          {s.done ? '✓' : `${i + 1}.`} {stepLabel(s.key)}
                        </button>
                      );
                    })}
                    {c.currentDisputeStep && (
                      <button type="button" disabled={busy} onClick={() => write(claim, () => api.post(`/api/claims/${c.claimId}/dispute-step`, {}), `${c.customerName}: ${stepLabel(c.currentDisputeStep!)} done`)}
                        className="mt-1 w-full text-[11px] px-2 py-1.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 disabled:opacity-50">
                        ✓ {stepLabel(c.currentDisputeStep)} done
                      </button>
                    )}
                  </div>
                )}

                <StageChecks defs={checks[c.stage] || []} checks={c.checks} busy={busy}
                  onToggle={(key, value) => write(claim, () => api.post(`/api/claims/${c.claimId}/check`, { key, value }), `${c.customerName}: ${checks[c.stage]?.find((x) => x.key === key)?.label || key}${value ? '' : ' (cleared)'}`)} />

                <div className={`mt-1.5 text-[11px] rounded px-1.5 py-1 ${c.stage !== 'closed' && isOverdue(c.nextActionDue) ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'}`}>
                  <span className="font-medium">{ownerLabel(c.nextActionOwner)}:</span> {c.nextAction}
                  {' · due '}{fmtDate(dueDay(c.nextActionDue))}
                </div>

                <MoveControls colIdx={colIdx} stages={stages} blocker={c.nextBlocker} busy={busy}
                  onBack={() => { const prev = stages[colIdx - 1]; if (prev) moveTo(claim, prev.key); }}
                  onAdvance={() => { const next = stages[colIdx + 1]; if (next) moveTo(claim, next.key); }}
                  lastLabel="Closed" />
                {c.jtStage && <p className="mt-1 text-[10px] text-gray-300 truncate" title="JobTread status">JT: {c.jtStage}</p>}

                {editId === c.claimId ? (
                  <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <input value={edit.carrier} onChange={(e) => setEdit({ ...edit, carrier: e.target.value })} placeholder="Carrier" className={small} />
                      <input value={edit.claimNumber} onChange={(e) => setEdit({ ...edit, claimNumber: e.target.value })} placeholder="Claim #" className={small} />
                      <input value={edit.policyNumber} onChange={(e) => setEdit({ ...edit, policyNumber: e.target.value })} placeholder="Policy #" className={small} />
                      <input type="date" value={edit.dateOfLoss} onChange={(e) => setEdit({ ...edit, dateOfLoss: e.target.value })} className={small} />
                      <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="Phone" className={small} />
                      <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} placeholder="Email" className={small} />
                      <input value={edit.jobtreadJobId} onChange={(e) => setEdit({ ...edit, jobtreadJobId: e.target.value })} placeholder="JobTread job ID" className={`${small} col-span-2`} />
                    </div>
                    <p className="text-[10px] text-gray-400 pt-1">Adjuster</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input value={edit.adjusterName} onChange={(e) => setEdit({ ...edit, adjusterName: e.target.value })} placeholder="Name" className={small} />
                      <input value={edit.adjusterPhone} onChange={(e) => setEdit({ ...edit, adjusterPhone: e.target.value })} placeholder="Phone" className={small} />
                      <input value={edit.adjusterEmail} onChange={(e) => setEdit({ ...edit, adjusterEmail: e.target.value })} placeholder="Email" className={small} />
                    </div>
                    <p className="text-[10px] text-gray-400 pt-1">Amounts ($)</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input value={edit.deductible} onChange={(e) => setEdit({ ...edit, deductible: e.target.value })} placeholder="Deductible" className={small} />
                      <input value={edit.acv} onChange={(e) => setEdit({ ...edit, acv: e.target.value })} placeholder="ACV" className={small} />
                      <input value={edit.rcv} onChange={(e) => setEdit({ ...edit, rcv: e.target.value })} placeholder="RCV" className={small} />
                      <input value={edit.firstCheck} onChange={(e) => setEdit({ ...edit, firstCheck: e.target.value })} placeholder="1st check" className={small} />
                      <input value={edit.supplements} onChange={(e) => setEdit({ ...edit, supplements: e.target.value })} placeholder="Supplements" className={small} />
                    </div>
                    <p className="text-[10px] text-gray-400 pt-1">Next action</p>
                    <input value={edit.nextAction} onChange={(e) => setEdit({ ...edit, nextAction: e.target.value })} placeholder="What happens next" className={`w-full ${small}`} />
                    <div className="grid grid-cols-2 gap-1.5">
                      <select value={edit.nextActionOwner} onChange={(e) => setEdit({ ...edit, nextActionOwner: e.target.value })} className={small}>
                        {ownerChoices(edit.nextActionOwner).map((o) => <option key={o} value={o}>{ownerLabel(o)}</option>)}
                      </select>
                      <input type="date" value={edit.nextActionDue} onChange={(e) => setEdit({ ...edit, nextActionDue: e.target.value })} className={small} />
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <button onClick={() => saveEdit(claim)} disabled={busy} className="text-[11px] px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50">Save</button>
                      <button onClick={() => setEditId(null)} className="text-[11px] px-2 py-1 rounded bg-gray-100 text-gray-600">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => startEdit(claim)} className="mt-1 text-[11px] py-1 px-2 -mx-2 rounded text-gray-400 hover:text-blue-600 hover:bg-gray-50">✎ Edit details</button>
                )}
              </>
            );
          }}
        />
      )}
    </div>
  );
}
