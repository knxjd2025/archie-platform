/**
 * Finishing a signed document, against a real database: the steps after
 * everyone signs used to run once, unwatched, after the response — and a run
 * frozen half-way never tried again. These pin down that each step happens
 * exactly once however many times, and however concurrently, it is resumed.
 *
 * Needs DATABASE_URL (the local bra_e2e database); skipped without one.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import { inCompany, makeTestCompany, TEST_COMPANY_ID } from '../../__tests__/helpers/tenant';

// Every test here runs as a real test company (row level security is on).
let __co = TEST_COMPANY_ID;
const as = inCompany(() => __co);
beforeAll(async () => { if (process.env.DATABASE_URL) __co = await makeTestCompany('sigdone'); });

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  sendWith: vi.fn(),
  send: vi.fn(),
  pending: [] as Array<Promise<unknown>>,
}));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { mocks.pending.push(p); } }));
vi.mock('../../integrations/company-mail', () => ({ sendAsMailbox: mocks.send, sendAsMailboxWithAttachments: mocks.sendWith }));
vi.mock('../../integrations/jobtread', () => ({ JobTreadClient: class { uploadJobFile = mocks.upload; } }));
vi.mock('../../integrations/gohighlevel', () => ({ GoHighLevelClient: class { sendSms = vi.fn(); } }));
vi.mock('../../access/team-scope', () => ({ memberByEmail: async () => null, visibleRepNamesFor: async () => null }));

const hasDb = !!process.env.DATABASE_URL;
const JOB = `test-sig-${process.pid}-${Date.now()}`;

type Mod = typeof import('../routes');
type Db = typeof import('../../db');
type Schema = typeof import('../../../shared/schema');
type Drizzle = typeof import('drizzle-orm');
let routes: Mod; let dbm: Db; let schema: Schema; let orm: Drizzle;

const token = () => crypto.randomBytes(16).toString('hex');
const flush = async () => { while (mocks.pending.length) await Promise.all(mocks.pending.splice(0)); };

async function makeRequest(o: {
  status?: string; kind?: string; signed?: boolean[]; emails?: Array<string | null>; roles?: string[];
} = {}) {
  const { db } = dbm; const { signatureRequests, signatureSigners } = schema;
  const [r] = await db.insert(signatureRequests).values({
    jobExternalId: JOB, sourceKind: o.kind ?? 'report', title: 'Roof report', html: '<p>The report</p>',
    docHash: 'x', status: o.status ?? 'sent', createdBy: 'rep@acme.test', sentBy: 'rep@acme.test',
  }).returning();
  const signed = o.signed ?? [true, true];
  const signers = await db.insert(signatureSigners).values(signed.map((isSigned, i) => ({
    requestId: r.id, ordinal: i, name: `Signer ${i}`, role: o.roles?.[i] ?? 'customer',
    email: o.emails ? o.emails[i] : `signer${i}@example.com`, token: token(),
    signedAt: isSigned ? new Date(Date.now() - (2 - i) * 60_000) : null,
    signedName: isSigned ? `Signer ${i}` : null, signatureKind: isSigned ? 'typed' : null,
    ip: isSigned ? `10.0.0.${i + 1}` : null,
  }))).returning();
  return { request: r, signers };
}

const statusOf = async (id: number) => {
  const [r] = await dbm.db.select().from(schema.signatureRequests).where(orm.eq(schema.signatureRequests.id, id));
  return r;
};

/** One registered route's handler, called the way Express would, resolved when it answers. */
function routeHandler(method: 'get' | 'post', path: string, register: (app: express.Express) => void) {
  const app = express();
  const spy = vi.spyOn(app, method);
  register(app);
  const args = spy.mock.calls.find((c) => c[0] === path) as unknown[] | undefined;
  if (!args) throw new Error(`no ${method} ${path}`);
  const handler = args[args.length - 1] as (req: unknown, res: unknown, next: (e?: unknown) => void) => void;
  return (req: Record<string, unknown>) => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const res: Record<string, unknown> = {};
    Object.assign(res, {
      status: (s: number) => { status = s; return res; },
      set: () => res,
      setHeader: () => res,
      send: (body: unknown) => { resolve({ status, body }); return res; },
      json: (body: unknown) => { resolve({ status, body }); return res; },
      redirect: (s: number, to: string) => { resolve({ status: s, body: to }); return res; },
    });
    handler({ headers: {}, query: {}, body: {}, ip: '10.9.9.9', ...req }, res, (e?: unknown) => (e ? reject(e) : resolve({ status, body: null })));
  });
}

