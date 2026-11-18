/**
 * News going back to Roof Lee: a new lead, a finished job. Against the real
 * test database, with a stand-in for Roof Lee that checks every signature the
 * way Roof Lee does.
 *
 * What must hold (docs/sisters/contract-v2.md in the Roof Lee repository,
 * "Events back to Roof Lee"): each event is signed over the method, the
 * address and the body with the pair secret; a lead Roof Lee itself added is
 * never told back; a failed delivery is tried again and delivered once; and
 * nothing at all is recorded or sent unless the link's settings are there and
 * the company is one Roof Lee made.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { companyBody, dropSecret, localDb, member, sisterSend, startSisterApp, TEST_SECRET, useSecret } from './helpers';
import { signRequest, verifyRequest } from '../verify';
import { EVENTS_PATH, EVENTS_URL_ENV, FINISHED_STAGE_ENV, eventsUrl, finishedStage, waitAfter } from '../events';

// Work handed to waitUntil (the send that follows the answer) is kept here so a test can wait for it.
const afterAnswer: Promise<unknown>[] = [];
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { afterAnswer.push(Promise.resolve(p).catch(() => {})); } }));
vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, createSeedOnce: () => async () => {} }));

describe('where news is sent', () => {
  afterEach(() => { delete process.env[EVENTS_URL_ENV]; delete process.env[FINISHED_STAGE_ENV]; });

  it('takes Roof Lee\'s address, as a base or in full, and always sends to the one path', () => {
    for (const ok of ['https://my.roofli.test', 'https://my.roofli.test/', `https://my.roofli.test${EVENTS_PATH}`, '  https://my.roofli.test  ']) {
      process.env[EVENTS_URL_ENV] = ok;
      expect(eventsUrl(), ok).toBe(`https://my.roofli.test${EVENTS_PATH}`);
    }
  });

  it('is off for anything else: unset, not https, another path, a query, a login in the address', () => {
    for (const bad of ['', 'my.roofli.test', 'http://my.roofli.test', 'https://my.roofli.test/elsewhere', `https://my.roofli.test${EVENTS_PATH}?x=1`, 'https://user:pw@my.roofli.test', 'ftp://my.roofli.test']) {
      process.env[EVENTS_URL_ENV] = bad;
      expect(eventsUrl(), bad).toBeNull();
    }
  });

  it('counts a job as finished at closed out unless another real stage is chosen', () => {
    expect(finishedStage()).toBe('closed_out');
    process.env[FINISHED_STAGE_ENV] = 'final_walkthrough';
    expect(finishedStage()).toBe('final_walkthrough');
    process.env[FINISHED_STAGE_ENV] = 'whenever';
    expect(finishedStage()).toBe('closed_out');
  });

  it('waits longer after each failure, up to a day', () => {
    expect([1, 2, 3, 4, 8, 50].map(waitAfter)).toEqual([1, 5, 15, 60, 1440, 1440]);
  });

  it('signs an event exactly as the contract\'s worked example does', () => {
    const body = '{"id":"evt_0001","product":"archie","roofliCompanyId":"0b9f6d0e-5c56-4a8e-9d55-2f1f5a3c7e11","type":"lead.created","occurredAt":"2026-11-17T12:00:00.000Z","data":{}}';
    expect(signRequest('POST', EVENTS_PATH, body, 1794916800000, 'example-pair-secret')).toBe('6cd35c28e8f5aeb435794757368b73b5f3328e9f84bdfa5e2c8cad0e943da2f9');
  });
});

describe.skipIf(!localDb)('news going back to Roof Lee', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { emitLeadCreated, deliverDue, runEventDelivery } = await import('../events');
  const { moveStage } = await import('../../production/pipeline');
  const { SISTER_EVENTS_CRON } = await import('../routes');

  const tag = `sis-evt-${process.pid}-${Date.now()}`;
  const companies = '/api/sister/v1/companies';
  let sister: Server;
  let base = '';

  // ---- A stand-in for Roof Lee ---------------------------------------------
  interface Got { path: string; method: string; body: any; raw: string; genuine: boolean }
  let roofLee: Server;
  let roofLeeUrl = '';
  let got: Got[] = [];
  /** What the stand-in answers next, one status per request; 200 when empty. */
  let answers: number[] = [];

  beforeAll(async () => {
    ({ server: sister, base } = await startSisterApp());
    roofLee = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const stamp = Number(req.headers['x-roofli-timestamp']);
        // Checked the way Roof Lee checks it: method, address as received, raw body, pair secret.
        const genuine = verifyRequest(req.method ?? '', req.url ?? '', raw, stamp, String(req.headers['x-roofli-signature'] ?? ''), TEST_SECRET, Date.now());
        let body: any = null;
        try { body = JSON.parse(raw); } catch { /* left null */ }
        got.push({ path: req.url ?? '', method: req.method ?? '', body, raw, genuine });
        res.statusCode = genuine ? (answers.shift() ?? 200) : 401;
        res.end();
      });
    });
    await new Promise<void>((resolve) => roofLee.listen(0, '127.0.0.1', resolve));
    roofLeeUrl = `http://127.0.0.1:${(roofLee.address() as AddressInfo).port}`;
  });
  afterAll(() => { sister?.close(); roofLee?.close(); });
  beforeEach(() => { useSecret(); process.env[EVENTS_URL_ENV] = roofLeeUrl; got = []; answers = []; afterAnswer.length = 0; });
  afterEach(async () => {
    await settle();
    dropSecret(); delete process.env[EVENTS_URL_ENV]; delete process.env[FINISHED_STAGE_ENV]; delete process.env.CRON_SECRET;
  });

  /** Waits for every send that was left to run after the answer. */
  async function settle() { while (afterAnswer.length) await afterAnswer.shift(); }

  async function make() {
    const owner = member(tag, 'owner');
    const body = companyBody(tag, { members: [owner] });
    const r = await sisterSend(base, { method: 'POST', path: companies, json: body, version: 1 });
    expect(r.status).toBe(201);
    return { id: r.body.companyId as string, roofliId: body.roofliCompanyId as string, owner };
  }
  /** A lead made inside Archie (typed in by someone, or come in from a form), then told. */
  async function archieLead(companyId: string, over: Record<string, unknown> = {}) {
    return runAsCompany(companyId, async () => {
      const [row] = await db.insert(schema.leads).values({
        source: 'manual', firstName: 'Pat', lastName: 'Hollis', phone: '(319) 555-0142', email: 'pat@example.test',
        city: 'Cedar Falls', serviceType: 'replacement', notes: 'Hail damage on the north slope.', status: 'new', ...over,
      } as any).returning();
      await emitLeadCreated(row);
      return row;
    });
  }
  const outbox = (companyId: string) => runAsCompany(companyId, () => db.select().from(schema.outboundEvents).orderBy(schema.outboundEvents.createdAt));
  /** Makes everything waiting for this company due now. */
  const makeDue = (companyId: string) => runAsCompany(companyId, () => db.update(schema.outboundEvents).set({ nextAttemptAt: sql`now() - interval '1 second'` }).where(sql`${schema.outboundEvents.deliveredAt} IS NULL`));
  const about = (roofliId: string) => got.filter((g) => g.body?.roofliCompanyId === roofliId);

  it('tells Roof Lee about a new lead, signed, with only the listed fields', async () => {
    const c = await make();
    const lead = await archieLead(c.id);
    await settle();
    const mine = about(c.roofliId);
    expect(mine).toHaveLength(1);
    const [g] = mine;
    expect(g.genuine).toBe(true);
    expect(g.method).toBe('POST');
    expect(g.path).toBe(EVENTS_PATH);
    expect(Object.keys(g.body).sort()).toEqual(['data', 'id', 'occurredAt', 'product', 'roofliCompanyId', 'type']);
    expect(g.body).toMatchObject({ product: 'archie', roofliCompanyId: c.roofliId, type: 'lead.created' });
    expect(g.body.id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(new Date(g.body.occurredAt).toISOString()).toBe(g.body.occurredAt);
    expect(g.body.data).toEqual({
      leadId: String(lead.id), source: 'manual', name: 'Pat Hollis', phone: '(319) 555-0142', email: 'pat@example.test',
      message: 'Hail damage on the north slope.', jobType: 'replacement', town: 'Cedar Falls',
    });
    // Archie's own company id is never sent.
    expect(g.raw).not.toContain(c.id);
    const [row] = await outbox(c.id);
    expect(row).toMatchObject({ id: g.body.id, type: 'lead.created', attempts: 1, lastError: null, gaveUpAt: null });
    expect(row.deliveredAt).not.toBeNull();
  });

  it('never tells Roof Lee about a lead Roof Lee itself added', async () => {
    const c = await make();
    const r = await sisterSend(base, {
      method: 'POST', path: `${companies}/${c.roofliId}/leads`, version: 2, headers: { 'idempotency-key': randomUUID() },
      json: { name: 'From Roof Lee', acting: { authUserId: c.owner.authUserId, role: 'owner' } },
    });
    expect(r.status).toBe(201);
    await archieLead(c.id, { source: 'roofli' });
    await settle();
    expect(await outbox(c.id)).toEqual([]);
    expect(about(c.roofliId)).toEqual([]);
  });

  it('tells Roof Lee about a lead a person typed in even when the company\'s own JobTread took it', async () => {
    // The lead form files such a lead under 'jobtread' once JobTread accepts it.
    const c = await make();
    const lead = await archieLead(c.id, { source: 'jobtread', externalId: `jt-${randomUUID()}` });
    await settle();
    const mine = about(c.roofliId);
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toMatchObject({ type: 'lead.created', data: { leadId: String(lead.id), name: 'Pat Hollis' } });
  });

  it('the JobTread sync, which rewrites its copies on every run, reports no leads', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../../sync/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      expect(readFileSync(new URL(file, dir), 'utf8'), file).not.toContain('emitLeadCreated');
    }
  });

  it('records and sends nothing unless the settings are there and Roof Lee made the company', async () => {
    const c = await make();
    // No address for Roof Lee.
    delete process.env[EVENTS_URL_ENV];
    await archieLead(c.id);
    // An address, but no pair secret to sign with.
    process.env[EVENTS_URL_ENV] = roofLeeUrl;
    dropSecret();
    await archieLead(c.id);
    useSecret();
    // Everything set, but a company Roof Lee did not make.
    const plain = await createCompany({ slug: `${tag}-plain-${randomUUID().slice(0, 8)}`, name: 'Not From Roof Lee', status: 'active' });
    await archieLead(plain.id);
    await settle();
    expect(await outbox(c.id)).toEqual([]);
    expect(await outbox(plain.id)).toEqual([]);
    expect(about(c.roofliId)).toEqual([]);
    // And the scheduled run has nothing to send for either of them. (It may
    // send other companies' news left waiting in the shared test database.)
    await runEventDelivery();
    expect(about(c.roofliId)).toEqual([]);
    expect(got.filter((g) => g.raw.includes(plain.id))).toEqual([]);
  });

  it('tries a failed delivery again later, and delivers it once', async () => {
    const c = await make();
    answers = [500];
    await archieLead(c.id);
    await settle();
    expect(about(c.roofliId)).toHaveLength(1);
    let [row] = await outbox(c.id);
    expect(row).toMatchObject({ attempts: 1, deliveredAt: null, gaveUpAt: null, lastError: 'answered 500' });
    // Not yet: the wait has not passed.
    await runAsCompany(c.id, () => deliverDue());
    expect(about(c.roofliId)).toHaveLength(1);
    // Later, the scheduled run sends it again, and this time Roof Lee has it.
    await makeDue(c.id);
    const run = await runEventDelivery();
    expect(run.delivered).toBeGreaterThanOrEqual(1);
    const sent = about(c.roofliId);
    expect(sent).toHaveLength(2);
    // The same event both times: Roof Lee would know a repeat by its id.
    expect(sent[1].body.id).toBe(sent[0].body.id);
    expect(sent.every((g) => g.genuine)).toBe(true);
    [row] = await outbox(c.id);
    expect(row.attempts).toBe(2);
    expect(row.deliveredAt).not.toBeNull();
    // Delivered means done: nothing sends it a third time, even if it were made due.
    await makeDue(c.id);
    await runEventDelivery();
    await runAsCompany(c.id, () => deliverDue());
    expect(about(c.roofliId)).toHaveLength(2);
  });

  it('tells the same lead once, however often it is reported', async () => {
    const c = await make();
    const lead = await archieLead(c.id);
    await runAsCompany(c.id, async () => { await emitLeadCreated(lead); await emitLeadCreated(lead); });
    await settle();
    expect(await outbox(c.id)).toHaveLength(1);
    expect(about(c.roofliId)).toHaveLength(1);
  });

  it('sends one event once when two runs start together', async () => {
    const c = await make();
    answers = [503];
    await archieLead(c.id);
    await settle();
    await makeDue(c.id);
    await Promise.all([runAsCompany(c.id, () => deliverDue()), runAsCompany(c.id, () => deliverDue()), runEventDelivery()]);
    expect(about(c.roofliId)).toHaveLength(2);
  });

  it('gives up on an event Roof Lee says it cannot read, and keeps trying one it did not answer', async () => {
    const c = await make();
    answers = [400];
    await archieLead(c.id);
    await settle();
    let [row] = await outbox(c.id);
    expect(row).toMatchObject({ deliveredAt: null, lastError: 'answered 400' });
    expect(row.gaveUpAt).not.toBeNull();
    await makeDue(c.id);
    await runAsCompany(c.id, () => deliverDue());
    expect(about(c.roofliId)).toHaveLength(1);

    // Nobody home at all: kept, to be tried again.
    const d = await make();
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const dead = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    process.env[EVENTS_URL_ENV] = dead;
    await archieLead(d.id);
    await settle();
    [row] = await outbox(d.id);
    expect(row).toMatchObject({ attempts: 1, deliveredAt: null, gaveUpAt: null, lastError: 'no answer' });
    process.env[EVENTS_URL_ENV] = roofLeeUrl;
    await makeDue(d.id);
    await runAsCompany(d.id, () => deliverDue());
    expect(about(d.roofliId)).toHaveLength(1);
  });

  it('never follows a redirect with a signed event', async () => {
    const c = await make();
    answers = [307];
    await archieLead(c.id);
    await settle();
    expect(about(c.roofliId)).toHaveLength(1);
    expect((await outbox(c.id))[0]).toMatchObject({ deliveredAt: null, lastError: 'answered 307' });
  });

  it('tells Roof Lee when a job is finished, also when automation made the move, and only once', async () => {
    const c = await make();
    const jobKey = `${tag}-job-${randomUUID().slice(0, 8)}`;
    const lead = await runAsCompany(c.id, async () => {
      const [row] = await db.insert(schema.leads).values({ source: 'manual', externalId: jobKey, firstName: 'Pat', lastName: 'Hollis', city: 'Cedar Falls', serviceType: 'replacement', status: 'won' } as any).returning();
      return row;
    });
    // Not the finished stage: no news.
    let moved = await runAsCompany(c.id, () => moveStage(jobKey, 'warranty', 'system', { system: true, reason: 'test' }));
    expect(moved.ok).toBe(true);
    await settle();
    expect(about(c.roofliId)).toEqual([]);
    // A move made by automation, not by a person.
    moved = await runAsCompany(c.id, () => moveStage(jobKey, 'closed_out', 'system', { system: true, reason: 'test' }));
    expect(moved).toMatchObject({ ok: true, moved: true });
    await settle();
    const mine = about(c.roofliId);
    expect(mine).toHaveLength(1);
    expect(mine[0].genuine).toBe(true);
    expect(mine[0].body).toMatchObject({ product: 'archie', roofliCompanyId: c.roofliId, type: 'job.finished' });
    expect(Object.keys(mine[0].body.data).sort()).toEqual(['finishedAt', 'jobId', 'jobType', 'photoConsent', 'town']);
    expect(mine[0].body.data).toMatchObject({ jobId: String(lead.id), jobType: 'replacement', town: 'Cedar Falls', photoConsent: false });
    expect(mine[0].body.data.jobId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(new Date(mine[0].body.data.finishedAt).toISOString()).toBe(mine[0].body.data.finishedAt);
    // Moved away and back: still one finished job.
    await runAsCompany(c.id, () => moveStage(jobKey, 'warranty', 'system', { system: true, reason: 'test' }));
    await runAsCompany(c.id, () => moveStage(jobKey, 'closed_out', 'system', { system: true, reason: 'test' }));
    await settle();
    expect(about(c.roofliId)).toHaveLength(1);
  });

  it('uses the stage the owner chose as "finished"', async () => {
    const c = await make();
    process.env[FINISHED_STAGE_ENV] = 'final_walkthrough';
    const jobKey = `${tag}-job-${randomUUID().slice(0, 8)}`;
    await runAsCompany(c.id, () => db.insert(schema.leads).values({ source: 'manual', externalId: jobKey, firstName: 'Jo', status: 'won' } as any));
    await runAsCompany(c.id, () => moveStage(jobKey, 'final_walkthrough', 'system', { system: true, reason: 'test' }));
    await settle();
    expect(about(c.roofliId).map((g) => g.body.type)).toEqual(['job.finished']);
    await runAsCompany(c.id, () => moveStage(jobKey, 'closed_out', 'system', { system: true, reason: 'test' }));
    await settle();
    expect(about(c.roofliId)).toHaveLength(1);
  });

  it('keeps each company\'s news under its own Roof Lee id, and holds a paused company\'s back', async () => {
    const a = await make();
    const b = await make();
    answers = [500, 500];
    const leadA = await archieLead(a.id, { firstName: 'Ann', lastName: 'A' });
    const leadB = await archieLead(b.id, { firstName: 'Bo', lastName: 'B' });
    await settle();
    // B is paused before the next try.
    await runAsSystem('test', () => db.update(schema.companies).set({ status: 'paused' }).where(eq(schema.companies.id, b.id)));
    await makeDue(a.id);
    await makeDue(b.id);
    got = [];
    await runEventDelivery();
    expect(about(a.roofliId).map((g) => [g.body.data.leadId, g.body.data.name])).toEqual([[String(leadA.id), 'Ann A']]);
    expect(about(b.roofliId)).toEqual([]);
    // Back in business: its news goes out, under its own id.
    await runAsSystem('test', () => db.update(schema.companies).set({ status: 'active' }).where(eq(schema.companies.id, b.id)));
    await runEventDelivery();
    expect(about(b.roofliId).map((g) => [g.body.data.leadId, g.body.data.name])).toEqual([[String(leadB.id), 'Bo B']]);
    for (const g of got) expect(g.genuine).toBe(true);
  });

  it('runs from the scheduler only with the cron secret', async () => {
    const c = await make();
    answers = [500];
    await archieLead(c.id);
    await settle();
    await makeDue(c.id);
    // No CRON_SECRET set: shut, whatever is sent.
    expect((await fetch(`${base}${SISTER_EVENTS_CRON}`)).status).toBe(401);
    expect((await fetch(`${base}${SISTER_EVENTS_CRON}`, { headers: { authorization: 'Bearer ' } })).status).toBe(401);
    process.env.CRON_SECRET = 'cron-test-secret';
    expect((await fetch(`${base}${SISTER_EVENTS_CRON}`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect(about(c.roofliId)).toHaveLength(1);
    const ok = await fetch(`${base}${SISTER_EVENTS_CRON}`, { headers: { authorization: 'Bearer cron-test-secret' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, on: true });
    expect(about(c.roofliId)).toHaveLength(2);
    // With the link's settings missing the run does nothing and says so.
    delete process.env[EVENTS_URL_ENV];
    const off = await fetch(`${base}${SISTER_EVENTS_CRON}`, { headers: { authorization: 'Bearer cron-test-secret' } });
    expect(await off.json()).toEqual({ ok: true, on: false, companies: 0, delivered: 0, failed: 0, rejected: 0, unanswered: 0 });
  });
});
