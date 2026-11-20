/**
 * Billing through the real request path: the Postgres session store, the
 * company middleware, the billing gate, the routes, and the database as the
 * app's own role (scripts/test-db.sh). Stripe is an in-memory fake
 * (fake-stripe.ts); nothing here reaches the real Stripe API.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import session from 'express-session';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { makeFakeStripe, signStripe } from './fake-stripe';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake_for_tests',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  STRIPE_PRICE_SOLO_BASE: 'price_solo_base',
  STRIPE_PRICE_SOLO_EXTRA: 'price_solo_extra',
  STRIPE_PRICE_TEAM_BASE: 'price_team_base',
  STRIPE_PRICE_TEAM_EXTRA: 'price_team_extra',
  APP_BASE_URL: 'https://app.archie.test',
  CRON_SECRET: 'cron-test-secret',
} as const;

describe.skipIf(!local)('billing', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { createSessionStore } = await import('../../session-store');
  const { registerAuthRoutes } = await import('../../auth/routes');
  const { registerPasswordRoutes } = await import('../../auth/password-routes');
  const { registerTeamRoutes } = await import('../../auth/team-routes');
  const { registerOperatorRoutes } = await import('../../operator/routes');
  const { registerBillingRoutes } = await import('../routes');
  const { billingGate, clearBillingGateCache } = await import('../gate');
  const { syncSeats } = await import('../service');
  const { setStripeApi } = await import('../stripe');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearSessionRevalidationCache, requireAuth } = await import('../../auth/middleware');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { hashPassword } = await import('../../auth/password');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const team = await import('../../storage/team');
  const { LOCK_MESSAGE, LOCKED_MEMBER_MESSAGE } = await import('../../../shared/billing/status');

  const fake = makeFakeStripe();
  const tag = `bill-${process.pid}-${Date.now()}`;
  const PW = 'a good long password 1';
  const DAY = 24 * 60 * 60 * 1000;
  const email = (who: string) => `${tag}-${who}@example.test`;
  const ids: Record<string, string> = {};
  const members: Record<string, number> = {};
  let server: Server;
  let base = '';
  const saved: Record<string, string | undefined> = {};

  const company = async (label: string, status: 'trial' | 'active', trialEndsAt: Date | null) =>
    (await createCompany({ slug: `${tag}-${label}`, name: `Billing ${label}`, status, trialEndsAt })).id;
  const addMember = async (companyId: string, who: string, role: string, canLogin: boolean) => runAsCompany(companyId, async () => {
    const m = await team.createTeamMember({ name: who, email: email(who), role, canLogin } as never, 'test');
    if (canLogin) await team.setPasswordHash(email(who), await hashPassword(PW));
    members[who] = m.id;
  });
  const billingRow = (companyId: string) => runAsCompany(companyId, async () => (await db.select().from(schema.companyBilling))[0] ?? null);
  const companyRow = async (companyId: string) => (await runAsSystem('test', () => db.select().from(schema.companies).where(eq(schema.companies.id, companyId))))[0];

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    saved.ARCHIE_OPERATOR_EMAILS = process.env.ARCHIE_OPERATOR_EMAILS;
    process.env.ARCHIE_OPERATOR_EMAILS = email('operator');
    setStripeApi(fake);

    ids.a = await company('a', 'trial', new Date(Date.now() + 10 * DAY));          // in its trial
    ids.b = await company('b', 'trial', new Date(Date.now() + 10 * DAY));          // another company
    ids.locked = await company('locked', 'trial', new Date(Date.now() - DAY));      // trial over, no card
    ids.grand = await company('grand', 'active', null);                              // from before trials
    ids.paused = await company('paused', 'active', null);                            // the operator will pause it
    await addMember(ids.a, 'admin-a', 'admin', true);
    await addMember(ids.a, 'rep-a', 'sales', true);
    await addMember(ids.a, 'crew-a', 'production', false);                           // free: cannot sign in
    await addMember(ids.b, 'admin-b', 'admin', true);
    await addMember(ids.locked, 'admin-l', 'admin', true);
    await addMember(ids.locked, 'rep-l', 'sales', true);
    await addMember(ids.grand, 'admin-g', 'admin', true);
    await addMember(ids.grand, 'operator', 'admin', true);

    const app = express();
    // The same order as api/index.ts and server/index.ts: webhooks raw, then JSON.
    app.use('/api/webhooks', express.raw({ type: 'application/json' }));
    app.use(express.json());
    app.use(session({ store: createSessionStore(), secret: 'test-secret', resave: false, saveUninitialized: false }));
    app.use(tenantFromSession);
    app.use('/api', billingGate);
    registerBillingRoutes(app);
    registerAuthRoutes(app);
    registerPasswordRoutes(app);
    registerTeamRoutes(app);
    registerOperatorRoutes(app);
    // An ordinary route anyone signed in may use.
    app.get('/api/ordinary', requireAuth, (_req, res) => res.json({ ok: true }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setStripeApi(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => { __resetRateLimits(); clearSessionRevalidationCache(); clearBillingGateCache(); });

  const cookieOf = (res: Response) => res.headers.getSetCookie().find((h) => h.startsWith('connect.sid='))!.split(';')[0];
  const req = (method: string, path: string, body?: unknown, cookie = '') => {
    clearSessionRevalidationCache(); clearBillingGateCache();
    return fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const signIn = async (who: string) => {
    const res = await req('POST', '/api/auth/login/password', { email: email(who), password: PW });
    expect(res.status, `sign in ${who}`).toBe(200);
    return cookieOf(res);
  };
  const sendEvent = (event: unknown, opts: { secret?: string; signature?: string; at?: number } = {}) => {
    const body = JSON.stringify(event);
    return fetch(`${base}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': opts.signature ?? signStripe(body, opts.secret ?? ENV.STRIPE_WEBHOOK_SECRET, opts.at) },
      body,
    });
  };
  let evtN = 0;
  const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_${tag}_${++evtN}`, type, data: { object } });
  /** Give company A a subscription the way Stripe would after Checkout, and tell the app. */
  const subscribeA = async (status = 'trialing') => {
    fake.reset();
    await runAsCompany(ids.a, () => db.delete(schema.companyBilling));
    const admin = await signIn('admin-a');
    const r = await req('POST', '/api/billing/checkout', {}, admin);
    expect(r.status).toBe(200);
    const sub = fake.completeCheckout(fake.sessions.at(-1)!, status);
    const res = await sendEvent(event('checkout.session.completed', { id: 'cs_x', mode: 'subscription', subscription: sub.id, customer: sub.customer }));
    expect(res.status).toBe(200);
    return { admin, sub };
  };
  const itemsOf = (subId: string) => Object.fromEntries(fake.subscriptions.get(subId)!.items.data.map((i) => [i.price.id, i.quantity]));

  describe('off when STRIPE_SECRET_KEY is unset', () => {
    it('gates nothing, shows no buttons and calls nothing', async () => {
      const key = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;
      try {
        fake.reset();
        const locked = await signIn('admin-l');
        expect((await req('GET', '/api/ordinary', undefined, locked)).status).toBe(200);
        expect((await req('GET', '/api/team', undefined, locked)).status).toBe(200);
        expect(await (await req('GET', '/api/billing/status', undefined, locked)).json()).toMatchObject({ enabled: false, locked: false });
        expect((await req('GET', '/api/billing', undefined, locked)).status).toBe(404);
        expect((await req('POST', '/api/billing/checkout', {}, locked)).status).toBe(404);
        expect((await req('POST', '/api/billing/portal', {}, locked)).status).toBe(404);
        expect((await sendEvent(event('invoice.paid', { subscription: 'sub_x' }))).status).toBe(404);
        // A team change makes no Stripe call either.
        const a = await signIn('admin-a');
        const added = await req('POST', '/api/team', { name: 'Off Hire', email: email('off-hire'), role: 'sales', canLogin: true }, a);
        expect(added.status).toBe(201);
        await req('PATCH', `/api/team/${(await added.json()).id}`, { active: false }, a);
        expect(fake.calls).toEqual([]);
      } finally {
        process.env.STRIPE_SECRET_KEY = key;
      }
    });
  });

  describe('checkout and portal', () => {
    it('makes a Checkout page for the current seats, inside the trial, as the company', async () => {
      fake.reset();
      const admin = await signIn('admin-a');
      const res = await req('POST', '/api/billing/checkout', {}, admin);
      expect(res.status).toBe(200);
      expect((await res.json()).url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      const s = fake.sessions[0];
      // Two people can sign in (the crew member cannot): Solo + 1 extra.
      expect(s.line_items).toEqual([{ price: 'price_solo_base', quantity: 1 }, { price: 'price_solo_extra', quantity: 1 }]);
      expect(s.mode).toBe('subscription');
      const trialEnd = (await companyRow(ids.a)).trialEndsAt!;
      expect(s.subscription_data.trial_end).toBe(Math.floor(trialEnd.getTime() / 1000));
      expect(s.subscription_data.metadata).toEqual({ archie_company_id: ids.a });
      expect(s.success_url).toBe('https://app.archie.test/?billing=success');
      expect(s.cancel_url).toBe('https://app.archie.test/?billing=cancelled');
      // One customer per company, tagged with it, stored, and reused.
      expect(fake.customers.get(s.customer)!.metadata).toEqual({ archie_company_id: ids.a });
      expect((await billingRow(ids.a))!.stripeCustomerId).toBe(s.customer);
      await req('POST', '/api/billing/checkout', {}, admin);
      expect(fake.sessions[1].customer).toBe(s.customer);
      expect(fake.calls.filter((c) => c === 'createCustomer')).toHaveLength(1);
    });

    it('does not set a trial that has already ended, and refuses non-admins', async () => {
      fake.reset();
      const admin = await signIn('admin-l');
      expect((await req('POST', '/api/billing/checkout', {}, admin)).status).toBe(200);
      expect(fake.sessions[0].subscription_data.trial_end).toBeUndefined();
      const rep = await signIn('rep-a');
      expect((await req('POST', '/api/billing/checkout', {}, rep)).status).toBe(403);
      expect((await req('POST', '/api/billing/portal', {}, rep)).status).toBe(403);
      expect((await req('GET', '/api/billing', undefined, rep)).status).toBe(403);
    });

    it('opens the billing portal for the company\'s own customer only', async () => {
      const b = await signIn('admin-b');
      expect((await req('POST', '/api/billing/portal', {}, b)).status).toBe(400);
      const a = await signIn('admin-a');
      const res = await req('POST', '/api/billing/portal', {}, a);
      expect(res.status).toBe(200);
      expect(fake.portals.at(-1)).toEqual({ customer: (await billingRow(ids.a))!.stripeCustomerId, return_url: 'https://app.archie.test/?billing=portal' });
    });
  });

  describe('webhook', () => {
    it('records a subscription from a signed event, keeping a trialing company on trial', async () => {
      const { sub } = await subscribeA('trialing');
      const row = await billingRow(ids.a);
      expect(row).toMatchObject({ stripeSubscriptionId: sub.id, subscriptionStatus: 'trialing', plan: 'solo', seats: 2, cancelAtPeriodEnd: false });
      expect(row!.currentPeriodEnd?.toISOString()).toBe('2026-12-18T00:00:00.000Z');
      expect((await companyRow(ids.a)).status).toBe('trial');
      // Paid: the company becomes active.
      fake.subscriptions.get(sub.id)!.status = 'active';
      expect((await sendEvent(event('invoice.paid', { subscription: sub.id, customer: sub.customer }))).status).toBe(200);
      expect((await billingRow(ids.a))!.subscriptionStatus).toBe('active');
      expect((await companyRow(ids.a)).status).toBe('active');
    });

    it('refuses a forged or stale signature and changes nothing', async () => {
      const { sub } = await subscribeA('trialing');
      fake.subscriptions.get(sub.id)!.status = 'canceled';
      const e = event('customer.subscription.deleted', { id: sub.id, customer: sub.customer });
      expect((await sendEvent(e, { secret: 'whsec_wrong' })).status).toBe(400);
      expect((await sendEvent(e, { signature: 'nonsense' })).status).toBe(400);
      expect((await sendEvent(e, { at: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(400);
      // A correct signature over different bytes is still wrong.
      const body = JSON.stringify(e);
      const tampered = body.replace('customer.subscription.deleted', 'customer.subscription.updated');
      const res = await fetch(`${base}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signStripe(body, ENV.STRIPE_WEBHOOK_SECRET) }, body: tampered });
      expect(res.status).toBe(400);
      expect((await billingRow(ids.a))!.subscriptionStatus).toBe('trialing');
      // The genuine one is applied.
      expect((await sendEvent(e)).status).toBe(200);
      expect((await billingRow(ids.a))!.subscriptionStatus).toBe('canceled');
    });

    it('needs the raw body: a body something already parsed as JSON is refused', async () => {
      const parsedFirst = express();
      parsedFirst.use(express.json());
      registerBillingRoutes(parsedFirst);
      const s = parsedFirst.listen(0);
      await new Promise((r) => s.once('listening', r));
      try {
        const body = JSON.stringify(event('invoice.paid', { subscription: 'sub_x' }));
        const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/webhooks/stripe`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signStripe(body, ENV.STRIPE_WEBHOOK_SECRET) }, body,
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/raw body/i);
      } finally {
        await new Promise<void>((r) => s.close(() => r()));
      }
    });

    it('handles each event id once', async () => {
      const { sub } = await subscribeA('trialing');
      const e = event('customer.subscription.updated', { id: sub.id, customer: sub.customer });
      fake.calls.length = 0;
      expect(await (await sendEvent(e)).json()).toMatchObject({ received: true, handled: true });
      const after = fake.calls.length;
      expect(await (await sendEvent(e)).json()).toMatchObject({ received: true, duplicate: true });
      expect(fake.calls.length).toBe(after);
      // The ledger is system-only: the app role cannot read it at all.
      await expect(runAsCompany(ids.a, () => db.select().from(schema.stripeEvents))).rejects.toMatchObject({ cause: { code: '42501' } });
      const rows = await runAsSystem('test', () => db.select().from(schema.stripeEvents).where(eq(schema.stripeEvents.id, e.id)));
      expect(rows).toHaveLength(1);
    });

    it('lets Stripe retry an event that failed half way', async () => {
      const { sub } = await subscribeA('trialing');
      const e = event('customer.subscription.updated', { id: sub.id, customer: sub.customer });
      const retrieve = fake.retrieveSubscription;
      fake.retrieveSubscription = async () => { throw new Error('Stripe timeout (fake)'); };
      try {
        expect((await sendEvent(e)).status).toBe(500);
      } finally {
        fake.retrieveSubscription = retrieve;
      }
      fake.subscriptions.get(sub.id)!.status = 'past_due';
      expect((await sendEvent(e)).status).toBe(200);
      expect((await billingRow(ids.a))!.subscriptionStatus).toBe('past_due');
    });

    it('takes the company only from Stripe metadata, never from other fields in the payload', async () => {
      const { sub } = await subscribeA('trialing');
      await runAsCompany(ids.b, () => db.delete(schema.companyBilling));
      // The event's own fields name company B everywhere they can; the subscription says A.
      fake.subscriptions.get(sub.id)!.status = 'active';
      const res = await sendEvent(event('checkout.session.completed', {
        id: 'cs_forged', mode: 'subscription', subscription: sub.id, customer: sub.customer,
        client_reference_id: ids.b, metadata: { archie_company_id: ids.b }, customer_email: email('admin-b'),
        customer_details: { email: email('admin-b') },
      }));
      expect(res.status).toBe(200);
      expect((await billingRow(ids.a))!.subscriptionStatus).toBe('active');
      expect(await billingRow(ids.b)).toBeNull();
      expect((await companyRow(ids.b)).status).toBe('trial');
    });

    it('refuses a subscription whose customer belongs to another company, or another customer', async () => {
      const { sub } = await subscribeA('trialing');
      // A subscription tagged B on A's customer: the two disagree.
      const crossed = fake.addSubscription({ customer: String(sub.customer), companyId: ids.b, items: [['price_team_base', 1]], status: 'active' });
      expect(await (await sendEvent(event('customer.subscription.created', { id: crossed.id, customer: sub.customer }))).json())
        .toMatchObject({ received: true, handled: false });
      expect(await billingRow(ids.b)).toBeNull();
      // A subscription tagged A on a new customer also tagged A: A is billed to its stored customer, so refused.
      const other = await fake.createCustomer({ name: 'x', metadata: { archie_company_id: ids.a } }, `k-${tag}-other`);
      const second = fake.addSubscription({ customer: other.id, companyId: ids.a, items: [['price_team_base', 1]], status: 'active' });
      await sendEvent(event('customer.subscription.created', { id: second.id, customer: other.id }));
      expect((await billingRow(ids.a))!.stripeSubscriptionId).toBe(sub.id);
      // The event naming a different customer from the subscription's.
      await sendEvent(event('customer.subscription.updated', { id: sub.id, customer: other.id }));
      expect((await billingRow(ids.a))!.subscriptionStatus).toBe('trialing');
    });

    it('never changes the status of a company the operator paused', async () => {
      await runAsSystem('test', () => db.update(schema.companies).set({ status: 'paused' }).where(eq(schema.companies.id, ids.paused)));
      fake.reset();
      const cus = await fake.createCustomer({ name: 'p', metadata: { archie_company_id: ids.paused } }, `k-${tag}-paused`);
      const sub = fake.addSubscription({ customer: cus.id, companyId: ids.paused, items: [['price_solo_base', 1]], status: 'active' });
      expect((await sendEvent(event('invoice.paid', { subscription: sub.id, customer: cus.id }))).status).toBe(200);
      expect((await companyRow(ids.paused)).status).toBe('paused');
      expect((await billingRow(ids.paused))!.subscriptionStatus).toBe('active');
    });

    it('ignores events it does not handle', async () => {
      expect(await (await sendEvent(event('customer.created', { id: 'cus_x' }))).json()).toMatchObject({ received: true, ignored: true });
    });
  });

  describe('seat sync', () => {
    it('follows every change to who can sign in, after the change is saved', async () => {
      const { admin, sub } = await subscribeA('active');
      expect(itemsOf(sub.id)).toEqual({ price_solo_base: 1, price_solo_extra: 1 });

      // Added, can sign in: 3 seats, Solo becomes Team.
      const added = await req('POST', '/api/team', { name: 'New Rep', email: email('new-rep'), role: 'sales', canLogin: true }, admin);
      expect(added.status).toBe(201);
      const newId = (await added.json()).id;
      expect(itemsOf(sub.id)).toEqual({ price_team_base: 1 });
      expect(await billingRow(ids.a)).toMatchObject({ plan: 'team', seats: 3, seatSyncError: null });

      // Added, cannot sign in: free, no Stripe change.
      const before = fake.updates.length;
      expect((await req('POST', '/api/team', { name: 'Crew Two', email: email('crew-two'), role: 'production', canLogin: false }, admin)).status).toBe(201);
      expect(fake.updates.length).toBe(before);

      // canLogin on for the crew member: 4 seats.
      expect((await req('PATCH', `/api/team/${members['crew-a']}`, { canLogin: true }, admin)).status).toBe(200);
      expect(itemsOf(sub.id)).toEqual({ price_team_base: 1, price_team_extra: 1 });

      // Switched off (active false): back to 3.
      expect((await req('PATCH', `/api/team/${newId}`, { active: false }, admin)).status).toBe(200);
      expect(itemsOf(sub.id)).toEqual({ price_team_base: 1 });

      // canLogin off: 2 seats, Team becomes Solo again.
      expect((await req('PATCH', `/api/team/${members['crew-a']}`, { canLogin: false }, admin)).status).toBe(200);
      expect(itemsOf(sub.id)).toEqual({ price_solo_base: 1, price_solo_extra: 1 });
      expect(await billingRow(ids.a)).toMatchObject({ plan: 'solo', seats: 2 });

      // A change that does not touch sign-in makes no Stripe update.
      const n = fake.updates.length;
      await req('PATCH', `/api/team/${members['rep-a']}`, { name: 'Rep A Renamed' }, admin);
      expect(fake.updates.length).toBe(n);
      // Every update asked for proration through the client, with a key.
      expect(fake.updates.every((u) => u.key.startsWith(`archie-seats-${sub.id}-`))).toBe(true);
    });

    it('never fails the team change when Stripe fails, records it, and the hourly job fixes it', async () => {
      const { admin, sub } = await subscribeA('active');
      fake.failUpdates = 1;
      const added = await req('POST', '/api/team', { name: 'Hire While Down', email: email('hire-down'), role: 'sales', canLogin: true }, admin);
      expect(added.status).toBe(201);
      expect(itemsOf(sub.id)).toEqual({ price_solo_base: 1, price_solo_extra: 1 });
      const failed = await billingRow(ids.a);
      expect(failed!.seatSyncError).toMatch(/Stripe is down/);
      expect(failed!.seatSyncFailedAt).toBeTruthy();
      const failedKey = fake.updates.at(-1)!.key;

      // The cron needs its secret.
      expect((await fetch(`${base}/api/cron/billing-seats`)).status).toBe(401);
      const run = await fetch(`${base}/api/cron/billing-seats`, { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } });
      expect(run.status).toBe(200);
      const report = await run.json();
      expect(report.companies.find((c: any) => c.companyId === ids.a)).toMatchObject({ status: 'done', value: { status: 'updated', seats: 3 } });
      expect(itemsOf(sub.id)).toEqual({ price_team_base: 1 });
      expect(await billingRow(ids.a)).toMatchObject({ seatSyncError: null, seatSyncFailedAt: null, plan: 'team', seats: 3 });
      // The retry of the same change used the same idempotency key.
      expect(fake.updates.at(-1)!.key).toBe(failedKey);
      // Nothing left to do: compares first and makes no update.
      const n = fake.updates.length;
      expect(await syncSeats(ids.a, 'test')).toEqual({ status: 'in_sync', seats: 3 });
      expect(fake.updates.length).toBe(n);
      await req('PATCH', `/api/team/${(await added.json()).id}`, { active: false }, admin);
    });

    it('does nothing for a company without a subscription, including one the operator creates', async () => {
      fake.reset();
      const b = await signIn('admin-b');
      expect((await req('POST', '/api/team', { name: 'B Rep', email: email('b-rep'), role: 'sales', canLogin: true }, b)).status).toBe(201);
      const op = await signIn('operator');
      const made = await req('POST', '/api/operator/companies', { companyName: `${tag} New Co`, adminName: 'New Admin', adminEmail: email('new-co-admin') }, op);
      expect(made.status).toBe(201);
      expect(fake.calls).toEqual([]);
    });
  });

  describe('gate', () => {
    it('locks a company whose trial ended: 402 on ordinary routes, billing still reachable', async () => {
      await runAsCompany(ids.locked, () => db.delete(schema.companyBilling));
      const admin = await signIn('admin-l');
      const blocked = await req('GET', '/api/team', undefined, admin);
      expect(blocked.status).toBe(402);
      expect(await blocked.json()).toMatchObject({ code: 'billing_locked', reason: 'trial_ended', error: LOCK_MESSAGE.trial_ended });
      expect((await req('GET', '/api/ordinary', undefined, admin)).status).toBe(402);
      expect((await req('GET', '/api/auth/me', undefined, admin)).status).toBe(200);
      const page = await (await req('GET', '/api/billing', undefined, admin)).json();
      expect(page).toMatchObject({ enabled: true, locked: true, reason: 'trial_ended', seats: 2, quote: { plan: 'solo', monthlyTotalCents: 24_800 } });
      expect((await req('POST', '/api/billing/checkout', {}, admin)).status).toBe(200);
      expect(await (await req('GET', '/api/billing/status', undefined, admin)).json())
        .toMatchObject({ enabled: true, locked: true, message: LOCK_MESSAGE.trial_ended });
    });

    it('tells everyone else to ask their admin', async () => {
      const rep = await signIn('rep-l');
      const blocked = await req('GET', '/api/ordinary', undefined, rep);
      expect(blocked.status).toBe(402);
      expect((await blocked.json()).error).toBe(LOCKED_MEMBER_MESSAGE);
      expect(await (await req('GET', '/api/billing/status', undefined, rep)).json())
        .toMatchObject({ locked: true, message: LOCKED_MEMBER_MESSAGE, banner: null });
    });

    it('opens again once a subscription works, and locks a canceled one', async () => {
      const admin = await signIn('admin-l');
      fake.reset();
      await runAsCompany(ids.locked, () => db.delete(schema.companyBilling));
      await req('POST', '/api/billing/checkout', {}, admin);
      const sub = fake.completeCheckout(fake.sessions[0], 'active');
      await sendEvent(event('checkout.session.completed', { mode: 'subscription', subscription: sub.id, customer: sub.customer }));
      expect((await req('GET', '/api/ordinary', undefined, admin)).status).toBe(200);
      fake.subscriptions.get(sub.id)!.status = 'unpaid';
      await sendEvent(event('customer.subscription.updated', { id: sub.id, customer: sub.customer }));
      const blocked = await req('GET', '/api/ordinary', undefined, admin);
      expect(blocked.status).toBe(402);
      expect((await blocked.json()).error).toBe(LOCK_MESSAGE.payment_problem);
      await runAsCompany(ids.locked, () => db.delete(schema.companyBilling));
    });

    it('does not lock a company from before trials (grandfathered), or one inside its trial', async () => {
      const g = await signIn('admin-g');
      expect((await req('GET', '/api/team', undefined, g)).status).toBe(200);
      expect(await (await req('GET', '/api/billing/status', undefined, g)).json()).toMatchObject({ locked: false, banner: null });
      const b = await signIn('admin-b');
      expect((await req('GET', '/api/team', undefined, b)).status).toBe(200);
    });

    it('shows admins the trial banner from 5 days before the end', async () => {
      await runAsSystem('test', () => db.update(schema.companies).set({ trialEndsAt: new Date(Date.now() + 3 * DAY - 60_000) }).where(eq(schema.companies.id, ids.b)));
      try {
        const b = await signIn('admin-b');
        expect((await (await req('GET', '/api/billing/status', undefined, b)).json()).banner)
          .toEqual({ kind: 'trial_ending', text: 'Your free trial ends in 3 days.', action: 'Add a card' });
      } finally {
        await runAsSystem('test', () => db.update(schema.companies).set({ trialEndsAt: new Date(Date.now() + 10 * DAY) }).where(eq(schema.companies.id, ids.b)));
      }
    });
  });

  // PERMANENT: Roof Lee bills the companies it made. Archie's own billing
  // must never lock one, nag one, or offer one a checkout, whatever its trial
  // date or billing row says.
  describe('a company Roof Lee made', () => {
    const roofliId = randomUUID();
    let admin = '';

    beforeAll(async () => {
      // The worst case on purpose: a trial that ended and a billing row Stripe
      // would lock anyone else for.
      ids.roofli = await company('roofli', 'trial', new Date(Date.now() - 30 * DAY));
      await runAsSystem('test: mark the company as one Roof Lee made', () =>
        db.update(schema.companies).set({ roofliCompanyId: roofliId }).where(eq(schema.companies.id, ids.roofli)));
      await addMember(ids.roofli, 'admin-r', 'admin', true);
      await addMember(ids.roofli, 'rep-r', 'sales', true);
      await runAsCompany(ids.roofli, () => db.insert(schema.companyBilling).values({
        companyId: ids.roofli, stripeCustomerId: `cus_${tag}_roofli`, stripeSubscriptionId: `sub_${tag}_roofli`, subscriptionStatus: 'unpaid',
      }));
    });

    beforeEach(async () => { fake.reset(); admin = await signIn('admin-r'); });

    it('is never locked by the billing gate, admin or not, and is shown no banner', async () => {
      const rep = await signIn('rep-r');
      for (const cookie of [admin, rep]) {
        expect((await req('GET', '/api/ordinary', undefined, cookie)).status).toBe(200);
        const status = await (await req('GET', '/api/billing/status', undefined, cookie)).json();
        expect(status).toMatchObject({ enabled: true, locked: false, reason: null, message: null, banner: null, managedBy: 'roofli' });
      }
      expect((await req('GET', '/api/team', undefined, admin)).status).toBe(200);
      // The same facts lock a company Roof Lee did not make.
      const other = await signIn('admin-l');
      expect((await req('GET', '/api/ordinary', undefined, other)).status).toBe(402);
    });

    it('shows a Billing page that says where the plan lives, with no price and nothing to buy', async () => {
      const res = await req('GET', '/api/billing', undefined, admin);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ enabled: true, managedBy: 'roofli', message: 'Your plan is managed in Roof Lee.' });
    });

    it('offers no checkout and no billing portal, and calls Stripe for neither', async () => {
      for (const what of ['checkout', 'portal']) {
        const res = await req('POST', `/api/billing/${what}`, {}, admin);
        expect(res.status, what).toBe(409);
        expect(await res.json()).toEqual({ error: 'Your plan is managed in Roof Lee.' });
      }
      expect(fake.calls).toEqual([]);
      expect(fake.sessions).toEqual([]);
      expect(fake.portals).toEqual([]);
    });

    it('never bills its seats: a team change and the hourly check make no Stripe call', async () => {
      const added = await req('POST', '/api/team', { name: 'Roofli Hire', email: email('roofli-hire'), role: 'sales', canLogin: true }, admin);
      expect(added.status).toBe(201);
      expect(await syncSeats(ids.roofli, 'test')).toEqual({ status: 'managed' });
      expect(fake.calls).toEqual([]);
    });

    it('refuses a Stripe event that names it, and keeps its billing row as it was', async () => {
      const before = await billingRow(ids.roofli);
      const customer = await fake.createCustomer({ name: 'x', email: 'x@example.test', metadata: { archie_company_id: ids.roofli } }, `k-${tag}`);
      const sub = fake.addSubscription({ customer: customer.id, companyId: ids.roofli, items: [['price_solo_base', 1]], status: 'active' });
      const res = await sendEvent(event('customer.subscription.updated', { id: sub.id, customer: customer.id }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ received: true, handled: false });
      expect(await billingRow(ids.roofli)).toEqual(before);
      expect((await companyRow(ids.roofli)).status).toBe('trial');
    });

    it('is shown on the operator page as billed by Roof Lee', async () => {
      const op = await signIn('operator');
      const res = await req('GET', `/api/operator/companies/${ids.roofli}`, undefined, op);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body.company ?? body).billedByRoofLee).toBe(true);
    });
  });

  describe('company_billing isolation', () => {
    it('keeps each company to its own billing row', async () => {
      await subscribeA('active');
      await runAsCompany(ids.b, () => db.insert(schema.companyBilling).values({ companyId: ids.b, plan: 'solo', seats: 1 }).onConflictDoNothing());
      const seenByB = await runAsCompany(ids.b, () => db.select().from(schema.companyBilling));
      expect(seenByB.map((r) => r.companyId)).toEqual([ids.b]);
      const seenByA = await runAsCompany(ids.a, () => db.select().from(schema.companyBilling));
      expect(seenByA.map((r) => r.companyId)).toEqual([ids.a]);
      // B cannot change or delete A's row, and cannot write a row for A.
      const changed = await runAsCompany(ids.b, () => db.update(schema.companyBilling).set({ seats: 99 })
        .where(eq(schema.companyBilling.companyId, ids.a)).returning());
      expect(changed).toEqual([]);
      const gone = await runAsCompany(ids.b, () => db.delete(schema.companyBilling).where(eq(schema.companyBilling.companyId, ids.a)).returning());
      expect(gone).toEqual([]);
      await expect(runAsCompany(ids.b, () => db.insert(schema.companyBilling).values({ companyId: ids.a }))).rejects.toThrow();
      expect((await billingRow(ids.a))!.seats).not.toBe(99);
      // With no company at all, nothing.
      expect(await db.select().from(schema.companyBilling)).toEqual([]);
      // Row level security is on and forced.
      const [rls] = (await runAsSystem('test', () => db.execute(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'company_billing'`))).rows as any[];
      expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });
});
