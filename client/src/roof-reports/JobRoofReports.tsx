import { useCallback, useEffect, useRef, useState } from 'react';
import type { TeamRole } from '../../../shared/rbac';
import { NOT_FOUND, decisionFor } from '../../../shared/roof-reports';
import { useAuth } from '../lib/auth';
import { fetchJobReports } from './api';
import { startFromJob, type JobLead, type JobStart } from './job-prefill';
import { rowView, type ReportRow } from './list-view';
import { RR, plainMessage } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const BUTTON = `px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 ${FOCUS}`;
const PRIMARY = `px-3 py-1.5 text-sm font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-dark ${FOCUS}`;

export type JobBlockPhase = 'hidden' | 'looking' | 'ready' | 'failed';

/**
 * Whether the block is drawn. Never before the app has said roof reports are
 * on for this person, and only after the server has said this job's reports
 * are theirs to see: a "not found" hides it, the same answer as a job that is
 * not theirs.
 */
export function jobBlockPhase(s: { allowed: boolean; answer: 'none' | 'ok' | 'error'; message?: string }): JobBlockPhase {
  if (!s.allowed) return 'hidden';
  if (s.answer === 'none') return 'looking';
  if (s.answer === 'ok') return 'ready';
  return s.message === NOT_FOUND ? 'hidden' : 'failed';
}

export interface JobReportsViewProps {
  role: TeamRole;
  phase: JobBlockPhase;
  reports: ReportRow[];
  error: string | null;
  onMake: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}

/** The block as it looks for the state it is handed. */
export function JobReportsView(p: JobReportsViewProps) {
  if (p.phase === 'hidden') return null;
  const mayMake = decisionFor(p.role, 'make') !== 'no';
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5" aria-label={RR.job.title} aria-busy={p.phase === 'looking' || undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{RR.job.title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{RR.job.help}</p>
        </div>
        {mayMake && p.phase !== 'looking' && <button type="button" onClick={p.onMake} className={PRIMARY}>{RR.job.make}</button>}
      </div>
      {p.phase === 'looking' && <p role="status" className="mt-3 text-sm text-gray-500">{RR.job.looking}</p>}
      {p.phase === 'failed' && (
        <div className="mt-3">
          <p role="alert" className="text-sm text-red-600">{p.error || RR.job.loadFailed}</p>
          <button type="button" onClick={p.onRetry} className={`mt-2 ${BUTTON}`}>{RR.job.retry}</button>
        </div>
      )}
      {p.phase === 'ready' && (p.reports.length === 0
        ? <p className="mt-3 text-sm text-gray-500">{RR.job.none}</p>
        : (
          <ul className="mt-3 divide-y divide-gray-100">
            {p.reports.map((r) => {
              const v = rowView(r, p.role);
              return (
                <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{v.headline}{v.place && <span className="font-normal text-gray-500">, {v.place}</span>}</p>
                    <p className="text-xs text-gray-500">{v.kinds} · {v.statusLabel} · {v.date}</p>
                    {v.note && <p className="text-xs text-gray-500">{v.note}</p>}
                  </div>
                  {v.canOpen && <button type="button" onClick={() => p.onOpen(r.id)} aria-label={RR.list.openFor(v.headline)} className={BUTTON}>{RR.list.open}</button>}
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}

/**
 * The block on the job page. Asks only when the app has said roof reports are
 * on for this person (the switch is on and the role may see reports), so with
 * the switch off no roof report request is made at all.
 */
export default function JobRoofReports({ externalId, lead, role, onMake, onOpen }: {
  externalId: string;
  lead: JobLead;
  role: TeamRole;
  onMake: (start: JobStart) => void;
  onOpen: (id: string) => void;
}) {
  const { roofReports } = useAuth();
  const [answer, setAnswer] = useState<'none' | 'ok' | 'error'>('none');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    if (!roofReports) return;
    setAnswer('none');
    fetchJobReports(externalId)
      .then((r) => { if (!alive.current) return; setReports(r.reports || []); setAnswer('ok'); })
      .catch((e) => { if (!alive.current) return; setMessage((e as { message?: string })?.message); setAnswer('error'); });
  }, [externalId, roofReports]);
  useEffect(() => { load(); }, [load]);

  const phase = jobBlockPhase({ allowed: roofReports, answer, message });
  return (
    <JobReportsView
      role={role}
      phase={phase}
      reports={reports}
      error={phase === 'failed' ? plainMessage({ message }, RR.job.loadFailed) : null}
      onMake={() => { const start = startFromJob({ ...lead, externalId }); if (start) onMake(start); }}
      onOpen={onOpen}
      onRetry={load}
    />
  );
}
