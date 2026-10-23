import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../lib/api';
import CommsVersionToggle from '../components/CommsVersionToggle';
import { fmtDate } from '../lib/format';

interface Job {
  externalId: string | null;
  customer: string;
  jobName: string | null;
  address: string | null;
  city: string | null;
  stage: string | null;
  jobNumber: string | null;
  rep: string | null;
  phone: string | null;
  email: string | null;
}
interface Doc {
  id: number; customer: string | null; jobRef: string | null; type: string | null;
  amount: number | null; status: string | null; issueDate: string | null; signedAt: string | null;
}
interface Report {
  reportId: string; jobExternalId: string; reportType: string | null;
  title: string | null; reportUrl: string | null; createdAt: string | null;
}
interface Summary {
  user: { name: string; email: string; role: string };
  scope: { effective: 'mine' | 'all'; denied: boolean; canSeeAll: boolean };
  windowDays: number;
  jobs: Job[];
  documents: Doc[];
  reports: Report[];
  stats: { jobs: number; documents: number; reports: number; byStage: Record<string, number> };
}
interface Conversation {
  id: string; source: string; channel: string; contact: string;
  lastMessage: string; direction: string; date: number;
}

const CHANNEL_ICON: Record<string, string> = {
  sms: '💬', call: '📞', email: '✉️', chat: '💬', note: '📝', other: '•',
};

const money = (n: number | null): string =>
  n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');

/**
 * "My account" — the jobs I own, the paperwork on them, and the last 30 days of
 * conversation. Messages come from the same multi-source feed the Messages page
 * uses (GHL texts/calls, Gmail, JobTread comments), so this page adds a window
 * and a rollup rather than a second source of truth.
 */
