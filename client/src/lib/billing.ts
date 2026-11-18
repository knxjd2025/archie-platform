import { useCallback, useEffect, useState } from 'react';
import { api, BILLING_LOCKED_EVENT } from './api';
import type { Banner, LockReason } from '../../../shared/billing/status';

/** What /api/billing/status says (server/billing/routes.ts). */
export interface BillingStatus {
  /** Billing is on (Stripe is set up). Off: no Billing page, no banner, no lock. */
  enabled: boolean;
  locked: boolean;
  reason: LockReason | null;
  /** The sentence to show when locked (an admin's or everyone else's). */
  message: string | null;
  /** Admins only: the trial or past-due reminder. */
  banner: Banner | null;
}

const OFF: BillingStatus = { enabled: false, locked: false, reason: null, message: null, banner: null };

/** Fired by the Billing page after Stripe sends someone back, so the app checks again. */
export const BILLING_CHANGED_EVENT = 'archie:billing-changed';

/**
 * The company's billing status, for the signed-in person. Asked again when
 * any request comes back 402 (the company was just locked) or the Billing
 * page says something changed. A failed check shows nothing rather than
 * locking anyone out: the server enforces the lock on every request anyway.
 */
export function useBillingStatus(signedIn: boolean): { status: BillingStatus; loaded: boolean; refresh: () => void } {
  const [status, setStatus] = useState<BillingStatus>(OFF);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    if (!signedIn) return;
    api.get<BillingStatus>('/api/billing/status')
      .then((s) => setStatus({ ...OFF, ...s }))
      .catch(() => { /* keep what we had */ })
      .finally(() => setLoaded(true));
  }, [signedIn]);
  useEffect(() => {
    if (!signedIn) { setStatus(OFF); setLoaded(false); return; }
    refresh();
    window.addEventListener(BILLING_LOCKED_EVENT, refresh);
    window.addEventListener(BILLING_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(BILLING_LOCKED_EVENT, refresh);
      window.removeEventListener(BILLING_CHANGED_EVENT, refresh);
    };
  }, [signedIn, refresh]);
  return { status, loaded, refresh };
}
