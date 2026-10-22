import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

/**
 * Triage for clients nobody owns.
 *
 * Suggestions come with the evidence behind them and are never applied
 * automatically — a wrong owner moves commission, and there are hundreds of
 * these, so every one is confirmed by a person.
 */

interface Rep { teamMemberId: number; repName: string; email: string; isFieldRep: boolean }
interface Person { teamMemberId: number; repName: string }
interface Suggestion {
  primary: Person | null;
  secondary: Person[];
  confidence: 'high' | 'medium' | 'low';
  source: string;
  reason: string;
}
interface Job {
  externalId: string;
  jobName: string | null;
  customerName: string;
  stage: string | null;
  address: string | null;
  suggestion: Suggestion;
}

const CONF: Record<string, { chip: string; label: string }> = {
  high: { chip: 'bg-emerald-100 text-emerald-700', label: 'Confident' },
  medium: { chip: 'bg-amber-100 text-amber-700', label: 'Check this' },
  low: { chip: 'bg-gray-100 text-gray-600', label: 'No evidence' },
};

export default function Assignments({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [counts, setCounts] = useState<{ total: number; active: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  // Per-job overrides before accepting.
  const [edit, setEdit] = useState<Record<string, { primary: number; secondary: number[] }>>({});

  const loadCounts = useCallback(async () => {
    try { setCounts(await api.get<{ total: number; active: number }>('/api/assignments/unassigned/count')); }
    catch { /* the flag is optional; the list below is the real content */ }
  }, []);

  const loadSuggestions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<{ jobs: Job[]; reps: Rep[] }>('/api/assignments/suggestions?limit=25');
      setJobs(r.jobs || []);
      setReps(r.reps || []);
    } catch (e: any) {
      setError(e?.message || 'Could not work out who owns these jobs.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const stateFor = (j: Job) => edit[j.externalId] || {
    primary: j.suggestion.primary?.teamMemberId ?? 0,
    secondary: j.suggestion.secondary.map((s) => s.teamMemberId),
  };

  const setPrimary = (j: Job, id: number) => {
    const cur = stateFor(j);
    setEdit((e) => ({ ...e, [j.externalId]: { primary: id, secondary: cur.secondary.filter((s) => s !== id) } }));
  };
  const toggleSecondary = (j: Job, id: number) => {
    const cur = stateFor(j);
    if (id === cur.primary) return; // the owner cannot also be the sharer
    setEdit((e) => ({
      ...e,
      [j.externalId]: {
        primary: cur.primary,
        secondary: cur.secondary.includes(id) ? cur.secondary.filter((s) => s !== id) : [...cur.secondary, id],
      },
    }));
  };

  const accept = async (j: Job) => {
    const st = stateFor(j);
    if (!st.primary) return;
    setBusy(j.externalId);
    try {
      await api.post('/api/assignments', {
        jobExternalId: j.externalId,
        primaryTeamMemberId: st.primary,
        secondaryTeamMemberIds: st.secondary,
        source: j.suggestion.source,
        confidence: j.suggestion.confidence,
        evidence: j.suggestion.reason,
      });
      const names = [st.primary, ...st.secondary]
        .map((id) => reps.find((r) => r.teamMemberId === id)?.repName)
        .filter(Boolean).join(' + ');
      setDone((d) => ({ ...d, [j.externalId]: names }));
      loadCounts();
    } catch (e: any) {
      setError(e?.message || 'Could not save that assignment.');
    } finally { setBusy(null); }
  };

  const pending = jobs.filter((j) => !done[j.externalId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Unassigned clients</h2>
          <p className="text-sm text-gray-500 mt-1">
            {counts
              ? <><span className="font-semibold text-red-600">{counts.active}</span> active {counts.active === 1 ? 'job has' : 'jobs have'} nobody on {counts.active === 1 ? 'it' : 'them'} · {counts.total} in total</>
              : 'Checking…'}
          </p>
        </div>
        <button onClick={loadSuggestions} disabled={loading}
          className="px-3 py-2 text-sm bg-brand text-on-brand rounded-lg font-medium hover:bg-brand-dark disabled:opacity-60">
          {loading ? 'Working out owners…' : jobs.length ? 'Reload suggestions' : 'Suggest owners'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {!jobs.length && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">
          <p className="font-medium text-gray-900">How this works</p>
          <p className="mt-1 text-gray-500">
            We read who has tasks on each JobTread job, who commented on it, and whose calendar the
            appointment landed on. A field rep on the job is the rep; if you're on it alone it's yours.
            Nothing is assigned until you accept it.
          </p>
          <p className="mt-3 text-gray-500">
            {/* This is a real JobTread read per job, so it's not run automatically on page
                load — tap "Suggest owners" above to work them out. */}
            {counts?.active ? `Tap "Suggest owners" above to work out who owns those ${counts.active} job${counts.active === 1 ? '' : 's'}.` : 'Tap "Suggest owners" above to check for unassigned jobs.'}
          </p>
        </div>
      )}

      {loading && (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      )}

      {pending.map((j) => {
        const st = stateFor(j);
        const conf = CONF[j.suggestion.confidence] || CONF.low;
        return (
          <div key={j.externalId} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button onClick={() => onOpenClient?.(j.externalId)}
                  className="text-sm font-semibold text-gray-900 hover:text-brand text-left truncate">
                  {j.jobName || j.customerName} <span className="text-blue-600">›</span>
                </button>
                <p className="text-xs text-gray-500 truncate">
                  {[j.customerName, j.address, j.stage].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${conf.chip}`}>{conf.label}</span>
            </div>

            <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-2">{j.suggestion.reason}</p>

            <div>
              <p className="text-xs text-gray-500 mb-1">Owner</p>
              <div className="flex flex-wrap gap-1.5">
                {reps.map((r) => (
                  <button key={r.teamMemberId} onClick={() => setPrimary(j, r.teamMemberId)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border ${
                      st.primary === r.teamMemberId
                        ? 'bg-brand text-on-brand border-brand'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {r.repName}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">Also on it (shared)</p>
              <div className="flex flex-wrap gap-1.5">
                {reps.filter((r) => r.teamMemberId !== st.primary).map((r) => (
                  <button key={r.teamMemberId} onClick={() => toggleSecondary(j, r.teamMemberId)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border ${
                      st.secondary.includes(r.teamMemberId)
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {st.secondary.includes(r.teamMemberId) ? '✓ ' : '+ '}{r.repName}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => accept(j)} disabled={!st.primary || busy === j.externalId}
                className="text-sm px-3 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">
                {busy === j.externalId ? 'Saving…' : 'Assign'}
              </button>
              <a href={`https://app.jobtread.com/jobs/${j.externalId}`} target="_blank" rel="noopener noreferrer"
                className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">
                JobTread ↗
              </a>
            </div>
          </div>
        );
      })}

      {Object.keys(done).length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <p className="text-sm font-medium text-emerald-800">Assigned this session</p>
          <ul className="mt-1 space-y-0.5">
            {Object.entries(done).map(([id, names]) => {
              const j = jobs.find((x) => x.externalId === id);
              return <li key={id} className="text-xs text-emerald-700">{j?.jobName || j?.customerName || id} → {names}</li>;
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
