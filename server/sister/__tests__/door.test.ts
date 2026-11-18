/**
 * The signed door every Roof Lee request comes through (server/sister/door.ts).
 *
 * The second half boots api/index.ts, the entry Vercel runs in production, and
 * sends it a real request. That is the test that matters most here: the
 * signature is over the raw bytes, so if express.json reaches a sister request
 * first the bytes are gone and nothing verifies. It passes locally with
 * server/index.ts wired and fails live if api/index.ts was forgotten.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sign, signRequest } from '../verify';
import { requireSister, sisterRawBody, SISTER_PREFIX, SISTER_SECRET_ENV } from '../door';

// api/index.ts seeds every live company before its first request. Not what is under test.
vi.mock('../../seed', () => ({
  seedAll: async () => {},
  seedCompany: async () => {},
  createSeedOnce: () => async () => {},
}));

const SECRET = 'door-test-pair-secret';
const listen = (handler: http.RequestListener): Promise<{ server: Server; base: string }> =>
  new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, '127.0.0.1', () =>
      resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });

interface Sent { method?: string; path: string; body?: string; secret?: string; version?: 1 | 2; at?: number; headers?: Record<string, string>; signedPath?: string }
function send(base: string, o: Sent) {
  const method = o.method ?? 'GET';
  const at = o.at ?? Date.now();
  const secret = o.secret ?? SECRET;
  const signature = (o.version ?? 2) === 2
    ? signRequest(method, o.signedPath ?? o.path, o.body ?? '', at, secret)
    : sign(o.body ?? '', at, secret);
  return fetch(`${base}${o.path}`, {
    method,
    body: o.body,
    headers: {
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-roofli-timestamp': String(at),
      'x-roofli-signature': signature,
      ...o.headers,
    },
  });
}

describe('the sister door', () => {
  let server: Server;
  let base = '';
  const seen: Array<{ raw: string; body: unknown }> = [];

  beforeAll(async () => {
    const app = express();
    app.use(SISTER_PREFIX, sisterRawBody());
    app.use(express.json());
    const echo = (req: express.Request, res: express.Response) => {
      seen.push({ raw: req.sister!.raw, body: req.sister!.body });
      res.json({ ok: true });
    };
    app.all('/api/sister/v1/old', requireSister(1), echo);
    app.all('/api/sister/v1/companies/:id/thing', requireSister(2), echo);
    ({ server, base } = await listen(app));
  });
  afterAll(() => { server?.close(); });
  beforeEach(() => { process.env[SISTER_SECRET_ENV] = SECRET; seen.length = 0; });
  afterEach(() => { delete process.env[SISTER_SECRET_ENV]; delete process.env.SISTERS_SHARED_SECRET; });

  const V2 = '/api/sister/v1/companies/0b9f6d0e-5c56-4a8e-9d55-2f1f5a3c7e11/thing';

  it('lets a correctly signed request in, with the body as it was sent', async () => {
    const body = '{ "b": 1,   "a" : [ 2 ] }';
    const r = await send(base, { method: 'POST', path: V2, body });
    expect(r.status).toBe(200);
    expect(seen).toEqual([{ raw: body, body: { b: 1, a: [2] } }]);
  });

  it('lets a signed read with a query and no body in', async () => {
    const r = await send(base, { path: `${V2}?actingUserId=u1&actingRole=office` });
    expect(r.status).toBe(200);
    expect(seen[0]).toEqual({ raw: '', body: undefined });
  });

  it('answers a bare 401 to anything that fails, with nothing to tell the failures apart', async () => {
    const body = '{"a":1}';
    const failures: Array<Promise<Response>> = [
      // no headers at all
      fetch(`${base}${V2}`),
      // another secret
      send(base, { method: 'POST', path: V2, body, secret: 'another-secret' }),
      // signed for another company's address
      send(base, { method: 'POST', path: V2, body, signedPath: V2.replace('0b9f', '1c8e') }),
      // signed without the query that was sent
      send(base, { path: `${V2}?x=1`, signedPath: V2 }),
      // six minutes old, and six minutes ahead
      send(base, { method: 'POST', path: V2, body, at: Date.now() - 6 * 60_000 }),
      send(base, { method: 'POST', path: V2, body, at: Date.now() + 6 * 60_000 }),
      // the version 1 form on a version 2 address, and the other way round
      send(base, { method: 'POST', path: V2, body, version: 1 }),
      send(base, { method: 'POST', path: '/api/sister/v1/old', body, version: 2 }),
      // a body sent as something other than JSON never reaches the verifier as bytes
      send(base, { method: 'POST', path: V2, body, headers: { 'content-type': 'text/plain' } }),
      // a timestamp that is not plain digits
      send(base, { method: 'POST', path: V2, body, headers: { 'x-roofli-timestamp': `${Date.now()}.0` } }),
      send(base, { method: 'POST', path: V2, body, headers: { 'x-roofli-timestamp': `0${Date.now()}` } }),
      // a signature that is not 64 lowercase hex characters
      send(base, { method: 'POST', path: V2, body, headers: { 'x-roofli-signature': 'A'.repeat(64) } }),
    ];
    const answers = await Promise.all(failures);
    const texts = await Promise.all(answers.map((a) => a.text()));
    expect(answers.map((a) => a.status)).toEqual(answers.map(() => 401));
    expect(new Set(texts)).toEqual(new Set(['']));
    expect(seen).toEqual([]);
  });

  it('refuses everything while the pair secret is unset, whatever it is signed with', async () => {
    delete process.env[SISTER_SECRET_ENV];
    expect((await send(base, { method: 'POST', path: V2, body: '{}' })).status).toBe(401);
    expect((await send(base, { method: 'POST', path: V2, body: '{}', secret: 'x' })).status).toBe(401);
    process.env[SISTER_SECRET_ENV] = '   ';
    expect((await send(base, { method: 'POST', path: V2, body: '{}', secret: '   ' })).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('never accepts the old shared secret, on either kind of address', async () => {
    process.env.SISTERS_SHARED_SECRET = 'old-shared-secret';
    expect((await send(base, { method: 'POST', path: '/api/sister/v1/old', body: '{}', version: 1, secret: 'old-shared-secret' })).status).toBe(401);
    delete process.env[SISTER_SECRET_ENV];
    expect((await send(base, { method: 'POST', path: '/api/sister/v1/old', body: '{}', version: 1, secret: 'old-shared-secret' })).status).toBe(401);
    expect((await send(base, { method: 'POST', path: V2, body: '{}', secret: 'old-shared-secret' })).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('takes the version 1 form on a version 1 address', async () => {
    const r = await send(base, { method: 'PUT', path: '/api/sister/v1/old', body: '{"a":1}', version: 1 });
    expect(r.status).toBe(200);
    expect(seen).toEqual([{ raw: '{"a":1}', body: { a: 1 } }]);
  });

  it('answers 400 to a signed body that is not a JSON object', async () => {
    for (const body of ['not json', '[1,2]', '"text"', 'null']) {
      const r = await send(base, { method: 'POST', path: V2, body });
      expect(r.status, body).toBe(400);
    }
    expect(seen).toEqual([]);
  });

  it('refuses an address with a dot part even when it is signed as sent', async () => {
    // fetch folds "/./" away before sending, so speak to the server directly.
    const path = '/api/sister/v1/companies/./0b9f6d0e-5c56-4a8e-9d55-2f1f5a3c7e11/thing';
    const status = await new Promise<number>((resolve, reject) => {
      const at = Date.now();
      const req = http.request(`${base}${path}`, {
        method: 'GET',
        headers: { 'x-roofli-timestamp': String(at), 'x-roofli-signature': 'a'.repeat(64) },
      }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end();
    });
    expect([401, 404]).toContain(status);
    expect(seen).toEqual([]);
  });
});

describe('the production entry (api/index.ts)', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const { default: handler } = await import('../../../api/index');
    ({ server, base } = await listen((req, res) => { void handler(req as never, res as never); }));
  });
  afterAll(() => { server?.close(); });
  beforeEach(() => { process.env[SISTER_SECRET_ENV] = SECRET; });
  afterEach(() => { delete process.env[SISTER_SECRET_ENV]; });

  const NOWHERE = '/api/sister/v1/companies/0b9f6d0e-5c56-4a8e-9d55-2f1f5a3c7e11/no-such-thing';

  it('hands the raw body to the verifier before anything parses it', async () => {
    // Spacing and key order a JSON round trip would lose. Nothing lives at
    // this address, so a request that passes the signature is answered 404,
    // not 401: that difference is the proof the raw bytes arrived.
    const body = '{ "zeta" : 1,\n  "alpha":   [ 2 ] }';
    const good = await send(base, { method: 'POST', path: NOWHERE, body });
    expect(good.status).toBe(404);
    const tampered = await send(base, { method: 'POST', path: NOWHERE, body, secret: 'another-secret' });
    expect(tampered.status).toBe(401);
    expect(await tampered.text()).toBe('');
  });

  it('does the same for a real endpoint: a signed body that is not a company is refused as one, not as a forgery', async () => {
    const body = '{ "zeta" : 1,\n  "alpha":   [ 2 ] }';
    const good = await send(base, { method: 'POST', path: '/api/sister/v1/companies', body, version: 1 });
    expect(good.status).toBe(400);
    const forged = await send(base, { method: 'POST', path: '/api/sister/v1/companies', body, version: 1, secret: 'another-secret' });
    expect(forged.status).toBe(401);
  });

  it('tells an unsigned caller nothing, not even which addresses exist', async () => {
    for (const path of [NOWHERE, '/api/sister/v1/ready', '/api/sister/v1/companies', '/api/sister']) {
      const r = await fetch(`${base}${path}`);
      expect(r.status, path).toBe(401);
      expect(await r.text()).toBe('');
    }
  });

  it('is shut, bare, while the pair secret is unset', async () => {
    delete process.env[SISTER_SECRET_ENV];
    const r = await send(base, { method: 'POST', path: NOWHERE, body: '{}' });
    expect(r.status).toBe(401);
    expect(await r.text()).toBe('');
  });

  it('answers a sign-in form with the plain refusal page, not the signed door\'s bare 401', async () => {
    const { SSO_REFUSED_PAGE } = await import('../sso');
    const r = await fetch(`${base}/api/sister/v1/sso`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ticket: 'not-a-ticket' }).toString(),
    });
    expect(r.status).toBe(401);
    expect(await r.text()).toBe(SSO_REFUSED_PAGE);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('leaves the rest of the app answering as before', async () => {
    const ping = await fetch(`${base}/api/ping`);
    expect(ping.status).toBe(200);
    // The login route still gets a parsed JSON body and gives its own answer, not the door's bare one.
    const login = await fetch(`${base}/api/auth/login/password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"","password":"x"}' });
    expect(login.status).toBe(401);
    expect(await login.text()).not.toBe('');
  });
});
