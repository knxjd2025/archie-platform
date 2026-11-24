import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { TeamRole } from '../../../shared/rbac';
import { TEMPLATES, VISUAL_STYLES } from '../../../shared/roof-reports';
import { archiveReport, createShareLink, fetchReport, revokeShareLink, rewriteFinding, rewriteSummary, sendReportEmail, updateReport } from './api';
import {
  FRAME_SANDBOX, SaveChain, editsAllowed, emptyValues, fieldReducer, initialFields, previewSrc, readDetail, requestFor, sharesAllowed, valueOf, valuesOf, withValue,
  type FieldKey, type FieldsState, type ReportDetail,
} from './editor-model';
import { partialNotes, type PartialNote } from './generate-flow';
import { useCompany } from '../lib/company';
import { initialRewrites, rewriteBusy, rewriteReducer, rewriteStateOf, submitRewrite, type RewriteMap } from './rewrite-model';
import { loadPdfBuilder } from './pdf-loader';
import { initialPdf, pdfFileName, pdfReducer, runPdf, saveFile, type PdfState } from './pdf-model';
import { SendDialog } from './SendDialog';
import { initialSend, makeSendKey, sendPrefill, sendReducer, sendsAllowed, sentLine, submitSend, type SendField, type SendState } from './send-model';
import { copyLink, initialShare, shareReducer, turnLinkOff, type ShareState } from './share-model';
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
  share: ShareState;
  onCopyLink: () => void;
  onTurnLinkOff: () => void;
  rewrites: RewriteMap;
  onRewrite: (key: FieldKey) => void;
  onUndoRewrite: (key: FieldKey) => void;
  pdf: PdfState;
  onPdf: () => void;
  send: SendState;
  onOpenSend: () => void;
  onEditSend: (field: SendField, text: string) => void;
  onSend: () => void;
  onCloseSend: () => void;
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

interface FieldProps {
  fields: FieldsState; k: FieldKey; label: string; multiline?: boolean; rows?: number; type?: string; max: number; onEdit: EditorViewProps['onEdit']; onSave: EditorViewProps['onSave']; editable: boolean;
  /** A field a model may rewrite (the summary, a finding): its state, and what its buttons do. */
  rewrite?: { rewrites: RewriteMap; onRewrite: (key: FieldKey) => void; onUndo: (key: FieldKey) => void };
}

function Field(p: FieldProps) {
  const id = idFor(p.k);
  const s = p.fields.status[p.k] ?? { status: 'idle' as const };
  const value = valueOf(p.fields.values, p.k);
  const rw = p.rewrite ? rewriteStateOf(p.rewrite.rewrites, p.k) : null;
  const rewriting = rw?.phase === 'rewriting';
  const common = {
    id, value, maxLength: p.max, disabled: !p.editable || rewriting, 'aria-busy': s.status === 'saving' || rewriting || undefined,
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
      {p.rewrite && p.editable && rw && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {(() => {
            const unsaved = s.status === 'unsaved' || s.status === 'saving' || s.status === 'failed';
            const blocked = unsaved || rewriteBusy(p.rewrite.rewrites);
            return (
              <>
                <button type="button" onClick={() => p.rewrite!.onRewrite(p.k)} disabled={blocked} aria-label={RR.rewrite.rewriteFor(p.label)} className={`text-xs ${BUTTON} !py-0.5`}>{RR.rewrite.button}</button>
                {rw.previous !== null && rw.phase !== 'rewriting' && (
                  <button type="button" onClick={() => p.rewrite!.onUndo(p.k)} disabled={blocked} aria-label={RR.rewrite.undoFor(p.label)} className={`text-xs ${BUTTON} !py-0.5`}>{RR.rewrite.undo}</button>
                )}
                {unsaved && !rewriting && <span className="text-xs text-gray-500">{RR.rewrite.unsavedFirst}</span>}
              </>
            );
          })()}
          {rewriting && <span role="status" className="text-xs text-gray-500">{RR.rewrite.rewriting}</span>}
          {rw.phase === 'done' && <span role="status" className="text-xs text-emerald-700">{RR.rewrite.done}</span>}
          {rw.phase === 'failed' && rw.error && <span role="alert" className="text-xs text-red-600">{rw.error}</span>}
        </div>
      )}
    </div>
  );
}

