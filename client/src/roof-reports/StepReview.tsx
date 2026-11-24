import { REPORT_KINDS, TEMPLATES, type ReportKindValue, type TemplateValue } from '../../../shared/roof-reports';
import type { ReviewDraft, WizardDraft } from './draft';
import { reviewSummary, toggleKind, type PhotoTile } from './wizard-model';
import { RR } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const FIELD = `w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 ${FOCUS}`;
const CHANGE = `text-sm text-blue-700 underline rounded ${FOCUS}`;

export interface ReviewViewProps {
  draft: WizardDraft;
  tiles: readonly PhotoTile[];
  onReview: (patch: Partial<ReviewDraft>) => void;
  /** Go back to the step that holds this. */
  onGoTo: (step: number) => void;
}

function Row({ text, note, what, step, onGoTo }: { text: string; note?: string; what: string; step: number; onGoTo: (step: number) => void }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="text-sm text-gray-900">{text}</p>
        {note && <p className="text-xs text-amber-700 mt-0.5">{note}</p>}
      </div>
      <button type="button" onClick={() => onGoTo(step)} aria-label={RR.review.changeFor(what)} className={CHANGE}>{RR.review.change}</button>
    </li>
  );
}

/** Step 5 as it looks for the state it is handed. */
export function ReviewView(p: ReviewViewProps) {
  const r = p.draft.review;
  const s = reviewSummary(p.draft, p.tiles);
  const inspectionNoPhotos = r.kinds.includes('inspection') && s.photos === RR.review.noPhotos;
  return (
    <div className="space-y-6">
      <h4 className="text-base font-semibold text-gray-900">{RR.review.title}</h4>

      <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl px-4" aria-label={RR.review.title}>
        <Row text={s.address} note={s.job ?? undefined} what={RR.review.rowAddress} step={1} onGoTo={p.onGoTo} />
        <Row text={s.photos} note={s.photosNote || undefined} what={RR.review.rowPhotos} step={2} onGoTo={p.onGoTo} />
        <Row text={s.roof} what={RR.review.rowRoof} step={3} onGoTo={p.onGoTo} />
        <Row text={s.damage} what={RR.review.rowDamage} step={4} onGoTo={p.onGoTo} />
      </ul>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-900 mb-2">{RR.review.coverTitle}</legend>
        <div className="space-y-2">
          {REPORT_KINDS.map((k) => (
            <div key={k.value} className="flex items-start gap-3">
              <input
                id={`rr-kind-${k.value}`}
                type="checkbox"
                checked={r.kinds.includes(k.value)}
                onChange={() => p.onReview({ kinds: toggleKind(r.kinds, k.value as ReportKindValue) })}
                aria-describedby={`rr-kind-${k.value}-help`}
                className={`mt-1 h-4 w-4 ${FOCUS}`}
              />
              <label htmlFor={`rr-kind-${k.value}`} className="text-sm text-gray-900">
                <span className="font-medium">{k.label}</span>
                <span id={`rr-kind-${k.value}-help`} className="block text-gray-500">{RR.review.kindDescriptions[k.value]}</span>
              </label>
            </div>
          ))}
        </div>
        {inspectionNoPhotos && <p className="mt-2 text-sm text-amber-700">{RR.review.noPhotosHint}</p>}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-900 mb-2">{RR.review.styleTitle}</legend>
        <div className="space-y-2">
          {TEMPLATES.map((t) => (
            <div key={t.value} className="flex items-start gap-3">
              <input
                id={`rr-template-${t.value}`}
                type="radio"
                name="rr-template"
                checked={r.template === t.value}
                onChange={() => p.onReview({ template: t.value as TemplateValue })}
                aria-describedby={`rr-template-${t.value}-help`}
                className={`mt-1 h-4 w-4 ${FOCUS}`}
              />
              <label htmlFor={`rr-template-${t.value}`} className="text-sm text-gray-900">
                <span className="font-medium">{t.label}</span>
                <span id={`rr-template-${t.value}-help`} className="block text-gray-500">{RR.review.templateDescriptions[t.value]}</span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-900">{RR.review.customerTitle}</legend>
        <p className="text-xs text-gray-500 mt-0.5 mb-2">{RR.review.customerHelp}</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="rr-customer-name" className="block text-sm text-gray-700 mb-1">{RR.review.customerName}</label>
            <input id="rr-customer-name" type="text" autoComplete="off" maxLength={200} value={r.customerName} onChange={(e) => p.onReview({ customerName: e.target.value })} className={FIELD} />
          </div>
          <div>
            <label htmlFor="rr-customer-email" className="block text-sm text-gray-700 mb-1">{RR.review.customerEmail}</label>
            <input id="rr-customer-email" type="email" autoComplete="off" maxLength={254} value={r.customerEmail} onChange={(e) => p.onReview({ customerEmail: e.target.value })} className={FIELD} />
          </div>
          <div>
            <label htmlFor="rr-customer-phone" className="block text-sm text-gray-700 mb-1">{RR.review.customerPhone}</label>
            <input id="rr-customer-phone" type="tel" autoComplete="off" maxLength={40} value={r.customerPhone} onChange={(e) => p.onReview({ customerPhone: e.target.value })} className={FIELD} />
          </div>
        </div>
      </fieldset>

      <div>
        <label htmlFor="rr-notes" className="block text-sm font-semibold text-gray-900">{RR.review.notes}</label>
        <p id="rr-notes-help" className="text-xs text-gray-500 mt-0.5 mb-1">{RR.review.notesHelp}</p>
        <textarea id="rr-notes" rows={4} maxLength={20000} aria-describedby="rr-notes-help" value={r.notes} onChange={(e) => p.onReview({ notes: e.target.value })} className={FIELD} />
      </div>
    </div>
  );
}

export default function StepReview(p: ReviewViewProps) {
  return <ReviewView {...p} />;
}
