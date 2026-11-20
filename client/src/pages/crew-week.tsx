import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import InstallBooking from '../components/InstallBooking';
import { CREW_WORDS, STATUS_CHIP, installsOn, statusLabel, type WeekInstall } from '../lib/crews-view';
import { addDays, installDayLabel, startTimeLabel } from '../../../shared/crews';

interface WeekCrew { id: string; name: string; color: string | null; active: boolean; people: number }
interface Unbooked { jobKey: string; customer: string | null; jobName: string | null; city: string | null; stage: string }
interface WeekResponse { weekStart: string; days: string[]; today: string; crews: WeekCrew[]; installs: WeekInstall[]; unbooked: Unbooked[] }
interface CrewFull { id: string; name: string; color: string | null; active: boolean; members: Array<{ id: number; name: string }> }
interface Person { id: number; name: string; crewId: string | null }

/**
 * The crew week: one row per crew, one column per day (Monday to Sunday, the
 * company's own dates), each install on every day it covers. Below it, the
 * jobs on the production board still waiting for an install, and the crews
 * themselves. Names, towns and dates only: no price, no map pin.
 */
export default function CrewWeek({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<WeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookFor, setBookFor] = useState<string | null>(null);

  const load = async (w: string | null = week) => {
    setError(null);
    try {
      setData(await api.get<WeekResponse>(`/api/crews/week${w ? `?week=${w}` : ''}`));
    } catch (e: any) {
      setError(e?.message || 'Couldn\'t load the crew week.');
    }
  };
  useEffect(() => { load(week); }, [week]);

  const shift = (n: number) => data && setWeek(addDays(data.weekStart, n * 7));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{CREW_WORDS.week}</h3>
          {data && <p className="text-xs text-gray-500">{installDayLabel(data.days[0])} to {installDayLabel(data.days[6])}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200" aria-label="Last week">←</button>
          <button onClick={() => setWeek(null)} className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200">This week</button>
          <button onClick={() => shift(1)} className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200" aria-label="Next week">→</button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !data ? (
        <div className="h-40 bg-gray-100 rounded-xl animate-pulse" />
      ) : data.crews.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500 bg-white rounded-xl border border-gray-200">{CREW_WORDS.noCrews}</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
          <table className="min-w-[760px] w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="text-left font-medium px-3 py-2 w-32">Crew</th>
                {data.days.map((d) => (
                  <th key={d} className={`text-left font-medium px-2 py-2 ${d === data.today ? 'text-blue-700' : ''}`}>{installDayLabel(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.crews.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: c.color || '#94a3b8' }} aria-hidden />
                    <span className="font-medium text-gray-800">{c.name}</span>
                    <span className="block text-[11px] text-gray-400">{c.people} {c.people === 1 ? 'person' : 'people'}{c.active ? '' : ' · switched off'}</span>
                  </td>
                  {data.days.map((d) => (
                    <td key={d} className={`px-1.5 py-1.5 ${d === data.today ? 'bg-blue-50/40' : ''}`}>
                      {installsOn(data.installs, c.id, d).map((i) => (
                        <button key={i.id} onClick={() => onOpenClient?.(i.jobKey)}
                          className="block w-full text-left mb-1 rounded-md border border-gray-200 px-1.5 py-1 hover:bg-gray-50">
                          <span className="block font-medium text-gray-800 truncate">{i.customer || i.jobName || 'Job'}</span>
                          <span className="block text-[11px] text-gray-500 truncate">{[i.city, startTimeLabel(i.startTime)].filter(Boolean).join(' · ')}</span>
                          <span className={`inline-block mt-0.5 text-[10px] px-1.5 rounded-full ${STATUS_CHIP[i.status]}`}>{statusLabel(i.status)}</span>
                        </button>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">{CREW_WORDS.unbooked}</h4>
          {data.unbooked.length === 0 ? (
            <p className="text-sm text-gray-500">{CREW_WORDS.noUnbooked}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.unbooked.map((u) => (
                <li key={u.jobKey} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => onOpenClient?.(u.jobKey)} className="text-sm text-blue-600 hover:underline truncate text-left">
                      {u.customer || u.jobName || 'Job'}{u.city ? <span className="text-gray-400"> · {u.city}</span> : null}
                    </button>
                    <button onClick={() => setBookFor(bookFor === u.jobKey ? null : u.jobKey)} className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {CREW_WORDS.book}
                    </button>
                  </div>
                  {bookFor === u.jobKey && (
                    <div className="mt-2 p-3 rounded-lg bg-gray-50 border border-gray-200">
                      <InstallBooking jobKey={u.jobKey} compact onSaved={() => { setBookFor(null); load(); }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <CrewSetup onChanged={() => load()} />
    </div>
  );
}

/** Make crews and choose who is on each. Only people on the Production role can be on one. */
function CrewSetup({ onChanged }: { onChanged: () => void }) {
  const [crews, setCrews] = useState<CrewFull[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    try {
      const r = await api.get<{ crews: CrewFull[]; people: Person[] }>('/api/crews');
      setCrews(r.crews); setPeople(r.people);
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Couldn\'t load the crews.' });
    }
  };
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: done });
      await load(); onChanged();
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'That didn\'t save. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (crew: CrewFull, personId: number) => {
    const on = crew.members.some((m) => m.id === personId);
    const ids = on ? crew.members.filter((m) => m.id !== personId).map((m) => m.id) : [...crew.members.map((m) => m.id), personId];
    return run(() => api.put(`/api/crews/${crew.id}/members`, { memberIds: ids }), 'Crew updated');
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-gray-800">{CREW_WORDS.crews}</h4>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(() => api.post('/api/crews', { name }), 'Crew made').then(() => setName('')); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Crew name, like Red crew"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5" disabled={busy} />
        <button type="submit" disabled={busy || !name.trim()} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-50">{CREW_WORDS.newCrew}</button>
      </form>
      {message && <p className={`text-xs ${message.ok ? 'text-emerald-700' : 'text-red-600'}`} role="status">{message.text}</p>}
      {crews && people.length === 0 && <p className="text-xs text-gray-500">{CREW_WORDS.noPeople}</p>}
      {crews?.map((c) => (
        <div key={c.id} className={`rounded-lg border border-gray-200 p-3 ${c.active ? '' : 'opacity-60'}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-800">{c.name}{c.active ? '' : ' (switched off)'}</p>
            <button disabled={busy} onClick={() => run(() => api.patch(`/api/crews/${c.id}`, { active: !c.active }), c.active ? 'Crew switched off' : 'Crew switched on')}
              className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">{c.active ? 'Switch off' : 'Switch on'}</button>
          </div>
          {people.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {people.map((p) => (
                <label key={p.id} className="text-xs flex items-center gap-1">
                  <input type="checkbox" disabled={busy || !c.active} checked={c.members.some((m) => m.id === p.id)} onChange={() => toggle(c, p.id)} />
                  {p.name}
                  {p.crewId && p.crewId !== c.id && <span className="text-gray-400">(on {crews.find((x) => x.id === p.crewId)?.name || 'another crew'})</span>}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
