import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { PhotoField } from './PreConstructionChecklist';
import type { ChecklistField } from '../../../shared/preconstruction-checklist';
import {

  WALKTHROUGH_FIELDS, WALKTHROUGH_SECTIONS, WALKTHROUGH_RELEVANT_STAGES, VERIFY_LABELS,
  missingRequiredWalkthroughFields, walkthroughIssues, walkthroughTally, verifyAnswer,
  type VerifyState,
} from '../../../shared/final-walkthrough';

/**
 * A field's name is the only stable thing about it (the forms are data, not
 * JSX), so it is what the label and the control agree on. Without this the
 * label above each FieldInput named nothing, and a screen reader read out an
 * unlabelled box.
 */
const fieldId = (name: string) => `f-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/**
 * The Final Walkthrough — sales rep or PM, once the crew is off the roof.
 * Same shape as PreConstructionChecklist; the new piece is the Pass / Issue /
 * N/A row per inspection point, where an Issue needs a note and becomes a
 * follow-up when the walkthrough is submitted.
 */

interface Walkthrough {
  id: number;
  jobExternalId: string;
  status: 'draft' | 'submitted';
  answers: Record<string, any>;
  issueCount: number;
  submittedAt: string | null;
  createdAt: string | null;
}

const STATES: VerifyState[] = ['ok', 'issue', 'na'];
const STATE_STYLE: Record<VerifyState, string> = {
  ok: 'bg-emerald-600 text-white border-emerald-600',
  issue: 'bg-red-600 text-white border-red-600',
  na: 'bg-gray-500 text-white border-gray-500',
};

function VerifyField({ value, onChange, disabled }: { value: any; onChange: (v: { state: VerifyState; note?: string }) => void; disabled: boolean }) {
  const a = verifyAnswer(value);
  return (
    <div>
      <div className="flex gap-1.5" role="radiogroup">
        {STATES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={a?.state === s} disabled={disabled}
            onClick={() => onChange({ state: s, ...(s === 'issue' ? { note: a?.note } : {}) })}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${a?.state === s ? STATE_STYLE[s] : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'} disabled:opacity-70`}>
            {s === 'ok' ? '✓ ' : s === 'issue' ? '⚠ ' : ''}{VERIFY_LABELS[s]}
          </button>
        ))}
      </div>
      {a?.state === 'issue' && (
        <textarea value={a.note ?? ''} onChange={(e) => onChange({ state: 'issue', note: e.target.value })} rows={2} disabled={disabled}
          placeholder="What's wrong and where — this becomes a follow-up when you submit."
          className="mt-1.5 w-full text-sm border border-red-200 bg-red-50/40 rounded-lg px-3 py-2 focus:ring-1 focus:ring-red-400" />
      )}
    </div>
  );
}

function FieldInput({ jobExternalId, field, value, onChange, disabled, id }: { jobExternalId: string; field: ChecklistField; value: any; onChange: (v: any) => void; disabled: boolean; id?: string }) {
  const base = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400';
  if (field.type === 'verify') return <VerifyField value={value} onChange={onChange} disabled={disabled} />;
  if (field.type === 'photo') return <PhotoField jobExternalId={jobExternalId} field={field} value={value} onChange={onChange} disabled={disabled} prefix="Walkthrough" description="Final Walkthrough" />;
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
        Done
      </label>
    );
  }
  if (field.type === 'option') {
    return (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">Select…</option>
        {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === 'longString') return <textarea id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} className={base} />;
  if (field.type === 'date') return <input id={id} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />;
  if (field.type === 'signature') return <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Type full name to sign" className={base} />;
  return <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />;
}

const RELEVANT = new Set(WALKTHROUGH_RELEVANT_STAGES);

