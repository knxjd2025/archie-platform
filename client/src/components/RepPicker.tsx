import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

export interface RepOption { id: number; name: string; email?: string | null; jobtreadSalesRep?: string | null }

/**
 * Pick the person who gets paid.
 *
 * The rep on a commission record used to be a free-text name, copied off
 * whatever JobTread had. Two spellings of the same person split their payout
 * into two rows on the Payouts board, and nothing tied either row to a roster
 * member. This picks from the roster instead, so the record carries the member
 * id and the name comes from them.
 *
 * Three ways in, because different people reach for different ones: click the
 * field and choose from the list, type a few letters and click the match, or
 * type and press Enter to take the top one. Arrow keys move, Escape backs out.
 */
export default function RepPicker({
  teamMemberId, repName, disabled, onPick,
}: {
  teamMemberId: number | null;
  repName: string | null;
  disabled?: boolean;
  onPick: (member: RepOption | null) => void;
}) {
  const [reps, setReps] = useState<RepOption[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (disabled || reps.length || loadError) return;
    api.get<{ reps: RepOption[] }>('/api/team/reps')
      .then((r) => setReps(r.reps || []))
      .catch(() => setLoadError(true));
  }, [disabled, reps.length, loadError]);

  // Clicking anywhere else closes without committing a half-typed name.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reps;
    return reps.filter((r) => r.name.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q));
  }, [reps, query]);

  useEffect(() => { setActive(0); }, [query, open]);

  const choose = (r: RepOption | null) => {
    onPick(r);
    setOpen(false);
    setQuery('');
  };

  if (disabled) {
    return <p className="text-sm text-gray-800 px-1 py-1.5">{repName || <span className="text-gray-400">Not set</span>}</p>;
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="rep-picker-list"
        aria-autocomplete="list"
        value={open ? query : (repName || '')}
        placeholder={repName ? undefined : 'Choose or type a name'}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (open && matches[active]) choose(matches[active]); }
          else if (e.key === 'Escape') { setOpen(false); setQuery(''); inputRef.current?.blur(); }
        }}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 pr-8 focus:ring-1 focus:ring-blue-400"
      />
      <span aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>

      {open && (
        <ul id="rep-picker-list" role="listbox"
          className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {loadError && <li className="px-3 py-2 text-xs text-red-600">Couldn't load the team list.</li>}
          {!loadError && !reps.length && <li className="px-3 py-2 text-xs text-gray-400">Loading…</li>}
          {!!reps.length && !matches.length && <li className="px-3 py-2 text-xs text-gray-400">No one matches “{query}”.</li>}
          {matches.map((r, i) => (
            <li key={r.id} role="option" aria-selected={r.id === teamMemberId}>
              <button
                type="button"
                // Focus stays in the input, so mousedown must do the work — a
                // click handler fires after blur has already closed the list.
                onMouseDown={(e) => { e.preventDefault(); choose(r); }}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-3 py-2 text-sm ${i === active ? 'bg-blue-50' : ''} ${r.id === teamMemberId ? 'font-semibold text-navy' : 'text-gray-700'}`}
              >
                {r.name}
                {r.email && <span className="block text-[11px] text-gray-400">{r.email}</span>}
              </button>
            </li>
          ))}
          {repName && (
            <li role="option" aria-selected={false} className="border-t border-gray-100 mt-1 pt-1">
              <button type="button" onMouseDown={(e) => { e.preventDefault(); choose(null); }}
                className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-50">
                Clear — nobody assigned yet
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
