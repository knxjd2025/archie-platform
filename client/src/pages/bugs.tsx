import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';

type BugStatus = 'new' | 'fixing' | 'fixed' | 'ignored';
type BugKind = 'report' | 'client_error' | 'server_error';

interface Bug {
  id: number;
  kind: BugKind;
  status: BugStatus;
  message: string;
  details: string | null;
  page: string | null;
  url: string | null;
  userEmail: string | null;
  userAgent: string | null;
  context: { trail?: { at: string; type: string; message: string }[]; [k: string]: unknown };
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  notes: string | null;
  hasScreenshot: boolean;
}

const TABS: { key: 'report' | 'caught'; label: string }[] = [
  { key: 'report', label: 'Reported by people' },
  { key: 'caught', label: 'Caught automatically' },
];

const FILTERS: { key: 'open' | BugStatus | 'all'; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'ignored', label: 'Ignored' },
  { key: 'all', label: 'All' },
];

const STATUS_STYLE: Record<BugStatus, string> = {
  new: 'bg-red-100 text-red-700',
  fixing: 'bg-amber-100 text-amber-700',
  fixed: 'bg-green-100 text-green-700',
  ignored: 'bg-gray-100 text-gray-500',
};

/** Admin-only: every bug report and every error the app caught on its own. */
export default function Bugs() {
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'report' | 'caught'>('report');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('open');
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ bugs: Bug[] }>('/api/bugs')
      .then((r) => { setBugs(r.bugs); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => bugs
    .filter((b) => (tab === 'report' ? b.kind === 'report' : b.kind !== 'report'))
    .filter((b) => (filter === 'all' ? true : filter === 'open' ? b.status === 'new' || b.status === 'fixing' : b.status === filter)),
  [bugs, tab, filter]);

  const openCount = (k: 'report' | 'caught') => bugs.filter((b) =>
    (k === 'report' ? b.kind === 'report' : b.kind !== 'report') && (b.status === 'new' || b.status === 'fixing')).length;

  const update = async (id: number, patch: { status?: BugStatus; notes?: string | null }) => {
    try {
      await api.patch(`/api/bugs/${id}`, patch);
      setBugs((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bugs</h1>
          <p className="text-sm text-gray-500">What people reported, and what the app caught going wrong on its own. Mark one fixed and it reopens if it happens again.</p>
        </div>
        <button onClick={load} className="text-sm px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50">Refresh</button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key} onClick={() => { setTab(t.key); setOpenId(null); }}
            className={`text-sm px-3 py-1.5 rounded-full font-medium ${tab === t.key ? 'bg-navy text-white' : 'bg-white border border-gray-200 text-gray-700'}`}
          >
            {t.label} {openCount(t.key) > 0 && <span className="ml-1 text-xs opacity-80">({openCount(t.key)} open)</span>}
          </button>
        ))}
        <span className="mx-1 border-l border-gray-200" />
        {FILTERS.map((f) => (
          <button
            key={f.key} onClick={() => setFilter(f.key)}
            className={`text-xs px-2.5 py-1 rounded-full ${filter === f.key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && !bugs.length ? <p className="text-sm text-gray-500">Loading…</p> : shown.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white rounded-xl border border-gray-200 p-6 text-center">Nothing here. 🎉</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((b) => (
            <BugRow key={b.id} bug={b} expanded={openId === b.id} onToggle={() => setOpenId(openId === b.id ? null : b.id)} onUpdate={update} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface BugRowProps {
  bug: Bug;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (id: number, patch: { status?: BugStatus; notes?: string | null }) => void;
}

function BugRow({ bug, expanded, onToggle, onUpdate }: BugRowProps) {
  const [notes, setNotes] = useState(bug.notes ?? '');
  const [shot, setShot] = useState<string | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const where = typeof bug.context?.where === 'string' ? bug.context.where : null;

  const loadShot = () => api.get<{ screenshot: string }>(`/api/bugs/${bug.id}/screenshot`)
    .then((r) => setShot(r.screenshot)).catch((e) => setShotError(e.message));

  return (
    <li className="bg-white rounded-xl border border-gray-200">
      <button onClick={onToggle} aria-expanded={expanded} className="w-full text-left p-4 flex items-start gap-3">
        <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 ${STATUS_STYLE[bug.status]}`}>{bug.status}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-900 break-words line-clamp-2">{bug.message}</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            {bug.kind === 'report' ? bug.userEmail : bug.kind === 'server_error' ? `Server · ${where ?? ''}` : `Browser · ${where ?? ''}`}
            {bug.page && ` · ${bug.page}`} · {timeAgo(bug.lastSeen)}
            {bug.hasScreenshot && ' · 📎'}
          </span>
        </span>
        {bug.kind !== 'report' && (
          <span className="text-xs font-semibold text-gray-700 bg-gray-100 rounded-full px-2 py-0.5 flex-shrink-0">{bug.occurrences}×</span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 text-sm border-t border-gray-100 pt-3">
          {bug.details && (
            <div>
              <p className="text-xs font-semibold text-gray-500">{bug.kind === 'report' ? 'What they were doing' : 'Stack'}</p>
              <pre className="whitespace-pre-wrap break-words text-xs bg-gray-50 rounded p-2 mt-1 max-h-60 overflow-auto">{bug.details}</pre>
            </div>
          )}
          <p className="text-xs text-gray-500">
            First seen {new Date(bug.firstSeen).toLocaleString()} · last {new Date(bug.lastSeen).toLocaleString()}
            {bug.kind !== 'report' && bug.userEmail && ` · last hit by ${bug.userEmail}`}
          </p>
          {bug.url && <p className="text-xs text-gray-500 break-all">URL: {bug.url}</p>}
          {bug.userAgent && <p className="text-xs text-gray-400 break-all">{bug.userAgent}</p>}

          {bug.hasScreenshot && (shot
            ? <img src={shot} alt="Screenshot sent with the report" className="max-h-96 rounded border border-gray-200" />
            : <button onClick={loadShot} className="text-xs text-blue-700 hover:underline">Show screenshot</button>)}
          {shotError && <p className="text-xs text-red-600">{shotError}</p>}

          {!!bug.context?.trail?.length && (
            <div>
              <p className="text-xs font-semibold text-gray-500">What happened just before</p>
              <ol className="mt-1 text-xs font-mono bg-gray-50 rounded p-2 max-h-48 overflow-auto space-y-0.5">
                {bug.context.trail.map((t, i) => (
                  <li key={i} className={t.type === 'error' || t.type === 'console' ? 'text-red-700' : 'text-gray-700'}>
                    <span className="text-gray-400">{new Date(t.at).toLocaleTimeString()}</span> [{t.type}] {t.message}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            {(['new', 'fixing', 'fixed', 'ignored'] as BugStatus[]).map((s) => (
              <button
                key={s} onClick={() => onUpdate(bug.id, { status: s })} disabled={bug.status === s}
                className={`text-xs px-2.5 py-1 rounded-full capitalize ${bug.status === s ? STATUS_STYLE[s] + ' font-semibold' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (what caused it, what fixed it)"
              className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
            />
            <button
              onClick={() => onUpdate(bug.id, { notes: notes.trim() || null })} disabled={(bug.notes ?? '') === notes}
              className="text-xs px-3 py-1.5 rounded-lg bg-navy text-white disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