export default function FinalWalkthrough({ jobExternalId, stage }: { jobExternalId: string; stage?: string | null }) {
  const { user } = useAuth();
  const [wt, setWt] = useState<Walkthrough | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000); };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the answers changed since the last save go up; the server merges
  // them onto what it has, so a second tab or a late save can't wipe answers
  // it never touched. A failed save keeps its changes for the next one.
  const unsaved = useRef<Record<string, any>>({});
  const starting = useRef(false);

  const load = () => api.get<{ walkthroughs: Walkthrough[] }>(`/api/final-walkthrough?jobExternalId=${encodeURIComponent(jobExternalId)}`)
    .then((r) => { const latest = (r.walkthroughs || [])[0] || null; setWt(latest); setAnswers(latest?.answers || {}); })
    .catch(() => {})
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, [jobExternalId]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const startDraft = async () => {
    if (starting.current) return;
    starting.current = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const role = user?.role === 'production' ? 'Project Manager' : 'Sales Rep';
      const r = await api.post<{ walkthrough: Walkthrough }>('/api/final-walkthrough', { jobExternalId, answers: { 'Walked by': user?.name, Role: role, Date: today } });
      setWt(r.walkthrough); setAnswers(r.walkthrough.answers || {}); setOpen(true);
    } catch (e: any) { flash(`Couldn't start: ${e?.message || 'failed'}`); starting.current = false; }
  };

  const setField = (name: string, value: any) => {
    const next = { ...answers, [name]: value };
    setAnswers(next);
    if (!wt || wt.status !== 'draft') return;
    unsaved.current = { ...unsaved.current, [name]: value };
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
    if (!wt || !Object.keys(changed).length) return true;
    unsaved.current = {};
    setSaving(true);
    const p = api.patch(`/api/final-walkthrough/${wt.id}`, { answers: changed })
      .then(() => true, () => { unsaved.current = { ...changed, ...unsaved.current }; return false; })
      .finally(() => setSaving(false));
    inFlight.current = p;
    const ok = await p;
    if (inFlight.current === p) inFlight.current = null;
    return ok;
  };

  const missing = missingRequiredWalkthroughFields(answers);
  const issues = walkthroughIssues(answers);
  const tally = walkthroughTally(answers);

  const submit = async () => {
    if (!wt || missing.length) return;
    setSubmitting(true);
    try {
      // The last answer typed within the 800ms autosave window was still
      // sitting in the timer when Submit went up, so follow-ups were built from
      // answers without it — and the late save then hit a submitted
      // walkthrough and was lost. Send it first; if that fails, stop.
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      if (!(await flushSave())) { flash("Couldn't save your last change — not submitted. Try again."); return; }
      const r = await api.post<{ walkthrough: Walkthrough; followUps: number }>(`/api/final-walkthrough/${wt.id}/submit`, {});
      setWt(r.walkthrough);
      flash(r.followUps ? `Walkthrough submitted ✅ — ${r.followUps} follow-up${r.followUps === 1 ? '' : 's'} created for the issues found` : 'Walkthrough submitted ✅ — no issues found');
    } catch (e: any) { flash(`Couldn't submit: ${e?.message || 'failed'}`); }
    finally { setSubmitting(false); }
  };

  if (loading) return null;

  const due = wt?.status !== 'submitted' && !!stage && RELEVANT.has(stage);
  const locked = !!wt && wt.status !== 'draft';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {due && (
        <div className="px-4 py-2 text-xs font-medium bg-amber-50 text-amber-800 border-b border-amber-100">
          ⚠️ Final walkthrough not done yet — nail sweep, damage check and cleanup before this job is called complete
        </div>
      )}
      <button onClick={() => (wt ? setOpen((o) => !o) : startDraft())} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="text-left">
          <h2 className="text-sm font-semibold text-gray-800">Final Walkthrough</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {!wt && 'Not started — tap to begin once the crew is off the roof.'}
            {wt?.status === 'draft' && `In progress · ${tally.ok} passed · ${tally.issue} issue${tally.issue === 1 ? '' : 's'} · ${missing.length ? `${missing.length} required item${missing.length === 1 ? '' : 's'} left` : 'ready to submit'}`}
            {wt?.status === 'submitted' && `Submitted ${fmtDate(wt.submittedAt) || ''} · ${wt.issueCount ? `${wt.issueCount} issue${wt.issueCount === 1 ? '' : 's'} → follow-ups` : 'no issues'}`}
          </p>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${wt?.status === 'draft' ? 'bg-amber-100 text-amber-700' : wt ? (wt.issueCount ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700') : 'bg-gray-100 text-gray-500'}`}>
          {wt?.status === 'submitted' ? (wt.issueCount ? `${wt.issueCount} open` : 'clean') : wt?.status || 'not started'}
        </span>
      </button>

      {toast && <div className="mx-4 mt-3 rounded-lg bg-gray-900 text-white text-sm px-4 py-2">{toast}</div>}

      {open && wt && (
        <div className="p-4 space-y-5">
          {locked && (
            <p className="text-xs text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-lg px-3 py-2">
              Locked — submitted{wt.submittedAt ? ` on ${fmtDate(wt.submittedAt)}` : ''}.
            </p>
          )}

          {issues.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold text-red-800 mb-1">Punch list — {issues.length} issue{issues.length === 1 ? '' : 's'}{locked ? ' (follow-ups created)' : ' (follow-ups will be created on submit)'}</p>
              <ul className="text-xs text-red-900 space-y-0.5">
                {issues.map((i) => <li key={i.item}>• <span className="text-red-700/70">[{i.section}]</span> {i.item}{i.note ? ` — ${i.note}` : ' — (needs a note)'}</li>)}
              </ul>
            </div>
          )}

          {WALKTHROUGH_SECTIONS.map((section) => {
            const fields = WALKTHROUGH_FIELDS.filter((f) => f.section === section);
            const sectionIssues = fields.filter((f) => verifyAnswer(answers[f.name])?.state === 'issue').length;
            return (
              <details key={section} open className="border border-gray-100 rounded-lg">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-700 bg-gray-50 rounded-t-lg flex items-center justify-between">
                  <span>{section}</span>
                  {sectionIssues > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">{sectionIssues} issue{sectionIssues === 1 ? '' : 's'}</span>}
                </summary>
                <div className="p-3 space-y-3">
                  {fields.map((f) => (
                    <div key={f.name}>
                      <label htmlFor={fieldId(f.name)} className="block text-xs font-semibold text-gray-600 mb-1">
                        {f.name}{f.isRequired && <span className="text-red-500"> *</span>}
                      </label>
                      {f.description && <p className="text-xs text-gray-400 mb-1">{f.description}</p>}
                      <fieldset disabled={locked}>
                        <FieldInput id={fieldId(f.name)} jobExternalId={jobExternalId} field={f} value={answers[f.name]} onChange={(val) => setField(f.name, val)} disabled={locked} />
                      </fieldset>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}

          {wt.status === 'draft' && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{saving ? 'Saving…' : 'Autosaved'}</span>
              <button onClick={submit} disabled={submitting || missing.length > 0} className="text-sm px-4 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">
                {submitting ? 'Submitting…' : missing.length ? `${missing.length} required item${missing.length === 1 ? '' : 's'} left` : issues.length ? `Submit — ${issues.length} issue${issues.length === 1 ? '' : 's'} → follow-ups` : 'Submit Walkthrough'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
