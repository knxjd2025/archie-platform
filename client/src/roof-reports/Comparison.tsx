import { useCallback, useEffect, useRef, useState } from 'react';
import { COMPARE_NOT_FOUND } from '../../../shared/roof-reports';
import { fetchComparison } from './api';
import { buildComparison, type CompareRow, type Comparison, type Tone } from './compare-model';
import { RR, plainMessage } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const BUTTON = `px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${FOCUS}`;

export type ComparePhase = 'loading' | 'ready' | 'notfound' | 'failed';

export interface ComparisonViewProps {
  phase: ComparePhase;
  comparison: Comparison | null;
  /** A plain sentence for the person when the comparison could not be shown. */
  message: string | null;
  onBack: () => void;
  onRetry: () => void;
}

const SIDE: Record<Tone, string> = { plain: 'text-gray-900', good: 'text-emerald-700 font-semibold', bad: 'text-red-700 font-semibold' };

function RowView({ row }: { row: CompareRow }) {
  // A row that differs is shaded and also says so in its last column: the words carry the meaning, the shade only helps.
  const shade = row.difference === 'different' ? 'bg-amber-50' : '';
  return (
    <tr className={`border-t border-gray-100 align-top ${shade}`}>
      <th scope="row" className="py-2 pr-3 text-left text-sm font-medium text-gray-700">{row.label}</th>
      <td className={`py-2 px-3 text-sm ${SIDE[row.tone.a]}`}>{row.a}</td>
      <td className={`py-2 px-3 text-sm ${SIDE[row.tone.b]}`}>{row.b}</td>
      <td className={`py-2 pl-3 text-sm ${row.difference === 'different' ? 'text-amber-800' : 'text-gray-500'}`}>{row.note}</td>
    </tr>
  );
}

function FindingList({ title, items }: { title: string; items: Array<{ title: string; text: string }> }) {
  return (
    <div>
      <h5 className="text-sm font-semibold text-gray-800">{title}</h5>
      {items.length === 0 ? <p className="text-sm text-gray-500 mt-1">{RR.compare.findingsNone}</p> : (
        <ul className="mt-1 space-y-1">
          {items.map((f, i) => (
            <li key={`${f.title}-${i}`} className="text-sm text-gray-800"><span className="font-medium">{f.title}</span><span className="text-gray-500">. {f.text}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The comparison as it looks for the state it is handed. All the fetching lives in ComparisonPage below. */
export function ComparisonView(p: ComparisonViewProps) {
  return (
    <section className="space-y-4" aria-label={RR.compare.title} aria-busy={p.phase === 'loading'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900">{RR.compare.title}</h3>
        <button type="button" onClick={p.onBack} className={BUTTON}>{RR.compare.back}</button>
      </div>

      {p.phase === 'loading' && (
        <div role="status" className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-600">{RR.compare.comparing}</p>
          <div className="mt-3 h-1 rounded bg-gray-100 overflow-hidden"><div className="h-full w-1/3 bg-blue-400 animate-pulse rounded" /></div>
        </div>
      )}

      {(p.phase === 'notfound' || p.phase === 'failed') && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p role="alert" className="text-sm text-red-600 font-medium">{p.message || RR.compare.failed}</p>
          {p.phase === 'failed' && <button type="button" onClick={p.onRetry} className={`mt-3 ${BUTTON}`}>{RR.compare.retry}</button>}
        </div>
      )}

      {p.phase === 'ready' && p.comparison && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-5">
          <p className="text-sm text-gray-700" aria-live="polite">{p.comparison.summary}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse">
              <thead>
                <tr className="align-bottom">
                  <th scope="col" className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{RR.compare.metric}</th>
                  {p.comparison.columns.map((c) => (
                    <th key={c.label} scope="col" className="py-2 px-3 text-left">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{c.label}</span>
                      <span className="block text-sm font-medium text-gray-900">{c.address}</span>
                      <span className="block text-xs font-normal text-gray-500">{c.date}</span>
                    </th>
                  ))}
                  <th scope="col" className="py-2 pl-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{RR.compare.differs}</th>
                </tr>
              </thead>
              {p.comparison.sections.map((section) => (
                <tbody key={section.title}>
                  <tr><th colSpan={4} scope="colgroup" className="pt-4 pb-1 text-left text-sm font-semibold text-gray-900">{section.title}</th></tr>
                  {section.rows.map((row) => <RowView key={row.label} row={row} />)}
                </tbody>
              ))}
            </table>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FindingList title={RR.compare.findingsBoth} items={p.comparison.findings.both.map((f) => ({ title: f.title, text: f.note }))} />
            <FindingList title={RR.compare.findingsOnlyA} items={p.comparison.findings.onlyA.map((f) => ({ title: f.title, text: f.severity ? `Rated ${f.severity}.` : '' }))} />
            <FindingList title={RR.compare.findingsOnlyB} items={p.comparison.findings.onlyB.map((f) => ({ title: f.title, text: f.severity ? `Rated ${f.severity}.` : '' }))} />
          </div>
        </div>
      )}
    </section>
  );
}

/** The comparison of two reports: asks for both at once, and shows only a whole answer. */
export default function ComparisonPage({ a, b, onBack }: { a: string; b: string; onBack: () => void }) {
  const [phase, setPhase] = useState<ComparePhase>('loading');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const asked = useRef(0);

  const load = useCallback(() => {
    const id = ++asked.current;
    // The screen says it is working in the same frame as the click.
    setPhase('loading'); setComparison(null); setMessage(null);
    fetchComparison(a, b)
      .then((r) => {
        if (id !== asked.current) return;
        setComparison(buildComparison(r.a, r.b));
        setPhase('ready');
      })
      .catch((e) => {
        if (id !== asked.current) return;
        const text = plainMessage(e, RR.compare.failed);
        setMessage(text);
        // A report that is not there (or not the person's) is said so; nothing of the other is ever shown.
        setPhase(text === COMPARE_NOT_FOUND ? 'notfound' : 'failed');
      });
  }, [a, b]);

  useEffect(() => { load(); return () => { asked.current++; }; }, [load]);

  return <ComparisonView phase={phase} comparison={comparison} message={message} onBack={onBack} onRetry={load} />;
}
