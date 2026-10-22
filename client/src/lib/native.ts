/**
 * The native shell, seen from the web app.
 *
 * The iOS and Android apps are Capacitor shells that load this site rather
 * than bundling it, so this code runs in both places and must work in both.
 * Capacitor injects `window.Capacitor` into the page it loads; on the website
 * that object simply is not there. Everything here is feature detection
 * against that global — no Capacitor packages are imported, so the web bundle
 * is unchanged and the browser build carries none of this weight.
 */

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, any>;
}

const bridge = (): CapacitorBridge | null => (window as any).Capacitor ?? null;

/** True only inside the iOS or Android shell. */
export const isNativeApp = (): boolean => {
  try { return bridge()?.isNativePlatform?.() === true; } catch { return false; }
};

export const nativePlatform = (): 'ios' | 'android' | 'web' => {
  try {
    const p = bridge()?.getPlatform?.();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch { return 'web'; }
};

const plugin = (name: string): any => bridge()?.Plugins?.[name] ?? null;

/**
 * Open a page outside the app.
 *
 * In the shell, sending the WebView itself to another site strands the rep —
 * there is no address bar and no back button to get home — and window.open
 * is swallowed without a word. The Browser plugin puts the page in the real
 * in-app browser, which closes back to us. On the website (or when the plugin
 * is missing) this is an ordinary new tab. Resolves false when nothing opened,
 * so the caller can say so rather than act as though it did.
 */
export async function openExternal(url: string): Promise<boolean> {
  const Browser = isNativeApp() ? plugin('Browser') : null;
  if (Browser?.open) {
    try { await Browser.open({ url }); return true; }
    catch (e) { console.warn('[native] could not open the browser', e); return false; }
  }
  try {
    // No 'noopener' in the features: with it, browsers return null even when
    // the tab opened, and null is the only signal that a popup was blocked.
    const w = window.open(url, '_blank');
    if (!w) return false;
    try { w.opener = null; } catch { /* cross-origin already */ }
    return true;
  } catch { return false; }
}

export type NativeSignInResult = 'signed-in' | 'cancelled' | 'failed' | 'unavailable';

// After the in-app browser closes, how long to wait for the brnapp:// link
// before calling it a cancel. On Android the Custom Tab reports "finished" a
// beat before the deep link reaches the app, so settling at once would turn a
// good sign-in into a cancel.
const BROWSER_CLOSED_GRACE_MS = 1500;

/**
 * Sign in from the native app.
 *
 * Google refuses OAuth inside an embedded WebView, so the consent screen has
 * to happen in the real browser. The server sends that browser back to
 * `brnapp://auth?t=…`; the listener below catches it and trades the token for
 * a session cookie in this WebView — which is the only jar that matters here.
 *
 * Always settles. A rep who closes the browser without signing in used to
 * leave the promise hanging and the button spinning forever; now that is
 * 'cancelled'. Both listeners are removed when it settles: a listener left
 * from an earlier attempt traded the same token a second time, and the loser
 * of that race sent the app to /login?error=auth_failed over a good sign-in.
 *
 * 'unavailable' means the plugins are not there, so the caller can say so
 * rather than leave somebody on a dead button.
 */
export async function startNativeSignIn(): Promise<NativeSignInResult> {
  const Browser = plugin('Browser');
  const App = plugin('App');
  if (!Browser?.open || !App?.addListener) return 'unavailable';

  return new Promise<NativeSignInResult>((resolve) => {
    let settled = false;
    let handling = false;              // a brnapp://auth link arrived; it owns the outcome now
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const handles: Array<Promise<any> | any> = [];

    const finish = (result: NativeSignInResult) => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      for (const h of handles) {
        Promise.resolve(h).then((x) => x?.remove?.()).catch(() => { /* already gone */ });
      }
      resolve(result);
    };

    handles.push(App.addListener('appUrlOpen', async (event: { url?: string }) => {
      const url = event?.url || '';
      if (!url.includes('://auth')) return;
      if (settled || handling) return;   // one exchange per attempt, never two
      handling = true;
      try {
        const token = new URL(url).searchParams.get('t');
        if (!token) return finish('failed');
        // Close the browser first: leaving it up over a reloading app looks broken.
        try { await Browser.close?.(); } catch { /* already gone */ }

        const res = await fetch('/api/auth/native/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          console.warn('[native] exchange failed', body);
          finish('failed');
          window.location.href = `/login?error=${res.status === 403 ? 'not_authorized' : 'auth_failed'}`;
          return;
        }
        // The cookie is set; load the app proper.
        finish('signed-in');
        window.location.href = '/';
      } catch (e) {
        console.warn('[native] sign-in handoff failed', e);
        finish('failed');
      }
    }));

    if (Browser.addListener) {
      handles.push(Browser.addListener('browserFinished', () => {
        if (settled || handling) return;
        graceTimer = setTimeout(() => { if (!handling) finish('cancelled'); }, BROWSER_CLOSED_GRACE_MS);
      }));
    }

    Promise.resolve(Browser.open({ url: `${window.location.origin}/api/auth/login/google?native=1` }))
      .catch((e: unknown) => { console.warn('[native] could not open the browser', e); finish('failed'); });
  });
}
