import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * The browser as a desk phone.
 *
 * Only the people whose number is set to ring a browser get one — the token
 * endpoint refuses everyone else, and this stays silent when it does. That
 * silence matters: a sales rep whose calls go to their mobile should never see
 * a call bar, and should never be asked for microphone permission.
 *
 * The SDK is loaded on demand for the same reason. It is a large dependency
 * and the client bundle is already over a megabyte; making every rep download
 * a softphone they will never use to open the dashboard is not a trade worth
 * making.
 */

export type PhoneState = 'off' | 'connecting' | 'ready' | 'ringing' | 'on-call' | 'error';

export interface IncomingInfo {
  from: string;
  /** Filled in once we have looked the number up. */
  name?: string | null;
  leadExternalId?: string | null;
}

interface TokenResponse {
  token: string;
  identity: string;
  expiresAt: string;
  number: string;
  label: string;
  /** False until a TwiML App is configured — take calls only. */
  canDial?: boolean;
}

export interface Softphone {
  state: PhoneState;
  /** The number this browser answers. Null when there is no phone here. */
  number: string | null;
  label: string | null;
  incoming: IncomingInfo | null;
  onCall: boolean;
  muted: boolean;
  /** Seconds, ticking while a call is up. */
  seconds: number;
  error: string | null;
  answer: () => void;
  hangUp: () => void;
  decline: () => void;
  toggleMute: () => void;
  /** Place a call from this browser. Resolves once it is connecting. */
  dial: (to: string, name?: string | null) => Promise<void>;
  /** True once the browser can place calls as well as take them. */
  canDial: boolean;
}

