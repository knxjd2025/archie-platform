// Field cheat sheets, "keep this in the truck." The page is the shell: a
// Residential / Commercial switch that remembers the last choice on this
// device, and the sheet it picks. Each sheet's content lives in its own file.

import { useState } from 'react';
import ResidentialSheet from './cheat-sheet/residential';
import CommercialSheet from './cheat-sheet/commercial';

type Kind = 'residential' | 'commercial';

const KINDS: { id: Kind; label: string; blurb: string }[] = [
  { id: 'residential', label: 'Residential', blurb: 'Keep this in the truck. Retail + Insurance, one page reference.' },
  { id: 'commercial', label: 'Commercial', blurb: 'Keep this handy. Property managers, owners and flat roofs.' },
];

const STORAGE_KEY = 'archie.cheatSheetKind';

function loadKind(): Kind {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'commercial' ? 'commercial' : 'residential';
  } catch { return 'residential'; }
}

export default function CheatSheet() {
  const [kind, setKind] = useState<Kind>(loadKind);
  const choose = (k: Kind) => {
    setKind(k);
    try { localStorage.setItem(STORAGE_KEY, k); } catch { /* ignore */ }
  };
  const current = KINDS.find((k) => k.id === kind)!;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sales Rep Cheat Sheet</h1>
        <p className="text-sm text-gray-500 mt-1">{current.blurb}</p>
      </div>

      <div role="tablist" aria-label="Cheat sheet type" className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={kind === k.id}
            onClick={() => choose(k.id)}
            className={`py-2.5 rounded-lg text-sm font-semibold ${
              kind === k.id ? 'bg-white text-ink shadow-sm' : 'text-gray-500'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kind === 'residential' ? <ResidentialSheet /> : <CommercialSheet />}
    </div>
  );
}
