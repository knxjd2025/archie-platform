import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CommsVersion, Readiness } from '../../../shared/comms-version';

interface State {
  version: CommsVersion;
  setBy: string | null;
  setAt: string | null;
  owner: string;
  labels: Record<CommsVersion, string>;
  blurbs: Record<CommsVersion, string>;
  readiness: Readiness;
  blockedReason: string | null;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/**
 * The switch between GoHighLevel and our own phone stack.
 *
 * Only James sees this — the server answers 404 to anyone else, so a rep
 * poking at the URL learns nothing. It is temporary scaffolding for running
 * the real business on V2 for an afternoon and putting it straight back, and
 * it comes out with the V1 code once V2 has held up.
 *
 * The component fetches once and hides itself entirely if the server says no,
 * so nothing about it is visible to anyone else.
 */
export default function CommsVersionToggle() {
  const { user } = useAuth();
  const [state, setState] = useState<State | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => {
    api.get<State>('/api/comms/version')
      .then(setState)
      .catch(() => setHidden(true));
  };
  useEffect(() => { if (user) load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden || !state) return null;

  const on = state.version === 'v2';
  const blocked = state.blockedReason;

  const flip = async (next: CommsVersion) => {
    if (next === state.version) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.put<State>('/api/comms/version', { version: next });
      setState((s) => (s ? { ...s, ...r } : s));
      setNote(next === 'v2'
        ? 'On V2. Texts and calls now go out on our own numbers — GoHighLevel is still connected and still receiving.'
        : 'Back on V1. Everything is going through GoHighLevel again.');
      load();
    } catch (e: any) {
      setNote(e?.message || 'That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Phone &amp; texting stack</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Only you can see this. Temporary, until the switch is finished for good.
          </p>
        </div>
        <span className={`text-[10px] px-2 py-1 rounded font-semibold ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
          {on ? 'V2' : 'V1'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-labelledby="comms-stack-heading">
        <span id="comms-stack-heading" className="sr-only">Which phone stack to use</span>
        {(['v1', 'v2'] as const).map((v) => {
          const active = state.version === v;
          const disabled = busy || (v === 'v2' && !!blocked);
          return (
            <button
              key={v}
              onClick={() => flip(v)}
              disabled={disabled}
              aria-pressed={active}
              title={v === 'v2' && blocked ? blocked : undefined}
              className={`text-left rounded-lg border p-3 transition ${
                active ? 'border-navy bg-navy text-white' : 'border-gray-200 bg-white hover:border-gray-300'
              } ${disabled && !active ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className="block text-sm font-semibold">{state.labels[v]}</span>
              <span className={`block text-[11px] mt-1 leading-snug ${active ? 'text-white/80' : 'text-gray-500'}`}>
                {state.blurbs[v]}
              </span>
            </button>
          );
        })}
      </div>

      {note && <p className="mt-3 text-sm bg-gray-900 text-white rounded-lg px-3 py-2">{note}</p>}

      {blocked && (
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {blocked}
        </p>
      )}

      {/* What V2 still needs, each with the thing to do about it — so this is
          never just a greyed-out button with no explanation. */}
      <ul className="mt-3 space-y-1.5">
        {state.readiness.requirements.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-xs">
            <span aria-hidden="true" className={r.ready ? 'text-emerald-600' : 'text-gray-300'}>
              {r.ready ? '●' : '○'}
            </span>
            <span className="sr-only">{r.ready ? 'Ready:' : 'Not ready:'}</span>
            <span className={r.ready ? 'text-gray-600' : 'text-gray-500'}>
              {r.label}
              {!r.ready && <span className="block text-gray-400">{r.fix}</span>}
            </span>
          </li>
        ))}
      </ul>

      {state.setAt && (
        <p className="mt-3 text-[11px] text-gray-400">
          Last changed {when(state.setAt)}{state.setBy ? ` by ${state.setBy.split('@')[0]}` : ''}.
          Switching back to V1 always works, whatever state V2 is in.
        </p>
      )}
    </div>
  );
}
