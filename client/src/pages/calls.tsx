import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { callClock, prettyFrom } from '../lib/softphone';

interface CallRow {
  id: number;
  direction: 'inbound' | 'outbound';
  status: string | null;
  outcome: string | null;
  fromE164: string;
  toE164: string;
  ourNumber: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  answeredBy: string | null;
  repName: string | null;
  summary: string | null;
  leadExternalId: string | null;
  hasRecording: boolean;
  transcript: string | null;
  clientName: string | null;
}

/** What actually happened, said plainly. */
const OUTCOME: Record<string, { label: string; tone: string }> = {
  connected: { label: 'Spoke', tone: 'bg-emerald-100 text-emerald-700' },
  handed_to_ai: { label: 'Went to AI', tone: 'bg-sky-100 text-sky-700' },
  no_answer: { label: 'No answer', tone: 'bg-gray-100 text-gray-600' },
  no_conversation: { label: 'Picked up, no talk', tone: 'bg-amber-100 text-amber-700' },
  busy: { label: 'Busy', tone: 'bg-amber-100 text-amber-700' },
  failed: { label: 'Failed', tone: 'bg-red-100 text-red-700' },
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

/**
 * Every call, newest first — the screen that was missing.
 *
 * The calls were being recorded from the first day the phone worked; there
 * was simply nowhere to look at them, which from the outside is
 * indistinguishable from not recording them at all.
 */
export default function CallsPage({ onOpenClient }: { onOpenClient?: (externalId: string) => void }) {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  const load = () => {
    api.get<{ calls: CallRow[] }>('/api/calls?limit=100')
      .then((r) => { setRows(r.calls || []); setError(null); })
      .catch((e: any) => setError(e?.message || 'Could not load the calls.'));
  };
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Calls</h1>
          <p className="text-sm text-gray-500 mt-0.5">Every call in and out, with recordings.</p>
        </div>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 font-medium">
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3">
          <span>{error}</span>
          <button onClick={load} className="text-xs underline">Retry</button>
        </div>
      )}

      {!rows && !error && (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse" />)}</div>
      )}

      {rows && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-center">
          <p className="text-sm text-gray-600">No calls yet.</p>
          <p className="text-xs text-gray-400 mt-1">
            Calls to and from the company numbers show up here as soon as they happen.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {rows.map((c) => {
            const other = c.direction === 'inbound' ? c.fromE164 : c.toE164;
            const o = c.outcome ? OUTCOME[c.outcome] : null;
            return (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="text-lg leading-none mt-0.5" aria-hidden="true">
                    {c.direction === 'inbound' ? '📥' : '📤'}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {c.clientName || prettyFrom(other)}
                      </span>
                      {o && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${o.tone}`}>{o.label}</span>}
                      {c.answeredBy === 'ai' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-600">AI</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.direction === 'inbound' ? 'From' : 'To'} {prettyFrom(other)}
                      {c.durationSeconds ? ` · ${callClock(c.durationSeconds)}` : ''}
                      {c.repName ? ` · ${c.repName}` : ''}
                      {c.startedAt ? ` · ${when(c.startedAt)}` : ''}
                    </p>
                    {c.summary && <p className="text-xs text-gray-400 mt-1">{c.summary}</p>}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {c.leadExternalId && onOpenClient && (
                      <button
                        onClick={() => onOpenClient(c.leadExternalId!)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium text-gray-700"
                      >
                        Open file
                      </button>
                    )}
                    {c.hasRecording && (
                      <button
                        onClick={() => setPlaying(playing === c.id ? null : c.id)}
                        aria-expanded={playing === c.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-ink text-white font-medium"
                      >
                        {playing === c.id ? 'Hide' : '▶ Recording'}
                      </button>
                    )}
                  </div>
                </div>

                {playing === c.id && c.hasRecording && (
                  <audio controls autoPlay src={`/api/calls/${c.id}/recording`} className="w-full mt-3">
                    Your browser cannot play this recording.
                  </audio>
                )}

                {c.transcript && (
                  <details className="mt-2">
                    <summary className="text-xs text-blue-600 cursor-pointer">Transcript</summary>
                    <p className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap">{c.transcript}</p>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
