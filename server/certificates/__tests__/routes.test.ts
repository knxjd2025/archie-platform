/**
 * The certificate's own routes, against a real database: what may still change
 * once it has been signed or sent, the homeowner's double tap, and the email
 * that carries names typed by anyone on the team.
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
beforeAll(async () => { if (process.env.DATABASE_URL) __co = await makeTestCompany('cert'); });

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  send: vi.fn(),
  pending: [] as Array<Promise<unknown>>,
}));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { mocks.pending.push(p); } }));
vi.mock('../../integrations/company-mail', () => ({ sendAsMailbox: mocks.send, sendAsMailboxWithAttachments: vi.fn() }));
vi.mock('../../integrations/jobtread', () => ({ JobTreadClient: class { uploadJobFile = mocks.upload; } }));
vi.mock('../../access/team-scope', () => ({ memberByEmail: async () => null, visibleRepNamesFor: async () => null }));

const hasDb = !!process.env.DATABASE_URL;
const JOB_PREFIX = `test-cert-${process.pid}-${Date.now()}`;
let seq = 0;

let routes: typeof import('../routes');
let dbm: typeof import('../../db');
let schema: typeof import('../../../shared/schema');
let orm: typeof import('drizzle-orm');

const admin = { email: 'boss@acme.test', name: '<Boss>', role: 'admin' };
const flush = async () => { while (mocks.pending.length) await Promise.all(mocks.pending.splice(0)); };

async function makeCertificate(extra: Partial<typeof import('../../../shared/schema').jobCertificates.$inferInsert> = {}) {
  const jobExternalId = `${JOB_PREFIX}-${++seq}`;
  const [row] = await dbm.db.insert(schema.jobCertificates).values({
    jobExternalId, createdBy: 'rep@acme.test', signToken: crypto.randomBytes(16).toString('hex'),
    data: {
      customerName: '<img src=x onerror=alert(1)> Whitfield', propertyAddress: '1420 <b>Sardis</b> Rd',
      jobName: 'Whitfield', claimNumber: '', completedOn: '2026-09-12', walkedBy: 'Dana Rep', walkedByRole: 'Project manager',
      sections: [], openItems: [], warrantyExplained: true, homeownerPresent: true, balance: '', homeownerConcerns: '',
      companyName: 'Acme Test Roofing LLC', officeAddress: '1 Main St', companyPhone: '(555) 010-0100',
    },
    ...extra,
  }).returning();
  return row;
}

function routeHandler(method: 'get' | 'post', path: string) {
  const app = express();
  const spy = vi.spyOn(app, method);
  routes.registerCertificateRoutes(app);
  const args = spy.mock.calls.find((c) => c[0] === path) as unknown[] | undefined;
  if (!args) throw new Error(`no ${method} ${path}`);
  const handler = args[args.length - 1] as (req: unknown, res: unknown, next: (e?: unknown) => void) => void;
  return (req: Record<string, unknown>) => new Promise<{ status: number; body: unknown; headers: Record<string, string> }>((resolve, reject) => {
    let status = 200;
    const headers: Record<string, string> = {};
    const res: Record<string, unknown> = {};
    Object.assign(res, {
      status: (s: number) => { status = s; return res; },
      set: (k: string, v: string) => { headers[k.toLowerCase()] = v; return res; },
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; return res; },
      send: (body: unknown) => { resolve({ status, body, headers }); return res; },
      json: (body: unknown) => { resolve({ status, body, headers }); return res; },
    });
    handler({ headers: {}, query: {}, body: {}, ip: '10.9.9.9', session: { user: admin }, ...req }, res, (e?: unknown) => (e ? reject(e) : resolve({ status, body: null, headers })));
  });
}

/** The rate limiter: registered just before the link's company lookup and the handler. */
function limiterFor(method: 'get' | 'post', path: string) {
  const app = express();
  const spy = vi.spyOn(app, method);
  routes.registerCertificateRoutes(app);
  const args = spy.mock.calls.find((c) => c[0] === path) as unknown[];
  return args[args.length - 3] as (req: unknown, res: unknown, next: () => void) => void;
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
  await dbm.db.delete(schema.signatureRequests).where(orm.like(schema.signatureRequests.jobExternalId, `${JOB_PREFIX}%`));
  await dbm.db.delete(schema.jobCertificates).where(orm.like(schema.jobCertificates.jobExternalId, `${JOB_PREFIX}%`));
  await dbm.db.delete(schema.finalWalkthroughs).where(orm.like(schema.finalWalkthroughs.jobExternalId, `${JOB_PREFIX}%`));
  await dbm.db.delete(schema.writeLog).where(orm.like(schema.writeLog.targetId, `${JOB_PREFIX}%`));
}));

beforeEach(as(() => {
  vi.clearAllMocks();
  mocks.pending.length = 0;
  mocks.upload.mockResolvedValue({ ok: true, fileId: 'file-1' });
  mocks.send.mockResolvedValue('msg');
}));

