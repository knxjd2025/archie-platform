import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

interface Result {
  externalId: string | null;
  name: string;
  stage: string | null;
  location: string | null;
}

export default function SearchOverlay({ onClose, onSelect }: { onClose: () => void; onSelect: (externalId: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setSearchError(false); return; }
    setLoading(true);
    setSearchError(false);
    const t = setTimeout(() => {
      const id = ++requestId.current;
      api.get<{ results: Result[] }>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { if (id === requestId.current) setResults(r.results || []); })
        .catch(() => { if (id === requestId.current) { setResults([]); setSearchError(true); } })
        .finally(() => { if (id === requestId.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 top-0 sm:top-16 mx-auto max-w-xl px-4">
        <div className="bg-white rounded-b-2xl sm:rounded-2xl shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
            <span className="text-gray-400" aria-hidden>🔍</span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search clients, jobs, phone, or address"
              placeholder="Search clients, jobs, phone, address…"
              className="flex-1 text-base outline-none"
            />
            <button onClick={onClose} aria-label="Close search" className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-gray-200">Esc</button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {q.trim().length < 2 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">Type at least 2 characters.</p>
            ) : loading ? (
              <div className="divide-y divide-gray-50">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                    <span className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5"><div className="h-3 w-1/3 bg-gray-100 rounded" /><div className="h-3 w-2/3 bg-gray-100 rounded" /></div>
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">{searchError ? 'Search failed, try again' : 'No matches.'}</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {results.map((r, i) => (
                  <button
                    key={r.externalId || i}
                    onClick={() => r.externalId && onSelect(r.externalId)}
                    disabled={!r.externalId}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 text-sm font-semibold flex items-center justify-center flex-shrink-0">
                      {(r.name || '?').trim()[0]?.toUpperCase() || '?'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                      <p className="text-xs text-gray-500 truncate">{[r.stage, r.location].filter(Boolean).join(' · ') || ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
