import type { RoofDraft } from './draft';
import { editedRoof, estimateNote, type PendingEstimate } from './satellite-model';
import { MATERIAL_OPTIONS, PITCH_OPTIONS, STORIES_OPTIONS, squareFeetLine } from './wizard-model';
import { RR } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const FIELD = `w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 ${FOCUS}`;
const LABEL = 'block text-sm font-medium text-gray-700 mb-1';

/** What the roof step needs to offer "Find it from the satellite". Without it the step is just the form. */
export interface SatelliteView {
  state: { phase: 'idle' } | { phase: 'looking' } | { phase: 'failed'; message: string } | { phase: 'choose'; pending: PendingEstimate };
  /** How clear the picture was, when it was looked at. */
  confidence?: 'high' | 'medium' | 'low' | null;
  onFind: () => void;
  onUse: () => void;
  onKeep: () => void;
}

export interface MeasurementsViewProps {
  value: RoofDraft;
  onChange: (next: RoofDraft) => void;
  satellite?: SatelliteView;
}

/** Step 3: how big the roof is and what it is made of. Every fact is optional. */
export function MeasurementsView({ value, onChange, satellite }: MeasurementsViewProps) {
  // A field the person changes is theirs: it stops being marked as an estimate.
  const set = (patch: Partial<RoofDraft>) => onChange(editedRoof(value, patch));
  const feet = squareFeetLine(value.squares);
  const note = estimateNote(value);
  const looking = satellite?.state.phase === 'looking';
  const chooseWhat = (p: PendingEstimate) => (p.squares && p.pitch ? RR.satellite.chooseBoth : p.squares ? RR.satellite.chooseSize : RR.satellite.choosePitch);
  return (
    <div className="space-y-5">
      <h4 className="text-base font-semibold text-gray-900">{RR.roof.title}</h4>

      {satellite && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2" aria-busy={looking}>
          <p className="text-sm text-gray-600">{RR.satellite.help}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={satellite.onFind}
              disabled={looking}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-wait ${FOCUS}`}
            >
              {RR.satellite.find}
            </button>
            {looking && <p role="status" className="text-sm text-gray-700">{RR.satellite.looking}</p>}
          </div>
          {satellite.state.phase === 'failed' && <p role="alert" className="text-sm text-red-600">{satellite.state.message}</p>}
          {satellite.state.phase === 'choose' && (
            <div role="group" aria-label={RR.satellite.chooseTitle(chooseWhat(satellite.state.pending))} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">{RR.satellite.chooseTitle(chooseWhat(satellite.state.pending))}</p>
              <p className="text-sm text-amber-900">{RR.satellite.chooseLine(satellite.state.pending.squares ?? null, satellite.state.pending.pitch ?? null)}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={satellite.onUse} className={`px-3 py-1.5 text-sm font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-dark ${FOCUS}`}>{RR.satellite.use}</button>
                <button type="button" onClick={satellite.onKeep} className={`px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 ${FOCUS}`}>{RR.satellite.keep}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {note && (
        <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{note}</p>
          {satellite?.confidence === 'low' && <p className="mt-1">{RR.satellite.unclear}</p>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rr-squares" className={LABEL}>{RR.roof.squares}</label>
          <input
            id="rr-squares"
            value={value.squares}
            onChange={(e) => set({ squares: e.target.value })}
            inputMode="decimal"
            maxLength={12}
            aria-describedby="rr-squares-help rr-squares-feet"
            className={FIELD}
          />
          <p id="rr-squares-help" className="mt-1 text-xs text-gray-500">{RR.roof.squaresHelp}</p>
          <p id="rr-squares-feet" className="mt-0.5 text-xs text-gray-700" aria-live="polite">{feet}</p>
        </div>

        <div>
          <label htmlFor="rr-pitch" className={LABEL}>{RR.roof.pitch}</label>
          <select id="rr-pitch" value={value.pitch} onChange={(e) => set({ pitch: e.target.value })} className={FIELD}>
            <option value="">{RR.roof.notSure}</option>
            {PITCH_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="rr-stories" className={LABEL}>{RR.roof.stories}</label>
          <select id="rr-stories" value={value.stories} onChange={(e) => set({ stories: e.target.value })} className={FIELD}>
            <option value="">{RR.roof.notSure}</option>
            {STORIES_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="rr-material" className={LABEL}>{RR.roof.material}</label>
          <select id="rr-material" value={value.material} onChange={(e) => set({ material: e.target.value })} className={FIELD}>
            <option value="">{RR.roof.notSure}</option>
            {MATERIAL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

export default MeasurementsView;
