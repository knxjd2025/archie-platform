import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { isNativeApp, startNativeSignIn } from '../lib/native';

export default function Login() {
  const { expired } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [clicking, setClicking] = useState(false);
  const native = isNativeApp();

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-navy to-navy-deep">
      <div className="bg-white shadow-xl rounded-2xl w-full max-w-sm text-center overflow-hidden">
        {/* Gold accent rule */}
        <div className="h-1.5 bg-gold" />
        <div className="p-8">
          <img src="/logo.jpg" alt="Best Roofing Now" className="h-16 w-auto mx-auto mb-5" />
          <h1 className="text-2xl font-semibold text-navy">Team App</h1>
          <p className="text-sm text-gray-500 mb-6">Company Assistant Console</p>
          {error && (
            <div className="mb-4">
              <p className="text-sm text-brick font-medium">
                {error === 'not_authorized' ? 'That account is not authorized.'
                  : error === 'cancelled' ? 'Sign-in was not finished. Try again.'
                  : 'Sign-in failed. Try again.'}
              </p>
              {error !== 'not_authorized' && error !== 'cancelled' && (
                <p className="text-xs text-gray-400 mt-1">
                  If this keeps happening,{' '}
                  <a href="mailto:admin@bestroofingnow.com" className="text-blue-600 hover:underline">
                    contact your admin
                  </a>.
                </p>
              )}
            </div>
          )}
          {expired && (
            <p className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Your session timed out — sign in again to pick up where you left off.
            </p>
          )}
          <a
            href="/api/auth/login/google"
            onClick={onSignIn}
            aria-disabled={clicking}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-3 text-sm font-medium text-white hover:bg-navy-dark transition-colors ${clicking ? 'opacity-70 pointer-events-none' : ''}`}
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
          <p className="mt-5 text-[11px] text-gray-400">Veteran-owned · Charlotte, NC</p>
        </div>
      </div>
    </div>
  );
}
