import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { conflictsFor, dayLabel, etParts, etToday, label12, openDays, timeLabel } from '../../../shared/schedule-board';

interface Person { email: string; name: string; role: string; google: boolean; ghl: boolean; jobtreadSalesRep: string | null }
interface BoardEvent { id: string; person: string; source: 'google' | 'ghl' | 'both'; title: string; start: string; end: string; allDay: boolean; address: string | null; kind: string }
interface Board { date: string; people: Person[]; events: BoardEvent[]; warnings: { person: string; source: string; message: string }[] }

export interface TimeChoice { date: string; time: string; forEmail: string | null }

const DEFAULT_DAYS = 5;
const SOURCE_LABEL: Record<BoardEvent['source'], string> = { google: 'Google', ghl: 'GoHighLevel', both: 'GHL + Google' };

/** Clock time of an instant, in the schedule board's time zone (Eastern, see shared/schedule-board). */
const timeOf = (iso: string) => label12(etParts(iso).minutes);

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

/**
 * Real open times instead of canned ones: the rep's live Google Calendar and
 * GoHighLevel appointments (the same board the Schedule tab draws), turned
 * into the half hours they are actually free. Pick a day, tap a time, and see
 * what is already on their day underneath — so the person on the phone books
 * something that exists rather than a guess that collides.
 */
