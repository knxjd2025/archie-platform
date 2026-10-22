import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { INSPECTION_FORM_FIELDS, INSPECTION_FORM_SECTIONS, missingRequiredFields, type InspectionField } from '../../../shared/inspection-form';
import { COMMERCIAL_INSPECTION_FIELDS, COMMERCIAL_INSPECTION_SECTIONS, missingRequiredCommercialFields } from '../../../shared/commercial-inspection-form';

/**
 * A field's name is the only stable thing about it (the forms are data, not
 * JSX), so it is what the label and the control agree on. Without this the
 * label above each FieldInput named nothing, and a screen reader read out an
 * unlabelled box.
 */
const fieldId = (name: string) => `f-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;


type FormKind = 'residential' | 'commercial';

interface Submission {
  id: number;
  jobExternalId: string;
  status: 'draft' | 'submitted' | 'reviewed';
  answers: Record<string, any>;
  recommendation: string | null;
  reviewedBy: string | null;
  signedAt: string | null;
  createdAt: string | null;
}

/** The two checklists, side by side: a steep-slope house and a low-slope building are different inspections. */
const FORMS: Record<FormKind, { title: string; hint: string; fields: InspectionField[]; sections: string[]; missing: (a: Record<string, any>) => string[] }> = {
  residential: { title: 'Field Inspection Form', hint: 'Not started yet — tap to begin the on-site checklist.', fields: INSPECTION_FORM_FIELDS, sections: INSPECTION_FORM_SECTIONS, missing: missingRequiredFields },
  commercial: { title: 'Commercial Roof Inspection', hint: 'Not started yet — tap to begin the low-slope assembly, condition and moisture checklist.', fields: COMMERCIAL_INSPECTION_FIELDS, sections: COMMERCIAL_INSPECTION_SECTIONS, missing: missingRequiredCommercialFields },
};
const recommendationsFor = (kind: FormKind) => FORMS[kind].fields.find((f) => f.name === 'Recommendation')!.options!;

interface StormCandidate { date: string; type: 'Hail' | 'Wind'; magnitude: string; distanceMiles: number | null }

/** Lets the rep pull verified NOAA storm dates near the job address and click one in, instead of typing a date from memory. */
function StormLookup({ jobExternalId, onPick }: { jobExternalId: string; onPick: (date: string, type: string) => void }) {
  const [candidates, setCandidates] = useState<StormCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ candidates: StormCandidate[] }>(`/api/inspections/storm-lookup?jobExternalId=${encodeURIComponent(jobExternalId)}`);
      setCandidates(r.candidates || []);
    } catch (e: any) {
      setError(e?.message || "Couldn't look up storm dates.");
    } finally { setLoading(false); }
  };

  return (
    <div className="mt-1.5">
      <button type="button" onClick={lookup} disabled={loading} className="text-xs px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50">
        {loading ? 'Looking up…' : '🔍 Pull storm dates near this address'}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      {candidates && (
        candidates.length === 0 ? (
          <p className="text-xs text-gray-400 mt-1">No verified hail or wind events found nearby.</p>
        ) : (
          <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto border border-gray-100 rounded-lg p-1.5">
            {candidates.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onPick(c.date.slice(0, 10), c.type)}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-blue-50 flex items-center justify-between gap-2"
              >
                <span>{c.date.slice(0, 10)} · {c.type} · {c.magnitude}</span>
                {c.distanceMiles != null && <span className="text-gray-400 whitespace-nowrap">{c.distanceMiles.toFixed(1)} mi</span>}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange, id }: { field: InspectionField; value: any; onChange: (v: any) => void; id?: string }) {
  const base = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400';
  if (field.type === 'option') {
    return (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">Select…</option>
        {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === 'longString') {
    return <textarea id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} className={base} />;
  }
  if (field.type === 'number') {
    return <input id={id} type="number" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />;
  }
  if (field.type === 'date') {
    return <input id={id} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />;
  }
  if (field.type === 'signature') {
    return <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Type your full name to sign" className={base} />;
  }
  return <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />;
}

/**
 * The field inspection checklist, filled by the rep on-site (not JobTread
 * — see shared/inspection-form.ts). Its answers feed report generation
 * directly. A commercial job (lead.propertyType, or the rep's choice before
 * starting) gets the low-slope checklist, which routes the job to the
 * commercial condition report and proposal.
 */
export default function InspectionForm({ jobExternalId, propertyType }: { jobExternalId: string; propertyType?: string | null }) {
  const { user } = useAuth();
  const isManagerPlus = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'sales_director';

  const [kind, setKind] = useState<FormKind>(String(propertyType || '').toLowerCase() === 'commercial' ? 'commercial' : 'residential');
  const form = FORMS[kind];
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the answers changed since the last save go up; the server merges
  // them onto what it has, so a second tab or a late save can't wipe answers
  // it never touched. A failed save keeps its changes for the next one.
  const unsaved = useRef<Record<string, any>>({});

  const load = () => api.get<{ submissions: Submission[] }>(`/api/inspections?jobExternalId=${encodeURIComponent(jobExternalId)}`)
    .then((r) => {
      const latest = (r.submissions || [])[0] || null;
      setSubmission(latest);
      setAnswers(latest?.answers || {});
      // An existing submission fixes the checklist — its answers are keyed by that schema.
      // The kind travels inside the answers (__formKind); a commercial checklist is also recognisable by its own fields.
      if (latest) setKind(latest.answers?.__formKind === 'commercial' || 'Deck type' in (latest.answers || {}) ? 'commercial' : 'residential');
    })
    .catch(() => {})
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, [jobExternalId]);
  // The debounced autosave timer wasn't cleared on unmount — navigating away
  // right after typing still fired the save later and called setSaving on an
  // unmounted component.
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // A ref, not state: two taps land in the same render pass, so a state flag
  // would still read false on the second one and POST a second draft. The
  // server inserts unconditionally, so that shows up as two inspections on the
  // same job — easy to do with a thumb on a phone.
  const starting = useRef(false);

  const startDraft = async () => {
    if (starting.current) return;
    starting.current = true;
    try {
      const r = await api.post<{ submission: Submission }>('/api/inspections', { jobExternalId, formKind: kind, answers: { 'Inspector Name': user?.name } });
      setSubmission(r.submission);
      setAnswers(r.submission.answers || {});
      setOpen(true);
    } catch (e: any) {
      flash(`Couldn't start: ${e?.message || 'failed'}`);
      starting.current = false; // let them retry a genuine failure
    }
  };

  const setFields = (patch: Record<string, any>) => {
    const next = { ...answers, ...patch };
    setAnswers(next);
    if (!submission || submission.status !== 'draft') return;
    unsaved.current = { ...unsaved.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      if (!(await flushSave())) flash('Autosave failed — your last change may not be saved.');
    }, 800);
  };

  // The save in flight, so submit can wait for it rather than race it.
  const inFlight = useRef<Promise<boolean> | null>(null);

  // Sends whatever hasn't been saved yet, after any save already on its way.
  // Resolves false when the save failed (its changes stay queued for the next).
  const flushSave = async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const changed = unsaved.current;
    if (!submission || !Object.keys(changed).length) return true;
    unsaved.current = {};
    setSaving(true);
    const p = api.patch(`/api/inspections/${submission.id}`, { answers: changed })
      .then(() => true, () => { unsaved.current = { ...changed, ...unsaved.current }; return false; })
      .finally(() => setSaving(false));
    inFlight.current = p;
    const ok = await p;
    if (inFlight.current === p) inFlight.current = null;
    return ok;
  };

  const setField = (name: string, value: any) => setFields({ [name]: value });

  const missing = useMemo(() => form.missing(answers), [answers, form]);

  const submit = async () => {
    if (!submission || missing.length) return;
    setSubmitting(true);
    try {
      // The last answer typed within the 800ms autosave window was still
      // sitting in the timer when Submit went up, so the server judged (and
      // locked) the inspection without it — and the late save then hit a
      // submitted inspection and was lost. Send it first; if that fails, stop.
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      if (!(await flushSave())) { flash("Couldn't save your last change — not submitted. Try again."); return; }
      const r = await api.post<{ submission: Submission }>(`/api/inspections/${submission.id}/submit`, {});
      setSubmission(r.submission);
      flash('Inspection submitted ✅');
    } catch (e: any) { flash(`Couldn't submit: ${e?.message || 'failed'}`); }
    finally { setSubmitting(false); }
  };

  const setRecommendation = async (recommendation: string) => {
    if (!submission) return;
    try {
      const r = await api.patch<{ submission: Submission }>(`/api/inspections/${submission.id}/review`, { recommendation });
      setSubmission(r.submission);
    } catch (e: any) { flash(`Couldn't save recommendation: ${e?.message || 'failed'}`); }
  };

  if (loading) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {!submission && (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-xs text-gray-500">
          <span>Checklist:</span>
          {(['residential', 'commercial'] as FormKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`px-2 py-0.5 rounded-md border ${kind === k ? 'bg-gray-800 text-white border-gray-800' : 'bg-white border-gray-200 text-gray-600'}`}>
              {k === 'residential' ? 'Residential (steep slope)' : 'Commercial (low slope)'}
            </button>
          ))}
        </div>
      )}
      <button onClick={() => (submission ? setOpen((o) => !o) : startDraft())} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="text-left">
          <h2 className="text-sm font-semibold text-gray-800">{form.title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {!submission && form.hint}
            {submission?.status === 'draft' && `In progress · ${missing.length ? `${missing.length} required field${missing.length === 1 ? '' : 's'} left` : 'ready to submit'}`}
            {submission?.status !== 'draft' && submission && `Submitted ${fmtDate(submission.signedAt) || ''}${submission.recommendation ? ` · Recommendation: ${submission.recommendation}` : ''}`}
          </p>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${submission?.status === 'draft' ? 'bg-amber-100 text-amber-700' : submission ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {submission?.status || 'not started'}
        </span>
      </button>

      {toast && <div className="mx-4 mt-3 rounded-lg bg-gray-900 text-white text-sm px-4 py-2">{toast}</div>}

      {open && submission && (
        <div className="p-4 space-y-5">
          {submission.status !== 'draft' && (
            <p className="text-xs text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-lg px-3 py-2">
              Locked — this inspection was submitted{submission.signedAt ? ` on ${fmtDate(submission.signedAt)}` : ''}. Start a new one from the job if conditions change.
            </p>
          )}

          {form.sections.filter((s) => s !== 'Review').map((section) => (
            <details key={section} open className="border border-gray-100 rounded-lg">
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-700 bg-gray-50 rounded-t-lg">{section}</summary>
              <div className="p-3 space-y-3">
                {form.fields.filter((f) => f.section === section).map((f) => (
                  <div key={f.name}>
                    <label htmlFor={fieldId(f.name)} className="block text-xs font-semibold text-gray-600 mb-1">
                      {f.name}{f.isRequired && <span className="text-red-500"> *</span>}
                    </label>
                    {f.description && <p className="text-xs text-gray-400 mb-1">{f.description}</p>}
                    <fieldset disabled={submission.status !== 'draft'}>
                      <FieldInput id={fieldId(f.name)} field={f} value={answers[f.name]} onChange={(v) => setField(f.name, v)} />
                    </fieldset>
                    {f.name === 'Storm Date' && submission.status === 'draft' && (
                      <StormLookup jobExternalId={jobExternalId} onPick={(date, type) => setFields({ 'Storm Date': date, 'Storm Type': type })} />
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}

          {submission.status === 'draft' && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{saving ? 'Saving…' : 'Autosaved'}</span>
              <button onClick={submit} disabled={submitting || missing.length > 0} className="text-sm px-4 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">
                {submitting ? 'Submitting…' : missing.length ? `${missing.length} required field${missing.length === 1 ? '' : 's'} left` : 'Submit Inspection'}
              </button>
            </div>
          )}

          {submission.status !== 'draft' && isManagerPlus && (
            <div className="border-t border-gray-100 pt-4">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Recommendation (reviewer)</label>
              <select value={submission.recommendation ?? ''} onChange={(e) => setRecommendation(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
                <option value="">Select…</option>
                {recommendationsFor(kind).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
