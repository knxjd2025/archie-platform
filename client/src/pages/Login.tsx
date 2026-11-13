import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { isNativeApp, startNativeSignIn } from '../lib/native';
import { ArchieMark, PRODUCT_NAME } from '../lib/company';
import { postAuth } from '../lib/auth-post';

export default function Login() {
  const { expired } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [clicking, setClicking] = useState(false);
  const native = isNativeApp();
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onPasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    setBusy(true);
    const err = await postAuth('/api/auth/login/password', { email, password });
    if (err) { setFormError(err); setBusy(false); return; }
    window.location.assign('/');   // reload so useAuth picks up the session
  };

  const onForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    setBusy(true);
    const err = await postAuth('/api/auth/password/forgot', { email });
    setBusy(false);
    if (err) setFormError(err); else setSent(true);
  };

  const field = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-accent';
  const primary = 'w-full rounded-lg bg-ink px-4 py-3 text-sm font-medium text-white hover:bg-ink-dark transition-colors disabled:opacity-70';

  /**
   * In the app the consent screen opens in the real browser — Google will not
   * run OAuth inside a WebView. If any of that is unavailable we let the link
   * behave normally rather than strand somebody on a button that does nothing.
   */
  const onSignIn = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    setClicking(true);
    if (!native) return;                     // website: the href does the work
    e.preventDefault();
    const result = await startNativeSignIn();
    // 'signed-in' is already loading the app, and a failed exchange has already
    // sent us to /login?error=… — only the outcomes that stay on this page need
    // the button back. Closing the browser without finishing used to leave it
    // spinning on "Opening your browser…" for good.
    if (result === 'cancelled') { setClicking(false); setError('cancelled'); }
    else if (result === 'unavailable' || result === 'failed') { setClicking(false); setError('auth_failed'); }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) {
      setError(err);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-ink to-ink-deep">
      <div className="bg-white shadow-xl rounded-2xl w-full max-w-sm text-center overflow-hidden">
        {/* Accent rule. No company is known before sign-in, so this is Archie's own. */}
        <div className="h-1.5 bg-brand-accent" />
        <div className="p-8">
          <ArchieMark size={64} className="mx-auto mb-5" />
          <h1 className="text-2xl font-semibold text-ink">{PRODUCT_NAME}</h1>
          <p className="text-sm text-gray-500 mb-6">Sign in to your team's workspace</p>
          {error && (
            <div className="mb-4">
              <p className="text-sm text-red-600 font-medium">
                {error === 'not_authorized' ? 'That account is not authorized.'
                  : error === 'cancelled' ? 'Sign-in was not finished. Try again.'
                  : 'Sign-in failed. Try again.'}
              </p>
              {error !== 'not_authorized' && error !== 'cancelled' && (
                <p className="text-xs text-gray-400 mt-1">
                  If this keeps happening, ask your company's {PRODUCT_NAME} admin.
                </p>
              )}
            </div>
          )}
          {expired && (
            <p className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Your session timed out — sign in again to pick up where you left off.
            </p>
          )}
          {mode === 'signin' ? (
            <form onSubmit={onPasswordSignIn} className="text-left mb-4">
              <label htmlFor="login-email" className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input id="login-email" type="email" autoComplete="username" required value={email}
                onChange={(e) => setEmail(e.target.value)} className={`${field} mb-3`} />
              <label htmlFor="login-password" className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input id="login-password" type="password" autoComplete="current-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} className={`${field} mb-3`} />
              {formError && <p role="alert" className="mb-3 text-sm text-red-600 font-medium">{formError}</p>}
              <button type="submit" disabled={busy} className={primary}>{busy ? 'Signing in…' : 'Sign in'}</button>
              <button type="button" onClick={() => { setMode('forgot'); setFormError(null); setSent(false); }}
                className="mt-3 block mx-auto text-xs text-gray-500 hover:text-ink underline">
                Forgot password?
              </button>
            </form>
          ) : (
            <form onSubmit={onForgot} className="text-left mb-4">
              <label htmlFor="forgot-email" className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input id="forgot-email" type="email" autoComplete="username" required value={email}
                onChange={(e) => setEmail(e.target.value)} className={`${field} mb-3`} />
              {sent && <p role="status" className="mb-3 text-sm text-green-700">If that email is on a team, we sent a link. Check your inbox.</p>}
              {formError && <p role="alert" className="mb-3 text-sm text-red-600 font-medium">{formError}</p>}
              <button type="submit" disabled={busy} className={primary}>{busy ? 'Sending…' : 'Email me a link'}</button>
              <button type="button" onClick={() => { setMode('signin'); setFormError(null); }}
                className="mt-3 block mx-auto text-xs text-gray-500 hover:text-ink underline">
                Back to sign in
              </button>
            </form>
          )}
          <div className="flex items-center gap-3 mb-4 text-xs text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />or<span className="h-px flex-1 bg-gray-200" />
          </div>
          <a
            href="/api/auth/login/google"
            onClick={onSignIn}
            aria-disabled={clicking}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3 text-sm font-medium text-white hover:bg-ink-dark transition-colors ${clicking ? 'opacity-70 pointer-events-none' : ''}`}
          >
            {clicking ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                {native ? 'Opening your browser…' : 'Redirecting…'}
              </>
            ) : (
              'Sign in with Google'
            )}
          </a>
          <p className="mt-5 text-[11px] text-gray-400">{PRODUCT_NAME} · the team app for roofing companies</p>
        </div>
      </div>
    </div>
  );
}