export default function OpenTimes({ durationMins, value, onChange, preferRep, days = DEFAULT_DAYS, className = '' }: {
  durationMins: number;
  value: TimeChoice;
  onChange: (v: TimeChoice) => void;
  /** JobTread Sales Rep name of the lead — whose calendar to open on, when we can see it. */
  preferRep?: string | null;
  days?: number;
  className?: string;
}) {
  const { user } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [day, setDay] = useState<string | null>(value.date || null);
  const today = etToday(now);

  const req = useRef(0);
  const load = useCallback(() => {
    const id = ++req.current;
    setLoading(true); setError(null);
    api.get<Board>(`/api/schedule/board?date=${etToday()}&days=${Math.min(Math.max(days, 1), 7)}`)
      .then((b) => { if (id === req.current) { setBoard(b); setNow(new Date()); } })
      .catch((e: any) => { if (id === req.current) setError(e?.message || "Couldn't reach the calendars."); })
      .finally(() => { if (id === req.current) setLoading(false); });
  }, [days]);
  useEffect(() => { load(); }, [load]);

  // Someone else may book a slot while this panel is open.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const people = board?.people ?? [];

  // Whose calendar: what the parent already chose, else the lead's rep, else me.
  const person = useMemo(() => {
    if (!people.length) return null;
    return people.find((p) => same(p.email, value.forEmail))
      ?? (preferRep ? people.find((p) => same(p.jobtreadSalesRep, preferRep) || same(p.name, preferRep)) : undefined)
      ?? people.find((p) => same(p.email, user?.email))
      ?? people[0];
  }, [people, value.forEmail, preferRep, user?.email]);

  // Keep the parent's payload pointed at the calendar being shown.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (person && !same(person.email, value.forEmail)) onChangeRef.current({ ...value, forEmail: person.email });
  }, [person?.email, value.forEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(
    () => (board?.events ?? []).filter((e) => person && same(e.person, person.email)),
    [board?.events, person?.email], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const openByDay = useMemo(
    () => (person ? openDays(mine, person.email, today, Math.min(Math.max(days, 1), 7), durationMins, now) : []),
    [mine, person?.email, today, days, durationMins, now], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Open on the first day with something free, unless a day is already picked.
  useEffect(() => {
    if (!openByDay.length) return;
    setDay((d) => (d && openByDay.some((x) => x.date === d) ? d : (openByDay.find((x) => x.times.length)?.date ?? openByDay[0].date)));
  }, [openByDay]);

  const selected = openByDay.find((d) => d.date === day) ?? openByDay[0];
  const booked = useMemo(() => {
    if (!selected) return [];
    return mine.filter((e) => !e.allDay && etParts(e.start).date === selected.date).sort((a, b) => a.start.localeCompare(b.start));
  }, [mine, selected?.date]); // eslint-disable-line react-hooks/exhaustive-deps
  const allDay = useMemo(
    () => (selected ? mine.filter((e) => e.allDay && etParts(e.start).date <= selected.date && etParts(e.end).date >= selected.date) : []),
    [mine, selected?.date], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const conflicts = person && value.date && value.time ? conflictsFor(mine, person.email, value.date, value.time, durationMins) : [];
  const warning = board?.warnings?.find((w) => person && same(w.person, person.email));

  const pick = (date: string, time: string) => onChange({ date, time, forEmail: person?.email ?? value.forEmail ?? null });

  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">Open times</span>
        {people.length > 1 ? (
          <select
            value={person?.email || ''}
            onChange={(e) => onChange({ ...value, forEmail: e.target.value })}
            aria-label="Whose calendar"
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
          >
            {people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
        ) : person ? (
          <span className="text-xs text-gray-500">{person.name}'s calendar</span>
        ) : null}
        <span className="text-[11px] text-gray-400">{durationMins < 60 ? `${durationMins} min` : `${durationMins / 60} hr${durationMins > 60 ? 's' : ''}`}</span>
        <button type="button" onClick={load} disabled={loading} className="ml-auto text-[11px] px-2 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-60">
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-[11px] text-red-700 bg-red-50 rounded-md px-2 py-1.5">
          Couldn't check the calendar ({error}) — retry, or set the date and time by hand.
        </p>
      )}
      {warning && <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 rounded-md px-2 py-1.5">{warning.message}</p>}
      {loading && !board && <p className="mt-2 text-[11px] text-gray-500">Checking the calendar…</p>}
      {!error && !loading && !person && (
        <p className="mt-2 text-[11px] text-gray-500">No calendar to check — pick a date and time by hand.</p>
      )}

      {person && (
        <>
          <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
            {openByDay.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => setDay(d.date)}
                className={`flex-shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg border text-left ${d.date === selected?.date ? 'bg-ink text-white border-ink' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}
              >
                <span className="font-medium">{dayLabel(d.date, today)}</span>
                <span className={`block text-[10px] ${d.date === selected?.date ? 'text-white/70' : d.times.length ? 'text-emerald-700' : 'text-gray-400'}`}>
                  {d.times.length ? `${d.times.length} open` : d.date === today ? 'none left' : 'full'}
                </span>
              </button>
            ))}
          </div>

          {selected && (
            selected.times.length ? (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {selected.times.map((t) => {
                  const on = value.date === selected.date && value.time === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => pick(selected.date, t)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border ${on ? 'bg-brand text-on-brand border-brand' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}
                    >
                      {timeLabel(t)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-gray-500">
                {selected.date === today ? 'Nothing open left today' : `${person.name.split(/\s+/)[0]} is booked solid`}
                {openByDay.some((d) => d.date > selected.date && d.times.length)
                  ? ` — try ${dayLabel(openByDay.find((d) => d.date > selected.date && d.times.length)!.date, today)}.`
                  : '.'}
              </p>
            )
          )}

          {(booked.length > 0 || allDay.length > 0) && (
            <div className="mt-2 border-t border-gray-100 pt-2 space-y-0.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Already on {dayLabel(selected?.date || today, today).toLowerCase()}</p>
              {allDay.map((e) => <p key={e.id} className="text-[11px] text-gray-600">All day · {e.title}</p>)}
              {booked.map((e) => (
                <p key={e.id} className="text-[11px] text-gray-600 truncate" title={`${e.title}${e.address ? ` · ${e.address}` : ''} (${SOURCE_LABEL[e.source]})`}>
                  {timeOf(e.start)}–{timeOf(e.end)} · {e.title}{e.address ? <span className="text-gray-400"> · {e.address}</span> : null}
                </p>
              ))}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
              <p className="font-semibold">Heads up — {person.name} already has something at {timeLabel(value.time)}:</p>
              {conflicts.map((c) => <p key={c.id}>{c.title} · {timeOf(c.start)}–{timeOf(c.end)} ({SOURCE_LABEL[c.source]})</p>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

