import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import LogKpiActivity from '../components/LogKpiActivity';
import GoalsCard from '../components/GoalsCard';

interface RepKpis {
  teamMemberId: number | null;
  name: string;
  doorKnocks: number;
  leadsContacted: number;
  reportsCreated: number;
  reportsPresented: number;
  referralsReceived: number;
  leadsGiven: number;
  leadsEntered: number;
}
interface Summary { range: string; reps: RepKpis[]; totals: Omit<RepKpis, 'teamMemberId' | 'name'> }

// Columns are declared once and drive the cards, the header, every row and the
// totals — adding a metric in six hand-written places is how one gets forgotten.
const COLUMNS: { key: keyof Omit<RepKpis, 'teamMemberId' | 'name'>; label: string; short: string; icon: string; color: string }[] = [
  { key: 'doorKnocks', label: 'Doors knocked', short: 'Doors knocked', icon: '🚪', color: 'bg-amber-50 text-amber-700' },
  { key: 'leadsContacted', label: 'Leads run', short: 'Leads run', icon: '📞', color: 'bg-blue-50 text-blue-700' },
  { key: 'reportsCreated', label: 'Reports made', short: 'Reports made', icon: '🏠', color: 'bg-indigo-50 text-indigo-700' },
  { key: 'reportsPresented', label: 'Reports presented', short: 'Presented', icon: '✅', color: 'bg-emerald-50 text-emerald-700' },
  { key: 'referralsReceived', label: 'Referrals received', short: 'Referrals in', icon: '🤝', color: 'bg-teal-50 text-teal-700' },
  { key: 'leadsGiven', label: 'Leads given', short: 'Leads given', icon: '🎯', color: 'bg-purple-50 text-purple-700' },
  { key: 'leadsEntered', label: 'Leads entered', short: 'Leads entered', icon: '📝', color: 'bg-sky-50 text-sky-700' },
];

const RANGES: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

export default function Kpis({ onOpenPlaybook }: { onOpenPlaybook?: (docId: string) => void } = {}) {
  const { user } = useAuth();
  const isManagerPlus = user?.role === 'admin' || user?.role === 'manager';
  const [range, setRange] = useState('today');
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tapping through ranges fires overlapping requests; without this the slower
  // one can land last and show "today" numbers under a "this week" heading.
  const requestId = useRef(0);

  // Named so a freshly logged referral can refresh the numbers immediately.
  const reload = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    api.get<Summary>(`/api/kpis/summary?range=${range}`)
      .then((r) => { if (id === requestId.current) setS(r); })
      .catch((e: any) => { if (id !== requestId.current) return; setS(null); setLoadError(e?.message || 'Could not load KPI data.'); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [range]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">KPIs</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isManagerPlus ? 'Doors knocked, leads run, and reports made across the team.' : 'Your doors knocked, leads run, and reports made.'}
        </p>
      </div>

      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)} aria-pressed={range === r.key} className={`px-3 py-1.5 text-sm rounded-full ${range === r.key ? 'bg-navy text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            {r.label}
          </button>
        ))}
      </div>
        <LogKpiActivity canPickRep={isManagerPlus} onLogged={reload} />

      <GoalsCard onOpenPlaybook={onOpenPlaybook} />

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {COLUMNS.map((c) => <div key={c.key} className="h-[4.5rem] bg-gray-100 rounded-xl border border-gray-200 animate-pulse" />)}
        </div>
      ) : loadError ? (
        <div className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
          <p>Couldn't load KPI data.</p>
          <button onClick={reload} className="mt-2 text-sm text-blue-600 hover:underline">Retry</button>
        </div>
      ) : !s || s.reps.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">No activity yet for this range.</p>
      ) : !isManagerPlus ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {COLUMNS.map((c) => <Stat key={c.key} label={c.label} value={s.totals[c.key]} icon={c.icon} color={c.color} />)}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">Rep</th>
                {COLUMNS.map((c) => <th key={c.key} className="px-4 py-3 font-medium text-right whitespace-nowrap">{c.icon} {c.short}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {s.reps.map((r) => (
                <tr key={r.teamMemberId ?? r.name}>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  {COLUMNS.map((c) => <td key={c.key} className="px-4 py-3 text-right text-gray-700">{(r[c.key] ?? 0).toLocaleString()}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200 font-semibold text-gray-900">
                <td className="px-4 py-3">Total</td>
                {COLUMNS.map((c) => <td key={c.key} className="px-4 py-3 text-right">{(s.totals[c.key] ?? 0).toLocaleString()}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5">{value.toLocaleString()}</p>
        </div>
        <span className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center text-lg flex-shrink-0`}>{icon}</span>
      </div>
    </div>
  );
}