beforeAll(as(async () => {
  if (!hasDb) return;
  routes = await import('../routes');
  dbm = await import('../../db');
  schema = await import('../../../shared/schema');
  orm = await import('drizzle-orm');
}));

afterAll(as(async () => {
  if (!hasDb) return;
  const { db } = dbm; const { signatureRequests, jobCertificates, writeLog } = schema;
  await db.delete(signatureRequests).where(orm.eq(signatureRequests.jobExternalId, JOB));
  await db.delete(jobCertificates).where(orm.eq(jobCertificates.jobExternalId, JOB));
  await db.delete(writeLog).where(orm.eq(writeLog.targetId, JOB));
}));

describe.skipIf(!hasDb)('finishing a signed document', () => {
  beforeEach(as(() => {
    vi.clearAllMocks();
    mocks.pending.length = 0;
    mocks.upload.mockResolvedValue({ ok: true, fileId: `file-${Date.now()}` });
    mocks.sendWith.mockResolvedValue('msg');
    mocks.send.mockResolvedValue('msg');
  }));

  it('files once and sends each signer one copy, however often it is run again', as(async () => {
    const { request } = await makeRequest();
    await routes.completeIfDone(request.id);
    await routes.completeIfDone(request.id);
    await routes.finishSigned(request.id, false);

    const after = await statusOf(request.id);
    expect(after.status).toBe('signed');
    expect(after.jobtreadFileId).toMatch(/^file-/);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.sendWith.mock.calls.map((c) => c[1]).sort()).toEqual(['signer0@example.com', 'signer1@example.com']);
  }));

  it('picks up a completion that stopped part-way, doing only what was left', as(async () => {
    const { request } = await makeRequest();
    mocks.sendWith.mockImplementation(async (_m: string, to: string) => {
      if (to === 'signer1@example.com') throw new Error('Gmail is down');
      return 'msg';
    });
    await routes.completeIfDone(request.id);
    expect(mocks.upload).toHaveBeenCalledTimes(1);

    mocks.sendWith.mockReset().mockResolvedValue('msg');
    await routes.completeIfDone(request.id);
    expect(mocks.upload).toHaveBeenCalledTimes(1);   // not filed a second time
    expect(mocks.sendWith.mock.calls.map((c) => c[1])).toEqual(['signer1@example.com']);
  }));

  it('two runs at once still send each copy once', as(async () => {
    const { request } = await makeRequest();
    await Promise.all([routes.completeIfDone(request.id), routes.completeIfDone(request.id), routes.finishSigned(request.id, false)]);
    await Promise.all([routes.finishSigned(request.id, false), routes.finishSigned(request.id, false)]);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.sendWith).toHaveBeenCalledTimes(2);
  }));

  it('stops retrying a step that keeps failing', as(async () => {
    const { request } = await makeRequest({ emails: ['signer0@example.com', null] });
    mocks.upload.mockResolvedValue({ ok: false, error: 'JobTread job not found' });
    for (let i = 0; i < 8; i++) await routes.completeIfDone(request.id);
    expect(mocks.upload).toHaveBeenCalledTimes(5);
    expect(mocks.sendWith).toHaveBeenCalledTimes(1);
  }));

  it('leaves alone a request completed before the steps were recorded', as(async () => {
    // Signed under the old code: its copies went out then, and nothing records
    // which — re-running it would email the customer a second time.
    const { request } = await makeRequest({ status: 'signed' });
    await routes.completeIfDone(request.id);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.sendWith).not.toHaveBeenCalled();
  }));

  it('does not complete until everyone has signed', as(async () => {
    const { request } = await makeRequest({ signed: [true, false], status: 'draft' });
    await routes.completeIfDone(request.id);
    expect((await statusOf(request.id)).status).toBe('sent');
    expect(mocks.upload).not.toHaveBeenCalled();
  }));

  it('writes a certificate signed here back onto the certificate on the job', as(async () => {
    const { db } = dbm; const { jobCertificates } = schema;
    await db.insert(jobCertificates).values({ jobExternalId: JOB, data: {}, signToken: token(), createdBy: 'rep@acme.test' });
    const { request } = await makeRequest({ kind: 'certificate', roles: ['customer', 'company'] });
    await routes.completeIfDone(request.id);

    const [cert] = await db.select().from(jobCertificates).where(orm.eq(jobCertificates.jobExternalId, JOB));
    expect(cert.status).toBe('signed');
    expect(cert.homeownerSigner).toBe('Signer 0');
    expect(cert.homeownerSignedAt).not.toBeNull();
    expect(cert.homeownerIp).toBe('10.0.0.1');
    expect(cert.companySigner).toBe('Signer 1');
    expect(cert.jobtreadFileId).toBe((await statusOf(request.id)).jobtreadFileId);

    // And it can no longer go out for signature a second time.
    const { buildSignable, listSignable } = await import('../providers');
    expect((await buildSignable(JOB, 'certificate', null)).ok).toBe(false);
    expect((await listSignable(JOB)).some((o) => o.kind === 'certificate')).toBe(false);
  }));

  it('does not stamp an old request onto a certificate created after it went out', as(async () => {
    // What the end-to-end run caught: a completion retried in the background
    // signed the certificate the rep had just re-created.
    const { db } = dbm; const { jobCertificates } = schema;
    // The test above leaves its certificate on the same job.
    await db.delete(jobCertificates).where(orm.eq(jobCertificates.jobExternalId, JOB));
    const { request } = await makeRequest({ kind: 'certificate', roles: ['customer', 'company'] });
    await db.insert(jobCertificates).values({
      jobExternalId: JOB, data: {}, signToken: token(), createdBy: 'rep@acme.test',
      createdAt: new Date(Date.now() + 60_000),
    });
    await routes.completeIfDone(request.id);

    const [cert] = await db.select().from(jobCertificates).where(orm.eq(jobCertificates.jobExternalId, JOB));
    expect(cert.homeownerSignedAt).toBeNull();
    expect(cert.companySignedAt).toBeNull();
    expect(cert.status).not.toBe('signed');
  }));

  it('runs the completion through waitUntil after the signature is posted', as(async () => {
    const { request, signers } = await makeRequest({ signed: [true, false] });
    const sign = routeHandler('post', '/r/s/:token', routes.registerSignatureRoutes);
    const res = await sign({ params: { token: signers[1].token }, body: { affirm: 'yes', name: 'Signer One' } });
    expect(res.status).toBe(200);
    expect(mocks.pending.length).toBe(1);
    await flush();
    expect((await statusOf(request.id)).status).toBe('signed');
    expect(mocks.sendWith).toHaveBeenCalledTimes(2);
  }));
});

