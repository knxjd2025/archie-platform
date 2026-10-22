/**
 * Who sells this job, on the client page — and, for a sales leader or admin,
 * the control to change the primary rep or add/remove shared reps at any time,
 * not only while the job is unassigned. Same rules as the Leads list:
 * one primary plus up to two shared.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { atLeast } from '../../../shared/rbac';

interface Rep { id: number; name: string; jobtreadSalesRep?: string | null }
interface Assignment { teamMemberId: number; role: string; name: string | null }

const MAX_SHARED = 2;

interface Props {
  externalId: string;
  repName: string | null;
  enteredByName: string | null;
  onChanged: (primaryName: string | null) => void;
  flash: (m: string) => void;
}

export default function JobReps({ externalId, repName, enteredByName, onChanged, flash }: Props) {
  const { user } = useAuth();
  const canEdit = !!user && atLeast(user.role, 'manager');
  const [current, setCurrent] = useState<Assignment[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [editing, setEditing] = useState(false);
  const [primary, setPrimary] = useState('');
  const [shared, setShared] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const loadCurrent = () => {
    if (!canEdit) return;
    api.get<{ assignments: Assignment[] }>(`/api/assignments/${externalId}`)
      .then((r) => setCurrent(r.assignments || []))
      .catch(() => setCurrent([]));
  };
  useEffect(loadCurrent, [externalId, canEdit]);

  const startEdit = async () => {
    let list = reps;
    try {
      if (!list.length) { list = (await api.get<{ reps: Rep[] }>('/api/team/reps')).reps || []; setReps(list); }
    } catch (e: any) { flash(`Couldn't load the rep list: ${e?.message || 'failed'}`); return; }
    // No assignment yet means the rep came from JobTread's Sales Rep field —
    // start from that person rather than a blank picker.
    const p = current.find((a) => a.role === 'primary');
    const wanted = (repName || '').trim().toLowerCase();
    const fromJobTread = wanted ? list.find((r) => r.name.trim().toLowerCase() === wanted || (r.jobtreadSalesRep || '').trim().toLowerCase() === wanted) : undefined;
    setPrimary(p ? String(p.teamMemberId) : fromJobTread ? String(fromJobTread.id) : '');
    setShared(current.filter((a) => a.role === 'secondary').map((a) => String(a.teamMemberId)));
    setEditing(true);
  };

  const toggleShared = (id: string) => setShared((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (prev.length >= MAX_SHARED) { flash(`Up to ${MAX_SHARED} shared reps, besides the primary.`); return prev; }
    return [...prev, id];
  });

  const save = async () => {
    if (!primary) { flash('Pick the primary rep first.'); return; }
    setSaving(true);
    try {
      await api.post('/api/assignments', {
        jobExternalId: externalId,
        primaryTeamMemberId: Number(primary),
        secondaryTeamMemberIds: shared.filter((s) => s !== primary).map(Number),
      });
      const name = reps.find((r) => String(r.id) === primary)?.name ?? null;
      onChanged(name);
      flash('Reps saved ✅');
      setEditing(false);
      loadCurrent();
    } catch (e: any) { flash(`Couldn't save reps: ${e?.message || 'failed'}`); }
    finally { setSaving(false); }
  };

  const sharedNames = current.filter((a) => a.role === 'secondary').map((a) => a.name).filter(Boolean);

  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">Sales Rep</p>
      <p className="text-sm text-gray-800">{repName || '—'}</p>
      {sharedNames.length > 0 && <p className="text-xs text-gray-500 mt-0.5">Shared with {sharedNames.join(', ')}</p>}
      {enteredByName && enteredByName.trim().toLowerCase() !== (repName || '').trim().toLowerCase() && (
        <p className="text-xs text-gray-400 mt-0.5">Entered by {enteredByName}</p>
      )}
      {canEdit && !editing && (
        <button onClick={startEdit} className="text-xs text-blue-600 hover:underline mt-1">{repName ? 'Change / add reps' : 'Assign rep'}</button>
      )}
      {editing && (
        <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <label className="block text-xs text-gray-600">
            Primary (commission + their book)
            <select value={primary} onChange={(e) => { setPrimary(e.target.value); setShared((s) => s.filter((x) => x !== e.target.value)); }} className="mt-1 w-full text-sm border border-gray-200 rounded px-2 py-1 bg-white">
              <option value="">Choose a rep…</option>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <div className="text-xs text-gray-600">
            Shared with (up to {MAX_SHARED})
            <div className="mt-1 flex flex-wrap gap-1">
              {reps.filter((r) => String(r.id) !== primary).map((r) => {
                const on = shared.includes(String(r.id));
                return (
                  <button key={r.id} onClick={() => toggleShared(String(r.id))} aria-pressed={on} className={`px-2 py-1 rounded-full border ${on ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                    {on ? '✓ ' : ''}{r.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !primary} className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(false)} disabled={saving} className="text-xs px-3 py-1.5 rounded border border-gray-200 bg-white text-gray-600">Cancel</button>
          </div>
          <p className="text-[11px] text-gray-400">Also updates the Sales Rep in JobTread. An existing commission record keeps its reps — adjust those in the commission box below.</p>
        </div>
      )}
    </div>
  );
}
