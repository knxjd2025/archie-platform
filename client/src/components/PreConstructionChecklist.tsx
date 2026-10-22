import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { shrinkImage } from './JobPhotos';
import {

  PRECON_CHECKLIST_FIELDS,
  PRECON_CHECKLIST_SECTIONS,
  missingRequiredPreconFields,
  type ChecklistField,
  type ChecklistPhotoAnswer,
} from '../../../shared/preconstruction-checklist';

/**
 * A field's name is the only stable thing about it (the forms are data, not
 * JSX), so it is what the label and the control agree on. Without this the
 * label above each FieldInput named nothing, and a screen reader read out an
 * unlabelled box.
 */
const fieldId = (name: string) => `f-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

interface Checklist {
  id: number;
  jobExternalId: string;
  status: 'draft' | 'submitted';
  answers: Record<string, any>;
  submittedAt: string | null;
  createdAt: string | null;
}

export function PhotoField({ jobExternalId, field, value, onChange, disabled, prefix = 'Precon', description = 'Pre-Construction Checklist' }: {
  /** Uploaded file name prefix / JobTread description — the final walkthrough passes its own. */
  prefix?: string;
  description?: string;
  jobExternalId: string;
  field: ChecklistField;
  value: ChecklistPhotoAnswer[] | undefined;
  onChange: (v: ChecklistPhotoAnswer[]) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // A failed upload used to console.error and nothing else, so a rep saw the
  // spinner stop and assumed it saved. Every upload was in fact failing.
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [existing, setExisting] = useState<Array<{ url: string; name: string; fileId: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const items = value || [];

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setError(null);
    const added: ChecklistPhotoAnswer[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const { base64, contentType } = await shrinkImage(file);
        const stamp = new Date().toISOString().slice(0, 10);
        const r = await api.post<{ ok: boolean; fileId: string; name: string }>(`/api/clients/${jobExternalId}/photos`, {
          name: `${prefix} - ${field.name} - ${stamp}.jpg`,
          base64,
          contentType,
          description: `${description} — ${field.name}`,
        });
        added.push({ fileId: r.fileId, name: file.name });
      } catch (err: any) {
        console.error('precon photo upload failed', err);
        failed.push(`${file.name}: ${err?.message || 'upload failed'}`);
      }
    }
    setBusy(false);
    // Say which ones failed. Silence here is how a rep walks away believing
    // the site photos are on the job when none of them are.
    if (failed.length) setError(`${failed.length} photo${failed.length === 1 ? '' : 's'} did not save — ${failed[0]}`);
    if (added.length) onChange([...items, ...added]);
  };

  const removeAt = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  /** Photos already on the job — no reason to re-shoot what CompanyCam or a
      previous visit already captured. */
  const openPicker = async () => {
    if (picking) { setPicking(false); return; }
    setError(null);
    try {
      const r = await api.get<{ photos: Array<{ url: string; name: string; id: string }> }>(`/api/clients/${jobExternalId}/photos`);
      setExisting((r.photos || []).map((p) => ({ url: p.url, name: p.name, fileId: p.id })));
      setPicking(true);
    } catch (e: any) {
      setError(e?.message || "Couldn't load the job's photos.");
      setPicking(false);
    }
  };

  return (
    <div>
      {items.length > 0 && (
        <ul className="mb-2 space-y-1">
          {items.map((p, i) => (
            <li key={`${p.fileId}-${i}`} className="flex items-center justify-between text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1">
              <span className="truncate">📷 {p.name}</span>
              {!disabled && <button type="button" onClick={() => removeAt(i)} className="text-gray-400 hover:text-red-500 ml-2">✕</button>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50"
        >
          {busy ? 'Uploading…' : `＋ Add photo${items.length ? '' : 's'}`}
        </button>
      )}
      {!disabled && (
        <button
          type="button"
          onClick={openPicker}
          disabled={busy}
          className="ml-2 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50"
        >
          🖼 Use a photo already on the job
        </button>
      )}

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      {picking && (
        <div className="mt-2 border border-gray-200 rounded-lg p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-600">
              {existing.length ? `${existing.length} photo${existing.length === 1 ? '' : 's'} on this job` : 'Loading…'}
            </span>
            <button type="button" onClick={() => setPicking(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-56 overflow-y-auto">
            {existing.map((p) => {
              const chosen = items.some((x) => x.fileId === p.fileId);
              return (
                <button
                  key={p.fileId}
                  type="button"
                  title={p.name}
                  onClick={() => onChange(chosen
                    ? items.filter((x) => x.fileId !== p.fileId)
                    : [...items, { fileId: p.fileId, name: p.name }])}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 ${chosen ? 'border-brick' : 'border-transparent hover:border-gray-300'}`}
                >
                  <img src={p.url} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                  {chosen && <span className="absolute top-0.5 right-0.5 bg-brick text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">✓</span>}
                </button>
              );
            })}
          </div>
          {!existing.length && <p className="text-xs text-gray-400 py-2">No photos on this job yet.</p>}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" onChange={onPick} className="hidden" />
    </div>
  );
}

