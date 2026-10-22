import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  DAY_END_HOUR, DAY_START_HOUR, SLOT_MINS, addDays, conflictsFor, etInstant, etParts, etToday, label12, layoutDay, minutesToHhmm, openSlots,
} from '../../../shared/schedule-board';

interface Person { email: string; name: string; role: string; google: boolean; ghl: boolean; jobtreadSalesRep: string | null }
interface BoardEvent { id: string; person: string; source: 'google' | 'ghl' | 'both'; title: string; start: string; end: string; allDay: boolean; address: string | null; kind: string; status?: string | null }
interface Board { date: string; people: Person[]; events: BoardEvent[]; warnings: { person: string; source: string; message: string }[]; canSeeEveryone: boolean }
interface Slot { person: Person; date: string; time: string }

const PX_PER_MIN = 1.1;
const GRID_MINS = (DAY_END_HOUR - DAY_START_HOUR) * 60;
const TYPES = ['Inspection', 'Sales appointment', 'Adjuster meeting', 'Estimate'];
const DURATIONS = [30, 60, 90, 120];

const SOURCE_STYLE: Record<BoardEvent['source'], { box: string; label: string }> = {
  google: { box: 'bg-blue-50 border-blue-500 text-blue-900', label: 'Google Calendar' },
  ghl: { box: 'bg-purple-50 border-purple-500 text-purple-900', label: 'GoHighLevel' },
  both: { box: 'bg-indigo-50 border-indigo-500 text-indigo-900', label: 'GoHighLevel + Google' },
};

const dayTitle = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const timeOf = (iso: string) => label12(etParts(iso).minutes);
const firstName = (n: string) => n.split(/\s+/)[0];

/**
 * Everyone's calendar for one day, side by side: Google Calendar (live) and
 * GoHighLevel appointments per person. Click any open half hour to book it on
 * that person's calendar — for a new lead taken on the call, or an existing
 * client. Built for whoever books for the team: the call center and the office.
 */
