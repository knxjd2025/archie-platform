/**
 * Photos of a job Archie keeps itself, through the real request path:
 * session, company, route, database (docs/archie/02-roof-lee-link.md,
 * "Archie's own jobs", Photos).
 *
 * The photo store is an in-memory fake (setPhotoStoreForTests): no test ever
 * makes a real store client. Every JobTread and KynexPro client throws if it
 * is even made, and every request leaving Archie is refused and recorded.
 *
 * Holds: what is stored carries no location; every copy sits under its own
 * company's prefix; another company, a salesperson who does not own the job
 * and a crew all get 404 on everything; only the right people change or
 * delete a photo; the store switched off answers 503 in plain words; and the
 * original JobTread company's photos still come from JobTread.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { makeJpeg, cleanJpegFixture } from './jpeg-fixtures';

const calls = vi.hoisted(() => {
  const state = { jobtread: [] as string[], kynexPro: [] as string[], mode: 'throw' as 'throw' | 'ok' };
  const answers: Record<string, (...args: any[]) => unknown> = {
    getJobFiles: () => ({ files: [], total: 0 }),
    uploadJobFile: () => ({ ok: true, fileId: 'jt-file-1' }),
  };
  const watched = (kind: 'jobtread' | 'kynexPro') => class {
    constructor() {
      state[kind].push('new');
      return new Proxy(this, {
        get: (_target, prop) => {
          if (typeof prop !== 'string' || prop === 'then') return undefined;
          return (...args: unknown[]) => {
            state[kind].push(prop);
            if (state.mode === 'throw') throw new Error(`${kind}.${prop} must not be called for a job Archie keeps`);
            const answer = answers[prop];
            return Promise.resolve(answer ? answer(...args) : { ok: true });
          };
        },
      });
    }
  };
  return { state, watched };
});

vi.mock('../../integrations/jobtread', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/jobtread')>();
  return { ...real, JobTreadClient: calls.watched('jobtread') };
});
vi.mock('../../integrations/gohighlevel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../integrations/gohighlevel')>();
  return { ...real, GoHighLevelClient: calls.watched('kynexPro') };
});
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));
vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));

const url = process.env.DATABASE_URL || '';
const localDb = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

/** SQLSTATE of a failed query (drizzle wraps pg errors in .cause). */
const sqlState = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');

