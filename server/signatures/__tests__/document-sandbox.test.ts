/**
 * The frozen document runs in a sandbox of its own, framed or full screen, and
 * the signing page runs only its own script. The document is a stored report
 * with inline scripts served from the app's origin; unsandboxed, anything that
 * got into one ran as the app.
 *
 * The page tests need nothing; the route tests need DATABASE_URL (the local
 * bra_e2e database) and are skipped without one.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import { DOCUMENT_SANDBOX, SIGN_PAGE_CSP, signPage } from '../sign-page';
import { inCompany, makeTestCompany, TEST_COMPANY_ID } from '../../__tests__/helpers/tenant';

// Every test here runs as a real test company (row level security is on).
let __co = TEST_COMPANY_ID;
const as = inCompany(() => __co);
beforeAll(async () => { if (process.env.DATABASE_URL) __co = await makeTestCompany('sigdoc'); });

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));
vi.mock('../../brain/gmail-delegated', () => ({ sendAsMailbox: vi.fn(), sendAsMailboxWithAttachments: vi.fn() }));
vi.mock('../../integrations/jobtread', () => ({ JobTreadClient: class { uploadJobFile = vi.fn(); } }));
vi.mock('../../integrations/gohighlevel', () => ({ GoHighLevelClient: class { sendSms = vi.fn(); } }));
vi.mock('../../access/team-scope', () => ({ memberByEmail: async () => null, visibleRepNamesFor: async () => null }));

const signer = { id: 1, name: 'Karen Whitfield', role: 'customer', signedAt: null } as unknown as Parameters<typeof signPage>[0]['signer'];
const page = (o: Partial<Parameters<typeof signPage>[0]> = {}) => signPage({
  token: 'a'.repeat(32), title: 'Roof report', propertyAddress: '1 Main St', message: null,
  signer, signers: [signer], framed: true, inlineHtml: '', ...o,
});

describe('the signing page', () => {
  it('frames the document in a sandbox that never shares the app origin', as(() => {
    const html = page();
    const attr = /<iframe[^>]*\ssandbox="([^"]*)"/.exec(html);
    expect(attr?.[1]).toBe(DOCUMENT_SANDBOX);
    expect(DOCUMENT_SANDBOX.split(/\s+/)).not.toContain('allow-same-origin');
    // Scripts in reports still run; Print still opens; new-tab links still open.
    expect(DOCUMENT_SANDBOX.split(/\s+/)).toEqual(expect.arrayContaining(['allow-scripts', 'allow-modals', 'allow-popups']));
  }));

  it('keeps the full-screen link outside the frame', as(() => {
    expect(page()).toMatch(/<a href="\/r\/s\/a{32}\/document" target="_blank"/);
  }));

  it('allows exactly its own script, so the hash cannot drift from the page', as(() => {
    const scripts = [...page().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    const hash = crypto.createHash('sha256').update(scripts[0], 'utf8').digest('base64');
    expect(SIGN_PAGE_CSP).toContain(`script-src 'sha256-${hash}'`);
    expect(SIGN_PAGE_CSP).toContain("frame-ancestors 'self'");
  }));

  it('takes the frame height only from the frame, as a number', as(() => {
    const html = page();
    expect(html).toContain('e.source !== frame.contentWindow');
    expect(html).toContain("typeof e.data.signDocHeight !== 'number'");
  }));
});

const hasDb = !!process.env.DATABASE_URL;
const JOB = `test-sig-sandbox-${process.pid}-${Date.now()}`;
let routes: typeof import('../routes');
let dbm: typeof import('../../db');
let schema: typeof import('../../../shared/schema');
let orm: typeof import('drizzle-orm');

function routeHandler(method: 'get' | 'post', path: string) {
  const app = express();
  const spy = vi.spyOn(app, method);
  routes.registerSignatureRoutes(app);
  const args = spy.mock.calls.find((c) => c[0] === path) as unknown[] | undefined;
  if (!args) throw new Error(`no ${method} ${path}`);
  const handler = args[args.length - 1] as (req: unknown, res: unknown, next: (e?: unknown) => void) => void;
  return (req: Record<string, unknown>) => new Promise<{ status: number; body: string; headers: Record<string, string> }>((resolve, reject) => {
    let status = 200;
    const headers: Record<string, string> = {};
    const res: Record<string, unknown> = {};
    Object.assign(res, {
      status: (s: number) => { status = s; return res; },
      set: (k: string, v: string) => { headers[k.toLowerCase()] = v; return res; },
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; return res; },
      send: (body: unknown) => { resolve({ status, body: String(body), headers }); return res; },
      redirect: (s: number, to: string) => { resolve({ status: s, body: to, headers }); return res; },
    });
    handler({ headers: {}, query: {}, body: {}, ip: '10.9.9.9', ...req }, res, (e?: unknown) => (e ? reject(e) : resolve({ status, body: '', headers })));
  });
}

async function makeRequest(html: string) {
  const [r] = await dbm.db.insert(schema.signatureRequests).values({
    jobExternalId: JOB, sourceKind: 'report', title: 'Roof report', html,
    docHash: 'x', status: 'sent', createdBy: 'rep@acme.test', sentBy: 'rep@acme.test',
  }).returning();
  const token = crypto.randomBytes(16).toString('hex');
  await dbm.db.insert(schema.signatureSigners).values({ requestId: r.id, ordinal: 0, name: 'Karen Whitfield', role: 'customer', email: 'k@example.com', token });
  return token;
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
  await dbm.db.delete(schema.signatureRequests).where(orm.eq(schema.signatureRequests.jobExternalId, JOB));
}));

describe.skipIf(!hasDb)('the frozen document', () => {
  it('is served in a CSP sandbox, framed only by the app, sized for the frame', as(async () => {
    const report = '<!doctype html><html><head></head><body><h1>Report</h1><script>var s = "</body>";</script></body></html>';
    const token = await makeRequest(report);
    const res = await routeHandler('get', '/r/s/:token/document')({ params: { token } });
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain(`sandbox ${DOCUMENT_SANDBOX}`);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('allow-same-origin');
    // The report itself is untouched; the height script lands before the real end of the body.
    expect(res.body).toContain('<script>var s = "</body>";</script>');
    expect(res.body).toMatch(/signDocHeight[\s\S]*<\/script><\/body><\/html>$/);
  }));

  it('wraps a fragment and still sizes it', as(async () => {
    const token = await makeRequest('<p>The certificate</p>');
    const res = await routeHandler('get', '/r/s/:token/document')({ params: { token } });
    expect(res.body).toMatch(/<p>The certificate<\/p>[\s\S]*signDocHeight[\s\S]*<\/body><\/html>$/);
  }));

  it('serves the signing page under its own script-only CSP', as(async () => {
    const token = await makeRequest('<p>The certificate</p>');
    const res = await routeHandler('get', '/r/s/:token')({ params: { token } });
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(SIGN_PAGE_CSP);
  }));
});
