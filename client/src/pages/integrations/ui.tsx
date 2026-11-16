/**
 * Small pieces the Integrations cards share: the card frame, the status pill,
 * a labelled input, a copyable value, and the connection state hook.
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';

/** What the connection routes answer. Never a secret. */
export interface ConnectionState {
  connected: boolean;
  source: 'company' | 'shared' | null;
  accountName?: string;
}

/** Tell the rest of the app (the KynexPro banner) that a connection changed. */
export const CONNECTIONS_CHANGED_EVENT = 'archie:integrations-changed';
export const announceConnectionsChanged = () => window.dispatchEvent(new CustomEvent(CONNECTIONS_CHANGED_EVENT));

export function useConnection(path: string) {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoadError(null);
    try { setState(await api.get<ConnectionState>(path)); }
    catch (e: any) { setLoadError(e?.message || 'Could not load this connection.'); }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { state, setState, loadError, reload };
}

export function IntegrationCard({ id, title, tag, summary, status, children }: {
  id: string;
  title: string;
  tag?: string;
  summary: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="bg-white rounded-xl border border-gray-200">
      <header className="px-4 sm:px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex flex-wrap items-center gap-2">
            <h2 id={`${id}-title`} className="text-lg font-semibold text-gray-900">{title}</h2>
            {tag && <span className="text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-600">{tag}</span>}
          </div>
          {status && <div className="shrink-0">{status}</div>}
        </div>
        <p className="text-sm text-gray-500 mt-1">{summary}</p>
      </header>
      <div className="px-4 sm:px-6 pb-5 space-y-4">{children}</div>
    </section>
  );
}

export function StatusPill({ connected, loading }: { connected: boolean; loading?: boolean }) {
  if (loading) return <span className="text-xs text-gray-400" role="status">Checking...</span>;
  return connected ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 ring-1 ring-green-200">
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-green-500" />Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-50 text-gray-600 ring-1 ring-gray-200">
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-gray-400" />Not connected
    </span>
  );
}

export function Field({ label, hint, type = 'text', value, onChange, autoComplete = 'off', placeholder, required }: {
  label: string;
  hint?: ReactNode;
  type?: 'text' | 'password';
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">{label}</label>
      {hint && <p id={`${id}-hint`} className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        spellCheck={false}
        placeholder={placeholder}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
      />
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{message}</p>;
}

export function PrimaryButton({ busy, busyLabel, children, type = 'submit', onClick }: {
  busy?: boolean; busyLabel?: string; children: ReactNode; type?: 'submit' | 'button'; onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy}
      className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
    >
      {busy ? (busyLabel ?? 'Saving...') : children}
    </button>
  );
}

export function SecondaryButton({ busy, busyLabel, children, onClick, danger }: {
  busy?: boolean; busyLabel?: string; children: ReactNode; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`px-3 py-1.5 text-sm font-medium rounded-lg border disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        danger ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
      }`}
    >
      {busy ? (busyLabel ?? 'Working...') : children}
    </button>
  );
}

/** A value someone pastes into another system, with a copy button. */
export function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setShown(true); }
  };
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <div className="mt-1 flex items-stretch gap-2">
        <code className="flex-1 min-w-0 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs sm:text-sm text-gray-800 break-all">
          {shown ? value : '•'.repeat(24)}
        </code>
        {secret && (
          <button type="button" onClick={() => setShown((s) => !s)} className="shrink-0 px-3 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            {shown ? 'Hide' : 'Show'}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="shrink-0 px-3 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
