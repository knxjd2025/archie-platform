import { useRef, useState } from 'react';
import { assessLead } from '../../../shared/canvass-intelligence';
import { api } from '../lib/api';
import type { Property } from '../lib/canvass';
import type { Enrichment } from './CanvassEnrichment';

export default function CanvassAssessment({ p, enrichment }: { p: Property; enrichment: Enrichment | null }) {
  const assessment = assessLead(p, enrichment);
  const [review, setReview] = useState<{ text: string; generatedAt: string; fingerprint: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const fingerprint = JSON.stringify([p.id, p.status, p.labels, p.stormSummary, p.measurements, enrichment?.roofScore, enrichment?.roofMaterial]);
  async function reviewEvidence() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await api.post<{ text: string; generatedAt: string }>(`/api/canvass/${p.id}/assessment`, {});
      setReview({ ...result, fingerprint });
    } catch (e) { setError(e instanceof Error ? e.message : 'AI review could not be completed.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section aria-label="Property intelligence" className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
    <div className="flex flex-wrap justify-between gap-2">
      <div><h2 className="font-semibold text-gray-900">Property intelligence</h2><p className="text-xs text-gray-600">{assessment.priority} · {assessment.coverage}% evidence coverage</p></div>
      <div className="text-right"><strong className="text-2xl text-blue-800">{assessment.score ?? '—'}<span className="text-xs font-normal"> / 100</span></strong><p className="text-xs text-gray-600">Lead priority</p></div>
    </div>
    <p className="text-xs text-gray-500">Rules-based score v{assessment.version}; not a damage or conversion probability. Missing inputs receive no points. Coverage measures available inputs, not certainty.</p>
    <div className="grid gap-2 sm:grid-cols-3">{assessment.factors.map(f => <div key={f.label} className="bg-white rounded-lg border border-blue-100 p-3"><p className="text-xs font-semibold text-gray-800">{f.label} · {f.points}/{f.max}</p><p className="text-xs text-gray-600 mt-1">{f.detail}</p></div>)}</div>
    <p className="text-sm font-medium text-gray-800">Next action: {assessment.nextAction}</p>
    <details className="text-xs text-gray-600"><summary className="cursor-pointer font-medium">Evidence gaps ({assessment.gaps.length})</summary><ul className="list-disc pl-5 mt-2 space-y-1">{assessment.gaps.map(g => <li key={g}>{g}</li>)}</ul></details>
    <button type="button" onClick={reviewEvidence} disabled={busy} className="rounded-lg bg-ink text-white px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Reviewing evidence…' : 'AI review of this property'}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {review && <div aria-live="polite" className="rounded-lg bg-white border border-blue-100 p-3"><p className="text-xs font-semibold text-gray-700">AI review · {new Date(review.generatedAt).toLocaleString()}</p>{review.fingerprint !== fingerprint ? <p className="text-sm text-amber-800 mt-2">Property data changed. Run a new AI review for the current evidence.</p> : <p className="text-sm text-gray-700 whitespace-pre-wrap mt-2">{review.text}</p>}</div>}
  </section>;
}
