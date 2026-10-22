/**
 * One-tap labels for a door: the damage the rep saw and what to know before
 * knocking again. Suggested labels toggle; anything else can be typed.
 */
import { useState } from 'react';
import { SUGGESTED_LABELS, MAX_LABELS, MAX_LABEL_LENGTH, labelMeta, normalizeLabels } from '../../../shared/canvass-labels';
import { LABEL_TONE } from '../lib/canvass';

interface Props {
  labels: string[];
  busy: boolean;
  onChange: (labels: string[]) => void;
}

export function LabelChips({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {labels.map((l) => {
        const m = labelMeta(l);
        return <span key={l} className={`text-[10px] px-1.5 py-0.5 rounded border ${LABEL_TONE[m.tone]}`}>{m.label}</span>;
      })}
    </span>
  );
}

export default function CanvassLabels({ labels, busy, onChange }: Props) {
  const [custom, setCustom] = useState('');
  const toggle = (v: string) => onChange(labels.includes(v) ? labels.filter((l) => l !== v) : normalizeLabels([...labels, v]));
  const addCustom = () => {
    const next = normalizeLabels([...labels, custom]);
    if (next.length !== labels.length) onChange(next);
    setCustom('');
  };
  const own = labels.filter((l) => !SUGGESTED_LABELS.some((s) => s.value === l));

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-700">🏷 Labels</p>
      <div className="flex flex-wrap gap-1.5">
        {[...SUGGESTED_LABELS.map((s) => s.value), ...own].map((v) => {
          const m = labelMeta(v);
          const on = labels.includes(v);
          return (
            <button
              key={v}
              onClick={() => toggle(v)}
              disabled={busy}
              aria-pressed={on}
              className={`text-xs px-2.5 py-1.5 rounded-full border disabled:opacity-50 ${on ? LABEL_TONE[m.tone] + ' font-medium' : 'bg-white border-gray-200 text-gray-500'}`}
            >
              {on ? '✓ ' : ''}{m.label}
            </button>
          );
        })}
      </div>
      {labels.length < MAX_LABELS && (
        <div className="flex gap-1.5">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) addCustom(); }}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="Your own label…"
            aria-label="Add your own label"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5"
          />
          <button onClick={addCustom} disabled={busy || !custom.trim()} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">Add</button>
        </div>
      )}
    </div>
  );
}
