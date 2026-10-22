import { useMemo, useState } from 'react';
import {
  COMMISSION_LINE_DOC_TYPE, hasDoc, isAdjusted, sourcesTotal,
  type CommissionLine, type CommissionSource,
} from '../../../shared/job-commission';

export interface CommissionDoc {
  id: string;
  name: string;
  number?: string;
  status: string;
  /** The money the document represents: its price if a customer document, its cost if a vendor one. */
  amount: number;
  issueDate?: string;
  type: string;
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const isApproved = (status: string) => /approved|signed|accepted|paid/i.test(status);

/**
 * One money line on a commission record — revenue, material, labor or other.
 *
 * It can be a plain typed figure, which is all a simple job needs, or a stack
 * of pieces: purchase orders from two suppliers, work orders from two crews,
 * plus anything that only exists on paper and has to be typed. Once a line has
 * pieces its total is their sum, so the figure on screen is arithmetic anyone
 * can check rather than a number somebody added up in their head.
 */
export default function CommissionMoneyLine({
  line, label, typed, onTyped, sources, onSources, documents, docsState, onNeedDocs, editable, by,
}: {
  line: CommissionLine;
  label: string;
  typed: string;
  onTyped: (v: string) => void;
  sources: CommissionSource[];
  onSources: (next: CommissionSource[]) => void;
  documents: CommissionDoc[];
  docsState: 'idle' | 'loading' | 'ready' | 'error' | 'none';
  onNeedDocs: () => void;
  editable: boolean;
  by: string;
}) {
  const [picking, setPicking] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [manual, setManual] = useState<{ label: string; amount: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string; amount: string } | null>(null);

  const itemised = sources.length > 0;
  const total = itemised ? sourcesTotal(sources) : Number(typed) || 0;
  const wantType = COMMISSION_LINE_DOC_TYPE[line];

  const candidates = useMemo(() => {
    const list = showAllDocs ? documents : documents.filter((d) => !d.type || d.type === wantType);
    // The document most likely wanted is the approved one, then the newest.
    return [...list].sort((a, b) => {
      if (isApproved(a.status) !== isApproved(b.status)) return isApproved(a.status) ? -1 : 1;
      return (b.issueDate || '').localeCompare(a.issueDate || '');
    });
  }, [documents, showAllDocs, wantType]);

  const openPicker = () => { setPicking(true); onNeedDocs(); };

  const addDoc = (d: CommissionDoc) => {
    onSources([...sources, {
      id: newId(), kind: 'doc',
      label: d.number ? `${d.name} #${d.number}` : d.name,
      amount: Math.round((Number(d.amount) || 0) * 100) / 100,
      docId: d.id, docNumber: d.number ?? null, docStatus: d.status || null,
      // Kept so a corrected figure can be shown against what the document said.
      docAmount: Math.round((Number(d.amount) || 0) * 100) / 100,
      addedBy: by, addedAt: new Date().toISOString(),
    }]);
    setPicking(false);
  };

  const commitEdit = () => {
    if (!editing) return;
    const amount = Number(editing.amount);
    if (!Number.isFinite(amount) || amount < 0) return;
    onSources(sources.map((s) => s.id !== editing.id ? s : {
      ...s,
      label: editing.label.trim() || s.label,
      amount: Math.round(amount * 100) / 100,
      editedBy: by, editedAt: new Date().toISOString(),
    }));
    setEditing(null);
  };

  const commitManual = () => {
    if (!manual) return;
    const amount = Number(manual.amount);
    if (!Number.isFinite(amount) || amount < 0) return;
    onSources([...sources, {
      id: newId(), kind: 'manual',
      label: manual.label.trim() || 'Manual amount',
      amount: Math.round(amount * 100) / 100,
      addedBy: by, addedAt: new Date().toISOString(),
    }]);
    setManual(null);
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-gray-600">
          {label} <span className="font-normal text-gray-400">(admin)</span>
        </span>
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{money(total)}</span>
      </div>

      {itemised ? (
        <ul className="mt-2 divide-y divide-gray-100">
          {sources.map((s) => editing?.id === s.id ? (
            <li key={s.id} className="py-2">
              <div className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-lg p-2">
                <label className="flex-1 min-w-[10rem]">
                  <span className="block text-[11px] text-gray-500 mb-0.5">What is it?</span>
                  <input autoFocus value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                </label>
                <label className="w-28">
                  <span className="block text-[11px] text-gray-500 mb-0.5">Amount</span>
                  <input type="number" inputMode="decimal" step="0.01" min="0" value={editing.amount}
                    onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                </label>
                <button type="button" onClick={commitEdit} disabled={editing.amount === '' || !(Number(editing.amount) >= 0)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-navy text-white font-medium disabled:opacity-40">Save</button>
                <button type="button" onClick={() => setEditing(null)} className="text-xs px-2 py-1.5 text-gray-500">Cancel</button>
              </div>
              {s.kind === 'doc' && s.docAmount != null && (
                <p className="text-[11px] text-gray-400 mt-1">The document says {money(s.docAmount)}.</p>
              )}
            </li>
          ) : (
            <li key={s.id} className="flex items-center gap-2 py-1.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${s.kind === 'doc' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                {s.kind === 'doc' ? 'JobTread' : 'Manual'}
              </span>
              <span className="text-sm text-gray-700 flex-1 min-w-0 break-words">
                {s.label}
                {s.docStatus && <span className="ml-1 text-[11px] text-gray-400">· {s.docStatus}</span>}
                {isAdjusted(s) && (
                  <span className="block text-[11px] text-amber-700">
                    Changed by hand — the document says {money(s.docAmount as number)}
                  </span>
                )}
              </span>
              <span className="text-sm text-gray-900 tabular-nums flex-shrink-0">{money(s.amount)}</span>
              {editable && (
                <>
                  <button type="button" aria-label={`Edit ${s.label}`}
                    onClick={() => setEditing({ id: s.id, label: s.label, amount: String(s.amount) })}
                    className="text-gray-400 hover:text-blue-600 text-xs px-1 flex-shrink-0">Edit</button>
                  <button type="button" aria-label={`Remove ${s.label}`} onClick={() => onSources(sources.filter((x) => x.id !== s.id))}
                    className="text-gray-400 hover:text-red-600 text-sm px-1 flex-shrink-0">×</button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : editable ? (
        <input type="number" inputMode="decimal" value={typed} onChange={(e) => onTyped(e.target.value)} step="0.01" min="0" placeholder="0.00"
          aria-label={label}
          className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400" />
      ) : null}

      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={openPicker}
            className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">
            ＋ Add document
          </button>
          <button type="button" onClick={() => setManual({ label: '', amount: '' })}
            className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">
            ＋ Add amount
          </button>
          {itemised && (
            <span className="text-[11px] text-gray-400">{sources.length} item{sources.length === 1 ? '' : 's'} — the total above is their sum</span>
          )}
        </div>
      )}

      {manual && (
        <div className="mt-2 flex flex-wrap items-end gap-2 bg-gray-50 rounded-lg p-2">
          <label className="flex-1 min-w-[10rem]">
            <span className="block text-[11px] text-gray-500 mb-0.5">What is it?</span>
            <input autoFocus value={manual.label} onChange={(e) => setManual({ ...manual, label: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') commitManual(); if (e.key === 'Escape') setManual(null); }}
              placeholder="e.g. Crew B — cash" className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
          </label>
          <label className="w-28">
            <span className="block text-[11px] text-gray-500 mb-0.5">Amount</span>
            <input type="number" inputMode="decimal" step="0.01" min="0" value={manual.amount}
              onChange={(e) => setManual({ ...manual, amount: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') commitManual(); if (e.key === 'Escape') setManual(null); }}
              placeholder="0.00" className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
          </label>
          <button type="button" onClick={commitManual} disabled={!(Number(manual.amount) >= 0) || manual.amount === ''}
            className="text-xs px-3 py-1.5 rounded-lg bg-navy text-white font-medium disabled:opacity-40">Add</button>
          <button type="button" onClick={() => setManual(null)} className="text-xs px-2 py-1.5 text-gray-500">Cancel</button>
        </div>
      )}

      {picking && (
        <div className="mt-2 border border-gray-200 rounded-lg bg-white">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-600">
              {wantType === 'customerOrder' ? 'Customer documents' : 'Purchase and work orders'}
            </span>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500 flex items-center gap-1">
                <input type="checkbox" checked={showAllDocs} onChange={(e) => setShowAllDocs(e.target.checked)} />
                Show all
              </label>
              <button type="button" onClick={() => setPicking(false)} className="text-gray-400 hover:text-gray-700 text-sm">×</button>
            </div>
          </div>
          <div className="max-h-60 overflow-auto">
            {docsState === 'loading' && <p className="px-3 py-3 text-xs text-gray-400">Reading the job's documents…</p>}
            {docsState === 'error' && <p className="px-3 py-3 text-xs text-red-600">Couldn't reach JobTread. Add the amount by hand instead.</p>}
            {docsState === 'none' && <p className="px-3 py-3 text-xs text-gray-500">This job isn't in JobTread, so there are no documents to pick. Add the amount by hand.</p>}
            {docsState === 'ready' && !candidates.length && (
              <p className="px-3 py-3 text-xs text-gray-500">
                No {wantType === 'customerOrder' ? 'customer documents' : 'purchase or work orders'} on this job yet.
                {!showAllDocs && ' Tick “Show all” to see every document.'}
              </p>
            )}
            {candidates.map((d) => {
              const already = hasDoc(sources, d.id);
              // A work order and the bill that follows it carry the same money.
              // Offering both without a word is how a line gets counted twice.
              const twin = !already && d.amount > 0 && sources.find((s) => Math.abs(s.amount - d.amount) < 0.005);
              return (
                <button key={d.id} type="button" disabled={already} onClick={() => addDoc(d)}
                  className="w-full text-left px-3 py-2 border-b border-gray-50 last:border-0 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-gray-800 break-words">
                      {d.name}{d.number ? ` #${d.number}` : ''}
                    </span>
                    <span className="block text-[11px] text-gray-400">
                      {d.status || 'no status'}{d.issueDate ? ` · ${d.issueDate.slice(0, 10)}` : ''}
                      {isApproved(d.status) ? ' · approved' : ''}
                      {already ? ' · already added' : ''}
                    </span>
                    {twin && (
                      <span className="block text-[11px] text-amber-700">
                        Same amount as “{twin.label}” already on this line — check you aren't counting it twice
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-gray-900 tabular-nums flex-shrink-0">{money(d.amount)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
