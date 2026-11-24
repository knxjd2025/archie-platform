import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptDraft, WizardDraft } from './draft';
import { LINE_EVERY_MS, attemptFor, buildGenerateBody, lineAt, statusLines } from './generate-flow';
import { runGeneration, type FlowState, type RunDeps } from './generate-run';
import { fetchReport, generateReport, retryReport } from './api';
import { RR } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const BUTTON = `px-4 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`;
const PRIMARY = `px-4 py-2 text-sm font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-dark disabled:opacity-50 ${FOCUS}`;

export interface GenerateViewProps {
  flow: FlowState;
  /** The line that changes while it waits. */
  line: string;
  /** "Try again" was pressed and the run has started again. */
  trying: boolean;
  onTryAgain: () => void;
  onBackToReview: () => void;
  onChangeAddress: () => void;
  onGoToReports: () => void;
}

/** Step 6 as it looks for the state it is handed. */
export function GenerateView(p: GenerateViewProps) {
  const f = p.flow;
  if (f.phase === 'cancelled') return null;
  if (f.phase === 'making') {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <h4 className="text-base font-semibold text-gray-900">{p.trying ? RR.generate.tryingAgain : RR.generate.making}</h4>
        <div className="h-1 rounded bg-gray-100 overflow-hidden" aria-hidden="true"><div className="h-full w-1/3 bg-blue-400 rounded animate-pulse" /></div>
        <p className="text-sm text-gray-800">{p.line}</p>
        <p className="text-sm text-gray-600">{RR.generate.takes}</p>
        <p className="text-xs text-gray-500">{RR.generate.refresh}</p>
      </div>
    );
  }
  if (f.phase === 'ready') return <p role="status" className="text-sm text-gray-800">{RR.generate.ready}</p>;
  if (f.phase === 'slow') {
    return (
      <div role="status" className="space-y-3">
        <p className="text-sm text-gray-800">{RR.generate.slow}</p>
        <button type="button" onClick={p.onGoToReports} className={PRIMARY}>{RR.generate.goToReports}</button>
      </div>
    );
  }
  const v = f.view;
  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-red-700">{v.sentence}</p>
      {v.note && <p className="text-sm text-gray-600">{v.note}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {v.canTryAgain && <button type="button" onClick={p.onTryAgain} aria-label={RR.generate.tryAgainFor} className={PRIMARY}>{RR.generate.tryAgain}</button>}
        {v.canChangeAddress && <button type="button" onClick={p.onChangeAddress} className={PRIMARY}>{RR.generate.changeAddress}</button>}
        <button type="button" onClick={p.onBackToReview} className={BUTTON}>{RR.generate.backToReview}</button>
      </div>
    </div>
  );
}

export interface MakeReportArgs {
  /** The draft as it stands now. */
  draft: WizardDraft;
  /** The ids of the photos that saved. */
  photoIds: string[];
  /** Records the attempt (and the step it moves to) in the draft, kept at once. */
  onAttempt: (attempt: AttemptDraft | null, step: number) => void;
  onReady: (reportId: string) => void;
}

const realDeps = (cancelled: () => boolean): RunDeps => ({
  generate: (body, key) => generateReport(body, key),
  retry: (id) => retryReport(id),
  status: (id) => fetchReport(id),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  cancelled,
});

/**
 * Making the report: starting it, picking it up again after a refresh, trying
 * again, and the waiting state. The screen shows "Making your report..." in the
 * same frame as the click; the run itself is runGeneration (tested with fakes).
 */
export function useMakeReport(args: MakeReportArgs) {
  const latest = useRef(args);
  latest.current = args;
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [trying, setTrying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const busy = useRef(false);
  const alive = useRef(true);
  const reportId = useRef<string | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback(async (mode: 'start' | 'retry', attempt: AttemptDraft) => {
    if (busy.current) return; // a second click while the first is under way starts nothing
    busy.current = true;
    startedAt.current = Date.now();
    setElapsed(0);
    const { draft, photoIds } = latest.current;
    const end = await runGeneration(
      realDeps(() => !alive.current),
      { mode, body: buildGenerateBody(draft, photoIds), key: attempt.key, id: mode === 'retry' ? reportId.current : null },
      (s) => { if (s.phase === 'making' && s.reportId) reportId.current = s.reportId; if (alive.current) setFlow(s); },
    );
    busy.current = false;
    if (end.phase === 'failed' && end.reportId) reportId.current = end.reportId;
    if (!alive.current || end.phase === 'cancelled') return;
    setTrying(false);
    setFlow(end);
    if (end.phase === 'ready') latest.current.onReady(end.reportId);
  }, []);

  /** From step 5: one attempt for this request, kept in the draft before anything is sent. */
  const begin = useCallback(() => {
    if (busy.current) return;
    const { draft, photoIds, onAttempt } = latest.current;
    const attempt = attemptFor(draft.attempt, buildGenerateBody(draft, photoIds));
    if (attempt.key !== draft.attempt?.key) reportId.current = null;
    onAttempt(attempt, 6);
    setFlow({ phase: 'making', reportId: null });
    void run('start', attempt);
  }, [run]);

  /** A refresh, or the wizard opened again, while an attempt is kept: the same request with the same key picks the report up. */
  const resume = useCallback(() => {
    const { draft } = latest.current;
    if (!draft.attempt || busy.current) return;
    setFlow({ phase: 'making', reportId: null });
    void run('start', draft.attempt);
  }, [run]);

  const tryAgain = useCallback(() => {
    const { draft } = latest.current;
    if (!draft.attempt || busy.current) return;
    setTrying(true);
    setFlow({ phase: 'making', reportId: reportId.current });
    void run(reportId.current ? 'retry' : 'start', draft.attempt);
  }, [run]);

  const clear = useCallback(() => { setFlow(null); setTrying(false); reportId.current = null; }, []);

  // The line changes while it waits.
  const waiting = flow?.phase === 'making';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(t);
  }, [waiting]);
  const lines = statusLines(args.draft.review.kinds, args.photoIds.length);
  return { flow, trying, line: lineAt(lines, Math.max(elapsed, 0)), begin, resume, tryAgain, clear, lineEveryMs: LINE_EVERY_MS };
}
