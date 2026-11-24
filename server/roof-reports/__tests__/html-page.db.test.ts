/**
 * The report page route (GET /api/roof-reports/:id/html), through a real
 * request path against the local test database: the page runs only its own
 * scripts, under a nonce that is fresh for every response.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPhotoStoreForTests } from '../../photos/store';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';
import { scanHtml } from '../../lib/roof-reports/__tests__/fixtures/injection';
import { analysis, fakeStorm } from './fakes';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('the report page route (database)', async () => {
  const tag = `rrpage-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { liveDeps } = await import('../generate');
  const { __resetRateLimits } = await import('../../lib/rate-limit');

  const fakeDeps = (reportId: string) => ({
    ...liveDeps(reportId, { keys: {} }),
    storm: async () => fakeStorm(),
    enhancedStorm: (() => ({ noaaEventPageUrls: [], nexradRadarImageUrls: [], countyStormDatabaseUrl: '', narratives: [], propertyProfile: null, hailSizeDistribution: {} })) as any,
    analyze: async () => analysis(),
    narrate: async () => ({ findings: [], executiveSummary: 'A short summary.' }),
    label: async () => null,
    sleep: async () => {},
  });
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, { deps: fakeDeps }));
  const store = fakeStore();
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let co: Co; let id = '';

  const GOOD = { reportTypes: ['inspection', 'storm'], template: 'full', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613' };
  const directive = (policy: string, name: string) => policy.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(`${name} `));
  const page = (reportId = id) => h.get(`/api/roof-reports/${reportId}/html`);
  const nonceIn = (policy: string) => /script-src 'nonce-([A-Za-z0-9+/]{24})'$/.exec(directive(policy, 'script-src') ?? '')?.[1];

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(store);
    co = await h.company('Summit Ridge Roofing', [['rep', 'sales']]);
    h.as(co, 'rep');
    const photos: string[] = [];
    for (let i = 0; i < 4; i++) photos.push((await h.upload('/api/roof-reports/photos', makeJpeg())).body.id);
    id = (await h.post('/api/roof-reports/generate', { ...GOOD, photoIds: photos })).body.id;
  });
  beforeEach(() => { __resetRateLimits(); h.as(co, 'rep'); });
  afterEach(() => { process.env.ARCHIE_ROOF_REPORTS = 'on'; });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  for (const style of ['formal', 'presentation', 'flight'] as const) {
    describe(`the ${style} page`, () => {
      beforeEach(async () => { await h.put(`/api/roof-reports/${id}`, { visualStyle: style }); });

      it('carries a nonce in its policy that every script in it carries too', async () => {
        const r = await page();
        expect(r.status).toBe(200);
        if (style !== 'formal') expect(r.text).toContain('ScrollCraft.mount');
        const policy = r.headers.get('content-security-policy')!;
        const nonce = nonceIn(policy);
        expect(nonce, policy).toBeTruthy();
        const scripts = scanHtml(r.text).tags.filter((t) => t.name === 'script');
        expect(scripts.length).toBeGreaterThan(0);
        for (const s of scripts) expect(s.attrs.find((a) => a.name === 'nonce')?.value).toBe(nonce);
        // No inline event handler anywhere: a nonce policy would not let it run.
        expect(scanHtml(r.text).tags.flatMap((t) => t.attrs.filter((a) => a.name.startsWith('on')))).toEqual([]);
      });

      it('loads the classic page\'s motion library from the app\'s own address, each file under the nonce, and the policy lets nothing else run', async () => {
    await h.put(`/api/roof-reports/${id}`, { visualStyle: 'formal' });
    const r = await page();
    const policy = r.headers.get('content-security-policy')!;
    const nonce = nonceIn(policy);
    const external = scanHtml(r.text).tags.filter((t) => t.name === 'script' && t.attrs.some((a) => a.name === 'src'));
    expect(external.map((t) => t.attrs.find((a) => a.name === 'src')!.value)).toEqual([
      `${h.base}/roof-reports/motion/gsap-3.14.2.min.js`, `${h.base}/roof-reports/motion/ScrollTrigger-3.14.2.min.js`,
    ]);
    for (const t of external) expect(t.attrs.find((a) => a.name === 'nonce')?.value).toBe(nonce);
    // The policy is the same: the nonce and nothing else, so an outside address would not run.
    expect(directive(policy, 'script-src')).toBe(`script-src 'nonce-${nonce}'`);
    expect(r.text).not.toContain('cdn.jsdelivr.net');
    await h.put(`/api/roof-reports/${id}`, { visualStyle: 'presentation' });
    const p2 = await page();
    expect(scanHtml(p2.text).tags.filter((t) => t.name === 'script' && t.attrs.some((a) => a.name === 'src'))).toEqual([]);
  });

  it('has a fresh nonce on every response, in the policy and in the page', async () => {
        const first = await page();
        const second = await page();
        const n1 = nonceIn(first.headers.get('content-security-policy')!);
        const n2 = nonceIn(second.headers.get('content-security-policy')!);
        expect(n1).toBeTruthy(); expect(n2).toBeTruthy();
        expect(n1).not.toBe(n2);
        expect(first.text).not.toContain(n2!);
        expect(second.text).not.toContain(n1!);
      });
    });
  }

  it('is served with a policy that lets no other script, connection, form or image host in', async () => {
    const r = await page();
    const policy = r.headers.get('content-security-policy')!;
    expect(directive(policy, 'sandbox')).toBe('sandbox allow-scripts');
    expect(policy).not.toMatch(/allow-same-origin/);
    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
    expect(directive(policy, 'connect-src')).toBe("connect-src 'none'");
    expect(directive(policy, 'form-action')).toBe("form-action 'none'");
    expect(directive(policy, 'script-src')).not.toMatch(/unsafe-inline|https?:|\*/);
    const img = directive(policy, 'img-src')!;
    expect(img).toContain(h.base);
    expect(img).toMatch(/\bdata:/);
    expect(img).toMatch(/\bblob:/);
    expect(img).not.toMatch(/\bhttps:|\*/);
  });

  it('is not cached, not sniffed and never sends a referrer', async () => {
    const r = await page();
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });

  it('serves a photo from its short link with no referrer and no sniffing, and the link runs out after ten minutes', async () => {
    await h.put(`/api/roof-reports/${id}`, { visualStyle: 'formal' });
    const r = await page();
    const token = /\/api\/roof-reports\/linked-photo\/([A-Za-z0-9_.-]+)/.exec(r.text)?.[1];
    expect(token).toBeTruthy();
    h.signedOut();
    const img = await h.get(`/api/roof-reports/linked-photo/${token}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('referrer-policy')).toBe('no-referrer');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(img.headers.get('cache-control')).toMatch(/^private,/);
    // The longest it may work: the pictures of a long page load as the reader scrolls to them.
    const { LINK_TTL_SECONDS, verifyPhotoLink } = await import('../photo-links');
    expect(LINK_TTL_SECONDS).toBe(600);
    expect(verifyPhotoLink(token, Date.now() + 599_000)).not.toBeNull();
    expect(verifyPhotoLink(token, Date.now() + 601_000)).toBeNull();
  });

  it('serves a saved page as strictly as before: no script, no nonce, and the same image and header rules', async () => {
    await h.put(`/api/roof-reports/${id}`, { editedHtml: '<!doctype html><html><body><h1>My edit</h1></body></html>' });
    const r = await page();
    expect(r.status).toBe(200);
    expect(r.text).toContain('<h1>My edit</h1>');
    const policy = r.headers.get('content-security-policy')!;
    expect(directive(policy, 'sandbox')).toBe('sandbox');
    expect(policy).not.toMatch(/allow-scripts|script-src|nonce/);
    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
    expect(directive(policy, 'img-src')).not.toMatch(/\bhttps:|\*/);
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    await h.put(`/api/roof-reports/${id}`, { editedHtml: null });
  });
});