describe.skipIf(!hasDb)('a cancelled request', () => {
  beforeEach(as(() => {
    vi.clearAllMocks();
    mocks.pending.length = 0;
    mocks.send.mockResolvedValue('msg');
  }));

  it('cannot be declined, and nobody is emailed about it', as(async () => {
    const { request, signers } = await makeRequest({ status: 'voided', signed: [false] });
    const post = routeHandler('post', '/r/s/:token/decline', routes.registerSignatureRoutes);
    const get = routeHandler('get', '/r/s/:token/decline', routes.registerSignatureRoutes);
    expect((await get({ params: { token: signers[0].token } })).status).toBe(410);
    expect((await post({ params: { token: signers[0].token }, body: { reason: 'no' } })).status).toBe(410);
    await flush();
    expect((await statusOf(request.id)).status).toBe('voided');
    expect(mocks.send).not.toHaveBeenCalled();
  }));

  it('no longer serves its document', as(async () => {
    const { signers } = await makeRequest({ status: 'voided', signed: [false] });
    const doc = routeHandler('get', '/r/s/:token/document', routes.registerSignatureRoutes);
    const res = await doc({ params: { token: signers[0].token } });
    expect(res.status).toBe(410);
    expect(String(res.body)).not.toContain('The report');
  }));

  it('an open one declines once, and the rep hears about it once', as(async () => {
    const { request, signers } = await makeRequest({ status: 'sent', signed: [false] });
    const post = routeHandler('post', '/r/s/:token/decline', routes.registerSignatureRoutes);
    await post({ params: { token: signers[0].token }, body: { reason: 'Price' } });
    await post({ params: { token: signers[0].token }, body: { reason: 'Price' } });
    await flush();
    expect((await statusOf(request.id)).status).toBe('declined');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  }));
});