export default function AvailabilityBoard({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [date, setDate] = useState(etToday());
  const [everyone, setEveryone] = useState(false);
  const [duration, setDuration] = useState(60);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [detail, setDetail] = useState<BoardEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  const req = useRef(0);
  const load = useCallback(() => {
    const id = ++req.current;
    setLoading(true); setError(null);
    api.get<Board>(`/api/schedule/board?date=${date}${everyone ? '&everyone=1' : ''}`)
      .then((b) => { if (id === req.current) setBoard(b); })
      .catch((e: any) => { if (id === req.current) setError(e?.message || 'Could not load the calendars.'); })
      .finally(() => { if (id === req.current) setLoading(false); });
  }, [date, everyone]);
  useEffect(() => { load(); }, [load]);

  // Stay current while the page is open: someone else may have just booked a slot.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    const refresh = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 2 * 60000);
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(tick); clearInterval(refresh); document.removeEventListener('visibilitychange', onFocus); };
  }, [load]);

  const people = board?.people ?? [];
  const events = board?.events ?? [];
  const today = etToday(now);
  const nowMins = date === today ? etParts(now).minutes : null;
  const isPastDay = date < today;

  const byPerson = useMemo(() => {
    const m = new Map<string, BoardEvent[]>();
    for (const p of people) m.set(p.email, []);
    for (const e of events) m.get(e.person)?.push(e);
    return m;
  }, [people, events]);

  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
  const slotStarts = Array.from({ length: GRID_MINS / SLOT_MINS }, (_, i) => DAY_START_HOUR * 60 + i * SLOT_MINS);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden">
          <button onClick={() => setDate((d) => addDays(d, -1))} className="px-2.5 py-1.5 text-sm hover:bg-gray-50" aria-label="Previous day">‹</button>
          <button onClick={() => setDate(etToday())} className={`px-3 py-1.5 text-sm border-x border-gray-200 ${date === today ? 'bg-navy text-white' : 'hover:bg-gray-50'}`}>Today</button>
          <button onClick={() => setDate((d) => addDays(d, 1))} className="px-2.5 py-1.5 text-sm hover:bg-gray-50" aria-label="Next day">›</button>
        </div>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a day" className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white" />
        <h3 className="text-base font-semibold text-gray-900 mr-auto">{dayTitle(date)}</h3>
        <label className="text-xs text-gray-600 flex items-center gap-1.5">Appointment
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            {DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${d / 60} hr${d > 60 ? 's' : ''}`}</option>)}
          </select>
        </label>
        {board?.canSeeEveryone && (
          <label className="text-xs text-gray-600 flex items-center gap-1.5"><input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Office calendars</label>
        )}
        <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        {(['google', 'ghl', 'both'] as const).map((s) => <span key={s} className="flex items-center gap-1"><span className={`w-3 h-3 rounded-sm border-l-4 ${SOURCE_STYLE[s].box}`} />{SOURCE_STYLE[s].label}</span>)}
        <span>Click an open time to book it.</span>
      </div>

      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-3 py-2">{toast}</div>}
      {board?.warnings?.length ? (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 space-y-0.5">
          {board.warnings.map((w, i) => <p key={i}>{people.find((p) => p.email === w.person)?.name || w.person}: {w.message}</p>)}
        </div>
      ) : null}
      {error && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-red-600 font-medium">Couldn't load the calendars</p>
          <p className="text-xs text-gray-500 mt-1">{error}</p>
          <button onClick={load} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
        </div>
      )}
      {!error && board && people.length === 0 && (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">No calendars to show. Ask an admin to turn on "All calendars" for you on the Team page.</p>
      )}

      {!error && people.length > 0 && (
        <div className={`bg-white rounded-xl border border-gray-200 overflow-x-auto ${loading ? 'opacity-70' : ''}`}>
          <div className="min-w-max">
            {/* Header: who, which calendars are connected, and the first open slot. */}
            <div className="flex bg-white border-b border-gray-200">
              <div className="w-14 flex-shrink-0" />
              {people.map((p) => {
                const mine = byPerson.get(p.email) ?? [];
                const open = isPastDay ? [] : openSlots(mine, p.email, date, duration, now);
                return (
                  <div key={p.email} className="w-44 sm:w-48 flex-shrink-0 border-l border-gray-100 px-2 py-2">
                    <p className="text-sm font-semibold text-gray-900 truncate" title={p.email}>{p.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`text-[10px] px-1 rounded ${p.google ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-400 line-through'}`} title={p.google ? 'Google Calendar connected' : 'No company Google calendar'}>Google</span>
                      <span className={`text-[10px] px-1 rounded ${p.ghl ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-400 line-through'}`} title={p.ghl ? 'GoHighLevel user matched by email' : 'No GoHighLevel user with this email'}>GHL</span>
                      <span className="text-[10px] text-gray-400 ml-auto">{mine.filter((e) => !e.allDay).length} booked</span>
                    </div>
                    {open.length > 0 ? (
                      <button onClick={() => setSlot({ person: p, date, time: open[0] })} className="mt-1.5 w-full text-[11px] px-2 py-1 rounded-md bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-medium text-left truncate">
                        Next open: {label12(Number(open[0].slice(0, 2)) * 60 + Number(open[0].slice(3)))} →
                      </button>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-gray-400 px-2 py-1">{isPastDay ? 'Past day' : 'No open time left'}</p>
                    )}
                    {mine.filter((e) => e.allDay).map((e) => (
                      <button key={e.id} onClick={() => setDetail(e)} className={`mt-1 w-full text-left text-[10px] px-1.5 py-0.5 rounded border-l-4 truncate ${SOURCE_STYLE[e.source].box}`}>All day: {e.title}</button>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* The day, 7 AM – 8 PM. */}
            <div className="flex relative" style={{ height: GRID_MINS * PX_PER_MIN }}>
              <div className="w-14 flex-shrink-0 relative">
                {hours.map((h) => (
                  <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-gray-400 whitespace-nowrap" style={{ top: (h - DAY_START_HOUR) * 60 * PX_PER_MIN }}>{h === DAY_START_HOUR ? '' : label12(h * 60)}</span>
                ))}
              </div>
              {people.map((p) => {
                const placed = layoutDay(byPerson.get(p.email) ?? [], date);
                return (
                  <div key={p.email} className="w-44 sm:w-48 flex-shrink-0 border-l border-gray-100 relative">
                    {slotStarts.map((m) => {
                      const t = minutesToHhmm(m);
                      const past = isPastDay || (nowMins !== null && m < nowMins);
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={past}
                          onClick={() => setSlot({ person: p, date, time: t })}
                          className={`group absolute left-0 right-0 border-t ${m % 60 === 0 ? 'border-gray-200' : 'border-gray-50'} ${past ? 'bg-gray-50/80 cursor-not-allowed' : 'hover:bg-emerald-50'}`}
                          style={{ top: (m - DAY_START_HOUR * 60) * PX_PER_MIN, height: SLOT_MINS * PX_PER_MIN }}
                          aria-label={`Book ${p.name} at ${label12(m)}`}
                        >
                          {!past && <span className="hidden group-hover:block text-[10px] text-emerald-700 font-medium text-left pl-1.5">+ {label12(m)}</span>}
                        </button>
                      );
                    })}
                    {placed.map(({ event: e, top, height, col, cols, clippedBefore, clippedAfter }) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => setDetail(e)}
                        className={`absolute z-10 rounded-md border-l-4 px-1.5 py-0.5 text-left overflow-hidden shadow-sm hover:shadow ${SOURCE_STYLE[e.source].box}`}
                        style={{ top: top * PX_PER_MIN, height: Math.max(height * PX_PER_MIN - 2, 16), left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                        title={`${e.title} · ${timeOf(e.start)} – ${timeOf(e.end)}`}
                      >
                        <p className="text-[11px] font-semibold leading-tight truncate">{clippedBefore ? '↑ ' : ''}{e.title}</p>
                        {height >= 40 && <p className="text-[10px] leading-tight opacity-80 truncate">{timeOf(e.start)} – {timeOf(e.end)}{clippedAfter ? ' ↓' : ''}</p>}
                        {height >= 70 && e.address && <p className="text-[10px] leading-tight opacity-70 truncate">{e.address}</p>}
                      </button>
                    ))}
                  </div>
                );
              })}
              {nowMins !== null && nowMins >= DAY_START_HOUR * 60 && nowMins <= DAY_END_HOUR * 60 && (
                <div className="absolute left-14 right-0 z-20 pointer-events-none border-t-2 border-brick" style={{ top: (nowMins - DAY_START_HOUR * 60) * PX_PER_MIN }}>
                  <span className="absolute -left-1.5 -top-[5px] w-2 h-2 rounded-full bg-brick" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {detail && <EventDetail event={detail} person={people.find((p) => p.email === detail.person)} onClose={() => setDetail(null)} />}
      {slot && (
        <BookingDialog
          slot={slot}
          people={people}
          events={events}
          defaultDuration={duration}
          onClose={() => setSlot(null)}
          onBooked={(msg) => { setSlot(null); flash(msg); load(); }}
          onOpenClient={onOpenClient}
        />
      )}
    </div>
  );
}

function EventDetail({ event: e, person, onClose }: { event: BoardEvent; person?: Person; onClose: () => void }) {
  return (
    <Modal onClose={onClose} title={e.title}>
      <div className="space-y-2 text-sm">
        <p className="text-gray-700">{e.allDay ? 'All day' : `${timeOf(e.start)} – ${timeOf(e.end)}`} · {dayTitle(etParts(e.start).date)}</p>
        <p className="text-gray-700">{person?.name || e.person}'s calendar</p>
        <p><span className={`text-[11px] px-1.5 py-0.5 rounded border-l-4 ${SOURCE_STYLE[e.source].box}`}>{SOURCE_STYLE[e.source].label}</span>{e.status ? <span className="ml-2 text-xs text-gray-500 capitalize">{e.status}</span> : null}</p>
        {e.address && <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.address)}`} target="_blank" rel="noopener noreferrer" className="block text-blue-600 hover:underline">{e.address} ↗</a>}
      </div>
    </Modal>
  );
}

interface LeadHit { externalId: string | null; firstName: string | null; lastName: string | null; jobName: string | null; address: string | null; city: string | null; phone: string | null }

function BookingDialog({ slot, people, events, defaultDuration, onClose, onBooked, onOpenClient }: {
  slot: Slot; people: Person[]; events: BoardEvent[]; defaultDuration: number;
  onClose: () => void; onBooked: (message: string) => void; onOpenClient?: (externalId: string) => void;
}) {
  const { user } = useAuth();
  const [personEmail, setPersonEmail] = useState(slot.person.email);
  const [date, setDate] = useState(slot.date);
  const [time, setTime] = useState(slot.time);
  const [durationMins, setDurationMins] = useState(defaultDuration);
  const [type, setType] = useState('Inspection');
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [nf, setNf] = useState({ firstName: '', lastName: '', phone: '', email: '', address: '', city: '', state: 'NC', zip: '' });
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [client, setClient] = useState<LeadHit | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; externalId: string | null } | null>(null);

  const person = people.find((p) => p.email === personEmail) ?? slot.person;
  const conflicts = conflictsFor(events, personEmail, date, time, durationMins);
  const inPast = etInstant(date, time).getTime() < Date.now();
  const times = Array.from({ length: ((DAY_END_HOUR - DAY_START_HOUR) * 60) / 15 }, (_, i) => minutesToHhmm(DAY_START_HOUR * 60 + i * 15));
  useEffect(() => { setAnyway(false); }, [personEmail, date, time, durationMins]);

  useEffect(() => {
    if (mode !== 'existing') return;
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    // The debounce only spaces requests out; it doesn't order the answers. A
    // slow search for "smi" could land after "smith" and show the wrong
    // people, so a search whose term has since changed is ignored.
    let stale = false;
    const t = setTimeout(() => {
      api.get<{ leads: LeadHit[] }>(`/api/leads?q=${encodeURIComponent(term)}&limit=8&includeClosed=true`)
        .then((r) => { if (!stale) setHits((r.leads || []).filter((l) => l.externalId)); })
        .catch(() => { if (!stale) setHits([]); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [q, mode]);

  const who = `${firstName(person.name)}'s`;
  const canSubmit = !busy && !inPast && (conflicts.length === 0 || anyway)
    && (mode === 'existing' ? !!client?.externalId : !!(nf.firstName.trim() || nf.phone.trim() || nf.email.trim()));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    const appointment = { date, time, durationMins, type, notes: notes.trim(), forEmail: personEmail };
    try {
      if (mode === 'existing' && client?.externalId) {
        const r = await api.post<{ bookedOn: string }>(`/api/clients/${client.externalId}/appointment`, appointment);
        const name = [client.firstName, client.lastName].filter(Boolean).join(' ') || client.jobName || 'the client';
        setDone({ message: `${type} for ${name} booked on ${who} calendar (${r.bookedOn}), ${dayTitle(date)} at ${label12(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))}.`, externalId: client.externalId });
      } else {
        const r = await api.post<{ jobId: string | null; jobtread: string; ghl: string; appointment: { ok: boolean; bookedOn?: string; error?: string | null } | null }>('/api/leads/create', {
          ...nf, state: nf.city || nf.zip ? nf.state : '', notes: notes.trim(), appointment,
        });
        const name = `${nf.firstName} ${nf.lastName}`.trim() || nf.phone || nf.email;
        if (r.appointment && !r.appointment.ok) {
          setErr(`${name} was added (JobTread: ${r.jobtread}), but the calendar booking failed: ${r.appointment.error || 'unknown error'}. Try the time again from their profile.`);
          setDone(null);
          return;
        }
        setDone({ message: `${name} added and ${type.toLowerCase()} booked on ${who} calendar (${r.appointment?.bookedOn}). JobTread: ${r.jobtread}. GoHighLevel: ${r.ghl}.`, externalId: r.jobId });
      }
    } catch (e: any) {
      setErr(e?.message || 'Booking failed.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:ring-1 focus:ring-blue-400';
  const lbl = 'block text-[11px] font-semibold text-gray-500 mb-0.5';

  if (done) {
    return (
      <Modal onClose={() => onBooked(done.message)} title="Booked">
        <p className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">{done.message}</p>
        <div className="flex gap-2 mt-3">
          {done.externalId && onOpenClient && <button onClick={() => { onBooked(done.message); onOpenClient(done.externalId!); }} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white">Open client</button>}
          <button onClick={() => onBooked(done.message)} className="text-sm px-3 py-1.5 rounded-lg bg-navy text-white font-medium">Back to calendars</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title={`Book for ${person.name}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2"><span className={lbl}>Whose calendar</span>
            <select value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} className={input}>
              {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
            </select>
          </label>
          <label><span className={lbl}>Day</span><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={input} /></label>
          <label><span className={lbl}>Time</span>
            <select value={time} onChange={(e) => setTime(e.target.value)} className={input}>
              {!times.includes(time) && <option value={time}>{label12(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))}</option>}
              {times.map((t) => <option key={t} value={t}>{label12(Number(t.slice(0, 2)) * 60 + Number(t.slice(3)))}</option>)}
            </select>
          </label>
          <label><span className={lbl}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className={input}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          <label><span className={lbl}>Length</span>
            <select value={durationMins} onChange={(e) => setDurationMins(Number(e.target.value))} className={input}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${d / 60} hr${d > 60 ? 's' : ''}`}</option>)}
            </select>
          </label>
        </div>

        {inPast && <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">That time has already passed. Pick a later time.</p>}
        {conflicts.length > 0 && (
          <div className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <p className="font-semibold">{person.name} already has something then:</p>
            <ul className="mt-1 space-y-0.5">{conflicts.map((c) => <li key={c.id}>{c.title} · {timeOf(c.start)} – {timeOf(c.end)} ({SOURCE_STYLE[c.source].label})</li>)}</ul>
            <label className="flex items-center gap-1.5 mt-1.5"><input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} /> Book it anyway</label>
          </div>
        )}

        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button onClick={() => setMode('new')} className={`flex-1 py-1.5 ${mode === 'new' ? 'bg-navy text-white' : 'bg-white text-gray-600'}`}>New lead</button>
          <button onClick={() => setMode('existing')} className={`flex-1 py-1.5 ${mode === 'existing' ? 'bg-navy text-white' : 'bg-white text-gray-600'}`}>Existing client</button>
        </div>

        {mode === 'new' ? (
          <div className="grid grid-cols-2 gap-2">
            <label><span className={lbl}>First name</span><input value={nf.firstName} onChange={(e) => setNf({ ...nf, firstName: e.target.value })} className={input} autoFocus /></label>
            <label><span className={lbl}>Last name</span><input value={nf.lastName} onChange={(e) => setNf({ ...nf, lastName: e.target.value })} className={input} /></label>
            <label><span className={lbl}>Phone</span><input type="tel" value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} className={input} /></label>
            <label><span className={lbl}>Email</span><input type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} className={input} /></label>
            <label className="col-span-2"><span className={lbl}>Street address</span><input value={nf.address} onChange={(e) => setNf({ ...nf, address: e.target.value })} className={input} /></label>
            <label><span className={lbl}>City</span><input value={nf.city} onChange={(e) => setNf({ ...nf, city: e.target.value })} className={input} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label><span className={lbl}>State</span>
                <select value={nf.state} onChange={(e) => setNf({ ...nf, state: e.target.value })} className={input}><option>NC</option><option>SC</option></select>
              </label>
              <label><span className={lbl}>ZIP</span><input value={nf.zip} onChange={(e) => setNf({ ...nf, zip: e.target.value })} className={input} inputMode="numeric" /></label>
            </div>
            <p className="col-span-2 text-[11px] text-gray-500">Creates the lead in JobTread and GoHighLevel with {person.name} as the sales rep{person.jobtreadSalesRep ? '' : ' in the app (they have no JobTread rep name on file, so JobTread shows you)'}, and books it on {who} calendar.{user && user.email.toLowerCase() !== personEmail ? ' You stay on it as a shared rep, so it stays in your leads.' : ''}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {client ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <span><b>{[client.firstName, client.lastName].filter(Boolean).join(' ') || client.jobName}</b>{client.address ? <span className="text-gray-500"> · {client.address}</span> : null}</span>
                <button onClick={() => setClient(null)} className="text-xs text-blue-600">Change</button>
              </div>
            ) : (
              <>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone or address…" className={input} autoFocus />
                {hits.map((h) => (
                  <button key={h.externalId!} onClick={() => setClient(h)} className="w-full text-left text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-200">
                    <span className="font-medium text-gray-900">{[h.firstName, h.lastName].filter(Boolean).join(' ') || h.jobName}</span>
                    {h.address && <span className="text-gray-500"> · {h.address}{h.city ? `, ${h.city}` : ''}</span>}
                  </button>
                ))}
                {q.trim().length >= 2 && hits.length === 0 && <p className="text-xs text-gray-400 px-1">No matching clients you can see.</p>}
              </>
            )}
          </div>
        )}

        <label className="block"><span className={lbl}>Notes for {firstName(person.name)}</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What they called about, gate code, best number…" className={input} />
        </label>

        {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white">Cancel</button>
          <button onClick={submit} disabled={!canSubmit} className="text-sm px-4 py-2 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50">
            {busy ? 'Booking…' : `Book ${type.toLowerCase()} on ${who} calendar`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 truncate pr-2">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none" aria-label="Close">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
