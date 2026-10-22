import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native iOS/Android shell for the Archie team app.
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
 * Which deployment the shell loads comes from CAP_SERVER_URL at `cap sync`
 * time (e.g. CAP_SERVER_URL=https://app.example.com npx cap sync). There is no
 * built-in default: without it, `server.url` is left out and the shell shows
 * the bundled build in webDir, which cannot sign in (see above), so set it for
 * every real build.
 *
 * appId must match the bundle id / applicationId of the native projects in
 * ios/ and android/, which are regenerated for Archie.
 */
const serverUrl = process.env.CAP_SERVER_URL?.trim() || undefined;

const config: CapacitorConfig = {
  appId: 'app.archie.mobile',
  appName: 'Archie',
  // Fallback bundle: only shown when CAP_SERVER_URL is not set.
  webDir: 'dist/public',
  server: {
    ...(serverUrl ? { url: serverUrl } : {}),
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
