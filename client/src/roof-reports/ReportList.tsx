import { useCallback, useEffect, useRef, useState } from 'react';
import type { TeamRole } from '../../../shared/rbac';
import { KIND_FILTERS, pagingText, rowView, statusOptions, type ListFilters, type Paging, type ReportRow } from './list-view';
import { archiveReport, fetchReports } from './api';
import { RR, plainMessage } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const BUTTON = `px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`;

export type ListPhase = 'first' | 'ready' | 'reloading' | 'failed';

export interface ReportListViewProps {
  role: TeamRole;
  filters: ListFilters;
  reports: ReportRow[];
  paging: Paging;
  phase: ListPhase;
  loadError: string | null;
  /** Reports whose archive is waiting on the server. */
  busyIds: Record<string, boolean>;
  /** The one report being asked "archive this?". */
  confirmId: string | null;
  rowErrors: Record<string, string>;
  onSearch: (text: string) => void;
  onKind: (kind: ListFilters['kind']) => void;
  onStatus: (status: ListFilters['status']) => void;
  onPage: (page: number) => void;
  onRetry: () => void;
  /** Opens the report in the editor. */
  onOpen: (id: string) => void;
  onAskArchive: (id: string) => void;
  onCancelArchive: () => void;
  onArchive: (id: string) => void;
}

const TONE: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  busy: 'bg-amber-50 text-amber-700 border-amber-200',
  bad: 'bg-red-50 text-red-700 border-red-200',
  quiet: 'bg-gray-100 text-gray-600 border-gray-200',
};

