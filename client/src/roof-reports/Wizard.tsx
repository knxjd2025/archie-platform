import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useCompany } from '../lib/company';
import { LAST_STEP, agoText, browserStorage, clearDraft, draftKey, emptyDraft, isEmptyDraft, readDraft, writeDraft, type WizardDraft } from './draft';
import { STEPS, draftPhotosFromTiles, photosInFlight, photosRemoving, tilesFromDraft, tryAdvance } from './wizard-model';
import { usePhotoUploads } from './photo-uploads';
import StepWhere from './StepWhere';
import StepPhotos from './StepPhotos';
import StepMeasurements from './StepMeasurements';
import StepDamage from './StepDamage';
import { RR } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const BUTTON = `px-4 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`;
const PRIMARY = `px-4 py-2 text-sm font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-dark disabled:opacity-50 ${FOCUS}`;

export interface WizardFrameProps {
  step: number;
  error: string | null;
  /** "2 hours ago" when this draft was brought back; null when it is a fresh start. */
  restoredNote: string | null;
  /** The draft has been kept on this device. */
  saved: boolean;
  /** Photos are still on their way, or being taken back: the wizard cannot be closed yet. */
  busy: boolean;
  /** Why it cannot be closed, when that is not "photos are still being added". */
  busyNote?: string;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onStartOver: () => void;
  children?: ReactNode;
}

/** The wizard's frame: heading, steps, notices and buttons around whichever step is showing. */
export function WizardFrame(p: WizardFrameProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  // Moving to another step puts the reader at its top, so a keyboard or screen reader user is not left on a button that has gone.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    heading.current?.focus();
  }, [p.step]);
  const last = p.step >= LAST_STEP;
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden" aria-label={RR.wizard.title}>
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold text-gray-900 focus:outline-none">{RR.wizard.title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{RR.wizard.stepOf(p.step, STEPS.length)}</p>
        </div>
        <div className="text-right">
          <button type="button" onClick={p.onClose} disabled={p.busy} className={BUTTON}>{RR.wizard.close}</button>
          {p.busy && <p className="mt-1 text-xs text-gray-500">{p.busyNote ?? RR.wizard.photosBusy}</p>}
        </div>
      </div>

      <ol aria-label={RR.wizard.stepsLabel} className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i + 1 === p.step ? 'step' : undefined} className={i + 1 === p.step ? 'font-semibold text-gray-900' : i + 1 < p.step ? 'text-gray-600' : 'text-gray-400'}>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      {p.restoredNote && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 flex flex-wrap items-center justify-between gap-2 text-sm text-amber-800">
          <span>{RR.wizard.keptDraft(p.restoredNote)}</span>
          <button type="button" onClick={p.onStartOver} className={`${BUTTON} !py-1`}>{RR.wizard.startOver}</button>
        </div>
      )}

      <div className="px-5 py-5">
        {p.children}
        {p.error && <p role="alert" className="mt-4 text-sm text-red-600">{p.error}</p>}
      </div>

      <div className="px-5 py-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {p.step > 1 && <button type="button" onClick={p.onBack} className={BUTTON}>{RR.wizard.back}</button>}
          {p.saved && !p.restoredNote && <button type="button" onClick={p.onStartOver} className="text-sm text-gray-500 hover:text-gray-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">{RR.wizard.startOver}</button>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {p.saved && <span className="text-xs text-gray-400" role="status">{RR.wizard.saved}</span>}
          {last && <span className="text-xs text-gray-500">{RR.wizard.comesNext}</span>}
          <button type="button" onClick={p.onNext} className={PRIMARY}>{last ? RR.wizard.saveAndClose : RR.wizard.next}</button>
        </div>
      </div>
    </section>
  );
}

const SAVE_DELAY_MS = 400;

/** The wizard: the draft it keeps in the browser, the photos it holds, and the step in front. */
export default function Wizard({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const company = useCompany();
  const key = useMemo(() => draftKey(company.id, user?.email), [company.id, user?.email]);

  // What was kept last time, read once when the wizard opens.
  const restored = useMemo(() => (key ? readDraft(browserStorage(), key) : null), [key]);
  const [draft, setDraft] = useState<WizardDraft>(() => restored?.draft ?? emptyDraft());
  const [restoredNote, setRestoredNote] = useState<string | null>(() => (restored ? agoText(restored.savedAt) : null));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploads = usePhotoUploads(useMemo(() => tilesFromDraft(restored?.draft.photos ?? []), [restored]));

  const current = useMemo<WizardDraft>(() => ({ ...draft, photos: draftPhotosFromTiles(uploads.tiles) }), [draft, uploads.tiles]);
  const latest = useRef(current);
  latest.current = current;

  const keep = useCallback(() => {
    if (!key) return;
    const storage = browserStorage();
    if (isEmptyDraft(latest.current)) { clearDraft(storage, key); setSaved(false); return; }
    setSaved(writeDraft(storage, key, latest.current));
  }, [key]);

  // Kept shortly after every change.
  useEffect(() => {
    const t = setTimeout(keep, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [current, keep]);

  const patch = (next: Partial<WizardDraft>) => { setError(null); setDraft((d) => ({ ...d, ...next })); };
  const removing = photosRemoving(uploads.tiles);
  const busy = photosInFlight(uploads.tiles) || removing;

  const next = () => {
    if (current.step >= LAST_STEP) {
      // Review and making the report are the next task; until then the draft is kept and the wizard closes.
      const check = tryAdvance(current, uploads.tiles);
      if (!check.ok) { setError(check.error); return; }
      keep();
      onClose();
      return;
    }
    const r = tryAdvance(current, uploads.tiles);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    patch({ step: r.step });
  };

  const startOver = () => {
    if (key) clearDraft(browserStorage(), key);
    uploads.reset();
    setDraft(emptyDraft());
    setRestoredNote(null);
    setSaved(false);
    setError(null);
  };

  const close = () => { keep(); onClose(); };

  return (
    <WizardFrame
      step={draft.step}
      error={error}
      restoredNote={restoredNote}
      saved={saved}
      busy={busy}
      busyNote={removing && !photosInFlight(uploads.tiles) ? RR.photos.removeBusy : undefined}
      onBack={() => patch({ step: Math.max(1, draft.step - 1) })}
      onNext={next}
      onClose={close}
      onStartOver={startOver}
    >
      {draft.step === 1 && <StepWhere value={draft.where} onChange={(where) => patch({ where })} />}
      {draft.step === 2 && (
        <StepPhotos
          tiles={uploads.tiles}
          notice={uploads.notice}
          kind={draft.photoKind}
          dragging={dragging}
          onKind={(photoKind) => patch({ photoKind })}
          onDragging={setDragging}
          onAdd={uploads.add}
          onRemove={uploads.remove}
          onRetry={uploads.retry}
        />
      )}
      {draft.step === 3 && <StepMeasurements value={draft.roof} onChange={(roof) => patch({ roof })} />}
      {draft.step === 4 && <StepDamage value={draft.damage} onChange={(damage) => patch({ damage })} />}
    </WizardFrame>
  );
}
