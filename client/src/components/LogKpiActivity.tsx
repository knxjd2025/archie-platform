import { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface Member { id: number; name: string }

/**
 * Log a referral received, or a lead handed to a rep.
 *
 * Door knocks and reports are recorded automatically as they happen; these two
 * have no system event behind them, so someone types them in. A lead given is
 * attributed to the rep who RECEIVED it, which is what makes the column answer
 * "how many has the company given this person".
 */
export default function LogKpiActivity({ canPickRep, onLogged }: { canPickRep: boolean; onLogged: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'referral_received' | 'lead_given'>('referral_received');
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [teamMemberId, setTeamMemberId] = useState<string>('');
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repsError, setRepsError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !canPickRep || members.length) return;
    // /api/team/reps — anyone who sells, i.e. role=sales plus anyone mapped to a
    // JobTread sales-rep name (which includes the owner). Manager+ only, which
    // matches when this picker is shown.
    setRepsError(null);
    api.get<{ reps: Member[] }>('/api/team/reps')
      .then((r) => setMembers(r.reps || []))
      .catch(() => setRepsError('Couldn\'t load team list.'));
  }, [open, canPickRep, members.length]);

  const submit = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.post('/api/kpis/log', {
        type,
        count,
        note: note.trim() || undefined,
        teamMemberId: canPickRep && teamMemberId ? Number(teamMemberId) : undefined,
      });
      setMsg(`Logged ${count} ${type === 'referral_received' ? 'referral' : 'lead given'}${count > 1 ? 's' : ''}.`);
      setNote(''); setCount(1);
      onLogged();
    } catch (e: any) {
      setError(e?.message || 'Could not log that.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-xs px-2.5 py-1 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark">
        ＋ Log referral / lead given
      </button>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3 w-full sm:w-auto sm:min-w-[22rem]">
      <div className="flex gap-1.5">
        {([
          ['referral_received', '🤝 Referral received'],
          ['lead_given', '🎯 Lead given to rep'],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setType(k)} aria-pressed={type === k}
            className={`flex-1 text-xs px-2 py-1.5 rounded-lg border ${type === k ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {canPickRep && (
        <label className="block">
          <span className="text-xs text-gray-500">{type === 'lead_given' ? 'Given to' : 'Credit to'}</span>
          <select value={teamMemberId} onChange={(e) => setTeamMemberId(e.target.value)}
            className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5">
            <option value="">Me</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {repsError && <span className="block text-xs text-red-600 mt-0.5">{repsError}</span>}
        </label>
      )}

      <div className="flex gap-2">
        <label className="w-20">
          <span className="text-xs text-gray-500">How many</span>
          <input type="number" inputMode="numeric" min={1} max={50} value={count}
            onChange={(e) => setCount(Math.min(Math.max(Number(e.target.value) || 1, 1), 50))}
            className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
        </label>
        <label className="flex-1">
          <span className="text-xs text-gray-500">{type === 'referral_received' ? 'Referred by (optional)' : 'Note (optional)'}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
            placeholder={type === 'referral_received' ? 'e.g. Dakota, past customer' : 'e.g. storm canvass overflow'}
            className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
        </label>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {msg && <p className="text-xs text-emerald-700">{msg}</p>}

      <div className="flex gap-2">
        <button onClick={submit} disabled={busy}
          className="text-sm px-3 py-1.5 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50">
          {busy ? 'Saving…' : 'Log it'}
        </button>
        <button onClick={() => { setOpen(false); setMsg(null); setError(null); }}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Done</button>
      </div>
    </div>
  );
}
