import { useState } from 'react';
import { ArchieMark, PRODUCT_NAME } from '../lib/company';
import { postAuth } from '../lib/auth-post';

// Read once and cached: the hash is cleared right away, and React may run a
// state initializer twice in development.
let captured: string | null | undefined;
function takeToken(): string | null {
  if (captured !== undefined) return captured;
  const m = /(?:^#|&)t=([^&]*)/.exec(window.location.hash);
  let token: string | null = null;
  if (m) {
    try { token = decodeURIComponent(m[1]) || null; } catch { token = null; }
  }
  // The code must not linger in the address bar or history.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  captured = token;
  return token;
}

export default function SetPassword() {
  const [token] = useState(takeToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !token) return;
    if (password !== confirm) { setError("The passwords don't match."); return; }
    setError(null);
    setBusy(true);
    const err = await postAuth('/api/auth/password/set', { token, password });
    if (err) { setError(err); setBusy(false); return; }
    window.location.assign('/');
  };

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-accent';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-ink to-ink-deep">
      <div className="bg-white shadow-xl rounded-2xl w-full max-w-sm text-center overflow-hidden">
        <div className="h-1.5 bg-brand-accent" />
        <div className="p-8">
          <ArchieMark size={64} className="mx-auto mb-5" />
          {token ? (
            <form onSubmit={submit} className="text-left">
              <h1 className="text-2xl font-semibold text-ink text-center">Set your password</h1>
              <p className="text-sm text-gray-500 mb-6 text-center">At least 10 characters.</p>
              <label htmlFor="new-password" className="block text-xs font-medium text-gray-600 mb-1">New password</label>
              <input id="new-password" type="password" autoComplete="new-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} className={`${input} mb-3`} />
              <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-600 mb-1">Confirm password</label>
              <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} className={`${input} mb-4`} />
              {error && <p role="alert" className="mb-3 text-sm text-red-600 font-medium">{error}</p>}
              <button type="submit" disabled={busy}
                className="w-full rounded-lg bg-ink px-4 py-3 text-sm font-medium text-white hover:bg-ink-dark transition-colors disabled:opacity-70">
                {busy ? 'Saving…' : 'Save and sign in'}
              </button>
            </form>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-ink">{PRODUCT_NAME}</h1>
              <p role="alert" className="mt-3 text-sm text-red-600 font-medium">
                This link is missing its code. Ask for a new one from the sign-in page.
              </p>
              <a href="/" className="mt-5 inline-block text-sm font-medium text-ink underline">Go to sign in</a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
