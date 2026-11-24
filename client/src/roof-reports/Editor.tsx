import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { TeamRole } from '../../../shared/rbac';
import { TEMPLATES, VISUAL_STYLES } from '../../../shared/roof-reports';
import { archiveReport, fetchReport, updateReport } from './api';
import {
  FRAME_SANDBOX, SaveChain, editsAllowed, emptyValues, fieldReducer, initialFields, previewSrc, readDetail, requestFor, valueOf, valuesOf,
  type FieldKey, type FieldsState, type ReportDetail,
} from './editor-model';
import { partialNotes, type PartialNote } from './generate-flow';
import { RR, plainMessage } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const BUTTON = `px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`;
const FIELD = `w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 ${FOCUS}`;

export interface StyleState { busy: boolean; error: string | null }
export interface ArchiveState { phase: 'idle' | 'asking' | 'busy'; error: string | null }

export interface EditorViewProps {
  role: TeamRole;
  detail: ReportDetail;
  fields: FieldsState;
  previewVersion: number;
  previewLoading: boolean;
  partial: PartialNote[];
  style: { template: StyleState; visualStyle: StyleState };
  archive: ArchiveState;
  onBack: () => void;
  onEdit: (key: FieldKey, text: string) => void;
  /** The person left the field, or pressed Try again. */
  onSave: (key: FieldKey) => void;
  onTemplate: (value: string) => void;
  onVisualStyle: (value: string) => void;
  onAskArchive: () => void;
  onCancelArchive: () => void;
  onArchive: () => void;
  onPreviewLoaded: () => void;
}

const idFor = (key: FieldKey) => `rr-edit-${key.replace(':', '-')}`;

