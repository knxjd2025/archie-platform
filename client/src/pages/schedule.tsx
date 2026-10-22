import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { formatPhone } from '../lib/format';
import ContactActions from '../components/ContactActions';
import AvailabilityBoard from '../components/AvailabilityBoard';

interface ApptClient {
  externalId: string;
  name: string;
  jobName: string | null;
  phone: string | null;
  email: string | null;
  matchedVia: 'address' | 'title';
}

interface Appt {
  title: string | null;
  start: string | null;
  end: string | null;
  address: string | null;
  kind: string | null;
  mailbox?: string | null;
  person?: string | null;
  /** The customer this appointment is about, when it could be identified. */
  client?: ApptClient | null;
}

/**
 * Directions rather than a map pin: on a phone this opens the native app with
 * navigation ready, which is what a rep standing in a driveway actually wants.
 */
const directionsUrl = (address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

const KIND_META: Record<string, { icon: string; color: string }> = {
  inspection: { icon: '🔍', color: 'bg-blue-100 text-blue-700' },
  adjuster: { icon: '🧾', color: 'bg-amber-100 text-amber-700' },
  internal: { icon: '🏢', color: 'bg-gray-100 text-gray-600' },
  other: { icon: '📌', color: 'bg-gray-100 text-gray-600' },
};

const dayKey = (s: string) => new Date(s).toDateString();
const dayLabel = (s: string) => {
  const d = new Date(s);
  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86400000).toDateString();
  if (d.toDateString() === today) return 'Today';
  if (d.toDateString() === tomorrow) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
};
const timeRange = (start: string | null, end: string | null) => {
  const t = (x: string) => new Date(x).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (start && end) return `${t(start)} – ${t(end)}`;
  if (start) return t(start);
  return 'All day';
};

const VIEW_KEY = 'archie.schedule.view';

/**
 * Two ways to look at the same calendars: Availability (everyone side by side
 * for a day, click an open time to book) and Agenda (a list of what's coming).
 */
export default function Schedule({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [view, setView] = useState<'board' | 'agenda'>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'agenda' ? 'agenda' : 'board'; } catch { return 'board'; }
  });
  const pick = (v: 'board' | 'agenda') => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* fine */ } };
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Schedule</h2>
          <p className="text-sm text-gray-500 mt-1">{view === 'board' ? 'Every connected calendar, Google and GoHighLevel, side by side. Click an open time to book.' : 'Inspections and appointments coming up.'}</p>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden text-sm" role="tablist">
          <button role="tab" aria-selected={view === 'board'} onClick={() => pick('board')} className={`px-3 py-1.5 ${view === 'board' ? 'bg-ink text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Availability</button>
          <button role="tab" aria-selected={view === 'agenda'} onClick={() => pick('agenda')} className={`px-3 py-1.5 border-l border-gray-200 ${view === 'agenda' ? 'bg-ink text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Agenda</button>
        </div>
      </div>
      {view === 'board' ? <AvailabilityBoard onOpenClient={onOpenClient} /> : <Agenda onOpenClient={onOpenClient} />}
    </div>
  );
}

