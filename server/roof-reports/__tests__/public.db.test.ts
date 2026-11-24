/**
 * The share link (D4), through a real request path on the local test database.
 *
 * A link opens ONE report and only that report's photos, with no sign-in: the
 * long random token in the address is the capability. It can be made and turned
 * off by a person who may share the report, it dies the moment the report is
 * archived, and an unknown, a turned-off and an archived link are the very same
 * plain page with the very same status and headers (one code path). The page is
 * served under the same sandbox and nonce policy as the signed-in view, and is
 * never cached, never indexed and never passes a referrer on.
 * Fictional companies: Summit Ridge Roofing and Cedar Falls Roofing Two.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { setPhotoStoreForTests } from '../../photos/store';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';
import { scanHtml } from '../../lib/roof-reports/__tests__/fixtures/injection';
import { analysis, fakeStorm } from './fakes';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('the share link (database)', async () => {
  const tag = `rrshare-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { liveDeps } = await import('../generate');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { signPhotoLink } = await import('../photo-links');
  const publicLimits = await import('../public');

  const fakeDeps = (reportId: string) => ({
    ...liveDeps(reportId, { keys: {} }),
    storm: async () => fakeStorm(),
    enhancedStorm: (() => ({ noaaEventPageUrls: [], nexradRadarImageUrls: [], countyStormDatabaseUrl: '', narratives: [], propertyProfile: null, hailSizeDistribution: {} })) as any,
    analyze: async () => analysis(),
    narrate: async () => ({ findings: [], executiveSummary: 'A short summary.' }),
    label: async () => null,
    sleep: async () => {},
  });
  // As in production (server/index.ts): one trusted proxy in front, so the address a request counts under is the one the proxy saw.
  const h = await startRoofApp(tag, (app) => { app.set('trust proxy', 1); registerRoofReportsRoutes(app, { deps: fakeDeps }); });
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let a: Co; let b: Co;
  let report = ''; let other = ''; let reportB = '';
  let photos: string[] = []; let photosB: string[] = []; let otherPhotos: string[] = [];
  const GOOD = { reportTypes: ['inspection', 'storm'], template: 'full', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613', customer: { name: 'Dana Whitfield', email: 'dana@example.com' } };
  const TOKEN = /^[0-9a-f]{64}$/;
  const tokenOf = (url: string) => /\/r\/roof\/([0-9a-f]{64})$/.exec(url)?.[1] ?? '';
  const guid = '00000000-0000-4000-8000-0000000000e1';

  async function make(co: Co, who: string, n: number): Promise<{ id: string; photos: string[] }> {
    h.as(co, who);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await h.upload('/api/roof-reports/photos', makeJpeg())).body.id);
    const id = (await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: ids })).body.id;
    return { id, photos: (await h.get(`/api/roof-reports/${id}`)).body.photos.map((p: any) => p.id) };
  }
  /** What a person sees from outside: nothing signed in. */
  const open = async (path: string) => { h.signedOut(); return h.get(path); };
  /** The parts of an answer that must be the same for an unknown, a turned-off and an archived link. */
  const shape = (r: { status: number; text: string; headers: Headers }) => ({
    status: r.status, text: r.text,
    headers: Object.fromEntries(['content-type', 'cache-control', 'referrer-policy', 'x-robots-tag', 'x-content-type-options', 'content-security-policy', 'content-length'].map((k) => [k, r.headers.get(k)])),
  });
  const directive = (policy: string, name: string) => policy.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(`${name} `));

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(fakeStore());
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['csr', 'customer_service'], ['repa', 'sales'], ['repb', 'sales'], ['crew', 'production']]);
    b = await h.company('Cedar Falls Roofing Two', [['admin', 'admin']]);
    const first = await make(a, 'repa', 4); report = first.id; photos = first.photos;
    const second = await make(a, 'admin', 3); other = second.id; otherPhotos = second.photos;
    const third = await make(b, 'admin', 3); reportB = third.id; photosB = third.photos;
    expect(photos).toHaveLength(4);
  });
  beforeEach(() => { __resetRateLimits(); h.as(a, 'repa'); });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  const create = async (id = report) => h.post(`/api/roof-reports/${id}/share-link`);
  const revoke = async (id = report) => h.del(`/api/roof-reports/${id}/share-link`);

  describe('making and turning off a link', () => {
    it('makes a long random link on the app\'s own address, and gives the same link again to whoever asks again', async () => {
      const first = await create();
      expect(first.status).toBe(200);
      expect(first.body.url).toMatch(new RegExp(`^${h.base}/r/roof/[0-9a-f]{64}$`));
      const token = tokenOf(first.body.url);
      expect(token).toMatch(TOKEN);
      const second = await create();
      expect(second.body.url).toBe(first.body.url);
      // A different report gets a different token, and so does a link made after one was turned off (below).
      const another = await create(other);
      expect(tokenOf(another.body.url)).not.toBe(token);
      await revoke(other);
    });

    it('says in the report\'s own answer that a link is on, and never hands the token out there', async () => {
      await create();
      const got = await h.get(`/api/roof-reports/${report}`);
      expect(got.body.shareLinkOn).toBe(true);
      const token = tokenOf((await create()).body.url);
      expect(got.text).not.toContain(token);
      expect(JSON.stringify((await h.get('/api/roof-reports')).body)).not.toContain(token);
      expect(JSON.stringify((await h.get(`/api/roof-reports/${report}`)).body)).not.toContain('shareToken');
    });

    it('turns the link off, says so, and is fine being asked twice', async () => {
      await create();
      const off = await revoke();
      expect(off.status).toBe(200);
      expect(off.body).toEqual({ shareLinkOn: false });
      expect((await h.get(`/api/roof-reports/${report}`)).body.shareLinkOn).toBe(false);
      expect((await revoke()).status).toBe(200);
    });

    it('gives a new, different link after one was turned off, and the old one stays dead', async () => {
      const first = tokenOf((await create()).body.url);
      await revoke();
      const second = tokenOf((await create()).body.url);
      expect(second).not.toBe(first);
      expect((await open(`/r/roof/${first}`)).status).toBe(404);
      expect((await open(`/r/roof/${second}`)).status).toBe(200);
    });

    it('makes a link only for a report that is finished, in a plain sentence', async () => {
      const [row] = await h.runAsCompany(a.id, () => h.db.insert(h.schema.roofReports).values({ address: '1 Main Street', reportTypes: ['storm'], status: 'generating', createdByMemberId: a.people.repa.id } as any).returning());
      const r = await create(row.id);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('A link can be made once the report is finished.');
    });

    it('is for whoever may share the report: the maker, and roles that see everything; not another rep, crew, or another company, who all get "not found"', async () => {
      for (const who of ['repa', 'admin', 'csr'] as const) {
        h.as(a, who);
        expect((await create()).status, who).toBe(200);
        expect((await revoke()).status, who).toBe(200);
      }
      for (const [co, who] of [[a, 'repb'], [a, 'crew'], [b, 'admin']] as Array<[Co, string]>) {
        h.as(co, who);
        const c = await create(); const r = await revoke();
        expect([c.status, r.status], who).toEqual([404, 404]);
        expect(c.text + r.text).not.toMatch(/r\/roof\/[0-9a-f]{64}/);
      }
      h.as(a, 'repa');
      expect((await h.get(`/api/roof-reports/${report}`)).body.shareLinkOn).toBe(false);
    });

    it('records each in the write log without the token', async () => {
      const made = await create();
      const token = tokenOf(made.body.url);
      await revoke();
      const rows = await h.runAsCompany(a.id, () => h.db.select().from(h.schema.writeLog));
      const mine = rows.filter((r: any) => ['roof_report_share_link', 'roof_report_share_link_off'].includes(r.action));
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(rows)).not.toContain(token);
    });
  });

  describe('opening a link', () => {
    let token = '';
    beforeAll(async () => { h.as(a, 'repa'); token = tokenOf((await create()).body.url); });

    it('shows one report with no sign-in, in a sandbox that has no origin of its own, under this response\'s nonce', async () => {
      const r = await open(`/r/roof/${token}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/^text\/html/);
      const policy = r.headers.get('content-security-policy')!;
      expect(directive(policy, 'sandbox')).toBe('sandbox allow-scripts');
      expect(policy).not.toMatch(/allow-same-origin/);
      expect(directive(policy, 'default-src')).toBe("default-src 'none'");
      expect(directive(policy, 'connect-src')).toBe("connect-src 'none'");
      expect(directive(policy, 'form-action')).toBe("form-action 'none'");
      const nonce = /script-src 'nonce-([A-Za-z0-9+/]{24})'$/.exec(directive(policy, 'script-src') ?? '')?.[1];
      expect(nonce).toBeTruthy();
      const scripts = scanHtml(r.text).tags.filter((t) => t.name === 'script');
      expect(scripts.length).toBeGreaterThan(0);
      for (const s of scripts) expect(s.attrs.find((x) => x.name === 'nonce')?.value).toBe(nonce);
      expect(scanHtml(r.text).tags.flatMap((t) => t.attrs.filter((x) => x.name.startsWith('on')))).toEqual([]);
      // A fresh nonce on every response.
      const again = await open(`/r/roof/${token}`);
      expect(/'nonce-([^']+)'/.exec(again.headers.get('content-security-policy')!)?.[1]).not.toBe(nonce);
    });

    it('is never cached, never indexed, never sniffed and never passes a referrer on', async () => {
      const r = await open(`/r/roof/${token}`);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('has the same motion library from the app\'s own address under the nonce, in the classic look, and nothing from outside', async () => {
      h.as(a, 'repa'); await h.put(`/api/roof-reports/${report}`, { visualStyle: 'formal' });
      const r = await open(`/r/roof/${token}`);
      const nonce = /'nonce-([^']+)'/.exec(r.headers.get('content-security-policy')!)![1];
      const external = scanHtml(r.text).tags.filter((t) => t.name === 'script' && t.attrs.some((x) => x.name === 'src'));
      expect(external.map((t) => t.attrs.find((x) => x.name === 'src')!.value)).toEqual([`${h.base}/roof-reports/motion/gsap-3.14.2.min.js`, `${h.base}/roof-reports/motion/ScrollTrigger-3.14.2.min.js`]);
      for (const t of external) expect(t.attrs.find((x) => x.name === 'nonce')?.value).toBe(nonce);
      await h.put(`/api/roof-reports/${report}`, { visualStyle: 'presentation' });
    });

    it('takes its photos only from this report, through addresses that carry the token and nothing else of the app', async () => {
      const r = await open(`/r/roof/${token}`);
      const addresses = [...r.text.matchAll(/(?:https?:\/\/[^"'\s)]+)?\/r\/roof\/[0-9a-f]{64}\/photos\/([0-9a-f-]{36})\/(working|thumb)/g)];
      const named = new Set(addresses.map((m) => m[1]));
      expect(named.size).toBeGreaterThan(0);
      for (const id of named) expect(photos).toContain(id);
      // The signed-in routes and the short signed links are not used on a shared page.
      expect(r.text).not.toMatch(/\/api\/roof-reports\//);
      for (const id of [...otherPhotos, ...photosB, other, reportB]) expect(r.text).not.toContain(id);
    });

    it('serves a photo of the report under the token, with no referrer, no sniffing, no cache and no index', async () => {
      for (const variant of ['working', 'thumb']) {
        const r = await open(`/r/roof/${token}/photos/${photos[0]}/${variant}`);
        expect(r.status, variant).toBe(200);
        expect(r.headers.get('content-type')).toBe('image/jpeg');
        expect(r.headers.get('referrer-policy')).toBe('no-referrer');
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
        expect(r.bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
      }
    });

    it('answers 404, the same plain page, for any photo that is not this report\'s: another report\'s of the same company, another company\'s, one that does not exist, or a bad variant', async () => {
      const unavailable = shape(await open('/r/roof/' + 'f'.repeat(64)));
      for (const path of [
        `/r/roof/${token}/photos/${otherPhotos[0]}/working`,
        `/r/roof/${token}/photos/${photosB[0]}/thumb`,
        `/r/roof/${token}/photos/${guid}/working`,
        `/r/roof/${token}/photos/not-an-id/working`,
        `/r/roof/${token}/photos/${photos[0]}/original`,
      ]) {
        const r = await open(path);
        expect(shape(r), path).toEqual(unavailable);
      }
      // And this report's own photo under another report's link is 404 too.
      h.as(a, 'admin'); const otherToken = tokenOf((await create(other)).body.url);
      expect((await open(`/r/roof/${otherToken}/photos/${photos[0]}/working`)).status).toBe(404);
      expect((await open(`/r/roof/${otherToken}/photos/${otherPhotos[0]}/working`)).status).toBe(200);
      h.as(a, 'admin'); await revoke(other);
    });

    it('holds nothing that belongs to somebody else or to the system: no company id, no staff email or id, no job key, no storage key, no other report', async () => {
      const [row] = await h.runAsCompany(a.id, () => h.db.select().from(h.schema.roofReports).where(eq(h.schema.roofReports.id, report)));
      const keys = await h.runAsCompany(a.id, () => h.db.select().from(h.schema.roofReportPhotos));
      const r = await open(`/r/roof/${token}`);
      const forbidden = [
        a.id, b.id, a.people.repa.email, a.people.admin.email, a.people.repb.email, `c/${a.id}`, '/rr/', 'working_key', 'thumb_key', 'workingKey', 'thumbKey',
        'createdByMemberId', 'created_by', 'idempotency', 'requestHash', 'request_hash', 'model_costs', 'cents', 'shareToken', 'share_token', 'reportJson', other, reportB,
        ...keys.map((k: any) => k.workingKey),
      ];
      for (const mark of forbidden) expect(r.text, mark).not.toContain(mark);
      expect(row.jobExternalId).toBeNull();
      // The token appears only inside the photo addresses.
      const without = r.text.replace(/\/r\/roof\/[0-9a-f]{64}\/photos\//g, '');
      expect(without).not.toMatch(/[0-9a-f]{64}/);
    });

    it('shows the report\'s own words and the company\'s own contact, which the report prints itself', async () => {
      const r = await open(`/r/roof/${token}`);
      expect(r.text).toContain('12 Elm Street');
      expect(r.text).toContain('Summit Ridge Roofing');
    });
  });

  describe('a link that does not open: unknown, turned off and archived are one and the same plain page', () => {
    it('gives the same status, body and headers for all three, and for a token that is not a token', async () => {
      const unknown = shape(await open('/r/roof/' + 'a'.repeat(64)));
      expect(unknown.status).toBe(404);
      expect(unknown.text).toContain('This report is not available.');
      expect(unknown.headers['cache-control']).toBe('no-store');
      expect(unknown.headers['referrer-policy']).toBe('no-referrer');
      expect(unknown.headers['x-robots-tag']).toMatch(/noindex/);
      expect(unknown.text).not.toMatch(/Summit|Cedar|Elm|[0-9a-f]{8}-[0-9a-f]{4}/);

      h.as(a, 'repa');
      const off = tokenOf((await create()).body.url);
      await revoke();
      expect(shape(await open(`/r/roof/${off}`))).toEqual(unknown);

      h.as(a, 'admin');
      const arch = await make(a, 'admin', 3);
      const toBeArchived = tokenOf((await create(arch.id)).body.url);
      expect((await open(`/r/roof/${toBeArchived}`)).status).toBe(200);
      h.as(a, 'admin');
      expect((await h.post(`/api/roof-reports/${arch.id}/archive`)).status).toBe(200);
      expect(shape(await open(`/r/roof/${toBeArchived}`))).toEqual(unknown);
      // Its photos die with it.
      expect(shape(await open(`/r/roof/${toBeArchived}/photos/${arch.photos[0]}/working`))).toEqual(unknown);

      for (const bad of ['short', 'A'.repeat(64), 'g'.repeat(64), '%00', 'a'.repeat(65), 'a'.repeat(300)]) {
        expect(shape(await open(`/r/roof/${bad}`)), bad).toEqual(unknown);
      }
    });

    it('does not open a report that is still being made or could not be finished', async () => {
      const failedToken = randomBytes(32).toString('hex');
      const doingToken = randomBytes(32).toString('hex');
      await h.runAsCompany(a.id, () => h.db.insert(h.schema.roofReports).values([
        { address: '1 Main Street', reportTypes: ['storm'], status: 'failed', shareToken: failedToken },
        { address: '2 Main Street', reportTypes: ['storm'], status: 'generating', shareToken: doingToken },
      ] as any));
      const unknown = shape(await open('/r/roof/' + 'a'.repeat(64)));
      expect(shape(await open(`/r/roof/${failedToken}`))).toEqual(unknown);
      expect(shape(await open(`/r/roof/${doingToken}`))).toEqual(unknown);
    });
  });

  describe('a page a person saved', () => {
    it('is served as saved (no script) with another report\'s photo links taken out and this report\'s turned into the token\'s own', async () => {
      h.as(a, 'repa');
      const token = tokenOf((await create()).body.url);
      const mine = signPhotoLink({ companyId: a.id, reportId: report, photoId: photos[0], variant: 'working' });
      const theirs = signPhotoLink({ companyId: a.id, reportId: other, photoId: otherPhotos[0], variant: 'working' });
      const html = `<!doctype html><html><body><h1>My edit</h1><img src="${h.base}/api/roof-reports/linked-photo/${mine}"><img src="${h.base}/api/roof-reports/linked-photo/${theirs}"></body></html>`;
      expect((await h.put(`/api/roof-reports/${report}`, { editedHtml: html })).status).toBe(200);
      try {
        const r = await open(`/r/roof/${token}`);
        expect(r.status).toBe(200);
        expect(r.text).toContain('<h1>My edit</h1>');
        expect(r.text).toContain(`${h.base}/r/roof/${token}/photos/${photos[0]}/working`);
        expect(r.text).not.toContain(theirs);
        expect(r.text).not.toContain(otherPhotos[0]);
        expect(r.text).not.toContain('/api/roof-reports/linked-photo/');
        const policy = r.headers.get('content-security-policy')!;
        expect(directive(policy, 'sandbox')).toBe('sandbox');
        expect(policy).not.toMatch(/allow-scripts|script-src|nonce/);
        expect(r.headers.get('cache-control')).toBe('no-store');
      } finally {
        h.as(a, 'repa'); await h.put(`/api/roof-reports/${report}`, { editedHtml: null });
      }
    });
  });

  describe('a page saved before links were limited', () => {
    it('is served to the customer with the link to another host taken out', async () => {
      h.as(a, 'repa');
      const token = tokenOf((await create()).body.url);
      const html = '<!doctype html><html><head><link rel="stylesheet" href="https://tracker.example/x.css"></head><body><h1>My edit</h1><a href="https://evil.example/login">Pay now</a><a href="tel:5550100142">Call</a></body></html>';
      await h.runAsCompany(a.id, () => h.db.update(h.schema.roofReports).set({ editedHtml: html }).where(eq(h.schema.roofReports.id, report)));
      try {
        const r = await open(`/r/roof/${token}`);
        expect(r.status).toBe(200);
        expect(r.text).not.toMatch(/evil\.example|tracker\.example/);
        expect(r.text).toContain('Pay now');
        expect(r.text).toContain('href="tel:5550100142"');
        expect(directive(r.headers.get('content-security-policy')!, 'style-src')).toBe("style-src 'unsafe-inline' https://fonts.googleapis.com");
      } finally {
        await h.runAsCompany(a.id, () => h.db.update(h.schema.roofReports).set({ editedHtml: null }).where(eq(h.schema.roofReports.id, report)));
      }
    });
  });

  describe('how often a page may be asked for', () => {
    it('lets one address ask a lot and then answers a plain page to wait, with Retry-After, and counts photos apart from pages', async () => {
      h.as(a, 'repa');
      const token = tokenOf((await create()).body.url);
      __resetRateLimits();
      const first = await open(`/r/roof/${token}`);
      expect(first.status).toBe(200);
      let limited: Awaited<ReturnType<typeof open>> | null = null;
      for (let i = 0; i < 125 && !limited; i++) {
        const r = await open(`/r/roof/${'c'.repeat(64)}`);
        if (r.status === 429) limited = r;
      }
      expect(limited).not.toBeNull();
      expect(limited!.headers.get('retry-after')).toBeTruthy();
      expect(limited!.text).toMatch(/Wait a little|try again/i);
      expect(limited!.text).not.toMatch(/\{|error|[0-9a-f]{8}-/i);
      expect(limited!.headers.get('cache-control')).toBe('no-store');
      expect(limited!.headers.get('x-robots-tag')).toMatch(/noindex/);
      // Photos are counted on their own, so a page that is being looked at still loads its pictures.
      expect((await open(`/r/roof/${token}/photos/${photos[0]}/thumb`)).status).toBe(200);
    }, 60_000);
  });

  describe('one token asked for from many addresses', () => {
    const { PAGE_TOKEN_LIMIT, PHOTO_TOKEN_LIMIT } = publicLimits;
    const from = (i: number, path: string) => { h.signedOut(); return h.send('GET', path, undefined, { headers: { 'x-forwarded-for': `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` } }); };

    it('stops a single token being hammered even when every request comes from a different address, and leaves other tokens and photos alone', async () => {
      h.as(a, 'repa');
      const token = tokenOf((await create()).body.url);
      h.as(b, 'admin');
      const tokenB = tokenOf((await create(reportB)).body.url);
      __resetRateLimits();
      let firstLimited = -1;
      for (let i = 0; i < PAGE_TOKEN_LIMIT + 5; i++) {
        const r = await from(i, `/r/roof/${token}`);
        if (r.status === 429) { firstLimited = i; break; }
        expect(r.status).toBe(200);
      }
      // Each address asked once: only the token's own limit can have said wait, and exactly after its allowance.
      expect(firstLimited).toBe(PAGE_TOKEN_LIMIT);
      const limited = await from(9_999, `/r/roof/${token}`);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBeTruthy();
      expect(limited.text).not.toMatch(/\{|error|[0-9a-f]{64}/i);
      // Another token from a fresh address, and the same token's photos, are not held up by it.
      expect((await from(10_000, `/r/roof/${tokenB}`)).status).toBe(200);
      expect((await from(10_001, `/r/roof/${token}/photos/${photos[0]}/thumb`)).status).toBe(200);
      expect(PHOTO_TOKEN_LIMIT).toBeGreaterThan(PAGE_TOKEN_LIMIT);
    }, 120_000);

    it('keys the limit on the token without keeping the token itself, so a bucket name is never a credential', async () => {
      const { tokenBucketKey } = publicLimits;
      const t = 'a'.repeat(64);
      expect(tokenBucketKey(t)).not.toContain(t);
      expect(tokenBucketKey(t)).toBe(tokenBucketKey(t));
      expect(tokenBucketKey(t)).not.toBe(tokenBucketKey('b'.repeat(64)));
      expect(tokenBucketKey(undefined)).toBe(tokenBucketKey('not a token'));
    });
  });

  describe('the switch', () => {
    it('is a bare 404 on every share route while off, nothing is changed, and the link works again when it is back on', async () => {
      h.as(a, 'repa');
      const token = tokenOf((await create()).body.url);
      process.env.ARCHIE_ROOF_REPORTS = 'off';
      try {
        for (const [method, path] of [['GET', `/r/roof/${token}`], ['GET', `/r/roof/${token}/photos/${photos[0]}/thumb`], ['POST', `/api/roof-reports/${report}/share-link`], ['DELETE', `/api/roof-reports/${report}/share-link`]] as const) {
          h.as(a, 'repa');
          const r = await h.send(method, path);
          expect(r.status, `${method} ${path}`).toBe(404);
          expect(r.text, `${method} ${path}`).toBe('');
        }
      } finally { process.env.ARCHIE_ROOF_REPORTS = 'on'; }
      expect((await open(`/r/roof/${token}`)).status).toBe(200);
    });
  });
});
