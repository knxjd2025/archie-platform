import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, fmtDay } from '../lib/format';
import { FEATURES } from '../../../shared/features';

interface Appt { title: string | null; start: string | null; end: string | null; address: string | null; kind: string | null }
interface Summary {
  newLeads: number;
  inProduction: number;
  wonCount: number;
  approvedDocs: number;
  overdueAR: { count: number; total: number } | null;
  upcoming: Appt[];
  recentLeads: { externalId: string | null; name: string | null; stage: string | null; status: string; createdAt: string | null }[];
}

interface FollowUpItem {
  id: number;
  jobExternalId: string | null;
  clientName: string | null;
  note: string;
  dueDate: string | null;
  overdue?: boolean;
  dueToday?: boolean;
}

interface Props {
  onAgentChat: (role: string) => void;
  onNavigate: (page: string, data?: any) => void;
  onOpenClient: (externalId: string) => void;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const timeAgo = (s: string | null) => {
  if (!s) return '';
  const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
};

const apptWhen = (a: Appt) => {
  if (!a.start) return '';
  const d = new Date(a.start);
  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86400000).toDateString();
  const day = d.toDateString() === today ? 'Today' : d.toDateString() === tomorrow ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

export default function Dashboard({ onNavigate, onOpenClient }: Props) {
  const { user } = useAuth();
  const isManagerPlus = user?.role === 'admin' || user?.role === 'manager';
  const isProduction = user?.role === 'production';
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const firstName = (user?.name || '').split(' ')[0] || 'there';

  const [fus, setFus] = useState<FollowUpItem[]>([]);
  const [inbox, setInbox] = useState<{ counts: Record<string, number>; lastScanAt: string | null; canScan: boolean } | null>(null);
  useEffect(() => { api.get<{ counts: Record<string, number>; lastScanAt: string | null; canScan: boolean }>('/api/inbox/summary').then(setInbox).catch(() => {}); }, []);
  const [fusError, setFusError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const loadFus = () => api.get<{ followUps: FollowUpItem[] }>('/api/follow-ups')
    .then((r) => { setFus(r.followUps || []); setFusError(false); })
    .catch(() => setFusError(true));

  const load = () => {
    setLoading(true); setErr(false);
    api.get<Summary>('/api/dashboard/summary').then(setS).catch(() => setErr(true)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); loadFus(); }, []);

  const doneFu = async (id: number) => {
    setFus((xs) => xs.filter((f) => f.id !== id)); // optimistic remove from the due list
    try { await api.post(`/api/follow-ups/${id}/done`, { done: true }); } catch { flash("Couldn't update — try again"); loadFus(); }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-56 bg-gray-200 rounded" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[4.5rem] bg-gray-100 rounded-xl border border-gray-200" />)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[4.5rem] bg-gray-100 rounded-xl border border-gray-200" />)}
        </div>
        <div className="h-44 bg-gray-100 rounded-xl border border-gray-200" />
      </div>
    );
  }

  // Crew / production: a schedule-first view (they don't work the sales pipeline).
  if (isProduction) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs text-gray-400 font-medium">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="text-2xl font-bold text-gray-900">{greeting()}, {firstName} 👋</h1>
          <p className="text-sm text-gray-500 mt-1">Here's what's on the schedule.</p>
        </div>
        <ScheduleSection items={s?.upcoming || []} onNavigate={onNavigate} />
        <div className={`grid gap-3 ${FEATURES.brnAdvisor ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <Action icon="📅" label="Full schedule" onClick={() => onNavigate('schedule')} />
          {FEATURES.brnAdvisor && <Action icon="✨" label="Ask Advisor" onClick={() => onNavigate('chat')} />}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-gray-400 font-medium">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="text-2xl font-bold text-gray-900">{greeting()}, {firstName} 👋</h1>
        <p className="text-sm text-gray-500 mt-1">Here's what's going on{isManagerPlus ? '' : ' with your clients'}.</p>
      </div>

      {err && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
          <p className="text-sm text-gray-600">Couldn't load your dashboard.</p>
          <button onClick={() => { load(); loadFus(); }} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium">Retry</button>
        </div>
      )}

      {fusError && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
          <p className="text-sm text-gray-600">Couldn't load follow-ups.</p>
          <button onClick={loadFus} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium">Retry</button>
        </div>
      )}

      {/* Attention cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="New Leads" value={err ? null : (s?.newLeads ?? 0)} icon="📥" color="bg-blue-50 text-blue-700" onClick={() => onNavigate('leads', { status: 'new' })} />
        <Stat label="In Production" value={err ? null : (s?.inProduction ?? 0)} icon="🏗️" color="bg-amber-50 text-amber-700" onClick={() => onNavigate('production')} />
        <Stat label="Won" value={err ? null : (s?.wonCount ?? 0)} icon="🎉" color="bg-emerald-50 text-emerald-700" onClick={() => onNavigate('leads', { status: 'won' })} />
        <Stat label="Approved Docs" value={err ? null : (s?.approvedDocs ?? 0)} icon="📄" color="bg-indigo-50 text-indigo-700" onClick={() => onNavigate('documents')} />
      </div>

      {isManagerPlus && s?.overdueAR && s.overdueAR.count > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-red-800">💸 {money(s.overdueAR.total)} overdue</p>
            <p className="text-xs text-red-600">{s.overdueAR.count} invoice{s.overdueAR.count > 1 ? 's' : ''} past due — worth a follow-up.</p>
          </div>
          {FEATURES.brnAdvisor && <button onClick={() => onNavigate('chat')} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700">Ask Advisor</button>}
        </div>
      )}

      {/* Inbox watch: leads and must-not-miss email since the last scan */}
      {inbox?.canScan && (() => {
        const n = (inbox.counts.lead || 0) + (inbox.counts.customer || 0) + (inbox.counts.important || 0);
        // Two labels either side of a 390px row is one label too many: the
        // title broke after "nothing" and the status crowded in beside the
        // orphan. They stack on a phone and only sit side by side once there
        // is room, and neither is allowed to break mid-phrase.
        return (
          <button onClick={() => onNavigate('inbox')} className={`w-full text-left rounded-xl border px-5 py-3 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${n > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
            <span className="text-sm font-semibold text-gray-800">
              📬 Inbox leads
              {n > 0
                ? <span className="text-red-600 font-normal whitespace-nowrap"> · {n} waiting</span>
                : <span className="text-gray-400 font-normal whitespace-nowrap"> · nothing waiting</span>}
            </span>
            <span className="text-xs text-gray-500 sm:shrink-0 sm:text-right">
              {inbox.counts.lead ? `${inbox.counts.lead} lead${inbox.counts.lead === 1 ? '' : 's'} · ` : ''}
              {inbox.counts.important ? `${inbox.counts.important} important · ` : ''}
              {inbox.lastScanAt
                ? `scanned ${new Date(inbox.lastScanAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                : 'not scanned yet'} →
            </span>
          </button>
        );
      })()}

      {/* Follow-ups due */}
      {toast && fus.length === 0 && (
        <p className="text-xs text-white bg-gray-900 rounded-lg px-4 py-2">{toast}</p>
      )}
      {fus.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">🔔 Follow-ups{(() => { const n = fus.filter((f) => f.overdue || f.dueToday).length; return n > 0 ? <span className="text-red-600 font-normal"> · {n} due</span> : null; })()}</h2>
          </div>
          {toast && <p className="px-5 py-2 text-xs text-white bg-gray-900">{toast}</p>}
          <div className="divide-y divide-gray-50">
            {fus.slice(0, 6).map((f) => (
              <div key={f.id} className="flex items-start gap-3 px-5 py-3">
                <button onClick={() => doneFu(f.id)} aria-label="Mark done" className="p-3 -m-3 flex-shrink-0">
                  <span className="block mt-0.5 w-4 h-4 rounded border border-gray-300 hover:border-emerald-400" />
                </button>
                <button onClick={() => f.jobExternalId && onOpenClient(f.jobExternalId)} disabled={!f.jobExternalId} className="min-w-0 flex-1 text-left">
                  <p className="text-sm text-gray-800 truncate">{f.note}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {f.clientName ? f.clientName : 'No client'}
                    {f.dueDate && <span className={f.overdue ? 'text-red-600 font-medium' : f.dueToday ? 'text-amber-600 font-medium' : ''}> · {f.overdue ? 'Overdue' : f.dueToday ? 'Due today' : `Due ${fmtDay(f.dueDate)}`}</span>}
                  </p>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      {/* Four tiles sit as 2x2 on a phone. Three leave an orphan in the second
          row, so the last one spans the width instead — deliberate rather than
          a gap where a button used to be. */}
      <div className={`grid grid-cols-2 gap-3 ${FEATURES.brnAdvisor ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <Action icon="➕" label="New lead + book" onClick={() => onNavigate('leads', { newLead: true })} />
        {FEATURES.brnAdvisor && <Action icon="✨" label="Ask Advisor" onClick={() => onNavigate('chat')} />}
        <Action icon="✉️" label="Messages" onClick={() => onNavigate('conversations')} />
        <Action
          icon="🏗️" label="Production" onClick={() => onNavigate('production')}
          className={FEATURES.brnAdvisor ? '' : 'col-span-2 sm:col-span-1'}
        />
      </div>

      {/* Coming up */}
      <ScheduleSection items={s?.upcoming || []} onNavigate={onNavigate} />

      {/* Recent leads */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Recent clients</h2>
          <button onClick={() => onNavigate('leads')} className="text-xs text-blue-600 hover:underline">View all</button>
        </div>
        {!s || s.recentLeads.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">No clients yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {s.recentLeads.map((l, i) => (
              <button
                key={l.externalId || i}
                onClick={() => l.externalId && onOpenClient(l.externalId)}
                disabled={!l.externalId}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 text-left"
              >
                <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 text-sm font-semibold flex items-center justify-center flex-shrink-0">
                  {(l.name || '?').trim()[0]?.toUpperCase() || '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{l.name || 'Unknown'}</p>
                  <p className="text-xs text-gray-500 truncate">{l.stage || l.status}</p>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(l.createdAt)}</span>
                {l.externalId && <span className="text-gray-300 flex-shrink-0" aria-hidden>›</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** `value` is null when the figure could not be loaded — an unknown count must
 *  not render as a confident zero. */
function Stat({ label, value, icon, color, onClick }: { label: string; value: number | null; icon: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:shadow-sm hover:border-gray-300 transition">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          <p className={`text-2xl font-bold mt-0.5 ${value === null ? 'text-gray-300' : 'text-gray-900'}`}>{value === null ? '—' : value.toLocaleString()}</p>
        </div>
        <span className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center text-lg flex-shrink-0`}>{icon}</span>
      </div>
    </button>
  );
}

function Action({ icon, label, onClick, className = '' }: { icon: string; label: string; onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick} className={`bg-white rounded-xl border border-gray-200 p-4 flex flex-col items-center gap-1.5 hover:bg-gray-50 hover:border-gray-300 transition ${className}`}>
      <span className="text-2xl">{icon}</span>
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </button>
  );
}

function ScheduleSection({ items, onNavigate }: { items: Appt[]; onNavigate: (p: string) => void }) {
  const todayCount = items.filter((a) => a.start && new Date(a.start).toDateString() === new Date().toDateString()).length;
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">📅 Coming up{todayCount > 0 && <span className="text-gray-400 font-normal"> · {todayCount} today</span>}</h2>
        <button onClick={() => onNavigate('schedule')} className="text-xs text-blue-600 hover:underline">View schedule</button>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-400">Nothing scheduled soon.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {items.map((a, i) => (
            <button key={i} onClick={() => onNavigate('schedule')} className="w-full flex items-start gap-3 px-5 py-3 hover:bg-gray-50 text-left">
              <span className="text-base mt-0.5">{a.kind === 'inspection' ? '🔍' : a.kind === 'adjuster' ? '🧾' : '📌'}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{a.title || 'Appointment'}</p>
                <p className="text-xs text-gray-500 truncate">{apptWhen(a)}{a.address ? ` · ${a.address}` : ''}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