function Agenda({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(14);
  const [who, setWho] = useState<string>('all');
  const people = Array.from(new Set(appts.map((a) => a.person).filter((p): p is string => !!p))).sort();
  const shownAppts = who === 'all' ? appts : appts.filter((a) => a.person === who);

  // Rapidly tapping "Load more" (14→28→56→90) fired overlapping requests with
  // no ordering guard — a slower, smaller-window response could land after a
  // larger one and overwrite it with fewer appointments.
  const requestId = useRef(0);
  const load = async (windowDays: number) => {
    const id = ++requestId.current;
    setLoading(true); setError(null);
    try {
      const r = await api.get<{ appointments: Appt[] }>(`/api/schedule?days=${windowDays}`);
      if (id !== requestId.current) return;
      setAppts((r.appointments || []).filter((a) => a.start));
    } catch (e: any) {
      if (id !== requestId.current) return;
      setError(e?.message || 'Failed to load the schedule');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };
  useEffect(() => { load(days); }, [days]);

  // Appointments booked elsewhere (dashboard, office, another rep) wouldn't
  // show up here until a manual refresh or a full page revisit — this had no
  // polling or refresh-on-focus at all.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load(days); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(days); }, 3 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const loadMore = () => setDays((d) => Math.min(d * 2, 90));

  // Group by day, in order.
  const groups: { key: string; label: string; items: Appt[] }[] = [];
  for (const a of shownAppts) {
    const k = dayKey(a.start!);
    let g = groups.find((x) => x.key === k);
    if (!g) { g = { key: k, label: dayLabel(a.start!), items: [] }; groups.push(g); }
    g.items.push(a);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-gray-500">Inspections & installs for the next {days} day{days === 1 ? '' : 's'}{appts.length ? ` · ${appts.length}` : ''}{(() => { const n = appts.filter((a) => a.start && new Date(a.start).toDateString() === new Date().toDateString()).length; return n > 0 ? ` · ${n} today` : ''; })()}</p>
        </div>
        {people.length > 1 && (
          <select aria-label="Whose calendar" value={who} onChange={(e) => setWho(e.target.value)} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
            <option value="all">Everyone ({appts.length})</option>
            {people.map((p) => <option key={p} value={p}>{p} ({appts.filter((a) => a.person === p).length})</option>)}
          </select>
        )}
        <button onClick={() => load(days)} disabled={loading} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {loading ? (
        <div className="space-y-5">{[0, 1].map((g) => (<div key={g}><div className="h-4 w-24 bg-gray-100 rounded animate-pulse mb-2" /><div className="space-y-px bg-white rounded-xl border border-gray-200 overflow-hidden">{[0, 1, 2].map((i) => <div key={i} className="h-14 bg-gray-50 animate-pulse" />)}</div></div>))}</div>
      ) : error ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-red-600 font-medium">Couldn't load the schedule</p>
          <p className="text-xs text-gray-500 mt-1">{error}</p>
          <button onClick={() => load(days)} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
        </div>
      ) : groups.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">Nothing scheduled in the next {days} days.</p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">{g.label}</h3>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50 overflow-hidden">
                {g.items.map((a, i) => {
                  const meta = KIND_META[(a.kind || 'other').toLowerCase()] || KIND_META.other;
                  // De-emphasize appointments whose time has already passed, so
                  // what's left today stands out at a glance — still shown,
                  // just muted, not removed.
                  const isPast = !!a.start && new Date(a.start) < new Date();
                  return (
                    <div key={i} className={`flex items-start gap-3 px-4 py-3 ${isPast ? 'opacity-50' : ''}`}>
                      <span className="text-lg mt-0.5">{meta.icon}</span>
                      <div className="min-w-0 flex-1">
                        {/* Title opens the client when we know who it is, and
                            is plain text when we don't — a dead button is
                            worse than an obviously static label. */}
                        {a.client && onOpenClient ? (
                          <button
                            onClick={() => onOpenClient(a.client!.externalId)}
                            className="text-sm font-medium text-gray-900 truncate hover:text-brand text-left w-full"
                            title={`Open ${a.client.name}`}
                          >
                            {a.title || 'Appointment'}
                            <span className="text-blue-600"> ›</span>
                          </button>
                        ) : (
                          <p className="text-sm font-medium text-gray-900 truncate">{a.title || 'Appointment'}</p>
                        )}

                        <p className="text-xs text-gray-500 truncate">
                          {timeRange(a.start, a.end)}
                          {a.address && (
                            <> · <a href={directionsUrl(a.address)} target="_blank" rel="noopener noreferrer"
                                 className="text-blue-600 hover:underline inline-block py-2 px-1 -my-2"
                                 title="Directions">{a.address}</a></>
                          )}
                        </p>

                        {a.client && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span className="text-xs text-gray-600 mr-0.5">{a.client.name}</span>
                            {/* Through GoHighLevel (business number), logged on the
                                contact — components/ContactActions.tsx. */}
                            {a.client.phone && (
                              <span title={formatPhone(a.client.phone)}>
                                <ContactActions externalId={a.client.externalId} phone={a.client.phone} size="sm" showEmail={false} />
                              </span>
                            )}
                            <a href={`https://app.jobtread.com/jobs/${a.client.externalId}`}
                               target="_blank" rel="noopener noreferrer"
                               className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
                              JobTread ↗
                            </a>
                          </div>
                        )}
                      </div>
                      {a.kind && <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${meta.color}`}>{a.kind}</span>}
                      {a.person && people.length > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600" title={a.mailbox || ''}>{a.person}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && !error && days < 90 && (
        <div className="text-center">
          <button onClick={loadMore} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600">
            Load more — next {Math.min(days * 2, 90)} days
          </button>
        </div>
      )}
    </div>
  );
}
