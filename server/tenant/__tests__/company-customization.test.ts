/**
 * The Company page through the real request path: session, company
 * middleware, roster re-check, route, database (row level security on).
 * Two companies: what Alpha's admin saves changes Alpha and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const url = process.env.DATABASE_URL || '';
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

// A real 1x1 PNG, and the start of a JPEG and a WebP.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5b1d9460000000049454e44ae426082', 'hex');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(24, 0)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

describe('sniffImageType', async () => {
  const { sniffImageType, checkLogo, MAX_LOGO_BYTES } = await import('../../company/logo');
  it('knows PNG, JPEG and WebP by their bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });
  it('refuses SVG, HTML and anything else', () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(HTML)).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImageType(Buffer.from('RIFF0000WAVE'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
  it('limits the size', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);
    expect(checkLogo(big)).toMatchObject({ ok: false, status: 413 });
    expect(checkLogo(PNG)).toEqual({ ok: true, type: 'image/png' });
  });
});

describe('validateCustomization', async () => {
  const { validateCustomization } = await import('../../company/settings');
  it('accepts only the three keys', () => {
    expect(validateCustomization({ logoUrl: 'https://evil.test/x.png' }).ok).toBe(false);
    expect(validateCustomization({ primaryColor: '#123456', phone: '1' }).ok).toBe(false);
    expect(validateCustomization({ companyId: 'x' }).ok).toBe(false);
  });
  it('refuses colors that are not #RRGGBB', () => {
    for (const bad of ['red', '#fff', '#12345G', '123456', 12, '#1234567']) {
      expect(validateCustomization({ primaryColor: bad }).ok).toBe(false);
      expect(validateCustomization({ accentColor: bad }).ok).toBe(false);
    }
  });
  it('darkens a main color white text cannot be read on, and says so', () => {
    const r = validateCustomization({ primaryColor: '#FFE066' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.adjusted?.from).toBe('#FFE066');
      expect(r.patch.primaryColor).toBe(r.adjusted?.to);
    }
    const ok = validateCustomization({ primaryColor: '#14532d' });
    expect(ok).toMatchObject({ ok: true, adjusted: null, patch: { primaryColor: '#14532D' } });
  });
});

describe.skipIf(!local)('Company page API', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../context');
  const { createCompany } = await import('../companies');
  const { tenantFromSession } = await import('../middleware');
  const { registerAuthRoutes } = await import('../../auth/routes');
  const { registerCompanyRoutes } = await import('../../company/routes');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { clearProfileCache } = await import('../profile');

  const tag = `co-page-${process.pid}-${Date.now()}`;
  const adminA = `${tag}-admin-a@example.test`;
  const repA = `${tag}-rep-a@example.test`;
  const adminB = `${tag}-admin-b@example.test`;
  const repB = `${tag}-rep-b@example.test`;
  let a = '';
  let b = '';
  let server: Server;
  let base = '';
  let sessionUser: Record<string, unknown> | undefined;

  const brandingB = { phone: '(555) 010-2222', primaryColor: '#7F1D1D', tagline: 'Bravo since 1990' };
  const settingsB = { credentials: ['Fully insured'], menuHidden: { sales: ['canvass'] } };

  beforeAll(async () => {
    process.env.APP_BASE_URL = 'https://app.example.test';
    a = (await createCompany({
      slug: `${tag}-a`, name: 'Alpha Roofing', status: 'active',
      branding: { phone: '(555) 010-1111', tagline: 'Alpha tagline', legalName: 'Alpha Roofing LLC', accentColor: '#C9A04B' },
      settings: { credentials: ['GAF Master Elite'], timeZone: 'America/Chicago', workmanshipYears: 10 },
    })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Bravo Roofing', status: 'active', branding: brandingB, settings: settingsB })).id;
    await runAsCompany(a, () => db.insert(schema.teamMembers).values([
      { name: 'Admin A', email: adminA, role: 'admin', canLogin: true },
      { name: 'Rep A', email: repA, role: 'sales', canLogin: true },
    ]));
    await runAsCompany(b, () => db.insert(schema.teamMembers).values([
      { name: 'Admin B', email: adminB, role: 'admin', canLogin: true },
      { name: 'Rep B', email: repB, role: 'sales', canLogin: true },
    ]));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = {
        user: sessionUser,
        destroy: (cb: () => void) => { req.session.user = undefined; cb(); },
        regenerate: (cb: (e?: unknown) => void) => cb(),
        save: (cb: (e?: unknown) => void) => cb(),
      };
      next();
    });
    app.use(tenantFromSession);
    registerAuthRoutes(app);
    registerCompanyRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    delete process.env.APP_BASE_URL;
    await runAsSystem('test cleanup', async () => {
      for (const id of [a, b]) {
        await db.delete(schema.teamMembers).where(eq(schema.teamMembers.companyId, id));
        await db.delete(schema.companyAssets).where(eq(schema.companyAssets.companyId, id));
      }
    });
  });

  const as = (email: string, companyId: string, role = 'admin') => {
    clearSessionRevalidationCache();
    clearProfileCache();
    sessionUser = { email, name: 'x', role, companyId };
  };
  const put = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const putLogo = (bytes: Buffer, type = 'image/png') => fetch(`${base}/api/company/logo`, {
    method: 'PUT', headers: { 'Content-Type': type }, body: new Uint8Array(bytes),
  });
  const row = async (id: string) => (await runAsSystem('test read', () => db.select().from(schema.companies).where(eq(schema.companies.id, id))))[0];

  it('is for admins only', async () => {
    as(repA, a, 'sales');
    expect((await fetch(`${base}/api/company/settings`)).status).toBe(403);
    expect((await put('/api/company/settings', { primaryColor: '#14532D' })).status).toBe(403);
    expect((await putLogo(PNG)).status).toBe(403);
    expect((await fetch(`${base}/api/company/logo`, { method: 'DELETE' })).status).toBe(403);
    sessionUser = undefined;
    expect((await fetch(`${base}/api/company/settings`)).status).toBe(401);
  });

  it('refuses bad input with 400 and changes nothing', async () => {
    as(adminA, a);
    const before = await row(a);
    for (const body of [
      { primaryColor: 'green' },
      { accentColor: '#abc' },
      { logoUrl: 'https://evil.test/x.png' },
      { companyId: b, primaryColor: '#14532D' },
      { menuHidden: { owner: ['kpis'] } },
      { menuHidden: { sales: ['not-a-page'] } },
      { menuHidden: { sales: ['team'] } },
      { menuHidden: { admin: ['company'] } },
      { menuHidden: { admin: ['team'] } },
      { menuHidden: { admin: ['integrations'] } },
    ]) {
      const r = await put('/api/company/settings', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await r.json()).error).toBe('string');
    }
    const after = await row(a);
    expect(after.branding).toEqual(before.branding);
    expect(after.settings).toEqual(before.settings);
  });

  it("saves the admin's own company only, and keeps every other key", async () => {
    as(adminA, a);
    const r = await put('/api/company/settings', { primaryColor: '#14532d', accentColor: '#f59e0b', menuHidden: { sales: ['kpis'] } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ primaryColor: '#14532D', accentColor: '#F59E0B', menuHidden: { sales: ['kpis'] }, adjusted: null });

    const rowA = await row(a);
    expect(rowA.branding).toEqual({
      phone: '(555) 010-1111', tagline: 'Alpha tagline', legalName: 'Alpha Roofing LLC', accentColor: '#F59E0B', primaryColor: '#14532D',
    });
    expect(rowA.settings).toEqual({ credentials: ['GAF Master Elite'], timeZone: 'America/Chicago', workmanshipYears: 10, menuHidden: { sales: ['kpis'] } });

    // Bravo is exactly as it was created.
    const rowB = await row(b);
    expect(rowB.branding).toEqual(brandingB);
    expect(rowB.settings).toEqual(settingsB);
    as(adminB, b);
    const meB = await (await fetch(`${base}/api/auth/me`)).json();
    expect(meB.profile).toMatchObject({ id: b, brandPrimary: '#7F1D1D', brandAccent: '', logoUrl: '', phone: '(555) 010-2222' });
    as(repB, b, 'sales');
    const meRepB = await (await fetch(`${base}/api/auth/me`)).json();
    expect(meRepB.profile.hiddenPages).toEqual(['canvass']);
  });

  it('carries the colors and the level\'s hidden pages on the profile', async () => {
    as(repA, a, 'sales');
    const me = await (await fetch(`${base}/api/auth/me`)).json();
    expect(me.profile).toMatchObject({ id: a, brandPrimary: '#14532D', brandAccent: '#F59E0B', hiddenPages: ['kpis'] });
    expect(me.profile.colors.primary).toBe('#14532D');
    as(adminA, a);
    expect((await (await fetch(`${base}/api/auth/me`)).json()).profile.hiddenPages).toEqual([]);
  });

  it('darkens a main color too light for white text and says it did', async () => {
    as(adminA, a);
    const r = await (await put('/api/company/settings', { primaryColor: '#FFE066' })).json();
    expect(r.adjusted.from).toBe('#FFE066');
    expect(r.primaryColor).toBe(r.adjusted.to);
    expect((await row(a)).branding.primaryColor).toBe(r.adjusted.to);
  });

  it('clears a color with null, leaving the rest', async () => {
    as(adminA, a);
    const r = await (await put('/api/company/settings', { primaryColor: null })).json();
    expect(r.primaryColor).toBeNull();
    expect(r.accentColor).toBe('#F59E0B');
    const rowA = await row(a);
    expect(rowA.branding).not.toHaveProperty('primaryColor');
    expect(rowA.branding.phone).toBe('(555) 010-1111');
  });

  it('refuses a logo that is not really an image, whatever it is called', async () => {
    as(adminA, a);
    for (const bytes of [SVG, HTML]) {
      const r = await putLogo(bytes, 'image/png');
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/PNG, JPEG or WebP/);
    }
    const svgTyped = await putLogo(SVG, 'image/svg+xml');
    expect(svgTyped.status).toBe(400);
    expect((await row(a)).branding).not.toHaveProperty('logoUrl');
  });

  it('refuses a logo over 300 KB', async () => {
    as(adminA, a);
    const r = await putLogo(Buffer.concat([PNG, Buffer.alloc(301 * 1024)]));
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/300 KB/);
    // Far over: refused while reading, same answer.
    const huge = await putLogo(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));
    expect(huge.status).toBe(413);
  });

  it('stores a logo, serves only that company\'s, and removes it', async () => {
    as(adminA, a);
    const r = await putLogo(PNG, 'application/octet-stream');
    expect(r.status).toBe(200);
    const { logoUrl } = await r.json();
    expect(logoUrl).toMatch(new RegExp(`^https://app\\.example\\.test/api/public/company/${a}/logo\\?v=[0-9a-f]{16}$`));
    expect((await row(a)).branding.logoUrl).toBe(logoUrl);
    expect((await row(b)).branding).toEqual(brandingB);

    // Public: no session at all.
    sessionUser = undefined;
    const path = logoUrl.replace('https://app.example.test', '');
    const img = await fetch(`${base}${path}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(img.headers.get('cache-control')).toMatch(/immutable/);
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);

    // Bravo has no logo: its address finds nothing, even signed in as Alpha.
    as(adminA, a);
    expect((await fetch(`${base}/api/public/company/${b}/logo`)).status).toBe(404);
    expect((await fetch(`${base}/api/public/company/not-a-company/logo`)).status).toBe(404);
    expect((await fetch(`${base}/api/public/company/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/logo`)).status).toBe(404);

    // Bravo uploads its own; each address returns its own company's bytes.
    as(adminB, b);
    const rb = await (await putLogo(JPEG, 'image/png')).json();
    expect(rb.logoUrl).toContain(`/company/${b}/`);
    sessionUser = undefined;
    const imgB = await fetch(`${base}/api/public/company/${b}/logo`);
    expect(imgB.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await imgB.arrayBuffer()).equals(JPEG)).toBe(true);
    const imgA = await fetch(`${base}/api/public/company/${a}/logo`);
    expect(Buffer.from(await imgA.arrayBuffer()).equals(PNG)).toBe(true);

    as(adminA, a);
    const del = await fetch(`${base}/api/company/logo`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await del.json()).logoUrl).toBeNull();
    expect((await row(a)).branding).not.toHaveProperty('logoUrl');
    expect((await fetch(`${base}/api/public/company/${a}/logo`)).status).toBe(404);
    // Bravo's logo is untouched.
    expect((await fetch(`${base}/api/public/company/${b}/logo`)).status).toBe(200);
    expect((await row(b)).branding.logoUrl).toBe(rb.logoUrl);
  });
});
