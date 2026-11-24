import { useEffect, useRef, useState } from 'react';
import type { DraftJob, WhereDraft } from './draft';
import { searchJobs, type JobResult } from './api';
import { US_STATES } from './states';
import { RR, plainMessage } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const FIELD = `w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 ${FOCUS}`;
const LABEL = 'block text-sm font-medium text-gray-700 mb-1';
const BUTTON = `px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 ${FOCUS}`;

export interface WhereViewProps {
  value: WhereDraft;
  onChange: (next: WhereDraft) => void;
  jobQuery: string;
  onJobQuery: (q: string) => void;
  jobResults: JobResult[];
  jobSearching: boolean;
  jobError: string | null;
  onPickJob: (job: DraftJob) => void;
  onRemoveJob: () => void;
}

const jobLabel = (r: JobResult) => (r.location ? `${r.name}, ${r.location}` : r.name);

/** Step 1 as it looks for the state it is handed. */
export function WhereView(p: WhereViewProps) {
  const set = (patch: Partial<WhereDraft>) => p.onChange({ ...p.value, ...patch });
  const searchedFor = p.jobQuery.trim().length >= 2;
  return (
    <div className="space-y-5">
      <h4 className="text-base font-semibold text-gray-900">{RR.where.title}</h4>

      <div className="grid gap-4 sm:grid-cols-6">
        <div className="sm:col-span-6">
          <label htmlFor="rr-address" className={LABEL}>{RR.where.address}</label>
          <input id="rr-address" value={p.value.address} onChange={(e) => set({ address: e.target.value })} maxLength={200} autoComplete="street-address" className={FIELD} />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="rr-city" className={LABEL}>{RR.where.city}</label>
          <input id="rr-city" value={p.value.city} onChange={(e) => set({ city: e.target.value })} maxLength={100} autoComplete="address-level2" className={FIELD} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="rr-state" className={LABEL}>{RR.where.state}</label>
          <select id="rr-state" value={p.value.state} onChange={(e) => set({ state: e.target.value })} autoComplete="address-level1" className={FIELD}>
            <option value="">{RR.where.chooseState}</option>
            {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-1">
          <label htmlFor="rr-zip" className={LABEL}>{RR.where.zip}</label>
          <input id="rr-zip" value={p.value.zip} onChange={(e) => set({ zip: e.target.value })} maxLength={10} inputMode="numeric" autoComplete="postal-code" className={FIELD} />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
        <div>
          <h5 className="text-sm font-semibold text-gray-800">{RR.where.jobHeading}</h5>
          <p id="rr-job-help" className="text-xs text-gray-500 mt-0.5">{RR.where.jobHelp}</p>
        </div>
        {p.value.job ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-800">{RR.where.linkedTo(p.value.job.label)}</p>
            <button type="button" onClick={p.onRemoveJob} className={BUTTON}>{RR.where.removeLink}</button>
          </div>
        ) : (
          <div aria-busy={p.jobSearching}>
            <label htmlFor="rr-job-search" className={LABEL}>{RR.where.jobSearch}</label>
            <input id="rr-job-search" type="search" value={p.jobQuery} onChange={(e) => p.onJobQuery(e.target.value)} maxLength={80} aria-describedby="rr-job-help" className={FIELD} />
            {p.jobSearching && (
              <div className="mt-2" role="status">
                <div className="h-1 w-24 rounded bg-gray-200 overflow-hidden"><div className="h-full w-1/3 bg-blue-400 animate-pulse rounded" /></div>
                <span className="text-xs text-gray-500">{RR.where.jobSearching}</span>
              </div>
            )}
            {p.jobError && <p role="alert" className="mt-2 text-sm text-red-600">{p.jobError}</p>}
            {!p.jobSearching && !p.jobError && searchedFor && p.jobResults.length === 0 && <p className="mt-2 text-sm text-gray-500">{RR.where.jobNone}</p>}
            {p.jobResults.length > 0 && (
              <ul aria-label={RR.where.jobFound} className="mt-2 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                {p.jobResults.map((r) => r.externalId && (
                  <li key={r.externalId}>
                    <button
                      type="button"
                      aria-label={RR.where.linkTo(jobLabel(r))}
                      onClick={() => p.onPickJob({ externalId: r.externalId as string, label: jobLabel(r) })}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${FOCUS}`}
                    >
                      <span className="font-medium text-gray-900">{r.name}</span>
                      {r.location && <span className="text-gray-500">, {r.location}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

const SEARCH_DELAY_MS = 250;

/** Step 1 with its job search: asked after a short pause, and only the newest answer is kept. */
export default function StepWhere({ value, onChange }: { value: WhereDraft; onChange: (next: WhereDraft) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JobResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    const q = query.trim();
    asked.current++;
    if (q.length < 2) { setResults([]); setSearching(false); setJobError(null); return; }
    setSearching(true); // the box shows it is looking in the same frame as the typing
    setJobError(null);
    const id = asked.current;
    const t = setTimeout(() => {
      searchJobs(q)
        .then((r) => { if (id === asked.current) setResults(r.results || []); })
        .catch((e) => { if (id === asked.current) { setResults([]); setJobError(plainMessage(e, RR.where.jobSearchFailed)); } })
        .finally(() => { if (id === asked.current) setSearching(false); });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <WhereView
      value={value}
      onChange={onChange}
      jobQuery={query}
      onJobQuery={setQuery}
      jobResults={results}
      jobSearching={searching}
      jobError={jobError}
      onPickJob={(job) => { onChange({ ...value, job }); setQuery(''); setResults([]); }}
      onRemoveJob={() => onChange({ ...value, job: null })}
    />
  );
}