/** The list as it looks for the state it is handed. All the waiting and asking lives in ReportList below. */
export function ReportListView(p: ReportListViewProps) {
  const loadingFirst = p.phase === 'first';
  const reloading = p.phase === 'reloading';
  const searching = p.filters.search.trim() !== '' || p.filters.kind !== '' || p.filters.status !== '';
  return (
    <section className="space-y-4" aria-label={RR.page.title}>
      <div className="flex flex-wrap items-end gap-3">
        <input
          type="search"
          value={p.filters.search}
          onChange={(e) => p.onSearch(e.target.value)}
          aria-label={RR.list.searchLabel}
          placeholder={RR.list.searchPlaceholder}
          maxLength={100}
          className={`flex-1 min-w-[12rem] px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg ${FOCUS}`}
        />
        <label className="block text-xs text-gray-500">
          <span className="block mb-1">{RR.list.statusLabel}</span>
          <select value={p.filters.status} onChange={(e) => p.onStatus(e.target.value as ListFilters['status'])} className={`text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-800 ${FOCUS}`}>
            {statusOptions(p.role).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          <span className="block mb-1">{RR.list.kindLabel}</span>
          <select value={p.filters.kind} onChange={(e) => p.onKind(e.target.value as ListFilters['kind'])} className={`text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-800 ${FOCUS}`}>
            {KIND_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="h-5 w-24" aria-hidden={!reloading}>
          {reloading && <div className="h-1 mt-2 rounded bg-gray-100 overflow-hidden"><div className="h-full w-1/3 bg-blue-400 animate-pulse rounded" /></div>}
        </div>
      </div>

      {loadingFirst ? (
        <div className="space-y-2" aria-busy="true" role="status" aria-label="Loading reports">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-100 rounded-xl border border-gray-200 animate-pulse" />)}
        </div>
      ) : p.phase === 'failed' ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-red-600 font-medium" role="alert">{p.loadError || RR.list.loadFailed}</p>
          <button type="button" onClick={p.onRetry} className={`mt-3 ${BUTTON}`}>{RR.list.retry}</button>
        </div>
      ) : p.reports.length === 0 ? (
        <div className="px-6 py-12 text-center bg-white rounded-xl border border-gray-200" aria-busy={reloading}>
          <p className="text-sm text-gray-600">{searching ? RR.list.noMatch : RR.list.emptyTitle}</p>
          {!searching && <p className="mt-1 text-sm text-gray-400">{RR.list.emptyHint}</p>}
        </div>
      ) : (
        <ul
          className={`bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden transition-opacity ${reloading ? 'opacity-60' : ''}`}
          aria-busy={reloading}
        >
          {p.reports.map((r) => {
            const v = rowView(r, p.role);
            const busy = !!p.busyIds[r.id];
            const asking = p.confirmId === r.id;
            const error = p.rowErrors[r.id];
            return (
              <li key={r.id} className={`px-4 py-3 transition-opacity ${busy ? 'opacity-50' : ''}`} aria-busy={busy}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm font-semibold text-gray-900 truncate">{v.headline}{v.place && <span className="font-normal text-gray-500">, {v.place}</span>}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{v.customer} · {v.kinds} · {v.date}</p>
                    {v.note && !error && <p className="text-xs text-gray-500 mt-1">{v.note}</p>}
                    {error && <p role="alert" className="text-xs text-red-600 mt-1">{error}</p>}
                  </div>
                  <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${TONE[v.tone]}`}>{v.statusLabel}</span>
                  <div className="flex items-center gap-2">
                    {busy ? (
                      <span role="status" className="text-sm text-gray-500">{RR.list.archiving}</span>
                    ) : asking ? (
                      <div role="group" aria-label={RR.list.archiveFor(v.headline)} className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-gray-700">{RR.list.confirmArchive}</span>
                        <button type="button" onClick={() => p.onArchive(r.id)} className={`${BUTTON} !bg-red-600 !text-white !border-red-600 hover:!bg-red-700`}>{RR.list.yesArchive}</button>
                        <button type="button" onClick={p.onCancelArchive} className={BUTTON}>{RR.list.keepIt}</button>
                      </div>
                    ) : (
                      <>
                        {v.canOpen && (
                          <button type="button" onClick={() => p.onOpen(r.id)} aria-label={RR.list.openFor(v.headline)} className={BUTTON}>{RR.list.open}</button>
                        )}
                        {v.canArchive && (
                          <button type="button" onClick={() => p.onAskArchive(r.id)} aria-label={RR.list.archiveFor(v.headline)} className={BUTTON}>{RR.list.archive}</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {p.reports.length > 0 && p.phase !== 'failed' && p.phase !== 'first' && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
          <p aria-live="polite">{pagingText(p.paging)}</p>
          <div className="flex gap-2">
            <button type="button" disabled={p.paging.page <= 1 || reloading} onClick={() => p.onPage(p.paging.page - 1)} className={BUTTON}>{RR.list.previous}</button>
            <button type="button" disabled={!p.paging.hasMore || reloading} onClick={() => p.onPage(p.paging.page + 1)} className={BUTTON}>{RR.list.next}</button>
          </div>
        </div>
      )}
    </section>
  );
}

const SEARCH_DELAY_MS = 300;
const EMPTY_PAGING: Paging = { page: 1, pageSize: 25, total: 0, hasMore: false };

/** The list with its asking, waiting and archiving. */
export default function ReportList({ role, onOpen, notice: flash }: { role: TeamRole; onOpen: (id: string) => void; notice?: string | null }) {
  const [typed, setTyped] = useState('');
  const [filters, setFilters] = useState<ListFilters>({ search: '', kind: '', status: '', page: 1 });
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [paging, setPaging] = useState<Paging>(EMPTY_PAGING);
  const [phase, setPhase] = useState<ListPhase>('first');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(flash ?? null);
  const asked = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((f: ListFilters) => {
    const id = ++asked.current;
    setPhase((p) => (p === 'first' ? 'first' : 'reloading'));
    fetchReports(f)
      .then((r) => {
        if (id !== asked.current) return; // an older answer arriving late
        setReports(r.reports || []);
        setPaging({ page: r.page, pageSize: r.pageSize, total: r.total, hasMore: r.hasMore });
        setLoadError(null);
        setPhase('ready');
      })
      .catch((e) => {
        if (id !== asked.current) return;
        setLoadError(plainMessage(e, RR.list.loadFailed));
        setPhase('failed');
      });
  }, []);

  useEffect(() => { load(filters); }, [filters, load]);

  // The typed text reaches the list after a short pause; until then the list already shows it is about to change.
  useEffect(() => {
    if (typed.trim() === filters.search.trim()) return;
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: typed, page: 1 })), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [typed, filters.search]);

  useEffect(() => {
    if (flash) noticeTimer.current = setTimeout(() => setNotice(null), 5000);
    return () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); };
  }, [flash]);

  const pendingSearch = typed.trim() !== filters.search.trim();
  const shownPhase: ListPhase = pendingSearch && phase === 'ready' ? 'reloading' : phase;

  const archive = async (id: string) => {
    setConfirmId(null);
    setRowErrors((e) => { const { [id]: _gone, ...rest } = e; return rest; });
    setBusyIds((b) => ({ ...b, [id]: true })); // the row dims in the same frame as the click
    try {
      await archiveReport(id);
      setReports((list) => list.filter((r) => r.id !== id));
      setPaging((p) => ({ ...p, total: Math.max(0, p.total - 1) }));
      setNotice(RR.list.archived);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 5000);
      // Pages after this one shift up by one; ask again so the page is whole.
      load(filters);
    } catch (e) {
      setRowErrors((errs) => ({ ...errs, [id]: plainMessage(e, RR.list.archiveFailed) }));
    } finally {
      setBusyIds((b) => { const { [id]: _done, ...rest } = b; return rest; });
    }
  };

  return (
    <div className="space-y-3">
      {notice && <p role="status" className="text-sm px-3 py-2 rounded-lg bg-gray-900 text-white">{notice}</p>}
      <ReportListView
        role={role}
        filters={{ ...filters, search: typed }}
        reports={reports}
        paging={paging}
        phase={shownPhase}
        loadError={loadError}
        busyIds={busyIds}
        confirmId={confirmId}
        rowErrors={rowErrors}
        onSearch={setTyped}
        onKind={(kind) => setFilters((f) => ({ ...f, kind, page: 1 }))}
        onStatus={(status) => setFilters((f) => ({ ...f, status, page: 1 }))}
        onPage={(page) => setFilters((f) => ({ ...f, page }))}
        onRetry={() => load(filters)}
        onOpen={onOpen}
        onAskArchive={setConfirmId}
        onCancelArchive={() => setConfirmId(null)}
        onArchive={archive}
      />
    </div>
  );
}
