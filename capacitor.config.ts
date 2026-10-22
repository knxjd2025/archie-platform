import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native iOS/Android shell for the Best Roofing Now team app.
 *
 * The shell loads the LIVE app rather than bundling the web assets locally.
 * That's deliberate:
 *   • Login is a session cookie + Google OAuth redirect. Bundled assets run on
 *     capacitor://localhost, a different origin — cookies and the OAuth return
 *     would both break. Loading the real origin keeps sign-in working as-is.
 *   • Every app update ships instantly; no App Store review to fix a typo.
 *   • The app is a live-data tool (leads, messages, JobTread) — offline use
 *     isn't meaningful, so bundling buys nothing.
 *
 * Native camera/GPS/push still work: Capacitor's bridge is injected into the
 * remote page, so @capacitor/camera and @capacitor/geolocation are available.
 *
 * Point at a different environment with CAP_SERVER_URL when testing.
 */
const serverUrl = process.env.CAP_SERVER_URL || 'https://app.bestroofingnow.com';

const config: CapacitorConfig = {
  appId: 'com.bestroofingnow.teamapp',
  appName: 'Best Roofing Now',
  // Fallback bundle: only shown if `server.url` is ever removed.
  webDir: 'dist/public',
  server: {
    url: serverUrl,
    // Never allow plaintext — the session cookie must not travel unencrypted.
    cleartext: false,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
