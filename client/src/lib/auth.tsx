import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SESSION_EXPIRED_EVENT, resetSessionExpiredNotice } from './api';
import { applyBrandTheme } from './brand';
import { isSetPasswordPath } from './password-pages';
import { setTimeZoneProvider } from '../../../shared/schedule-board';
import type { TeamRole } from '../../../shared/rbac';
import type { CompanyProfile } from '../../../shared/company';

export interface AuthUser { email: string; name: string; role: TeamRole }
/**
 * The company profile /api/auth/me sends, plus the menu pages the company's
 * admin hid from this person's level (Company page, shared/menu.ts).
 */
export type SessionProfile = CompanyProfile & { hiddenPages?: string[] };
interface AuthState {
  user: AuthUser | null;
  /**
   * The signed-in person's company, as /api/auth/me describes it (name,
   * contact details, colors). Null before sign-in. Read it through
   * useCompany() (lib/company.tsx), which fills in a neutral profile.
   */
  profile: SessionProfile | null;
  loading: boolean;
  expired: boolean;
  /** The last session check couldn't reach the server — we are offline, not signed out. */
  offline: boolean;
  signOut: () => Promise<void>;
  /** Ask the server again for the person and their company, e.g. after the Company page saves. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ user: null, profile: null, loading: true, expired: false, offline: false, signOut: async () => {}, refresh: async () => {} });

/**
 * Who was signed in last time the server answered.
 *
 * A rep on a roof loses signal, `/api/auth/me` fails, and without this the app
 * decided they were signed out and offered them a Google button that cannot
 * work without a network. Remembering the last confirmed session lets the app
 * stay usable — and a real 401 still clears it, so this never keeps someone
 * signed in after the server has said otherwise.
 */
const CACHE_KEY = 'archie.session';
/** The company that went with that session, so the app keeps its name and colors offline. */
const COMPANY_CACHE_KEY = 'archie.company';

function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u && typeof u.email === 'string' && typeof u.role === 'string' ? (u as AuthUser) : null;
  } catch { return null; }
}

function writeCachedUser(u: AuthUser | null): void {
  try {
    if (u) localStorage.setItem(CACHE_KEY, JSON.stringify(u));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* private window or blocked storage — the app still works online */ }
}

function readCachedProfile(): SessionProfile | null {
  try {
    const raw = localStorage.getItem(COMPANY_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p.displayName === 'string' && p.colors && typeof p.colors.primary === 'string' ? (p as SessionProfile) : null;
  } catch { return null; }
}

function writeCachedProfile(p: SessionProfile | null): void {
  try {
    if (p) localStorage.setItem(COMPANY_CACHE_KEY, JSON.stringify(p));
    else localStorage.removeItem(COMPANY_CACHE_KEY);
  } catch { /* private window or blocked storage */ }
}

/** How long to wait before asking the server again while it isn't answering. */
export const OFFLINE_RETRY_MS = 15_000;

/**
 * Ask again, once, a while from now — for as long as we are offline.
 *
 * The 'online' event only fires when the device's own network comes back. A
 * 5xx from a deploy rolling out, or a cold start, is the network being fine
 * and the server not answering yet — no event ever fires for it, so the
 * offline banner stayed up until the rep reloaded the page. Scheduling twice
 * keeps one timer; cancel() is for a real answer and for unmount.
 */
export function offlineRetry(run: () => void, ms = OFFLINE_RETRY_MS): { schedule: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer) return;
      timer = setTimeout(() => { timer = null; run(); }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [offline, setOffline] = useState(false);
  const checkRef = useRef<(() => Promise<void>) | null>(null);

  // When the session goes, drop to the sign-in screen rather than leaving a
  // shell where every panel fails differently.
  useEffect(() => {
    const onExpired = () => { setUser(null); setProfile(null); setExpired(true); setOffline(false); writeCachedUser(null); writeCachedProfile(null); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const retry = offlineRetry(() => { if (!cancelled) check(); });

    const check = async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        if (cancelled) return;
        if (r.ok) {
          const d = await r.json().catch(() => null);
          const u = (d?.user ?? null) as AuthUser | null;
          const p = (u && d?.profile ? d.profile : null) as SessionProfile | null;
          retry.cancel();
          setUser(u);
          setProfile(p);
          setOffline(false);
          writeCachedUser(u);
          writeCachedProfile(p);
          if (u) { setExpired(false); resetSessionExpiredNotice(); }
          return;
        }
        if (r.status === 401 || r.status === 403) {
          // The server answered and said no. That is a real sign-out, so the
          // cached session goes with it.
          retry.cancel();
          setUser(null);
          setProfile(null);
          setOffline(false);
          writeCachedUser(null);
          writeCachedProfile(null);
          return;
        }
        // A 502 or 503 while a deploy rolls out or the server cold-starts is
        // not the server saying no — signing reps out on it erased their
        // session mid-job. Treat it like no signal: keep the last confirmed
        // session and say we can't reach the server.
        setUser(readCachedUser());
        setProfile(readCachedProfile());
        setOffline(true);
        retry.schedule();
      } catch {
        // The server didn't answer at all. We cannot tell whether the session
        // is still good, so we keep the last one we confirmed and say we're
        // offline rather than pretending the rep has been signed out.
        if (cancelled) return;
        const cached = readCachedUser();
        setUser(cached);
        setProfile(cached ? readCachedProfile() : null);
        setOffline(true);
        retry.schedule();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    checkRef.current = check;
    check();

    // Coming back into signal re-checks, so a genuinely expired session is
    // caught the moment the network returns.
    const onOnline = () => { check(); };
    window.addEventListener('online', onOnline);
    return () => { cancelled = true; retry.cancel(); window.removeEventListener('online', onOnline); };
  }, []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
    setProfile(null);
    setExpired(false);
    setOffline(false);
    writeCachedUser(null);
    writeCachedProfile(null);
    resetSessionExpiredNotice();
  }

  // The company's colors on every brand-* class, and its chosen main color on
  // the app chrome (ink-*); Archie's when signed out. The set-password page is
  // Archie's own whoever is signed in, like the sign-in page.
  useEffect(() => {
    const archie = !profile || isSetPasswordPath(window.location.pathname);
    applyBrandTheme(archie ? null : { ...profile.colors, ink: profile.brandPrimary || undefined });
  }, [profile]);
  // Schedules and due dates show in the company's own time zone.
  useEffect(() => { setTimeZoneProvider(() => profile?.timeZone); }, [profile]);

  const refresh = async () => { await checkRef.current?.(); };

  return <Ctx.Provider value={{ user, profile, loading, expired, offline, signOut, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() { return useContext(Ctx); }
