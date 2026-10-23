import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { MeetingBar } from '../components/MeetingBar';
import { useAuth } from '../lib/auth';
import {
  type MeetingAction, type MeetingDef, type MeetingKey, type MeetingPack, type MeetingSection,
  agendaMinutes, meetingDayLabel, meetingMinutes, meetingTime, mondayFor,
} from '../../../shared/monday-meetings';

interface Payload { pack: MeetingPack; meetings: MeetingDef[]; generated: boolean }

const input = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-blue-400';

/** A number, and which way it moved. */
function MetricCard({ m }: { m: MeetingSection['metrics'] extends (infer T)[] | undefined ? T : never }) {
  const arrow = m.better === null || m.better === undefined ? null : m.better ? '▲' : '▼';
  const tone = m.better === null || m.better === undefined ? 'text-gray-400' : m.better ? 'text-emerald-600' : 'text-red-600';
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{m.label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-0.5 tabular-nums">{m.value}</p>
      {m.previous !== undefined && (
        <p className={`text-xs mt-0.5 ${tone}`}>
          {arrow} <span className="text-gray-500">was {m.previous}</span>
        </p>
      )}
      {m.hint && <p className="text-[11px] text-gray-400 mt-1">{m.hint}</p>}
    </div>
  );
}

function Section({ s, onOpen }: { s: MeetingSection; onOpen: (page: string) => void }) {
  const isEmpty = !s.metrics?.length && !s.attention?.length && !s.rows?.length;
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-800 mb-2">{s.heading}</h3>

      {isEmpty && s.empty && (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{s.empty}</p>
      )}

      {!!s.metrics?.length && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-2">
          {s.metrics.map((m, i) => <MetricCard key={i} m={m} />)}
        </div>
      )}

      {!!s.attention?.length && (
        <ul className="space-y-1.5">
          {s.attention.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <span aria-hidden>→</span>
              <span className="flex-1 text-amber-900">{a.text}</span>
              {a.page && (
                <button onClick={() => onOpen(a.page!)} className="text-xs text-blue-700 underline whitespace-nowrap">
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!!s.rows?.length && (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-50 overflow-hidden">
          {s.rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 px-3.5 py-2">
              <span className="text-sm text-gray-800 min-w-0 truncate">{r.label}</span>
              <span className="text-sm font-medium text-gray-900 tabular-nums whitespace-nowrap">{r.value}</span>
              {r.note && <span className="text-[11px] text-gray-400 whitespace-nowrap hidden sm:block">{r.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Meetings.
 *
 * The week's meetings, each with the numbers its room argues about and
 * the handful of things that need deciding. Built on Sunday evening so it is
 * on screen when people sit down, and what gets agreed is written here — open
 * items lead next week's pack rather than being remembered or not.
 */
export default function Meetings({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth();
  const [state, setState] = useState<Payload | null>(null);
  const [tab, setTab] = useState<MeetingKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');

  const monday = useMemo(() => mondayFor(new Date()), []);
  const isAdmin = user?.role === 'admin' || user?.role === 'sales_director';

  const load = () => {
    setLoading(true);
    api.get<Payload>('/api/meetings')
      .then((r) => {
        setState(r);
        setTab((t) => t ?? r.meetings[0]?.key ?? null);
        setError(null);
      })
      .catch((e: any) => setError(e?.message || 'Could not load the meeting pack.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Notes follow the tab, so switching rooms does not carry one room's notes
  // into another's box. Only on a tab change (or the first load that has the
  // tab): every action reloads state, and re-syncing then wiped whatever was
  // typed into the box but not saved yet.
  const notesTab = useRef<MeetingKey | null>(null);
  useEffect(() => {
    if (!state || !tab || notesTab.current === tab) return;
    notesTab.current = tab;
    setNotes(state.pack.notes[tab] ?? '');
  }, [tab, state]);

  const meeting = state?.meetings.find((m) => m.key === tab) ?? null;
  const agenda = state?.pack.agendas.find((a) => a.key === tab) ?? null;
  const actions = (state?.pack.actions ?? []).filter((a) => a.meeting === tab);
  const carried = (state?.pack.carriedOver ?? []).filter((a) => a.meeting === tab);

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try { await fn(); load(); } catch (e: any) { setError(e?.message || 'That did not work.'); }
    finally { setBusy(null); }
  };

  const addAction = () => run('add', async () => {
    await api.post(`/api/meetings/${tab}/actions`, {
      monday, text: draft.trim(), ownerEmail: owner || null, dueDate: due || null,
    });
    setDraft(''); setOwner(''); setDue('');
  });

  const toggle = (a: MeetingAction) => run(`t${a.id}`, () => api.patch(`/api/meetings/actions/${a.id}`, { done: !a.doneAt }));
  const saveNotes = () => run('notes', () => api.put(`/api/meetings/${tab}/notes`, { monday, notes }));
  const refresh = () => run('refresh', () => api.post('/api/meetings/refresh', { monday }));

  if (loading && !state) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Meetings</h2>
          <p className="text-sm text-gray-600">Week of {meetingDayLabel(monday)}</p>
          {state?.pack.weekFrom && <p className="text-xs text-gray-500">Numbers from {state.pack.weekFrom} to {state.pack.weekTo}</p>}
          <p className="text-sm text-gray-500 mt-0.5">
            {state?.pack.generatedAt
              ? `Prepared ${new Date(state.pack.generatedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
              : 'Not prepared yet'}
          </p>
        </div>
        {isAdmin && (
          <button onClick={refresh} disabled={busy === 'refresh'}
                  className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">
            {busy === 'refresh' ? 'Rebuilding…' : state?.generated ? 'Refresh the numbers' : 'Prepare it now'}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          <span>{error}</span><button onClick={load} className="text-xs underline">Retry</button>
        </div>
      )}

      {!state?.generated && (
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          Sunday evening's job builds this automatically. {isAdmin ? 'You can build it now with the button above.' : 'It will be here before the week starts.'}
        </p>
      )}

      {/* The four rooms, in the order they happen */}
      <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-2">
        {state?.meetings.map((m) => (
          <button
            key={m.key}
            onClick={() => setTab(m.key)}
            aria-current={tab === m.key ? 'page' : undefined}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === m.key ? 'bg-ink text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {m.label}
            <span className={`ml-2 text-[11px] ${tab === m.key ? 'text-white/70' : 'text-gray-400'}`}>{meetingTime(m)}</span>
          </button>
        ))}
      </div>

      {meeting && (
        <>
          {/* Where the room is, to scale. Live only on the day the pack is
              for — a countdown against a meeting that finished last Tuesday
              would be noise, so an older pack shows the plan and no marker. */}
          <MeetingBar meeting={meeting} live={monday === mondayFor(new Date())} />

          <p className="text-sm text-gray-600">{meeting.purpose}</p>

          {/* The running order. Written down so the meeting has a shape before
              anyone walks in, and so an overrun is visible rather than felt. */}
          <details className="rounded-xl border border-gray-200 bg-white" open>
            <summary className="px-3.5 py-2.5 text-sm font-semibold text-gray-800 cursor-pointer select-none">
              Running order
              <span className="ml-2 font-normal text-gray-400">
                {agendaMinutes(meeting)} of {meetingMinutes(meeting)} minutes
              </span>
            </summary>
            <ol className="px-3.5 pb-3 space-y-1">
              {meeting.runningOrder.map((item, i) => (
                <li key={i} className="flex items-baseline gap-2.5 text-sm">
                  <span className="text-[11px] text-gray-400 tabular-nums w-10 text-right flex-shrink-0">{item.minutes} min</span>
                  <span className="text-gray-800">{item.title}</span>
                  {item.note && <span className="text-[11px] text-gray-400 hidden sm:inline">— {item.note}</span>}
                </li>
              ))}
            </ol>
          </details>

          {!!carried.length && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900 mb-1.5">Still open from before</p>
              <ul className="space-y-1">
                {carried.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-sm text-amber-900">
                    <input type="checkbox" checked={false} onChange={() => toggle(a)} className="mt-1" />
                    <span className="flex-1">{a.text}</span>
                    <span className="text-[11px] text-amber-700 whitespace-nowrap">
                      {a.ownerName ?? 'unassigned'}{a.fromWeek ? ` · from ${a.fromWeek}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {agenda?.sections.map((s, i) => (
            <Section key={i} s={s} onOpen={(page) => onNavigate?.(page)} />
          ))}

          {/* What came out of the room */}
          <div className="rounded-xl border border-gray-200 bg-white p-3.5 space-y-3">
            <p className="text-sm font-semibold text-gray-800">Actions from this meeting</p>

            {actions.length > 0 && (
              <ul className="space-y-1">
                {actions.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={!!a.doneAt} onChange={() => toggle(a)} disabled={busy === `t${a.id}`} className="mt-1" />
                    <span className={`flex-1 ${a.doneAt ? 'line-through text-gray-400' : 'text-gray-800'}`}>{a.text}</span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">
                      {a.ownerName ?? 'unassigned'}{a.dueDate ? ` · ${a.dueDate}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
              <input className={input} placeholder="What needs doing?" value={draft}
                     onChange={(e) => setDraft(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim().length > 2) addAction(); }} />
              <input className={`${input} sm:w-44`} placeholder="Owner email" value={owner} onChange={(e) => setOwner(e.target.value)} />
              <input className={`${input} sm:w-36`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              <button onClick={addAction} disabled={draft.trim().length < 3 || busy === 'add'}
                      className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                Add
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-3.5">
            <p className="text-sm font-semibold text-gray-800 mb-1.5">Notes</p>
            <textarea className={`${input} min-h-[7rem]`} value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="What was discussed, decided, or needs saying again next week." />
            <div className="flex justify-end mt-2">
              <button onClick={saveNotes} disabled={busy === 'notes'}
                      className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">
                {busy === 'notes' ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
