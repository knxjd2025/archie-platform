/**
 * The billing gate: one middleware in front of every API route. When billing
 * is on (STRIPE_SECRET_KEY set) and the signed-in person's company is
 * billing-locked (shared/billing/status.ts), every API route answers 402 with
 * a plain sentence, except:
 *   - /api/auth      signing in and out, and who am I
 *   - /api/billing   the Billing page and its buttons (admin-only routes check the role themselves)
 *   - /api/webhooks  Stripe (and others) telling us things; never a session
 *   - /api/operator  the people who run Archie, who sign in through a company too
 * Requests with no signed-in company (public links, crons, webhooks) pass:
 * there is no company to lock. The data is kept; nothing is deleted.
 */
import type { NextFunction, Request, Response } from 'express';
import { billingEnabled } from './config';
import { currentBillingState } from './service';
import { currentCompanyId, isCompanyId } from '../tenant/context';
import { BILLING_LOCKED_CODE, LOCK_MESSAGE, LOCKED_MEMBER_MESSAGE, type LockReason } from '../../shared/billing/status';

export const BILLING_GATE_EXEMPT = ['/api/auth', '/api/billing', '/api/webhooks', '/api/operator'];

/** A short cache per company: the gate runs on every request. */
const CACHE_MS = 15_000;
const cache = new Map<string, { reason: LockReason | null; at: number }>();

/** Forget cached answers (after a webhook changes a company's billing, and between tests). */
export function clearBillingGateCache(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

async function lockFor(companyId: string): Promise<LockReason | null> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.reason;
  const state = await currentBillingState();
  cache.set(companyId, { reason: state.reason, at: Date.now() });
  return state.reason;
}

const exempt = (path: string): boolean => BILLING_GATE_EXEMPT.some((p) => path === p || path.startsWith(`${p}/`));

export function billingGate(req: Request, res: Response, next: NextFunction): void {
  const path = req.originalUrl.split('?')[0];
  if (!path.startsWith('/api/') || exempt(path) || !billingEnabled()) return next();
  const companyId = req.session?.user?.companyId;
  // Only a signed-in company's own request (tenantFromSession set it), never anything else.
  if (!isCompanyId(companyId) || currentCompanyId() !== companyId) return next();
  lockFor(companyId).then((reason) => {
    if (!reason) return next();
    const admin = req.session.user?.role === 'admin';
    const message = admin ? LOCK_MESSAGE[reason] : LOCKED_MEMBER_MESSAGE;
    res.status(402).json({ error: message, message, code: BILLING_LOCKED_CODE, reason });
  }, (err) => {
    // A failed check is not proof the company owes anything: let the request
    // through rather than lock every company out on a database blip.
    console.error('[billing] gate check failed', err);
    next();
  });
}
