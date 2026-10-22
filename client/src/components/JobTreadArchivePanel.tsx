/**
 * Progress of the JobTread backup — step one of leaving JobTread. It runs on
 * its own every 10 minutes until it's finished; "Run now" does a chunk
 * straight away. A step whose query JobTread rejected shows the error and can
 * be re-run once it's fixed. Admin only (the endpoints refuse anyone else, and
 * this hides itself when they do).
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';

interface StepError { at: string; where: string; message: string }
interface Step {
  step: string; status: string; counts: Record<string, number>; errors: StepError[];
  startedAt: string | null; finishedAt: string | null; updatedAt: string | null;
}
interface Status { steps: Step[]; totals: Record<string, number>; finished: boolean }

const STEP_LABEL: Record<string, string> = {
  jobs: 'Jobs',
  customFields: 'Custom field definitions',
  'documents:customerOrder': 'Estimates & proposals',
  'documents:customerInvoice': 'Invoices',
  'documents:vendorOrder': 'Purchase & work orders',
  'documents:vendorBill': 'Vendor bills',
  payments: 'Payments',
  jobDetail: 'Each job: custom fields, contacts, files, comments, daily logs, tasks',
  documentLines: 'Each document: line items',
};

const TOTAL_LABEL: Record<string, string> = {
  job: 'jobs', contact: 'contacts', customField: 'custom fields', document: 'documents', documentLine: 'line items',
  payment: 'payments', file: 'files', comment: 'comments', dailyLog: 'daily logs', task: 'tasks',
};

const STATUS_STYLE: Record<string, string> = {
  done: 'bg-emerald-100 text-emerald-700', running: 'bg-blue-100 text-blue-700',
  pending: 'bg-gray-100 text-gray-600', error: 'bg-red-100 text-red-700',
};

export default function JobTreadArchivePanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api.get<Status>('/api/jobtread-archive/status')
      .then(setStatus)
      .catch((e: any) => {
        if (/403|forbidden/i.test(String(e?.message))) setHidden(true);
        else setLoadError(e?.message || "Couldn't load the backup status");
      });
  };
  useEffect(load, []);

  const runNow = async () => {
    setBusy('run'); setNote('Running for up to 4 minutes…');
    try {
      const r = await api.post<{ run: { rowsWritten?: number; busy?: boolean }; status: Status }>('/api/jobtread-archive/run', {});
      setStatus(r.status);
      setNote(r.run.busy ? 'A run is already going — check back in a few minutes.' : `Saved ${r.run.rowsWritten ?? 0} records this run.`);
    } catch (e: any) { setNote(`Run failed: ${e?.message || 'unknown error'}`); }
    finally { setBusy(null); }
  };

  const rerun = async (step: string) => {
    setBusy(step);
    try { setStatus(await api.post<Status>(`/api/jobtread-archive/reset/${encodeURIComponent(step)}`, {})); setNote(`"${STEP_LABEL[step] || step}" will run again from the start.`); }
    catch (e: any) { setNote(`Couldn't reset: ${e?.message || 'failed'}`); }
    finally { setBusy(null); }
  };

  if (hidden) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">JobTread backup</h2>
          <p className="text-xs text-gray-500">A full copy of everything in JobTread, kept in this app. Runs by itself every 10 minutes until done.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={!!busy} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 disabled:opacity-50">Refresh</button>
          <button onClick={runNow} disabled={!!busy || status?.finished} className="text-xs px-3 py-1.5 rounded-lg bg-brick text-white font-medium disabled:opacity-50">{busy === 'run' ? 'Running…' : 'Run now'}</button>
        </div>
      </div>

      {note && <p className="px-4 pt-3 text-xs text-gray-600">{note}</p>}
      {loadError && (
        <div className="px-4 py-3 text-sm text-red-600 flex items-center gap-2">
          <span>{loadError}</span><button onClick={load} className="underline">Retry</button>
        </div>
      )}

      {status && (
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-700">
            {status.finished ? '✅ Finished. ' : '⏳ In progress. '}
            {Object.keys(status.totals).length
              ? Object.entries(status.totals).map(([k, n]) => `${n.toLocaleString()} ${TOTAL_LABEL[k] || k}`).join(' · ')
              : 'Nothing saved yet.'}
          </p>
          <ul className="divide-y divide-gray-50">
            {status.steps.map((s) => (
              <li key={s.step} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-800">{STEP_LABEL[s.step] || s.step}</span>
                  <span className="flex items-center gap-2">
                    {s.counts?.records != null && <span className="text-xs text-gray-400">{s.counts.records.toLocaleString()}</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[s.status] || STATUS_STYLE.pending}`}>{s.status}</span>
                    {(s.status === 'error' || s.status === 'done' || s.errors?.length > 0) && (
                      <button onClick={() => rerun(s.step)} disabled={!!busy} className="text-xs text-blue-600 hover:underline disabled:opacity-50">Run again</button>
                    )}
                  </span>
                </div>
                {s.errors?.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-xs text-red-600 cursor-pointer">{s.errors.length} error{s.errors.length === 1 ? '' : 's'} (latest {fmtDate(s.errors[s.errors.length - 1].at)})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {s.errors.slice(-5).map((e, i) => <li key={i} className="text-[11px] text-gray-500 break-words"><b>{e.where}</b>: {e.message}</li>)}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