function FieldInput({ jobExternalId, field, value, onChange, disabled, id }: {
  jobExternalId: string;
  field: ChecklistField;
  value: any;
  onChange: (v: any) => void;
  disabled: boolean;
  id?: string;
}) {
  const base = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400';
  if (field.type === 'photo') {
    return <PhotoField jobExternalId={jobExternalId} field={field} value={value} onChange={onChange} disabled={disabled} />;
  }
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
        Confirmed
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
  if (field.type === 'longString') {
    return <textarea id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} className={base} />;
  }
  if (field.type === 'date') {
    return <input id={id} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />;
  }
  if (field.type === 'signature') {
    return <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Type your full name to sign" className={base} />;
  }
  return <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />;
}

// Mirrors server/production/columns.ts's PRODUCTION_COLUMNS (that file is
// server-only) — the stages where a down payment has been collected and
// install hasn't wrapped up yet, i.e. where this checklist is still relevant.
const PRECON_RELEVANT_STAGES = new Set(['Buyer Approved', 'Permitting', 'Schedule', 'Pre-Construction', 'Roof Construction', 'Other Construction Work']);

/** Sales rep's pre-construction checklist: site photos + homeowner talking points, filled at the point the down payment is collected. */
export default function PreConstructionChecklist({ jobExternalId, stage }: { jobExternalId: string; stage?: string | null }) {
  const { user } = useAuth();

  const [checklist, setChecklist] = useState<Checklist | null>(null);
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

  const load = () => api.get<{ checklists: Checklist[] }>(`/api/preconstruction?jobExternalId=${encodeURIComponent(jobExternalId)}`)
    .then((r) => {
      const latest = (r.checklists || [])[0] || null;
      setChecklist(latest);
      setAnswers(latest?.answers || {});
    })
    .catch(() => {})
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, [jobExternalId]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // See InspectionForm: a ref, because two thumb taps share a render pass and a
  // state flag would still read false on the second — creating two checklists
  // for one job.
  const starting = useRef(false);

  const startDraft = async () => {
    if (starting.current) return;
    starting.current = true;
    try {
      const r = await api.post<{ checklist: Checklist }>('/api/preconstruction', { jobExternalId, answers: { 'Rep Name': user?.name } });
      setChecklist(r.checklist);
      setAnswers(r.checklist.answers || {});
      setOpen(true);
    } catch (e: any) {
      flash(`Couldn't start: ${e?.message || 'failed'}`);
      starting.current = false;
    }
  };

  const setField = (name: string, value: any) => {
    const next = { ...answers, [name]: value };
    setAnswers(next);
    if (!checklist || checklist.status !== 'draft') return;
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
    if (!checklist || !Object.keys(changed).length) return true;
    unsaved.current = {};
    setSaving(true);
    const p = api.patch(`/api/preconstruction/${checklist.id}`, { answers: changed })
      .then(() => true, () => { unsaved.current = { ...changed, ...unsaved.current }; return false; })
      .finally(() => setSaving(false));
    inFlight.current = p;
    const ok = await p;
    if (inFlight.current === p) inFlight.current = null;
    return ok;
  };

  const missing = missingRequiredPreconFields(answers);

  const submit = async () => {
    if (!checklist || missing.length) return;
    setSubmitting(true);
    try {
      // The last answer typed within the 800ms autosave window was still
      // sitting in the timer when Submit went up, so the server judged (and
      // locked) the checklist without it — and the late save then hit a
      // submitted checklist and was lost. Send it first; if that fails, stop.
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      if (!(await flushSave())) { flash("Couldn't save your last change — not submitted. Try again."); return; }
      const r = await api.post<{ checklist: Checklist }>(`/api/preconstruction/${checklist.id}/submit`, {});
      setChecklist(r.checklist);
      flash('Pre-construction checklist submitted ✅');
    } catch (e: any) { flash(`Couldn't submit: ${e?.message || 'failed'}`); }
    finally { setSubmitting(false); }
  };

  if (loading) return null;

  const needsReminder = checklist?.status !== 'submitted' && !!stage && PRECON_RELEVANT_STAGES.has(stage);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {needsReminder && (
        <div className="px-4 py-2 text-xs font-medium bg-amber-50 text-amber-800 border-b border-amber-100">
          ⚠️ Pre-construction checklist not completed yet
        </div>
      )}
      <button onClick={() => (checklist ? setOpen((o) => !o) : startDraft())} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="text-left">
          <h2 className="text-sm font-semibold text-gray-800">Pre-Construction Checklist</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {!checklist && 'Not started yet — tap to begin, once the down payment is collected.'}
            {checklist?.status === 'draft' && `In progress · ${missing.length ? `${missing.length} required item${missing.length === 1 ? '' : 's'} left` : 'ready to submit'}`}
            {checklist?.status === 'submitted' && `Submitted ${fmtDate(checklist.submittedAt) || ''}`}
          </p>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${checklist?.status === 'draft' ? 'bg-amber-100 text-amber-700' : checklist ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {checklist?.status || 'not started'}
        </span>
      </button>

      {toast && <div className="mx-4 mt-3 rounded-lg bg-gray-900 text-white text-sm px-4 py-2">{toast}</div>}

      {open && checklist && (
        <div className="p-4 space-y-5">
          {checklist.status !== 'draft' && (
            <p className="text-xs text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-lg px-3 py-2">
              Locked — this checklist was submitted{checklist.submittedAt ? ` on ${fmtDate(checklist.submittedAt)}` : ''}.
            </p>
          )}

          {PRECON_CHECKLIST_SECTIONS.map((section) => (
            <details key={section} open className="border border-gray-100 rounded-lg">
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-700 bg-gray-50 rounded-t-lg">{section}</summary>
              <div className="p-3 space-y-3">
                {PRECON_CHECKLIST_FIELDS.filter((f) => f.section === section).map((f) => (
                  <div key={f.name}>
                    <label htmlFor={fieldId(f.name)} className="block text-xs font-semibold text-gray-600 mb-1">
                      {f.name}{f.isRequired && <span className="text-red-500"> *</span>}
                    </label>
                    {f.description && <p className="text-xs text-gray-400 mb-1">{f.description}</p>}
                    <fieldset disabled={checklist.status !== 'draft'}>
                      <FieldInput id={fieldId(f.name)} jobExternalId={jobExternalId} field={f} value={answers[f.name]} onChange={(v) => setField(f.name, v)} disabled={checklist.status !== 'draft'} />
                    </fieldset>
                  </div>
                ))}
              </div>
            </details>
          ))}

          {checklist.status === 'draft' && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{saving ? 'Saving…' : 'Autosaved'}</span>
              <button onClick={submit} disabled={submitting || missing.length > 0} className="text-sm px-4 py-2 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50">
                {submitting ? 'Submitting…' : missing.length ? `${missing.length} required item${missing.length === 1 ? '' : 's'} left` : 'Submit Checklist'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