describe.skipIf(!hasDb)('pulling the walkthrough in again', () => {
  const refresh = () => routeHandler('post', '/api/clients/:externalId/certificate/refresh');

  it('is refused once we have signed it', as(async () => {
    const row = await makeCertificate({ companySigner: 'Dana Rep', companySignedAt: new Date() });
    const res = await refresh()({ params: { externalId: row.jobExternalId } });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/your signature/);
  }));

  it('is refused once the homeowner has the link', as(async () => {
    const row = await makeCertificate({ sentAt: new Date(), status: 'sent' });
    const res = await refresh()({ params: { externalId: row.jobExternalId } });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/homeowner/);
  }));

  it('is refused while it is out through Send for signature', as(async () => {
    const row = await makeCertificate();
    await dbm.db.insert(schema.signatureRequests).values({
      jobExternalId: row.jobExternalId, sourceKind: 'certificate', title: 'Certificate of Completion',
      html: '<p>x</p>', docHash: 'x', status: 'sent', createdBy: 'rep@acme.test',
    });
    const res = await refresh()({ params: { externalId: row.jobExternalId } });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/out for signature/);
  }));

  it('can be started over once sent, and the link the homeowner holds stops working', as(async () => {
    const row = await makeCertificate({ companySigner: 'Dana Rep', companySignedAt: new Date(), sentAt: new Date(), sentBy: 'rep@acme.test', status: 'sent' });
    await dbm.db.insert(schema.finalWalkthroughs).values({
      jobExternalId: row.jobExternalId, answers: {}, status: 'submitted', submittedAt: new Date(), createdBy: 'rep@acme.test',
    });
    // Refused without saying so: the 409 offers the way forward rather than a dead end.
    const refused = await refresh()({ params: { externalId: row.jobExternalId } });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ canRestart: true });
    expect((refused.body as { error: string }).error).toMatch(/Start it over/);

    const res = await refresh()({ params: { externalId: row.jobExternalId }, body: { restart: true } });
    expect(res.status).toBe(200);
    const [after] = await dbm.db.select().from(schema.jobCertificates).where(orm.eq(schema.jobCertificates.id, row.id));
    expect([after.status, after.companySigner, after.companySignedAt, after.sentAt]).toEqual(['draft', null, null, null]);
    expect(after.signToken).not.toBe(row.signToken);

    const page = routeHandler('get', '/r/sign/:token');
    expect((await page({ params: { token: row.signToken } })).status).toBe(404);
  }));

  it('is never started over once the homeowner has signed', as(async () => {
    const row = await makeCertificate({
      companySigner: 'Dana Rep', companySignedAt: new Date(), sentAt: new Date(), status: 'signed',
      homeownerSigner: 'Karen Whitfield', homeownerSignedAt: new Date(),
    });
    const res = await refresh()({ params: { externalId: row.jobExternalId }, body: { restart: true } });
    expect(res.status).toBe(409);
    const [after] = await dbm.db.select().from(schema.jobCertificates).where(orm.eq(schema.jobCertificates.id, row.id));
    expect(after.signToken).toBe(row.signToken);
    expect(after.homeownerSigner).toBe('Karen Whitfield');
  }));
});

describe.skipIf(!hasDb)('the homeowner signing through the certificate link', () => {
  it('records the first signature only, and files one copy', as(async () => {
    const row = await makeCertificate({ companySigner: 'Dana Rep', companySignedAt: new Date(), sentAt: new Date(), status: 'sent' });
    const sign = routeHandler('post', '/r/sign/:token');
    await Promise.all([
      sign({ params: { token: row.signToken }, body: { name: 'Karen Whitfield', affirm: 'yes' } }),
      sign({ params: { token: row.signToken }, body: { name: 'Somebody Else', affirm: 'yes' } }),
    ]);
    await flush();
    const [after] = await dbm.db.select().from(schema.jobCertificates).where(orm.eq(schema.jobCertificates.id, row.id));
    expect(after.status).toBe('signed');
    expect(['Karen Whitfield', 'Somebody Else']).toContain(after.homeownerSigner);
    expect(mocks.upload).toHaveBeenCalledTimes(1);

    // A later tap does not move the name or the time.
    await sign({ params: { token: row.signToken }, body: { name: 'Third Person', affirm: 'yes' } });
    await flush();
    const [again] = await dbm.db.select().from(schema.jobCertificates).where(orm.eq(schema.jobCertificates.id, row.id));
    expect(again.homeownerSigner).toBe(after.homeownerSigner);
    expect(again.homeownerSignedAt?.getTime()).toBe(after.homeownerSignedAt?.getTime());
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  }));
});