function State({ fields, k, label }: { fields: FieldsState; k: FieldKey; label: string }) {
  const s = fields.status[k] ?? { status: 'idle' as const };
  if (s.status === 'idle') return null;
  if (s.status === 'failed') return <span role="alert" className="text-xs text-red-600">{s.error}</span>;
  return (
    <span role="status" className={`text-xs ${s.status === 'saved' ? 'text-emerald-700' : 'text-gray-500'}`}>
      {s.status === 'unsaved' ? RR.editor.unsaved : s.status === 'saving' ? RR.editor.saving : RR.editor.saved}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

interface FieldProps { fields: FieldsState; k: FieldKey; label: string; multiline?: boolean; rows?: number; type?: string; max: number; onEdit: EditorViewProps['onEdit']; onSave: EditorViewProps['onSave']; editable: boolean }

function Field(p: FieldProps) {
  const id = idFor(p.k);
  const s = p.fields.status[p.k] ?? { status: 'idle' as const };
  const value = valueOf(p.fields.values, p.k);
  const common = {
    id, value, maxLength: p.max, disabled: !p.editable, 'aria-busy': s.status === 'saving' || undefined,
    onChange: (e: { target: { value: string } }) => p.onEdit(p.k, e.target.value),
    onBlur: () => { if (s.status === 'unsaved') p.onSave(p.k); },
    className: FIELD,
  };
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="text-sm font-medium text-gray-800">{p.label}</label>
        <span className="flex items-center gap-2">
          <State fields={p.fields} k={p.k} label={p.label} />
          {s.status === 'failed' && <button type="button" onClick={() => p.onSave(p.k)} aria-label={RR.editor.tryFor(p.label)} className={`text-xs ${BUTTON} !py-0.5`}>{RR.editor.tryAgain}</button>}
        </span>
      </div>
      {p.multiline ? <textarea rows={p.rows ?? 4} {...common} /> : <input type={p.type ?? 'text'} autoComplete="off" {...common} />}
    </div>
  );
}

/** The editor as it looks for the state it is handed. All the saving and waiting lives in Editor below. */
export function EditorView(p: EditorViewProps) {
  const editable = editsAllowed(p.role);
  const v = p.fields.values;
  const findings = (p.detail.report?.structuredFindings as Array<{ title?: unknown }> | undefined) ?? [];
  const field = (k: FieldKey, label: string, o: Partial<FieldProps> = {}) => (
    <Field key={k} fields={p.fields} k={k} label={label} max={o.max ?? 200} onEdit={p.onEdit} onSave={p.onSave} editable={editable} {...o} />
  );
  return (
    <section className="space-y-4" aria-label={p.detail.title || p.detail.address}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={p.onBack} className={BUTTON}>{RR.editor.back}</button>
        <h3 className="text-lg font-semibold text-gray-900 min-w-0 truncate">{p.detail.title || p.detail.address}</h3>
      </div>

      {p.partial.length > 0 && (
        <ul className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 space-y-1" aria-label="What is missing from this report">
          {p.partial.map((n) => <li key={n.kind} className="text-sm text-amber-800">{n.sentence}</li>)}
        </ul>
      )}
      {!editable && <p className="text-sm text-gray-600">{RR.editor.readOnly}</p>}

      <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start">
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">{RR.editor.detailsTitle}</h4>
            {field('title', RR.editor.fieldTitle)}
            {field('customerName', RR.editor.fieldCustomerName)}
            {field('customerEmail', RR.editor.fieldCustomerEmail, { type: 'email', max: 254 })}
            {field('customerPhone', RR.editor.fieldCustomerPhone, { type: 'tel', max: 40 })}
            {field('inspectorNotes', RR.editor.fieldNotes, { multiline: true, rows: 4, max: 20000 })}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">{RR.editor.styleTitle}</h4>
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <label htmlFor="rr-edit-template" className="text-sm font-medium text-gray-800">{RR.editor.templateLabel}</label>
                {p.style.template.busy && <span role="status" className="text-xs text-gray-500">{RR.editor.saving}</span>}
              </div>
              <select id="rr-edit-template" value={p.detail.template} disabled={!editable || p.style.template.busy} onChange={(e) => p.onTemplate(e.target.value)} className={FIELD}>
                {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {p.style.template.error && <p role="alert" className="text-xs text-red-600 mt-1">{p.style.template.error}</p>}
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <label htmlFor="rr-edit-look" className="text-sm font-medium text-gray-800">{RR.editor.lookLabel}</label>
                {p.style.visualStyle.busy && <span role="status" className="text-xs text-gray-500">{RR.editor.saving}</span>}
              </div>
              <select id="rr-edit-look" value={p.detail.visualStyle ?? ''} disabled={!editable || p.style.visualStyle.busy} onChange={(e) => p.onVisualStyle(e.target.value)} className={FIELD}>
                <option value="">{RR.editor.lookDefault}</option>
                {VISUAL_STYLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {p.style.visualStyle.error && <p role="alert" className="text-xs text-red-600 mt-1">{p.style.visualStyle.error}</p>}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">{RR.editor.findingsTitle}</h4>
            {field('summary', RR.editor.fieldSummary, { multiline: true, rows: 5, max: 20000 })}
            {v.findings.length === 0
              ? <p className="text-sm text-gray-500">{RR.editor.noFindings}</p>
              : v.findings.map((_, i) => field(`finding:${i}` as FieldKey, RR.editor.finding(i + 1, typeof findings[i]?.title === 'string' ? (findings[i].title as string) : ''), { multiline: true, rows: 4, max: 20000 }))}
          </div>

          {editable && (
            <div className="pt-2 border-t border-gray-100">
              {p.archive.phase === 'asking' ? (
                <div role="group" aria-label={RR.editor.archive} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-700">{RR.editor.confirmArchive}</span>
                  <button type="button" onClick={p.onArchive} className={`${BUTTON} !bg-red-600 !text-white !border-red-600 hover:!bg-red-700`}>{RR.editor.yesArchive}</button>
                  <button type="button" onClick={p.onCancelArchive} className={BUTTON}>{RR.editor.keepIt}</button>
                </div>
              ) : p.archive.phase === 'busy' ? (
                <span role="status" className="text-sm text-gray-500">{RR.editor.archiving}</span>
              ) : (
                <button type="button" onClick={p.onAskArchive} className={BUTTON}>{RR.editor.archive}</button>
              )}
              {p.archive.error && <p role="alert" className="text-xs text-red-600 mt-1">{p.archive.error}</p>}
            </div>
          )}
        </div>

        <div className="relative lg:sticky lg:top-4">
          {p.previewLoading && <p role="status" className="absolute top-2 right-3 z-10 text-xs px-2 py-1 rounded bg-gray-900 text-white">{RR.editor.updatingPreview}</p>}
          <iframe
            title={RR.editor.previewTitle}
            src={previewSrc(p.detail.id, p.previewVersion)}
            sandbox={FRAME_SANDBOX}
            referrerPolicy="no-referrer"
            onLoad={p.onPreviewLoaded}
            className="w-full h-[70vh] rounded-xl border border-gray-200 bg-white"
          />
        </div>
      </div>
    </section>
  );
}

export type EditorMessageKind = 'loading' | 'loadFailed' | 'making' | 'failed' | 'missing';

/** What the editor says while there is no report to edit. */
export function EditorMessage({ kind, problem, onBack, onRetry }: { kind: EditorMessageKind; problem: string | null; onBack: () => void; onRetry: () => void }) {
  const text = kind === 'loading' ? RR.editor.opening
    : kind === 'loadFailed' ? RR.editor.loadFailed
    : kind === 'making' ? RR.editor.making
    : kind === 'missing' ? RR.editor.missing
    : plainMessage({ message: problem ?? '' }, RR.editor.couldNotFinish);
  return (
    <section className="space-y-4">
      <button type="button" onClick={onBack} className={BUTTON}>{RR.editor.back}</button>
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
        {kind === 'loading' ? <p role="status" aria-busy="true" className="text-sm text-gray-600">{text}</p> : <p role="alert" className="text-sm text-gray-700">{text}</p>}
        {(kind === 'loadFailed' || kind === 'making') && <button type="button" onClick={onRetry} className={`mt-3 ${BUTTON}`}>{RR.editor.retry}</button>}
      </div>
    </section>
  );
}

/** The editor: opens a report, saves each field when it is left, and archives. */
export default function Editor({ id, role, onBack, onArchived }: { id: string; role: TeamRole; onBack: () => void; onArchived: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'loadFailed' | 'ready' | 'making' | 'failed' | 'missing'>('loading');
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [fields, dispatch] = useReducer(fieldReducer, initialFields(emptyValues()));
  const [version, setVersion] = useState(1);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [style, setStyle] = useState<{ template: StyleState; visualStyle: StyleState }>({ template: { busy: false, error: null }, visualStyle: { busy: false, error: null } });
  const [archive, setArchive] = useState<ArchiveState>({ phase: 'idle', error: null });
  const confirmed = useRef<Record<string, unknown> | null>(null);
  const chain = useRef(new SaveChain());
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    setPhase('loading');
    fetchReport(id)
      .then((raw) => {
        if (!alive.current) return;
        const d = readDetail(raw);
        if (!d) { setPhase('loadFailed'); return; }
        setDetail(d);
        confirmed.current = d.report;
        dispatch({ type: 'reset', values: valuesOf(d) });
        setPhase(d.status === 'ready' ? 'ready' : d.status === 'generating' ? 'making' : 'failed');
      })
      .catch((e) => { if (alive.current) setPhase(plainMessage(e, '') === RR.editor.missing ? 'missing' : 'loadFailed'); });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const bump = () => { setPreviewLoading(true); setVersion((n) => n + 1); };

  const save = useCallback((key: FieldKey) => {
    const text = valueOf(fieldsRef.current.values, key);
    dispatch({ type: 'saving', key });
    void chain.current.run(async () => {
      const body = requestFor(key, fieldsRef.current.values, confirmed.current);
      if (!body) throw new Error(RR.editor.saveFailed);
      const answer = readDetail(await updateReport(id, body));
      if (answer?.report) confirmed.current = answer.report;
      return answer;
    }).then(() => {
      if (!alive.current) return;
      dispatch({ type: 'saved', key, text });
      bump();
    }).catch((e) => {
      if (alive.current) dispatch({ type: 'failed', key, error: plainMessage(e, RR.editor.saveFailed) });
    });
  }, [id]);

  const changeStyle = (field: 'template' | 'visualStyle', value: string) => {
    if (!detail) return;
    const before = detail;
    setStyle((s) => ({ ...s, [field]: { busy: true, error: null } }));
    // Shown at once; put back with a sentence if the server refuses.
    setDetail({ ...detail, [field]: field === 'visualStyle' && value === '' ? null : value } as ReportDetail);
    void chain.current.run(() => updateReport(id, { [field]: field === 'visualStyle' && value === '' ? null : value }))
      .then(() => { if (!alive.current) return; setStyle((s) => ({ ...s, [field]: { busy: false, error: null } })); bump(); })
      .catch((e) => { if (!alive.current) return; setDetail(before); setStyle((s) => ({ ...s, [field]: { busy: false, error: plainMessage(e, RR.editor.styleFailed) } })); });
  };

  const doArchive = () => {
    setArchive({ phase: 'busy', error: null });
    archiveReport(id)
      .then(() => { if (alive.current) onArchived(); })
      .catch((e) => { if (alive.current) setArchive({ phase: 'idle', error: plainMessage(e, RR.editor.archiveFailed) }); });
  };

  const partial = useMemo(() => partialNotes(detail?.problem), [detail?.problem]);

  if (phase !== 'ready' || !detail) {
    return <EditorMessage kind={phase === 'ready' ? 'loading' : phase} problem={detail?.problem ?? null} onBack={onBack} onRetry={load} />;
  }
  return (
    <EditorView
      role={role}
      detail={detail}
      fields={fields}
      previewVersion={version}
      previewLoading={previewLoading}
      partial={partial}
      style={style}
      archive={archive}
      onBack={onBack}
      onEdit={(key, text) => dispatch({ type: 'edit', key, text })}
      onSave={save}
      onTemplate={(v) => changeStyle('template', v)}
      onVisualStyle={(v) => changeStyle('visualStyle', v)}
      onAskArchive={() => setArchive({ phase: 'asking', error: null })}
      onCancelArchive={() => setArchive({ phase: 'idle', error: null })}
      onArchive={doArchive}
      onPreviewLoaded={() => setPreviewLoading(false)}
    />
  );
}