/** The customer link: copy it, turn it off. Each click is answered in its own frame, and every state says in words what happened. */
function ShareControls({ share, onCopyLink, onTurnLinkOff }: { share: ShareState; onCopyLink: () => void; onTurnLinkOff: () => void }) {
  const busy = share.phase === 'making' || share.phase === 'turningOff';
  const message = share.phase === 'making' ? RR.share.making
    : share.phase === 'copied' ? RR.share.copied
    : share.phase === 'manual' ? RR.share.manual
    : share.phase === 'turningOff' ? RR.share.turningOff
    : share.phase === 'off' ? RR.share.off
    : share.on ? RR.share.on : null;
  const live = share.phase !== 'idle';
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900">{RR.share.title}</h4>
      <p className="text-sm text-gray-600">{RR.share.help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onCopyLink} disabled={busy} aria-busy={share.phase === 'making' || undefined} className={BUTTON}>{RR.share.copy}</button>
        {share.on && share.phase !== 'off' && <button type="button" onClick={onTurnLinkOff} disabled={busy} aria-busy={share.phase === 'turningOff' || undefined} className={BUTTON}>{RR.share.turnOff}</button>}
      </div>
      {message && (live
        ? <p role="status" className={`text-sm ${share.phase === 'copied' ? 'text-emerald-700' : 'text-gray-600'}`}>{message}</p>
        : <p className="text-sm text-gray-600">{message}</p>)}
      {share.phase === 'manual' && share.url && (
        <div>
          <label htmlFor="rr-share-link" className="text-sm font-medium text-gray-800">{RR.share.linkLabel}</label>
          <input id="rr-share-link" type="text" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} className={`${FIELD} mt-1`} />
        </div>
      )}
      {share.error && <p role="alert" className="text-xs text-red-600">{share.error}</p>}
    </div>
  );
}

/** The email button and what has already been sent. The dialog itself is drawn at the end of the editor. */
function PdfControls({ pdf, onPdf }: { pdf: PdfState; onPdf: () => void }) {
  const preparing = pdf.phase === 'preparing';
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-gray-900">{RR.pdf.title}</h4>
      <p className="text-sm text-gray-600">{RR.pdf.help}</p>
      <button type="button" onClick={onPdf} disabled={preparing} aria-busy={preparing || undefined} className={BUTTON}>{preparing ? RR.pdf.preparing : RR.pdf.button}</button>
      {pdf.error && <p role="alert" className="text-xs text-red-600">{pdf.error}</p>}
    </div>
  );
}

