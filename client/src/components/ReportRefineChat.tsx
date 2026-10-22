import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  at?: string;
  changes?: string[];
}

// Common asks, so the rep doesn't have to think of the wording.
const QUICK = [
  'Shorten the summary to three sentences',
  'Rewrite it for an insurance adjuster',
  'Make the wording simpler for the homeowner',
];

/**
 * Ask for changes to a finished report in plain English. The server only lets
 * the AI rewrite wording — severities, measurements, storm data and pricing are
 * off-limits — and re-renders the report from the edited data.
 */
export default function ReportRefineChat({ externalId, reportId, onChanged }: {
  externalId: string;
  reportId: string;
  onChanged?: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadHistory = () => {
    setHistoryError(false);
    api.get<{ turns: Turn[] }>(`/api/clients/${externalId}/reports/${reportId}/chat`)
      .then((r) => setTurns(r.turns || []))
      .catch(() => setHistoryError(true));
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalId, reportId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [turns.length, busy]);

  const send = async (instruction: string) => {
    const msg = instruction.trim();
    if (!msg || busy) return;
    setBusy(true);
    setError(null);
    setText('');
    setTurns((t) => [...t, { role: 'user', text: msg }]);
    try {
      const r = await api.post<{ reply: string; changes: string[] }>(
        `/api/clients/${externalId}/reports/${reportId}/refine`, { instruction: msg },
      );
      setTurns((t) => [...t, { role: 'assistant', text: r.reply, changes: r.changes }]);
      if (r.changes?.length) onChanged?.();
    } catch (e: any) {
      setError(e?.message || 'That change could not be applied.');
      // Drop the optimistic turn — it was never applied to the report. Put
      // the instruction back in the box instead of just discarding it —
      // the rep had to retype the whole thing to retry otherwise.
      setTurns((t) => t.slice(0, -1));
      setText(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs text-gray-500 mb-2">
        Ask for changes in plain English. Wording only — damage findings, measurements, storm data and pricing stay as measured.
      </p>

      {historyError && (
        <p className="text-xs text-red-600 mb-2">
          Couldn't load chat history. <button onClick={loadHistory} className="underline hover:no-underline">Retry</button>
        </p>
      )}

      {turns.length > 0 && (
        <div className="max-h-60 overflow-y-auto space-y-2 mb-2">
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
              <span className={`inline-block text-sm rounded-lg px-2.5 py-1.5 max-w-[85%] text-left ${
                t.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
              }`}>
                {t.text}
              </span>
              {!!t.changes?.length && (
                <p className="text-[11px] text-emerald-700 mt-0.5">✓ updated {t.changes.join(', ')}</p>
              )}
              {t.role === 'assistant' && t.changes && t.changes.length === 0 && (
                <p className="text-[11px] text-gray-400 mt-0.5">No change made</p>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {QUICK.map((q) => (
            <button key={q} onClick={() => send(q)} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50">
              {q}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
          placeholder={busy ? 'Working…' : 'e.g. shorten the summary'}
          disabled={busy}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-blue-400 disabled:bg-gray-100"
        />
        <button onClick={() => send(text)} disabled={busy || !text.trim()}
          className="text-sm px-3 py-1.5 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