export default function AccountPage({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');

  const [convos, setConvos] = useState<Conversation[] | null>(null);
  const [convoError, setConvoError] = useState<string | null>(null);
  const [tab, setTab] = useState<'jobs' | 'docs' | 'messages'>('jobs');

  // Switching mine/all quickly can land the responses out of order, showing
  // one scope's numbers while the other is selected.
  const summaryId = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((n) => n + 1);

  useEffect(() => {
    const id = ++summaryId.current;
    setLoading(true);
    setError(null);
    api.get<Summary>(`/api/account/summary?scope=${scope}`)
      .then((r) => { if (id !== summaryId.current) return; setData(r); setError(null); })
      .catch((e) => { if (id === summaryId.current) setError(e?.message || 'Could not load your account.'); })
      .finally(() => { if (id === summaryId.current) setLoading(false); });
  }, [scope, attempt]);

  // The conversation feed hits three live services, so it loads on its own and
  // never blocks the jobs and documents that come straight from our database.
  const loadConvos = () => {
    setConvoError(null);
    api.get<{ conversations: Conversation[] }>('/api/conversations')
      .then((r) => setConvos(r.conversations || []))
      .catch((e) => setConvoError(e?.message || 'Could not load messages.'));
  };
  useEffect(() => { loadConvos(); }, []);

  const windowDays = data?.windowDays ?? 30;
  const recent = useMemo(() => {
    if (!convos) return null;
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return convos.filter((c) => c.date >= cutoff).sort((a, b) => b.date - a.date);
  }, [convos, windowDays]);

  if (loading && !data) {
    return <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>;
  }
  // A failure used to replace the whole page, Mine/Everyone toggle included,
  // with no way to try again short of leaving. With nothing to show yet the
  // error gets a Retry; once there is data it sits inline above it.
  if (!data) {
    return (
      <div className="p-6 text-center text-sm text-red-600 space-y-2">
        <p>{error || 'Could not load your account.'}</p>
        <button onClick={retry} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">Retry</button>
      </div>
    );
  }

  const stages = Object.entries(data.stats.byStage).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{data.user.name || data.user.email}</h1>
          <p className="text-sm text-gray-500 capitalize">{data.user.role} · {data.user.email}</p>
        </div>
        {data.scope.canSeeAll && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['mine', 'all'] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} aria-pressed={scope === s}
                className={`px-3 py-1.5 ${scope === s ? 'bg-ink text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {s === 'mine' ? 'My book' : 'Everyone'}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <span>{error}</span>
          <button onClick={retry} className="underline hover:no-underline">Retry</button>
        </div>
      )}

      {data.scope.denied && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          You can only see your own clients, so this is your book.
        </p>
      )}

      <CommsVersionToggle />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { v: data.stats.jobs, k: 'Active jobs' },
          { v: data.stats.documents, k: 'Signed docs' },
          { v: data.stats.reports, k: 'Roof reports' },
          { v: recent?.length ?? null, k: `Msgs · ${windowDays}d` },
        ].map((c) => (
          <div key={c.k} className="bg-white border border-gray-200 rounded-xl p-3 text-center">
            {c.v == null ? (
              convoError ? (
                <button onClick={loadConvos} title={`${convoError} — tap to retry`} className="flex items-center justify-center gap-1.5 h-8 w-full">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="text-lg font-semibold text-gray-400">—</span>
                </button>
              ) : (
                <div className="h-8 flex items-center justify-center">
                  <div className="h-5 w-6 bg-gray-100 rounded animate-pulse" />
                </div>
              )
            ) : (
              <div className="text-2xl font-semibold text-ink">{c.v}</div>
            )}
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mt-0.5">{c.k}</div>
          </div>
        ))}
      </div>

      {stages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stages.map(([stage, n]) => (
            <span key={stage} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">{stage} · {n}</span>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200">
        {([
          ['jobs', `Jobs (${data.stats.jobs})`],
          ['docs', `Docs (${data.stats.documents + data.stats.reports})`],
          ['messages', `Messages${recent ? ` (${recent.length})` : ''}`],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-brand text-brand font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'jobs' && (
        data.jobs.length === 0
          ? <p className="py-10 text-center text-sm text-gray-400">No active jobs assigned to you.</p>
          : <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
              {data.jobs.map((j) => (
                <button key={j.externalId || j.jobName} onClick={() => j.externalId && onOpenClient?.(j.externalId)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3">
                  <span className="text-lg mt-0.5">🏠</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 truncate">{j.customer}</span>
                    <span className="block text-xs text-gray-500 truncate">
                      {[j.address, j.city].filter(Boolean).join(', ') || j.jobName || ''}
                    </span>
                  </span>
                  <span className="text-xs text-gray-500 whitespace-nowrap">{j.stage || '—'}</span>
                </button>
              ))}
            </div>
      )}

      {tab === 'docs' && (
        data.documents.length === 0 && data.reports.length === 0
          ? <p className="py-10 text-center text-sm text-gray-400">No signed documents or roof reports on your jobs yet.</p>
          : <div className="space-y-3">
              {data.documents.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
                  {data.documents.map((d) => (
                    <div key={d.id} className="px-4 py-3 flex items-start gap-3">
                      <span className="text-lg mt-0.5">📄</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{d.customer || d.jobRef || 'Document'}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {d.type || 'Document'}{d.signedAt ? ` · signed ${fmtDate(d.signedAt)}` : d.issueDate ? ` · issued ${fmtDate(d.issueDate)}` : ''}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{money(d.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.reports.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
                  {data.reports.map((r) => (
                    <div key={r.reportId} className="px-4 py-3 flex items-start gap-3">
                      <span className="text-lg mt-0.5">🏠</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{r.title || r.reportType || 'Roof report'}</p>
                        <p className="text-xs text-gray-500">{r.createdAt ? fmtDate(r.createdAt) : ''}</p>
                      </div>
                      {r.reportUrl && (
                        <a href={r.reportUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline whitespace-nowrap">View</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
      )}

      {tab === 'messages' && (
        convoError ? (
          <div className="py-10 text-center text-sm text-red-600">
            <p>{convoError}</p>
            <button onClick={loadConvos} className="mt-2 text-xs underline hover:no-underline">Retry</button>
          </div>
        )
        : !recent ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        : recent.length === 0 ? <p className="py-10 text-center text-sm text-gray-400">No texts or emails in the last {windowDays} days.</p>
        : <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
            {recent.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-start gap-3">
                <span className="text-lg mt-0.5">{CHANNEL_ICON[c.channel] || '•'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.contact}</p>
                  <p className="text-xs text-gray-500 truncate">{c.lastMessage}</p>
                </div>
                <span className="text-[11px] text-gray-400 whitespace-nowrap">{fmtDate(new Date(c.date).toISOString())}</span>
              </div>
            ))}
          </div>
      )}
    </div>
  );
}