function SendControls({ detail, onOpen }: { detail: ReportDetail; onOpen: () => void }) {
  const line = sentLine(detail.emailSentCount, detail.emailSentAt);
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900">{RR.send.title}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onOpen} className={BUTTON}>{RR.send.open}</button>
      </div>
      {line && <p className="text-sm text-gray-600">{line}</p>}
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
  const rewritable = { rewrites: p.rewrites, onRewrite: p.onRewrite, onUndo: p.onUndoRewrite };
  return (
    <section className="space-y-4 pb-24" aria-label={p.detail.title || p.detail.address}>
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
              <select id="rr-edit-look" value={p.detail.visualStyle ?? ''} disabled={!editable || p.style.visualStyle.busy} onChange={(e) => p.onVisualStyle(e.target.value)} aria-describedby={p.detail.look?.notice ? 'rr-look-notice' : undefined} className={FIELD}>
                <option value="">{RR.editor.lookDefault}</option>
                {VISUAL_STYLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {p.detail.look?.notice && <p id="rr-look-notice" role="status" className="text-xs text-amber-800 mt-1">{p.detail.look.notice}</p>}
              {p.style.visualStyle.error && <p role="alert" className="text-xs text-red-600 mt-1">{p.style.visualStyle.error}</p>}
            </div>
          </div>

          {sharesAllowed(p.role) && <ShareControls share={p.share} onCopyLink={p.onCopyLink} onTurnLinkOff={p.onTurnLinkOff} />}
          {sendsAllowed(p.role) && <SendControls detail={p.detail} onOpen={p.onOpenSend} />}
          <PdfControls pdf={p.pdf} onPdf={p.onPdf} />

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">{RR.editor.findingsTitle}</h4>
            {field('summary', RR.editor.fieldSummary, { multiline: true, rows: 5, max: 20000, rewrite: rewritable })}
            {v.findings.length === 0
              ? <p className="text-sm text-gray-500">{RR.editor.noFindings}</p>
              : v.findings.map((_, i) => field(`finding:${i}` as FieldKey, RR.editor.finding(i + 1, typeof findings[i]?.title === 'string' ? (findings[i].title as string) : ''), { multiline: true, rows: 4, max: 20000, rewrite: rewritable }))}
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
      <SendDialog state={p.send} onEdit={p.onEditSend} onSend={p.onSend} onClose={p.onCloseSend} />
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
  const [share, dispatchShare] = useReducer(shareReducer, initialShare(false));
  const [rewrites, dispatchRewrite] = useReducer(rewriteReducer, initialRewrites());
  const rewritesRef = useRef(rewrites);
  rewritesRef.current = rewrites;
  const [pdfState, dispatchPdf] = useReducer(pdfReducer, initialPdf());
  const pdfRef = useRef(pdfState);
  pdfRef.current = pdfState;
  const company = useCompany();
  const [send, dispatchSend] = useReducer(sendReducer, initialSend());
  const sendRef = useRef(send);
  sendRef.current = send;
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
        dispatchShare({ type: 'reset', on: d.shareLinkOn });
        dispatchRewrite({ type: 'reset' });
        setPhase(d.status === 'ready' ? 'ready' : d.status === 'generating' ? 'making' : 'failed');
      })
      .catch((e) => { if (alive.current) setPhase(plainMessage(e, '') === RR.editor.missing ? 'missing' : 'loadFailed'); });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const bump = () => { setPreviewLoading(true); setVersion((n) => n + 1); };

  /** Saves one field. `text` puts that text in the box first (the undo of a rewrite). Says whether it was saved. */
  const save = useCallback((key: FieldKey, text?: string): Promise<boolean> => {
    const values = text === undefined ? fieldsRef.current.values : withValue(fieldsRef.current.values, key, text);
    const now = valueOf(values, key);
    if (text !== undefined) dispatch({ type: 'edit', key, text });
    dispatch({ type: 'saving', key });
    return chain.current.run(async () => {
      const body = requestFor(key, values, confirmed.current);
      if (!body) throw new Error(RR.editor.saveFailed);
      const answer = readDetail(await updateReport(id, body));
      if (answer?.report) confirmed.current = answer.report;
      return answer;
    }).then(() => {
      if (!alive.current) return true;
      dispatch({ type: 'saved', key, text: now });
      bump();
      return true;
    }).catch((e) => {
      if (alive.current) dispatch({ type: 'failed', key, error: plainMessage(e, RR.editor.saveFailed) });
      return false;
    });
  }, [id]);

  const changeStyle = (field: 'template' | 'visualStyle', value: string) => {
    if (!detail) return;
    const before = detail;
    setStyle((s) => ({ ...s, [field]: { busy: true, error: null } }));
    // Shown at once; put back with a sentence if the server refuses.
    // The sentence about the old look goes at once; the server's answer brings the new one.
    setDetail({ ...detail, look: detail.look ? { ...detail.look, notice: null } : null, [field]: field === 'visualStyle' && value === '' ? null : value } as ReportDetail);
    void chain.current.run(() => updateReport(id, { [field]: field === 'visualStyle' && value === '' ? null : value }))
      .then((raw) => {
        if (!alive.current) return;
        // The server says which look the page really has now, and why when it is not the one chosen.
        const answer = readDetail(raw);
        if (answer) setDetail((d) => (d ? { ...d, look: answer.look } : d));
        setStyle((s) => ({ ...s, [field]: { busy: false, error: null } }));
        bump();
      })
      .catch((e) => { if (!alive.current) return; setDetail(before); setStyle((s) => ({ ...s, [field]: { busy: false, error: plainMessage(e, RR.editor.styleFailed) } })); });
  };

  // Both answer in the frame of the click (the state changes before anything is asked), and clear on success or failure.
  const doCopyLink = () => {
    dispatchShare({ type: 'making' });
    void copyLink({ create: () => createShareLink(id), write: (text) => navigator.clipboard.writeText(text) })
      .then((action) => { if (alive.current) dispatchShare(action); });
  };
  const doTurnLinkOff = () => {
    dispatchShare({ type: 'turningOff' });
    void turnLinkOff({ revoke: () => revokeShareLink(id) })
      .then((action) => { if (alive.current) dispatchShare(action); });
  };

  // Opening the dialog starts a try with its own request key; pressing Send answers in the same frame (Sending...), and a second press while it is sending does nothing.
  const openSend = () => { if (detail) dispatchSend({ type: 'open', ...sendPrefill(fieldsRef.current.values), key: makeSendKey() }); };
  const doSend = () => {
    const now = sendRef.current;
    if (now.phase === 'sending' || now.phase === 'sent' || now.phase === 'closed') return;
    dispatchSend({ type: 'sending' });
    void submitSend({ send: (body, key) => sendReportEmail(id, body, key) }, now)
      .then((action) => {
        if (!alive.current) return;
        dispatchSend(action);
        // The server counted it and a link is now on, so the screen says so without asking again.
        if (action.type === 'sent') {
          setDetail((d) => (d ? { ...d, emailSentCount: d.emailSentCount + 1, emailSentAt: new Date().toISOString(), shareLinkOn: true } : d));
          dispatchShare({ type: 'reset', on: true });
        }
      });
  };

  // A rewrite answers in the frame of the press: that one field says Rewriting... and nothing else moves. One at a time, in order with the saves.
  const doRewrite = (key: FieldKey) => {
    if (rewriteBusy(rewritesRef.current)) return;
    const previous = valueOf(fieldsRef.current.values, key);
    dispatchRewrite({ type: 'start', key });
    const call = () => (key === 'summary' ? rewriteSummary(id) : rewriteFinding(id, Number(key.split(':')[1])));
    void chain.current.run(() => submitRewrite({ call }, key, previous)).then((result) => {
      if (!alive.current) return;
      if (result.type === 'done') {
        // The server already holds the new words: they are saved, so the box shows them as saved.
        confirmed.current = result.report;
        dispatch({ type: 'edit', key, text: result.text });
        dispatch({ type: 'saved', key, text: result.text });
        bump();
      }
      dispatchRewrite(result);
    });
  };
  // Undo puts the old words back through the ordinary save of that field, and forgets the undo once that is saved.
  const doUndoRewrite = (key: FieldKey) => {
    const previous = rewritesRef.current[key]?.previous;
    if (previous === null || previous === undefined || rewriteBusy(rewritesRef.current)) return;
    void save(key, previous).then((saved) => { if (saved && alive.current) dispatchRewrite({ type: 'clear', key }); });
  };

  // The PDF code is fetched by this click and by nothing else. The button answers in the same frame (Preparing PDF...).
  const doPdf = () => {
    if (!detail || pdfRef.current.phase === 'preparing') return;
    dispatchPdf({ type: 'start' });
    void runPdf({
      build: async () => {
        const { buildReportPdf } = await loadPdfBuilder();
        return buildReportPdf(
          { id, title: detail.title, address: detail.address, city: detail.city, state: detail.state, zip: detail.zip, customerName: detail.customerName, inspectionDate: detail.inspectionDate, inspectorNotes: detail.inspectorNotes, report: confirmed.current ?? detail.report, photos: detail.photos },
          { name: company.displayName, phone: company.phone, email: company.email, website: company.websiteLabel },
        );
      },
      save: saveFile,
    }, pdfFileName(detail.address, new Date())).then((action) => { if (alive.current) dispatchPdf(action); });
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
      share={share}
      onCopyLink={doCopyLink}
      onTurnLinkOff={doTurnLinkOff}
      rewrites={rewrites}
      onRewrite={doRewrite}
      onUndoRewrite={doUndoRewrite}
      pdf={pdfState}
      onPdf={doPdf}
      send={send}
      onOpenSend={openSend}
      onEditSend={(field, text) => dispatchSend({ type: 'edit', field, text })}
      onSend={doSend}
      onCloseSend={() => dispatchSend({ type: 'close' })}
      onBack={onBack}
      onEdit={(key, text) => { dispatch({ type: 'edit', key, text }); if (rewritesRef.current[key]) dispatchRewrite({ type: 'clear', key }); }}
      onSave={(key) => { void save(key); }}
      onTemplate={(v) => changeStyle('template', v)}
      onVisualStyle={(v) => changeStyle('visualStyle', v)}
      onAskArchive={() => setArchive({ phase: 'asking', error: null })}
      onCancelArchive={() => setArchive({ phase: 'idle', error: null })}
      onArchive={doArchive}
      onPreviewLoaded={() => setPreviewLoading(false)}
    />
  );
}
