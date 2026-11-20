import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CREW_WORDS, STATUS_CHIP, statusLabel, whenLine } from '../lib/crews-view';
import { CREW_STATUSES, MAX_CREW_NOTES, type CrewStatus } from '../../../shared/crews';

interface CrewOption { id: string; name: string; active: boolean; members: Array<{ id: number; name: string }> }
interface Install {
  crewId: string; installDate: string; endDate: string | null; startTime: string | null; notes: string | null; status: CrewStatus;
}

/**
 * A job's install: which crew, which day or days, when they start, and a note
 * for the crew. Shown to office staff and up, for a job Archie keeps, on the
 * job page and from a Production board card. The crew sees the note and the
 * dates on their phone, and never a price, so this box asks for none.
 */
export default function InstallBooking({ jobKey, onSaved, compact = false }: { jobKey: string; onSaved?: () => void; compact?: boolean }) {
  const [crews, setCrews] = useState<CrewOption[] | null>(null);
  const [install, setInstall] = useState<Install | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [crewId, setCrewId] = useState('');
  const [installDate, setInstallDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const fill = (i: Install | null) => {
    setInstall(i);
    setCrewId(i?.crewId ?? '');
    setInstallDate(i?.installDate ?? '');
    setEndDate(i?.endDate ?? '');
    setStartTime(i?.startTime ?? '');
    setNotes(i?.notes ?? '');
  };

  useEffect(() => {
    let live = true;
    setLoadError(null);
    Promise.all([api.get<{ crews: CrewOption[] }>('/api/crews'), api.get<{ install: Install | null }>(`/api/jobs/${jobKey}/install`)])
      .then(([c, i]) => { if (!live) return; setCrews(c.crews); fill(i.install); })
      .catch((e: any) => { if (live) setLoadError(e?.message || 'Couldn\'t load the install.'); });
    return () => { live = false; };
  }, [jobKey]);

  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      const r = await api.put<{ install: Install }>(`/api/jobs/${jobKey}/install`, { crewId, installDate, endDate: endDate || null, startTime: startTime || null, notes });
      fill(r.install);
      setMessage({ ok: true, text: CREW_WORDS.saveDone });
      onSaved?.();
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Couldn\'t save the install.' });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(CREW_WORDS.clearCheck)) return;
    setBusy(true); setMessage(null);
    try {
      await api.delete(`/api/jobs/${jobKey}/install`);
      fill(null);
      setMessage({ ok: true, text: CREW_WORDS.cleared });
      onSaved?.();
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Couldn\'t take it off the schedule.' });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: CrewStatus) => {
    setBusy(true); setMessage(null);
    try {
      const r = await api.post<{ install: Install }>(`/api/jobs/${jobKey}/install/status`, { status });
      fill(r.install);
      onSaved?.();
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Couldn\'t change it.' });
    } finally {
      setBusy(false);
    }
  };

  const active = (crews ?? []).filter((c) => c.active || c.id === install?.crewId);
  const field = 'w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-400';

  return (
    <div className={compact ? '' : 'bg-white rounded-xl border border-gray-200 p-4'}>
      {!compact && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-800">{CREW_WORDS.install}</h3>
          {install && <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_CHIP[install.status]}`}>{statusLabel(install.status)}</span>}
        </div>
      )}
      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : !crews ? (
        <div className="h-20 bg-gray-50 rounded animate-pulse" />
      ) : active.length === 0 ? (
        <p className="text-sm text-gray-500">{CREW_WORDS.noCrews}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{install ? whenLine(install) : CREW_WORDS.noInstall}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-xs text-gray-600">Crew
              <select value={crewId} onChange={(e) => setCrewId(e.target.value)} className={field} disabled={busy}>
                <option value="">Pick a crew</option>
                {active.map((c) => <option key={c.id} value={c.id}>{c.name}{c.members.length ? ` (${c.members.length})` : ''}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">First day
              <input type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} className={field} disabled={busy} />
            </label>
            <label className="text-xs text-gray-600">Last day <span className="text-gray-400">(optional)</span>
              <input type="date" value={endDate} min={installDate || undefined} onChange={(e) => setEndDate(e.target.value)} className={field} disabled={busy} />
            </label>
            <label className="text-xs text-gray-600">Start time <span className="text-gray-400">(optional)</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={field} disabled={busy} />
            </label>
            <label className="col-span-2 text-xs text-gray-600">Note for the crew <span className="text-gray-400">(no prices: the crew sees this)</span>
              <textarea value={notes} maxLength={MAX_CREW_NOTES} rows={2} onChange={(e) => setNotes(e.target.value)} className={field} disabled={busy}
                placeholder="What to do, where to park, gate code" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={busy || !crewId || !installDate} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-50">
              {busy ? CREW_WORDS.saving : CREW_WORDS.save}
            </button>
            {install?.status === 'scheduled' && (
              <button onClick={clear} disabled={busy} className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-700 disabled:opacity-50">{CREW_WORDS.clear}</button>
            )}
            {install && (
              <label className="ml-auto text-xs text-gray-600 flex items-center gap-1">Status
                <select value={install.status} onChange={(e) => setStatus(e.target.value as CrewStatus)} disabled={busy} className="text-xs border border-gray-200 rounded px-1 py-1">
                  {CREW_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
              </label>
            )}
          </div>
          {message && <p className={`text-xs ${message.ok ? 'text-emerald-700' : 'text-red-600'}`} role="status">{message.text}</p>}
        </div>
      )}
    </div>
  );
}