describe.skipIf(!localDb)('photos of a job Archie keeps', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { and, eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearProfileCache } = await import('../../tenant/profile');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { registerRoutes } = await import('../../routes');
  const { isNativeJobId } = await import('../../production/native-jobs');
  const { setPhotoStoreForTests } = await import('../store');
  const { PHOTO_STORE_OFF, EDIT_NOT_ALLOWED, DELETE_NOT_ALLOWED, PHOTO_UNREADABLE, PHOTO_NOT_JPEG, PICK_PHASE } = await import('../native');

  const tag = `photos-${process.pid}-${Date.now()}`;
  type Role = 'admin' | 'customer_service' | 'sales' | 'sales_director' | 'production';
  interface Person { id: number; email: string; name: string; role: Role }
  interface Co { id: string; people: Record<string, Person> }

  /** The fake store: what was put, by key. */
  const stored = new Map<string, Buffer>();
  let storeFails = false;
  const fakeStore = {
    put: async (key: string, body: Buffer) => {
      if (storeFails) throw Object.assign(new Error('store down'), { name: 'ServiceUnavailable' });
      stored.set(key, Buffer.from(body));
    },
    get: async (key: string) => {
      const b = stored.get(key);
      return b ? { body: Readable.from(b), length: b.length } : null;
    },
  };

  let server: Server;
  let base = '';
  let sessionUser: Record<string, unknown> | undefined;
  let outside: string[] = [];
  let a: Co; let b: Co; let original: Co;

  async function company(name: string, roofLee: boolean, people: Array<[string, Role]>): Promise<Co> {
    const c = await createCompany({ slug: `${tag}-${name.toLowerCase().replace(/\W+/g, '-')}`, name, status: 'active' });
    if (roofLee) {
      await runAsSystem('test: a company Roof Lee made', () => db.update(schema.companies).set({ roofliCompanyId: randomUUID() }).where(eq(schema.companies.id, c.id)));
      clearProfileCache(c.id);
    }
    const made: Record<string, Person> = {};
    for (const [key, role] of people) {
      const email = `${tag}-${c.id.slice(0, 8)}-${key}@example.test`;
      const display = `${key[0].toUpperCase()}${key.slice(1)} ${name.split(' ')[0]}`;
      const [row] = await runAsCompany(c.id, () => db.insert(schema.teamMembers).values({ name: display, email, role, canLogin: true, active: true, jobtreadSalesRep: roofLee ? null : `Rep ${key}` }).returning());
      made[key] = { id: row.id, email, name: display, role };
    }
    return { id: c.id, people: made };
  }

  beforeAll(async () => {
    a = await company('Summit Ridge Roofing', true, [
      ['owner', 'admin'], ['office', 'customer_service'], ['director', 'sales_director'], ['rep', 'sales'], ['rep2', 'sales'], ['crew', 'production'],
    ]);
    b = await company('Cedar Falls Roofing', true, [['owner', 'admin'], ['rep', 'sales']]);
    original = await company('Cedar Falls Exteriors', false, [['owner', 'admin'], ['rep', 'sales']]);

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use((req: any, _res, next) => {
      req.session = { user: sessionUser, destroy: (cb: () => void) => { req.session.user = undefined; cb(); } };
      next();
    });
    app.use(tenantFromSession);
    registerRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setPhotoStoreForTests(fakeStore);
  });
  afterAll(() => { setPhotoStoreForTests(null); server?.close(); });

  beforeEach(() => {
    calls.state.jobtread.length = 0; calls.state.kynexPro.length = 0; calls.state.mode = 'throw';
    storeFails = false;
    setPhotoStoreForTests(fakeStore);
    const real = globalThis.fetch;
    outside = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const u = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!u.startsWith(base)) { outside.push(u); return Promise.reject(new Error('no outside calls in tests')); }
      return real(input, init);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const as = (c: Co, who: string) => {
    clearSessionRevalidationCache();
    const p = c.people[who];
    sessionUser = { email: p.email, name: p.name, role: p.role, companyId: c.id };
    return p;
  };
  const send = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, redirect: 'manual', headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const get = (path: string) => send('GET', path);
  const post = (path: string, body: unknown) => send('POST', path, body);
  const patch = (path: string, body: unknown) => send('PATCH', path, body);
  const del = (path: string) => send('DELETE', path);
  /** The raw answer of a photo fetch, never following a redirect. */
  const fetchPhoto = async (path: string) => {
    const r = await fetch(`${base}${path}`, { redirect: 'manual' });
    return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
  };

  const nothingLeftArchie = () => {
    expect(calls.state.jobtread).toEqual([]);
    expect(calls.state.kynexPro).toEqual([]);
    expect(outside).toEqual([]);
  };

  /** A fresh lead of company A, made on the lead form by its rep (so the rep owns it). */
  const nativeLead = async (c: Co = a) => {
    as(c, 'rep');
    const r = await post('/api/leads/create', { firstName: 'Pat', lastName: 'Hollis', phone: '(319) 555-0142', address: '12 Main St', city: 'Cedar Falls', state: 'IA' });
    expect(r.status).toBe(200);
    expect(isNativeJobId(r.body.jobId)).toBe(true);
    return r.body.jobId as string;
  };
  const b64 = (buf: Buffer) => buf.toString('base64');
  /** A photo added by company A's rep, with a GPS Exif block in both copies. */
  const addPhoto = async (key: string, over: Record<string, unknown> = {}) => {
    as(a, 'rep');
    const r = await post(`/api/clients/${key}/photos`, {
      base64: `data:image/jpeg;base64,${b64(makeJpeg({ exif: true, app13: true, comment: true }))}`,
      thumbBase64: b64(makeJpeg({ exif: true, width: 400, height: 300 })),
      contentType: 'image/jpeg', phase: 'before', category: 'roof', caption: 'North slope', takenAt: '2026-11-18T09:30:00Z', ...over,
    });
    expect(r.status).toBe(200);
    return r.body as { ok: true; fileId: string; name: string };
  };
  const photoRow = async (c: Co, id: string) =>
    (await runAsCompany(c.id, () => db.select().from(schema.jobPhotos).where(eq(schema.jobPhotos.id, id))))[0];

  // ---------------------------------------------------------------- the table

  describe('the table', () => {
    it('keeps every stored copy under the row\'s own company prefix', async () => {
      const key = await nativeLead();
      const elsewhere = `c/${b.id}/p/${randomUUID()}/working.jpg`;
      const mine = `c/${a.id}/p/${randomUUID()}/working.jpg`;
      const insert = (values: Record<string, unknown>) => runAsCompany(a.id, () =>
        db.insert(schema.jobPhotos).values({ jobKey: key, uploadedBy: 'test', ...values } as any));
      expect(await sqlState(insert({ workingKey: elsewhere }))).toBe('23514');
      expect(await sqlState(insert({ thumbKey: `c/${b.id}/p/x/thumb.jpg` }))).toBe('23514');
      expect(await sqlState(insert({ originalKey: 'photos/anywhere.jpg' }))).toBe('23514');
      expect(await sqlState(insert({ workingKey: mine }))).toBeNull();
    });

    it('never holds a ready photo without its working copy', async () => {
      const key = await nativeLead();
      const insert = (values: Record<string, unknown>) => runAsCompany(a.id, () =>
        db.insert(schema.jobPhotos).values({ jobKey: key, uploadedBy: 'test', ...values } as any));
      expect(await sqlState(insert({ status: 'ready' }))).toBe('23514');
      expect(await sqlState(insert({ status: 'ready', workingKey: `c/${a.id}/p/${randomUUID()}/working.jpg` }))).toBeNull();
      expect(await sqlState(insert({ phase: 'someday' }))).toBe('23514');
      expect(await sqlState(insert({ caption: 'x'.repeat(501) }))).toBe('23514');
      expect(await sqlState(insert({ source: 'somewhere' }))).toBe('23514');
    });
  });

  // ---------------------------------------------------------------- adding and reading

  describe('adding and reading', () => {
    it('stores a copy with no location, under the company\'s prefix, and says so in the checklist\'s shape', async () => {
      const key = await nativeLead();
      const added = await addPhoto(key);
      expect(added).toEqual({ ok: true, fileId: expect.any(String), name: 'North slope' });

      const row = await photoRow(a, added.fileId);
      expect(row).toMatchObject({ jobKey: key, status: 'ready', phase: 'before', category: 'roof', caption: 'North slope', source: 'archie_app',
        width: 1600, height: 1200, uploadedBy: a.people.rep.email, uploadedByName: a.people.rep.name });
      expect(row.takenAt?.toISOString()).toBe('2026-11-18T09:30:00.000Z');
      expect(row.workingKey).toBe(`c/${a.id}/p/${row.id}/working.jpg`);
      expect(row.thumbKey).toBe(`c/${a.id}/p/${row.id}/thumb.jpg`);
      for (const k of [row.workingKey!, row.thumbKey!]) {
        const bytes = stored.get(k)!;
        expect(bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
        expect(bytes.includes(Buffer.from('GPS', 'latin1'))).toBe(false);
        expect([bytes[0], bytes[1], bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
      }
      expect(stored.get(row.workingKey!)!.equals(cleanJpegFixture())).toBe(true);

      const [log] = await runAsCompany(a.id, () => db.select().from(schema.writeLog)
        .where(and(eq(schema.writeLog.targetId, key), eq(schema.writeLog.action, 'upload_photo'))));
      expect(log).toMatchObject({ actor: a.people.rep.email, system: 'archie', ok: true });
      nothingLeftArchie();
    });

    it('lists ready photos newest first, a page at a time, in today\'s shape with what Archie keeps added', async () => {
      const key = await nativeLead();
      const first = await addPhoto(key, { caption: 'First', phase: 'before' });
      const second = await addPhoto(key, { caption: 'Second', phase: 'during', category: 'materials' });
      const third = await addPhoto(key, { caption: '', phase: 'after', category: '', takenAt: undefined });
      // A photo still pending (its copy never finished) is not listed.
      await runAsCompany(a.id, () => db.insert(schema.jobPhotos).values({ jobKey: key, uploadedBy: 'test', status: 'pending' }));

      const all = await get(`/api/clients/${key}/photos`);
      expect(all.status).toBe(200);
      expect(all.body.totalFiles).toBe(3);
      expect(all.body.nextBefore).toBeNull();
      expect(all.body.photos.map((p: any) => p.id)).toEqual([third.fileId, second.fileId, first.fileId]);
      expect(all.body.photos[0]).toEqual({
        id: third.fileId, name: 'After photo', url: `/api/photos/${third.fileId}/working`, thumbUrl: `/api/photos/${third.fileId}/thumb`,
        description: null, createdAt: expect.any(String), phase: 'after', category: null, caption: null, takenAt: null,
        width: 1600, height: 1200, uploadedByName: a.people.rep.name, mayEdit: true, mayDelete: true,
      });
      expect(all.body.photos[1]).toMatchObject({ caption: 'Second', description: 'Second', phase: 'during', category: 'materials' });

      const page1 = await get(`/api/clients/${key}/photos?limit=2`);
      expect(page1.body.photos.map((p: any) => p.id)).toEqual([third.fileId, second.fileId]);
      expect(page1.body.nextBefore).toBe(second.fileId);
      const page2 = await get(`/api/clients/${key}/photos?limit=2&before=${page1.body.nextBefore}`);
      expect(page2.body.photos.map((p: any) => p.id)).toEqual([first.fileId]);
      expect(page2.body.nextBefore).toBeNull();

      const after = await get(`/api/clients/${key}/photos?phase=after`);
      expect(after.body).toMatchObject({ totalFiles: 1, nextBefore: null });
      expect(after.body.photos.map((p: any) => p.id)).toEqual([third.fileId]);
      // A phase that is not one of the three filters nothing.
      expect((await get(`/api/clients/${key}/photos?phase=later`)).body.totalFiles).toBe(3);

      const files = await get(`/api/clients/${key}/files`);
      expect(files.status).toBe(200);
      expect(files.body.totalFiles).toBe(3);
      expect(files.body.files.every((f: any) => f.isImage === true && f.type === 'image/jpeg')).toBe(true);
      nothingLeftArchie();
    });

    it('streams a copy from the store as a private JPEG, never a redirect', async () => {
      const key = await nativeLead();
      const { fileId } = await addPhoto(key);
      const row = await photoRow(a, fileId);
      for (const [variant, k] of [['working', row.workingKey], ['thumb', row.thumbKey]] as const) {
        const r = await fetchPhoto(`/api/photos/${fileId}/${variant}`);
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toBe('image/jpeg');
        expect(r.headers.get('cache-control')).toBe('private, max-age=300');
        expect(r.headers.get('location')).toBeNull();
        expect(r.bytes.equals(stored.get(k!)!)).toBe(true);
        expect(r.bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
      }
      expect((await fetchPhoto(`/api/photos/${fileId}/original`)).status).toBe(404);
      expect((await fetchPhoto(`/api/photos/not-a-photo/working`)).status).toBe(404);
      nothingLeftArchie();
    });

    it('hands its working copy to a letter only for its own job and company', async () => {
      const { nativePhotoBytes } = await import('../native');
      const key = await nativeLead();
      const other = await nativeLead();
      const { fileId } = await addPhoto(key, { caption: 'Hail on the ridge' });
      const row = await photoRow(a, fileId);
      const mine = await runAsCompany(a.id, () => nativePhotoBytes(key, fileId, fakeStore, 8 * 1024 * 1024));
      expect(mine).toEqual({ bytes: stored.get(row.workingKey!), name: 'Hail on the ridge.jpg', caption: 'Hail on the ridge' });
      expect(await runAsCompany(a.id, () => nativePhotoBytes(other, fileId, fakeStore, 8 * 1024 * 1024))).toBeNull();
      expect(await runAsCompany(b.id, () => nativePhotoBytes(key, fileId, fakeStore, 8 * 1024 * 1024))).toBeNull();
      expect(await runAsCompany(a.id, () => nativePhotoBytes(key, fileId, fakeStore, 10))).toBeNull();
      nothingLeftArchie();
    });

    it('shows its working copy as the small one when no small copy was sent (the checklist\'s upload)', async () => {
      const key = await nativeLead();
      as(a, 'rep');
      const r = await post(`/api/clients/${key}/photos`, { name: 'Precon - Deck - 2026-11-19.jpg', base64: b64(makeJpeg({ exif: true })), contentType: 'image/jpeg', description: 'Pre-Construction Checklist' });
      expect(r).toEqual({ status: 200, body: { ok: true, fileId: expect.any(String), name: 'Job photo' } });
      const row = await photoRow(a, r.body.fileId);
      expect(row.thumbKey).toBeNull();
      const thumb = await fetchPhoto(`/api/photos/${r.body.fileId}/thumb`);
      expect(thumb.status).toBe(200);
      expect(thumb.bytes.equals(stored.get(row.workingKey!)!)).toBe(true);
      nothingLeftArchie();
    });

    it('refuses what is not a whole JPEG, or a phase that is not one of the three, and stores nothing', async () => {
      const key = await nativeLead();
      as(a, 'rep');
      const before = stored.size;
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      expect(await post(`/api/clients/${key}/photos`, { base64: b64(png), contentType: 'image/jpeg' })).toEqual({ status: 400, body: { error: PHOTO_UNREADABLE } });
      expect(await post(`/api/clients/${key}/photos`, { base64: b64(png), contentType: 'image/png' })).toEqual({ status: 400, body: { error: PHOTO_NOT_JPEG } });
      expect(await post(`/api/clients/${key}/photos`, { base64: b64(makeJpeg().subarray(0, 40)), contentType: 'image/jpeg' })).toEqual({ status: 400, body: { error: PHOTO_UNREADABLE } });
      expect(await post(`/api/clients/${key}/photos`, { base64: b64(makeJpeg()), thumbBase64: b64(png), contentType: 'image/jpeg' })).toEqual({ status: 400, body: { error: PHOTO_UNREADABLE } });
      expect(await post(`/api/clients/${key}/photos`, { base64: b64(makeJpeg()), contentType: 'image/jpeg', phase: 'someday' })).toEqual({ status: 400, body: { error: PICK_PHASE } });
      expect(stored.size).toBe(before);
      expect(await runAsCompany(a.id, () => db.select().from(schema.jobPhotos).where(eq(schema.jobPhotos.jobKey, key)))).toEqual([]);
      nothingLeftArchie();
    });

    it('says plainly when the photo store is not switched on, and writes nothing', async () => {
      const key = await nativeLead();
      setPhotoStoreForTests(null);
      const saved = process.env.ARCHIE_PHOTOS_BUCKET;
      delete process.env.ARCHIE_PHOTOS_BUCKET;
      try {
        as(a, 'rep');
        expect(await post(`/api/clients/${key}/photos`, { base64: b64(makeJpeg()), contentType: 'image/jpeg' })).toEqual({ status: 503, body: { error: PHOTO_STORE_OFF } });
        expect(await runAsCompany(a.id, () => db.select().from(schema.jobPhotos).where(eq(schema.jobPhotos.jobKey, key)))).toEqual([]);
        // The list still answers (empty), so the page opens.
        expect(await get(`/api/clients/${key}/photos`)).toMatchObject({ status: 200, body: { photos: [], totalFiles: 0 } });
      } finally {
        if (saved !== undefined) process.env.ARCHIE_PHOTOS_BUCKET = saved;
      }
      nothingLeftArchie();
    });

    it('leaves a pending row and no listed photo when the store fails part way', async () => {
      const key = await nativeLead();
      storeFails = true;
      as(a, 'rep');
      const r = await post(`/api/clients/${key}/photos`, { base64: b64(makeJpeg()), contentType: 'image/jpeg' });
      expect(r.status).toBe(502);
      expect(r.body.error).toMatch(/couldn't be saved/);
      const rows = await runAsCompany(a.id, () => db.select().from(schema.jobPhotos).where(eq(schema.jobPhotos.jobKey, key)));
      expect(rows.map((x) => x.status)).toEqual(['pending']);
      expect((await get(`/api/clients/${key}/photos`)).body.photos).toEqual([]);
      nothingLeftArchie();
    });
  });

  // ---------------------------------------------------------------- who

  describe('who may see, change and delete', () => {
    it('gives another company 404 on list, stream, change and delete of this company\'s photo', async () => {
      const key = await nativeLead();
      const { fileId } = await addPhoto(key);
      as(b, 'owner');
      expect((await get(`/api/clients/${key}/photos`)).status).toBe(404);
      expect((await get(`/api/clients/${key}/files`)).status).toBe(404);
      expect((await post(`/api/clients/${key}/photos`, { base64: b64(makeJpeg()), contentType: 'image/jpeg' })).status).toBe(404);
      expect((await fetchPhoto(`/api/photos/${fileId}/working`)).status).toBe(404);
      expect((await fetchPhoto(`/api/photos/${fileId}/thumb`)).status).toBe(404);
      expect((await patch(`/api/photos/${fileId}`, { caption: 'Mine now' })).status).toBe(404);
      expect((await del(`/api/photos/${fileId}`)).status).toBe(404);
      expect(await photoRow(a, fileId)).toMatchObject({ status: 'ready', caption: 'North slope' });
      nothingLeftArchie();
    });

    it('gives a salesperson 404 on another rep\'s job, everywhere', async () => {
      const key = await nativeLead();
      const { fileId } = await addPhoto(key);
      as(a, 'rep2');
      expect((await get(`/api/clients/${key}/photos`)).status).toBe(404);
      expect((await post(`/api/clients/${key}/photos`, { base64: b64(makeJpeg()), contentType: 'image/jpeg' })).status).toBe(404);
      expect((await fetchPhoto(`/api/photos/${fileId}/working`)).status).toBe(404);
      expect((await patch(`/api/photos/${fileId}`, { caption: 'x' })).status).toBe(404);
      expect((await del(`/api/photos/${fileId}`)).status).toBe(404);
      nothingLeftArchie();
    });

    it('gives a crew 404 everywhere, even with an assignment row on the job', async () => {
      const key = await nativeLead();
      const { fileId } = await addPhoto(key);
      // The assignment route refuses a crew owner; a row put in by hand still opens nothing here.
      await runAsCompany(a.id, () => db.insert(schema.repAssignments).values({ jobExternalId: key, teamMemberId: a.people.crew.id, role: 'secondary' }));
      as(a, 'crew');
      expect((await get(`/api/clients/${key}/photos`)).status).toBe(404);
      expect((await get(`/api/clients/${key}/files`)).status).toBe(404);
      expect((await post(`/api/clients/${key}/photos`, { base64: b64(makeJpeg()), contentType: 'image/jpeg' })).status).toBe(404);
      expect((await fetchPhoto(`/api/photos/${fileId}/working`)).status).toBe(404);
      expect((await patch(`/api/photos/${fileId}`, { caption: 'x' })).status).toBe(404);
      expect((await del(`/api/photos/${fileId}`)).status).toBe(404);
      nothingLeftArchie();
    });

    it('lets the person who added it, or a manager, change it, and logs each change', async () => {
      const key = await nativeLead();
      const { fileId } = await addPhoto(key);
      as(a, 'office');
      expect(await patch(`/api/photos/${fileId}`, { caption: 'Office edit' })).toEqual({ status: 403, body: { error: EDIT_NOT_ALLOWED } });
      expect((await get(`/api/clients/${key}/photos`)).body.photos[0]).toMatchObject({ mayEdit: false, mayDelete: false });
      as(a, 'rep');
      const mine = await patch(`/api/photos/${fileId}`, { caption: 'Ridge vent', phase: 'after', category: 'vents' });
      expect(mine.status).toBe(200);
      expect(mine.body.photo).toMatchObject({ caption: 'Ridge vent', phase: 'after', category: 'vents', name: 'Ridge vent' });
      expect((await patch(`/api/photos/${fileId}`, { phase: 'later' })).status).toBe(400);
      as(a, 'director');
      expect((await patch(`/api/photos/${fileId}`, { caption: '' })).body.photo).toMatchObject({ caption: null, name: 'After photo' });
      const logs = await runAsCompany(a.id, () => db.select().from(schema.writeLog)
        .where(and(eq(schema.writeLog.targetId, key), eq(schema.writeLog.action, 'edit_photo'))));
      expect(logs.map((l) => [l.actor, l.system, l.ok])).toEqual([[a.people.rep.email, 'archie', true], [a.people.director.email, 'archie', true]]);
      nothingLeftArchie();
    });

    it('lets the person who added it delete it the same day, a manager any day, and nobody else', async () => {
      const key = await nativeLead();
      const today = await addPhoto(key);
      const old = await addPhoto(key, { caption: 'Last week' });
      await runAsCompany(a.id, () => db.update(schema.jobPhotos).set({ createdAt: new Date(Date.now() - 3 * 24 * 3600_000) }).where(eq(schema.jobPhotos.id, old.fileId)));

      as(a, 'office');
      expect(await del(`/api/photos/${today.fileId}`)).toEqual({ status: 403, body: { error: DELETE_NOT_ALLOWED } });
      as(a, 'rep');
      expect(await del(`/api/photos/${old.fileId}`)).toEqual({ status: 403, body: { error: DELETE_NOT_ALLOWED } });
      expect(await del(`/api/photos/${today.fileId}`)).toEqual({ status: 200, body: { ok: true } });
      expect(await photoRow(a, today.fileId)).toMatchObject({ status: 'deleted', deletedBy: a.people.rep.email, deletedAt: expect.any(Date) });
      expect((await fetchPhoto(`/api/photos/${today.fileId}/working`)).status).toBe(404);
      expect((await patch(`/api/photos/${today.fileId}`, { caption: 'back' })).status).toBe(404);
      as(a, 'owner');
      expect(await del(`/api/photos/${old.fileId}`)).toEqual({ status: 200, body: { ok: true } });
      expect((await get(`/api/clients/${key}/photos`)).body).toMatchObject({ photos: [], totalFiles: 0 });
      // The stored copies are kept for a later sweep; nothing is served from them.
      expect(stored.has(`c/${a.id}/p/${today.fileId}/working.jpg`)).toBe(true);
      const logs = await runAsCompany(a.id, () => db.select().from(schema.writeLog)
        .where(and(eq(schema.writeLog.targetId, key), eq(schema.writeLog.action, 'delete_photo'))));
      expect(logs.map((l) => l.actor).sort()).toEqual([a.people.owner.email, a.people.rep.email].sort());
      nothingLeftArchie();
    });
  });

  // ---------------------------------------------------------------- every other company

  describe('the original JobTread company, unchanged', () => {
    beforeEach(() => { calls.state.mode = 'ok'; });

    it('still lists and adds its photos through JobTread', async () => {
      const key = `jt-${randomUUID().slice(0, 12)}`;
      await runAsCompany(original.id, () => db.insert(schema.leads).values({
        source: 'jobtread', externalId: key, firstName: 'Sam Reyes', jobName: 'Reyes Roof', stage: 'New Lead', status: 'new', jtSalesRep: 'Rep rep',
      } as any));
      as(original, 'rep');
      expect(await get(`/api/clients/${key}/photos`)).toEqual({ status: 200, body: { photos: [], totalFiles: 0 } });
      expect(await get(`/api/clients/${key}/files`)).toEqual({ status: 200, body: { files: [], totalFiles: 0 } });
      // A PNG is still taken as it always was: JobTread's store takes any of the four kinds.
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const add = await post(`/api/clients/${key}/photos`, { base64: b64(png), contentType: 'image/png', name: 'roof.png' });
      expect(add).toEqual({ status: 200, body: { ok: true, fileId: 'jt-file-1', name: 'roof.png' } });
      expect(calls.state.jobtread).toEqual(['new', 'getJobFiles', 'new', 'getJobFiles', 'new', 'uploadJobFile']);
      const [log] = await runAsCompany(original.id, () => db.select().from(schema.writeLog)
        .where(and(eq(schema.writeLog.targetId, key), eq(schema.writeLog.action, 'upload_photo'))));
      expect(log).toMatchObject({ system: 'jobtread', ok: true });
      expect(await runAsCompany(original.id, () => db.select().from(schema.jobPhotos))).toEqual([]);
    });

    it('has nothing behind the photo addresses: a JobTread file id is not found, and JobTread is not asked', async () => {
      as(original, 'owner');
      expect((await fetchPhoto('/api/photos/jt-file-1/working')).status).toBe(404);
      expect((await patch('/api/photos/jt-file-1', { caption: 'x' })).status).toBe(404);
      expect((await del('/api/photos/jt-file-1')).status).toBe(404);
      expect(calls.state.jobtread).toEqual([]);
    });
  });
});