describe.skipIf(!hasDb)('the signing email', () => {
  it('escapes the names and addresses it carries', as(async () => {
    const row = await makeCertificate({ companySigner: 'Dana Rep', companySignedAt: new Date() });
    const send = routeHandler('post', '/api/clients/:externalId/certificate/send');
    const res = await send({ params: { externalId: row.jobExternalId }, body: { email: 'karen@example.com' } });
    expect(res.status).toBe(200);
    const html = String(mocks.send.mock.calls[0][3]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>Sardis</b>');
    expect(html).not.toContain('<Boss>');
    expect(html).toContain('&lt;b&gt;Sardis&lt;/b&gt;');
  }));
});

describe.skipIf(!hasDb)('the certificate link before it is ready', () => {
  const page = () => routeHandler('get', '/r/sign/:token');
  const sign = () => routeHandler('post', '/r/sign/:token');

  it('will not take a signature on a draft nobody has signed or sent', as(async () => {
    const row = await makeCertificate();
    const shown = await page()({ params: { token: row.signToken } });
    expect(shown.status).toBe(409);
    expect(String(shown.body)).toMatch(/isn't ready to sign yet/);
    expect(String(shown.body)).not.toContain('<form');

    // The form is a plain POST, so the refusal cannot live only on the page.
    const posted = await sign()({ params: { token: row.signToken }, body: { name: 'Karen Whitfield', affirm: 'yes' } });
    expect(posted.status).toBe(409);
    const [after] = await dbm.db.select().from(schema.jobCertificates).where(orm.eq(schema.jobCertificates.id, row.id));
    expect([after.homeownerSigner, after.homeownerSignedAt, after.status]).toEqual([null, null, 'draft']);
    expect(mocks.upload).not.toHaveBeenCalled();
  }));

  it('will not take one we have signed but not yet sent', as(async () => {
    const row = await makeCertificate({ companySigner: 'Dana Rep', companySignedAt: new Date() });
    expect((await page()({ params: { token: row.signToken } })).status).toBe(409);
    expect((await sign()({ params: { token: row.signToken }, body: { name: 'Karen Whitfield', affirm: 'yes' } })).status).toBe(409);
  }));

  it('opens the form once it is countersigned and sent, with no script allowed on the page', as(async () => {
    const row = await makeCertificate({ companySigner: 'Dana Rep', companySignedAt: new Date(), sentAt: new Date(), status: 'sent' });
    const res = await page()({ params: { token: row.signToken } });
    expect(res.status).toBe(200);
    expect(String(res.body)).toContain(`<form method="post" action="/r/sign/${row.signToken}"`);
    expect(res.headers['content-security-policy']).toMatch(/script-src 'none'/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'self'/);
  }));

  it('still shows the thank-you once signed, however it was signed', as(async () => {
    // Signed through "Send for signature", which writes back without the certificate's own send.
    const row = await makeCertificate({ status: 'signed', homeownerSigner: 'Karen Whitfield', homeownerSignedAt: new Date() });
    const res = await page()({ params: { token: row.signToken } });
    expect(res.status).toBe(200);
    expect(String(res.body)).toMatch(/this is signed/);
  }));

  it('turns away a malformed token without looking it up', as(async () => {
    const selectSpy = vi.spyOn(dbm.db, 'select');
    for (const token of ['nope', `${'a'.repeat(32)}' or 1=1`, 'A'.repeat(32), 'a'.repeat(33)]) {
      expect((await page()({ params: { token } })).status).toBe(404);
      expect((await sign()({ params: { token }, body: { name: 'Karen Whitfield', affirm: 'yes' } })).status).toBe(404);
    }
    expect(selectSpy).not.toHaveBeenCalled();
    selectSpy.mockRestore();
  }));
});

describe.skipIf(!hasDb)('the certificate link under load', () => {
  it('answers a limited homeowner with a page, not JSON, on both reading and signing', as(async () => {
    const { __resetRateLimits } = await import('../../lib/rate-limit');
    for (const method of ['get', 'post'] as const) {
      __resetRateLimits();
      const limiter = limiterFor(method, '/r/sign/:token');
      let refused: { status: number; body: string; type: string } | null = null;
      for (let i = 0; i < 300 && !refused; i++) {
        let status = 200; let type = '';
        const res: Record<string, unknown> = {};
        Object.assign(res, {
          status: (s: number) => { status = s; return res; },
          setHeader: () => res,
          set: (k: string, v: string) => { if (k.toLowerCase() === 'content-type') type = v; return res; },
          send: (body: unknown) => { refused = { status, body: String(body), type }; return res; },
          json: (body: unknown) => { refused = { status, body: JSON.stringify(body), type: 'application/json' }; return res; },
        });
        limiter({ headers: {}, ip: '10.1.2.3', params: { token: 'a'.repeat(32) } }, res, () => {});
      }
      expect(refused).not.toBeNull();
      expect(refused!.status).toBe(429);
      expect(refused!.type).toMatch(/text\/html/);
      expect(refused!.body).toMatch(/Please wait/);
    }
    __resetRateLimits();
  }));
});
