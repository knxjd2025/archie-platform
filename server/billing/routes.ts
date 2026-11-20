/**
 * Billing routes.
 *
 *   GET  /api/billing/status     everyone signed in: is the company locked, and (admins) the banner
 *   GET  /api/billing            admins: the Billing page
 *   POST /api/billing/checkout   admins: a Stripe Checkout link to add a card and subscribe
 *   POST /api/billing/portal     admins: a Stripe Billing Portal link (card, invoices, cancel)
 *   POST /api/webhooks/stripe    Stripe: signed events (raw body, verified, once per event id)
 *   GET  /api/cron/billing-seats the hourly seat check (CRON_SECRET)
 *
 * With STRIPE_SECRET_KEY unset billing is off: status says so, the page and
 * buttons answer 404, and nothing calls Stripe.
 */
import express, { type Express, type Request, type Response } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { asyncHandler } from '../lib/async-handler';
import { rateLimit } from '../lib/rate-limit';
import { timingSafeEqualStr } from '../security-config';
import { runCompanyJob, type CompanyJob } from '../tenant/fan-out';
import { billingEnabled, stripeWebhookSecret } from './config';
import { verifyStripeSignature } from './signature';
import { clearBillingGateCache } from './gate';
import {
  BillingError, HANDLED_EVENTS, billingPage, claimEvent, companiesWithSubscription, currentBillingState,
  handleStripeEvent, releaseEvent, startCheckout, startPortal, syncSeats, type StripeEvent,
} from './service';
import { LOCK_MESSAGE, LOCKED_MEMBER_MESSAGE } from '../../shared/billing/status';

const OFF = { error: 'Billing is not set up.' };
const TEN_MINUTES = 10 * 60 * 1000;
/** Each one makes Stripe calls. */
const linkLimit = rateLimit(20, TEN_MINUTES);

const cronAuthorized = (req: Request): boolean =>
  !!process.env.CRON_SECRET && timingSafeEqualStr(String(req.headers['authorization'] || ''), `Bearer ${process.env.CRON_SECRET}`);

const sendBillingError = (res: Response, what: string, err: unknown) => {
  if (err instanceof BillingError) return res.status(err.status).json({ error: err.message });
  console.error(`[billing] ${what} failed`, err);
  return res.status(502).json({ error: 'Could not reach Stripe. Try again in a minute.' });
};

/** The hourly seat check: every company with a subscription, as that company. */
export function billingSeatsJob(): CompanyJob<Awaited<ReturnType<typeof syncSeats>>> {
  return {
    name: 'billing-seats',
    // Once per UTC hour.
    period: (_company, now) => now.toISOString().slice(0, 13),
    run: async ({ company }) => {
      const r = await syncSeats(company.id, 'the hourly seat check');
      // Thrown so the run is recorded as failed and tried again next hour.
      if (r.status === 'failed') throw new Error(r.error || 'seat sync failed');
      return r;
    },
    perCompanyMs: 30_000,
    concurrency: 4,
  };
}

export function registerBillingRoutes(app: Express): void {
  app.get('/api/billing/status', requireAuth, asyncHandler(async (req, res) => {
    const state = await currentBillingState();
    const admin = req.session.user!.role === 'admin';
    res.json({
      enabled: state.enabled,
      locked: state.locked,
      reason: state.reason,
      message: state.reason ? (admin ? LOCK_MESSAGE[state.reason] : LOCKED_MEMBER_MESSAGE) : null,
      banner: admin ? state.banner : null,
    });
  }));

  app.get('/api/billing', requireRole('admin'), asyncHandler(async (_req, res) => {
    if (!billingEnabled()) return res.status(404).json(OFF);
    res.json(await billingPage());
  }));

  app.post('/api/billing/checkout', requireRole('admin'), linkLimit, asyncHandler(async (req, res) => {
    if (!billingEnabled()) return res.status(404).json(OFF);
    try {
      res.json(await startCheckout(req.session.user!.companyId, req.session.user!.email));
    } catch (err) { sendBillingError(res, 'checkout', err); }
  }));

  app.post('/api/billing/portal', requireRole('admin'), linkLimit, asyncHandler(async (req, res) => {
    if (!billingEnabled()) return res.status(404).json(OFF);
    try {
      res.json(await startPortal(req.session.user!.companyId));
    } catch (err) { sendBillingError(res, 'portal', err); }
  }));

  // The raw bytes, whatever the content type: the signature is over them.
  // (server/index.ts and api/index.ts already parse /api/webhooks raw, before
  // the JSON parser; this covers a delivery with another content type.)
  app.post('/api/webhooks/stripe', express.raw({ type: () => true, limit: '1mb' }), asyncHandler(async (req, res) => {
    if (!billingEnabled()) return res.status(404).json(OFF);
    const secret = stripeWebhookSecret();
    if (!secret) {
      console.error('[billing] STRIPE_WEBHOOK_SECRET is not set: refusing a webhook');
      return res.status(500).json({ error: 'Webhook secret not configured.' });
    }
    if (!Buffer.isBuffer(req.body)) {
      // Something parsed the body first; its bytes are gone, so it cannot be verified.
      console.error('[billing] webhook body was already parsed; check the raw body middleware order');
      return res.status(400).json({ error: 'Raw body required.' });
    }
    const check = verifyStripeSignature(req.body, req.header('stripe-signature'), secret);
    if (!check.ok) {
      console.warn(`[billing] webhook refused: ${check.reason}`);
      return res.status(400).json({ error: 'Bad signature.' });
    }
    let event: StripeEvent;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad JSON.' }); }
    if (!event?.id || typeof event.type !== 'string') return res.status(400).json({ error: 'Not an event.' });
    if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return res.json({ received: true, ignored: true });
    if (!(await claimEvent(event.id, event.type))) return res.json({ received: true, duplicate: true });
    try {
      const outcome = await handleStripeEvent(event);
      if (outcome.companyId) clearBillingGateCache(outcome.companyId);
      res.json({ received: true, handled: outcome.handled });
    } catch (err) {
      await releaseEvent(event.id).catch((e) => console.error('[billing] could not release event', e));
      console.error(`[billing] webhook ${event.id} (${event.type}) failed`, err);
      res.status(500).json({ error: 'Could not process the event.' });
    }
  }));

  app.get('/api/cron/billing-seats', asyncHandler(async (req, res) => {
    if (!cronAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
    if (!billingEnabled()) return res.json({ job: 'billing-seats', ok: true, off: true, companies: [] });
    const ids = await companiesWithSubscription();
    if (!ids.length) return res.json({ job: 'billing-seats', ok: true, remaining: 0, companies: [] });
    res.json(await runCompanyJob(billingSeatsJob(), { onlyCompanyIds: ids }));
  }));
}