/** Twilio hands us "client:office" or a raw number; show something a person reads. */
export function prettyFrom(raw: string | undefined | null): string {
  const s = String(raw ?? '').replace(/^client:/i, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return s || 'Unknown';
}

/** Refresh the token this long before it lapses. */
const TOKEN_REFRESH_LEAD_MS = 5 * 60_000;
/** Never refresh sooner than this, and retry this soon after a failed refresh. */
const TOKEN_RETRY_MS = 60_000;

/**
 * How long to wait before replacing a token that expires at `expiresAt`.
 * A missing or garbled expiry falls back to the shortest wait, so a bad
 * answer from the server means an early refresh rather than none at all.
 */
export function tokenRefreshDelay(expiresAt: string | null | undefined, now: number = Date.now()): number {
  const at = new Date(String(expiresAt ?? '')).getTime();
  if (Number.isNaN(at)) return TOKEN_RETRY_MS;
  return Math.max(at - now - TOKEN_REFRESH_LEAD_MS, TOKEN_RETRY_MS);
}

export function useSoftphone(enabled: boolean): Softphone {
  const [state, setState] = useState<PhoneState>('off');
  const [number, setNumber] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<IncomingInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [canDial, setCanDial] = useState(false);
  const deviceRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const refreshRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  const stopTicking = () => {
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
  };

  /** Back to waiting, whatever just happened. */
  const toIdle = useCallback(() => {
    callRef.current = null;
    setIncoming(null);
    setMuted(false);
    setSeconds(0);
    stopTicking();
    setState((s) => (s === 'off' || s === 'error' ? s : 'ready'));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const attach = (call: any) => {
      callRef.current = call;
      call.on('disconnect', toIdle);
      call.on('cancel', toIdle);
      call.on('reject', toIdle);
      call.on('error', (e: any) => { setError(e?.message || 'The call dropped.'); toIdle(); });
    };

    const start = async () => {
      setState('connecting');
      let tok: TokenResponse;
      try {
        tok = await api.get<TokenResponse>('/api/voice/token');
      } catch {
        // No browser number for this person. Not an error — most people.
        if (!cancelled) setState('off');
        return;
      }
      if (cancelled) return;

      setNumber(tok.number);
      setLabel(tok.label);
      // Dialling needs a TwiML App on the token; without one the browser can
      // only take calls, and the UI should say so rather than offer a button
      // that fails.
      setCanDial(!!tok.canDial);

      let Device: any;
      try {
        ({ Device } = await import('@twilio/voice-sdk'));
      } catch {
        if (!cancelled) { setError('The phone could not load.'); setState('error'); }
        return;
      }
      if (cancelled) return;

      const device = new Device(tok.token, {
        codecPreferences: ['opus', 'pcmu'],
        // Chrome throttles background tabs; without this a call in an
        // unfocused tab degrades and nobody can tell why.
        enableImprovedSignalingErrorPrecision: true,
      });
      deviceRef.current = device;

      device.on('registered', () => { if (!cancelled) setState('ready'); });
      device.on('unregistered', () => { if (!cancelled) setState('connecting'); });
      device.on('error', (e: any) => {
        if (cancelled) return;
        setError(e?.message || 'The phone hit a problem.');
        setState('error');
      });

      device.on('incoming', (call: any) => {
        if (cancelled) return;
        attach(call);
        setIncoming({ from: prettyFrom(call.parameters?.From) });
        setState('ringing');
        // Who is this? Best effort — the bar is useful either way.
        const raw = String(call.parameters?.From || '');
        api.get<{ name?: string; externalId?: string }>(`/api/comms/who-is/${encodeURIComponent(raw)}`)
          .then((r) => { if (!cancelled) setIncoming((i) => (i ? { ...i, name: r?.name ?? null, leadExternalId: r?.externalId ?? null } : i)); })
          .catch(() => {});
      });

      try { await device.register(); } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Could not connect the phone.'); setState('error'); }
      }

      // Tokens last an hour; replace it before it lapses rather than after,
      // so an incoming call never lands on an expired device. Each refresh
      // arms the next one from the new token's expiry — refreshing once and
      // stopping left the browser deaf to calls about two hours in.
      const scheduleRefresh = (expiresAt: string) => {
        if (cancelled) return;
        refreshRef.current = window.setTimeout(async () => {
          if (cancelled) return;
          let nextExpiry: string | null = null;
          try {
            const next = await api.get<TokenResponse>('/api/voice/token');
            if (cancelled) return;
            deviceRef.current?.updateToken(next.token);
            nextExpiry = next.expiresAt;
          } catch { /* try again shortly — the token we hold may still be good */ }
          scheduleRefresh(nextExpiry ?? new Date(Date.now() + TOKEN_RETRY_MS + TOKEN_REFRESH_LEAD_MS).toISOString());
        }, tokenRefreshDelay(expiresAt));
      };
      scheduleRefresh(tok.expiresAt);
    };

    start();

    return () => {
      cancelled = true;
      if (refreshRef.current) window.clearTimeout(refreshRef.current);
      stopTicking();
      try { callRef.current?.disconnect(); } catch { /* already gone */ }
      try { deviceRef.current?.destroy(); } catch { /* already gone */ }
      deviceRef.current = null;
    };
  }, [enabled, toIdle]);

  const answer = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    call.accept();
    setState('on-call');
    setIncoming(null);
    setSeconds(0);
    stopTicking();
    tickRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);

  const decline = useCallback(() => {
    try { callRef.current?.reject(); } catch { /* already gone */ }
    toIdle();
  }, [toIdle]);

  const hangUp = useCallback(() => {
    try { callRef.current?.disconnect(); } catch { /* already gone */ }
    toIdle();
  }, [toIdle]);

  /**
   * Place a call. The caller id is decided by the server from the number this
   * person owns — a browser that could name its own would be able to call as
   * anybody.
   */
  const dial = useCallback(async (to: string, name?: string | null) => {
    const device = deviceRef.current;
    if (!device) { setError('The phone is not connected.'); return; }
    if (callRef.current) { setError('You are already on a call.'); return; }
    try {
      const call = await device.connect({ params: { To: to } });
      callRef.current = call;
      call.on('disconnect', toIdle);
      call.on('cancel', toIdle);
      call.on('error', (e: any) => { setError(e?.message || 'The call dropped.'); toIdle(); });
      setIncoming({ from: prettyFrom(to), name: name ?? null });
      setState('on-call');
      setSeconds(0);
      stopTicking();
      tickRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e: any) {
      setError(e?.message || 'That call could not be placed.');
    }
  }, [toIdle]);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !muted;
    call.mute(next);
    setMuted(next);
  }, [muted]);

  return {
    state, number, label, incoming,
    onCall: state === 'on-call',
    muted, seconds, error,
    answer, hangUp, decline, toggleMute, dial, canDial,
  };
}

/** mm:ss for a call timer. */
export const callClock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
