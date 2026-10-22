import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';

export interface FollowUp {
  id: number;
  jobExternalId: string | null;
  clientName: string | null;
  note: string;
  dueDate: string | null;
  assigneeName: string | null;
  done: boolean;
  overdue?: boolean;
  dueToday?: boolean;
}

// Follow-up reminders for one client, shown on the client detail page.
export default function FollowUps({ jobExternalId, clientName }: { jobExternalId: string; clientName?: string | null }) {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const flashError = (m: string) => { setOpError(m); setTimeout(() => setOpError(null), 4000); };

  const load = () => {
    setLoading(true);
    api.get<{ followUps: FollowUp[] }>(`/api/follow-ups?jobExternalId=${encodeURIComponent(jobExternalId)}`)
      .then((r) => { setItems(r.followUps || []); setLoadError(null); })
      // Swallowing this showed "no follow-ups" for a client who has them —
      // the one state that makes a rep stop chasing a deal.
      .catch((e: any) => setLoadError(e?.message || 'Could not load follow-ups.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [jobExternalId]);

  const add = async () => {
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      await api.post('/api/follow-ups', { jobExternalId, clientName, note: note.trim(), dueDate: due || null });
      setNote(''); setDue(''); setOpError(null); load();
    } catch (e: any) { flashError(e?.message || "Couldn't add that follow-up — try again."); } finally { setBusy(false); }
  };
  const toggle = async (f: FollowUp) => {
    setItems((xs) => xs.map((x) => (x.id === f.id ? { ...x, done: !x.done } : x))); // optimistic
    try { await api.post(`/api/follow-ups/${f.id}/done`, { done: !f.done }); setOpError(null); } catch { flashError("Couldn't save that — reloaded."); load(); }
  };

  const open = items.filter((f) => !f.done);
  const done = items.filter((f) => f.done);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-800">🔔 Follow-ups</h3></div>
      <div className="p-3 border-b border-gray-100 flex flex-col sm:flex-row gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Add a follow-up… (e.g. call back about the estimate)"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400"
        />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-600 focus:ring-1 focus:ring-blue-400" />
        <button onClick={add} disabled={busy || !note.trim()} className="text-sm px-3 py-2 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50">{busy ? 'Adding…' : 'Add'}</button>
      </div>
      {opError && <p className="px-4 pt-2 -mb-1 text-xs text-red-600">{opError}</p>}
      {loading ? (
        <div className="p-3 space-y-2">{[0, 1].map((i) => <div key={i} className="h-8 bg-gray-50 rounded animate-pulse" />)}</div>
      ) : loadError ? (
        <div className="px-4 py-5 text-center">
          <p className="text-sm text-red-600">Couldn't load follow-ups</p>
          <p className="text-xs text-gray-500 mt-0.5">{loadError}</p>
          <button onClick={load} className="mt-2 text-xs px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200">Retry</button>
        </div>
      ) : open.length === 0 && done.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">No follow-ups yet. Add one so this client doesn't slip.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {[...open, ...done].map((f) => (
            <div key={f.id} className="flex items-start gap-3 px-4 py-2.5">
              <button onClick={() => toggle(f)} aria-label={f.done ? 'Reopen' : 'Mark done'} className="p-3 -m-3 flex-shrink-0 flex items-center justify-center">
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${f.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 hover:border-emerald-400'}`}>{f.done ? '✓' : ''}</span>
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${f.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{f.note}</p>
                {f.dueDate && !f.done && (
                  <p className={`text-xs ${f.overdue ? 'text-brick font-medium' : f.dueToday ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                    {f.overdue ? 'Overdue · ' : f.dueToday ? 'Due today · ' : 'Due '}{fmtDate(f.dueDate)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
