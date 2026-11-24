import type { RoofDraft } from './draft';
import { MATERIAL_OPTIONS, PITCH_OPTIONS, STORIES_OPTIONS, squareFeetLine } from './wizard-model';
import { RR } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const FIELD = `w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 ${FOCUS}`;
const LABEL = 'block text-sm font-medium text-gray-700 mb-1';

export interface MeasurementsViewProps {
  value: RoofDraft;
  onChange: (next: RoofDraft) => void;
}

/** Step 3: how big the roof is and what it is made of. Every fact is optional. */
export function MeasurementsView({ value, onChange }: MeasurementsViewProps) {
  const set = (patch: Partial<RoofDraft>) => onChange({ ...value, ...patch });
  const feet = squareFeetLine(value.squares);
  return (
    <div className="space-y-5">
      <h4 className="text-base font-semibold text-gray-900">{RR.roof.title}</h4>

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
