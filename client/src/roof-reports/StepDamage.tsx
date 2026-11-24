import type { DamageDraft } from './draft';
import { DAMAGE_ROWS, bumpCount, damageTotal, totalLine } from './wizard-model';
import { RR } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
/** Large enough to press with a thumb on a roof. */
const STEP_BUTTON = `min-h-[44px] min-w-[44px] px-3 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 active:bg-gray-100 ${FOCUS}`;

export interface DamageViewProps {
  value: DamageDraft;
  onChange: (next: DamageDraft) => void;
}

/** Step 4: three counts of damaged shingles, each with a box to type in and buttons to move it. */
export function DamageView({ value, onChange }: DamageViewProps) {
  const total = damageTotal(value);
  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-base font-semibold text-gray-900">{RR.damage.title}</h4>
        <p className="text-sm text-gray-600 mt-1">{RR.damage.help}</p>
      </div>

      <ul className="space-y-3">
        {DAMAGE_ROWS.map((row) => (
          <li key={row.field} className="rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <label htmlFor={`rr-damage-${row.field}`} className="block text-sm font-medium text-gray-900">{row.label}</label>
                <p id={`rr-damage-${row.field}-help`} className="text-xs text-gray-500">{row.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label={RR.damage.take1For(row.what)} onClick={() => onChange({ ...value, [row.field]: bumpCount(value[row.field], -1) })} className={STEP_BUTTON}>{RR.damage.take1}</button>
                <input
                  id={`rr-damage-${row.field}`}
                  value={value[row.field]}
                  onChange={(e) => onChange({ ...value, [row.field]: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  aria-describedby={`rr-damage-${row.field}-help`}
                  className={`w-20 text-center text-base border border-gray-300 rounded-lg px-2 py-2.5 bg-white text-gray-900 ${FOCUS}`}
                />
                <button type="button" aria-label={RR.damage.add1For(row.what)} onClick={() => onChange({ ...value, [row.field]: bumpCount(value[row.field], 1) })} className={STEP_BUTTON}>{RR.damage.add1}</button>
                <button type="button" aria-label={RR.damage.add5For(row.what)} onClick={() => onChange({ ...value, [row.field]: bumpCount(value[row.field], 5) })} className={STEP_BUTTON}>{RR.damage.add5}</button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-800" aria-live="polite">{totalLine(total)}</p>
        <button
          type="button"
          aria-label={RR.damage.resetFor}
          onClick={() => onChange({ wind: '0', hail: '0', general: '0' })}
          className={`px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 ${FOCUS}`}
        >
          {RR.damage.reset}
        </button>
      </div>
    </div>
  );
}

export default DamageView;
