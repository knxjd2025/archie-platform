/**
 * The checklists of a job Archie keeps use its own photos (Stage A3,
 * docs/archie/02-roof-lee-link.md, "Archie's own jobs", Photos), through the
 * real request path: session, company, route, database.
 *
 * For such a job the pre-construction checklist and the final walkthrough are
 * accepted only when every photo they name is one of the job's own saved
 * (ready) photos. A made-up id, another job's photo, another company's photo,
 * a deleted one and one that never finished saving are all refused in plain
 * words, and the checklist stays a draft. With its own photos the checklist
 * moves the Production board exactly as before (Schedule Job, then Final
 * Invoice). The board's own gates are not touched.
 *
 * The original JobTread company is unchanged: its checklists name JobTread
 * file ids, which Archie never checks, and still reach JobTread.
 *
 * The photo store is an in-memory fake; JobTread and KynexPro clients throw if
 * they are even made, and every request leaving Archie is refused and recorded.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { makeJpeg } from './jpeg-fixtures';

const calls = vi.hoisted(() => {
  const state = { jobtread: [] as string[], kynexPro: [] as string[], mode: 'throw' as 'throw' | 'ok' };
  const answers: Record<string, (...args: any[]) => unknown> = {
    addJobComment: () => ({ ok: true, id: 'c-1' }),
    setJobStage: () => ({ ok: true }),
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
            return Promise.resolve(answer ? answer(...args) : { ok: true, success: true });
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

describe.skipIf(!localDb)('the checklists of a job Archie keeps use its own photos', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { runAsCompany, runAsSystem } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { tenantFromSession } = await import('../../tenant/middleware');
  const { clearProfileCache } = await import('../../tenant/profile');
  const { clearSessionRevalidationCache } = await import('../../auth/middleware');
  const { registerRoutes } = await import('../../routes');
  const { isNativeJobId } = await import('../../production/native-jobs');
  const { setPhotoStoreForTests } = await import('../store');
  const { CHECKLIST_PHOTO_NOT_SAVED } = await import('../native');
  const { PRECON_CHECKLIST_FIELDS } = await import('../../../shared/preconstruction-checklist');
  const { WALKTHROUGH_FIELDS } = await import('../../../shared/final-walkthrough');

  const tag = `checklist-photos-${process.pid}-${Date.now()}`;
  type Role = 'admin' | 'sales' | 'production';
  interface Person { id: number; email: string; name: string; role: Role }
  interface Co { id: string; people: Record<string, Person> }

  const stored = new Map<string, Buffer>();
  const fakeStore = {
    put: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); },
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
    a = await company('Summit Ridge Roofing', true, [['owner', 'admin'], ['rep', 'sales']]);
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
  });
  afterAll(() => { setPhotoStoreForTests(null); server?.close(); });

  beforeEach(() => {
    calls.state.jobtread.length = 0; calls.state.kynexPro.length = 0; calls.state.mode = 'throw';
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
      method, headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const get = (path: string) => send('GET', path);
  const post = (path: string, body: unknown) => send('POST', path, body);
  const patch = (path: string, body: unknown) => send('PATCH', path, body);
  const del = (path: string) => send('DELETE', path);

  const nothingLeftArchie = () => {
    expect(calls.state.jobtread).toEqual([]);
    expect(calls.state.kynexPro).toEqual([]);
    expect(outside).toEqual([]);
  };

  /** A fresh lead of a Roof Lee company, made on the lead form by its rep (so the rep owns it). */
  const nativeLead = async (c: Co = a) => {
    as(c, 'rep');
    const r = await post('/api/leads/create', { firstName: 'Pat', lastName: 'Hollis', phone: '(319) 555-0142', address: '12 Main St', city: 'Cedar Falls', state: 'IA' });
    expect(r.status).toBe(200);
    expect(isNativeJobId(r.body.jobId)).toBe(true);
    return r.body.jobId as string;
  };
  /** A photo added to the job by the company's rep, the way the checklist adds one. */
  const addPhoto = async (key: string, field: string, phase: 'before' | 'after', c: Co = a): Promise<{ fileId: string; name: string }> => {
    as(c, 'rep');
    const r = await post(`/api/clients/${key}/photos`, { base64: makeJpeg({ exif: true }).toString('base64'), contentType: 'image/jpeg', phase, category: 'checklist', caption: field });
    expect(r.status).toBe(200);
    return { fileId: r.body.fileId, name: `${field}.jpg` };
  };

  type Field = { name: string; type: string; options: string[] | null; isRequired: boolean };
  /** Every required answer filled, each photo field with the photos given for it. */
  const filled = (fields: Field[], photos: (field: string) => Array<{ fileId: string; name: string }>, over: Record<string, unknown> = {}) => {
    const answers: Record<string, unknown> = {};
    for (const f of fields) {
      if (!f.isRequired) continue;
      answers[f.name] = f.type === 'checkbox' ? true
        : f.type === 'photo' ? photos(f.name)
          : f.type === 'verify' ? { state: 'ok' }
            : f.type === 'option' ? f.options![0]
              : f.type === 'date' ? '2026-11-19'
                : f.type === 'signature' ? 'data:image/png;base64,iVBORw0KGgo='
                  : 'Summit Ridge test';
    }
    return { ...answers, ...over };
  };
  /** The job's own photos, one added per required photo field. */
  const ownPhotos = async (key: string, fields: Field[], phase: 'before' | 'after', c: Co = a) => {
    const by = new Map<string, Array<{ fileId: string; name: string }>>();
    for (const f of fields) if (f.type === 'photo' && f.isRequired) by.set(f.name, [await addPhoto(key, f.name, phase, c)]);
    return (field: string) => by.get(field) ?? [];
  };
  const firstPhotoField = (fields: Field[]) => fields.find((f) => f.type === 'photo' && f.isRequired)!.name;
  const walkedWith = (photos: (field: string) => Array<{ fileId: string; name: string }>, over: Record<string, unknown> = {}) =>
    filled(WALKTHROUGH_FIELDS as Field[], photos, { 'Homeowner present': 'Yes', 'Homeowner signature': 'data:image/png;base64,iVBORw0KGgo=', ...over });

  const boardStage = async (c: Co, key: string) =>
    (await runAsCompany(c.id, () => db.select().from(schema.productionPipeline).where(eq(schema.productionPipeline.jobExternalId, key))))[0]?.stage ?? null;
  const preconRow = async (c: Co, id: number) =>
    (await runAsCompany(c.id, () => db.select().from(schema.preConstructionChecklists).where(eq(schema.preConstructionChecklists.id, id))))[0];
  const walkRow = async (c: Co, id: number) =>
    (await runAsCompany(c.id, () => db.select().from(schema.finalWalkthroughs).where(eq(schema.finalWalkthroughs.id, id))))[0];

  // ---------------------------------------------------------------- pre-construction

  describe('the pre-construction checklist', () => {
    it('with the job\'s own photos, is accepted and moves the board to Schedule Job', async () => {
      const key = await nativeLead();
      const photos = await ownPhotos(key, PRECON_CHECKLIST_FIELDS as Field[], 'before');
      as(a, 'rep');
      const draft = await post('/api/preconstruction', { jobExternalId: key, answers: filled(PRECON_CHECKLIST_FIELDS as Field[], photos) });
      expect(draft.status).toBe(200);
      const done = await post(`/api/preconstruction/${draft.body.checklist.id}/submit`, {});
      expect(done.status).toBe(200);
      expect(done.body.checklist).toMatchObject({ status: 'submitted', jobtreadSyncedAt: null });
      expect(done.body.automation).toEqual(expect.arrayContaining([expect.stringContaining('Schedule Job')]));
      expect(await boardStage(a, key)).toBe('schedule');
      nothingLeftArchie();
    });

    it('takes a photo picked from the job\'s photos as well as one just added', async () => {
      const key = await nativeLead();
      const photos = await ownPhotos(key, PRECON_CHECKLIST_FIELDS as Field[], 'before');
      const earlier = await addPhoto(key, 'Roof from the street', 'before');
      const field = firstPhotoField(PRECON_CHECKLIST_FIELDS as Field[]);
      as(a, 'rep');
      const answers = filled(PRECON_CHECKLIST_FIELDS as Field[], photos, { [field]: [...photos(field), earlier], 'Risk / hazard items': [earlier] });
      const draft = await post('/api/preconstruction', { jobExternalId: key, answers });
      expect((await post(`/api/preconstruction/${draft.body.checklist.id}/submit`, {})).status).toBe(200);
      nothingLeftArchie();
    });

    it('refuses a photo that is not one of the job\'s own saved photos, in plain words, and stays a draft', async () => {
      const key = await nativeLead();
      const other = await nativeLead();
      const photos = await ownPhotos(key, PRECON_CHECKLIST_FIELDS as Field[], 'before');
      const otherJobs = await addPhoto(other, 'Another job', 'before');
      const otherCompanys = await addPhoto(await nativeLead(b), 'Another company', 'before', b);
      const deleted = await addPhoto(key, 'Taken by mistake', 'before');
      as(a, 'rep');
      expect((await del(`/api/photos/${deleted.fileId}`)).status).toBe(200);
      const [pending] = await runAsCompany(a.id, () => db.insert(schema.jobPhotos).values({ jobKey: key, uploadedBy: a.people.rep.email, status: 'pending' }).returning());

      const field = firstPhotoField(PRECON_CHECKLIST_FIELDS as Field[]);
      const bad: Array<[string, unknown]> = [
        ['a made-up id', { fileId: randomUUID(), name: 'made up.jpg' }],
        ['an id that is not a photo id', { fileId: 'photo-1', name: 'site.jpg' }],
        ['an entry with no id', { name: 'no id.jpg' }],
        ['another job\'s photo', otherJobs],
        ['another company\'s photo', otherCompanys],
        ['a deleted photo', deleted],
        ['a photo that never finished saving', { fileId: pending.id, name: 'pending.jpg' }],
      ];
      for (const [, entry] of bad) {
        as(a, 'rep');
        // Alongside a good photo, so one bad one is enough to refuse.
        const draft = await post('/api/preconstruction', { jobExternalId: key, answers: filled(PRECON_CHECKLIST_FIELDS as Field[], photos, { [field]: [...photos(field), entry] }) });
        expect(draft.status).toBe(200);
        const done = await post(`/api/preconstruction/${draft.body.checklist.id}/submit`, {});
        expect(done).toEqual({ status: 400, body: { error: CHECKLIST_PHOTO_NOT_SAVED } });
        expect(await preconRow(a, draft.body.checklist.id)).toMatchObject({ status: 'draft', submittedAt: null });
      }
      // An optional photo field is held to the same rule.
      const optional = await post('/api/preconstruction', { jobExternalId: key, answers: filled(PRECON_CHECKLIST_FIELDS as Field[], photos, { 'Risk / hazard items': [{ fileId: randomUUID(), name: 'x.jpg' }] }) });
      expect(await post(`/api/preconstruction/${optional.body.checklist.id}/submit`, {})).toEqual({ status: 400, body: { error: CHECKLIST_PHOTO_NOT_SAVED } });
      expect(await boardStage(a, key)).toBeNull();

      // Put right (the bad photo taken out), the same draft goes through.
      expect((await patch(`/api/preconstruction/${optional.body.checklist.id}`, { answers: { 'Risk / hazard items': [] } })).status).toBe(200);
      expect((await post(`/api/preconstruction/${optional.body.checklist.id}/submit`, {})).status).toBe(200);
      expect(await boardStage(a, key)).toBe('schedule');
      nothingLeftArchie();
    });

    it('says it in plain words, with no codes and no dashes', () => {
      expect(CHECKLIST_PHOTO_NOT_SAVED).toBe('One of the photos didn\'t finish saving. Please add it again.');
      expect(CHECKLIST_PHOTO_NOT_SAVED).not.toMatch(/[—–]|\bids?\b|error|code/i);
    });
  });

  // ---------------------------------------------------------------- final walkthrough

  describe('the final walkthrough', () => {
    it('with the job\'s own photos, is accepted and moves the board to Final Invoice', async () => {
      const key = await nativeLead();
      const before = await ownPhotos(key, PRECON_CHECKLIST_FIELDS as Field[], 'before');
      as(a, 'rep');
      const precon = await post('/api/preconstruction', { jobExternalId: key, answers: filled(PRECON_CHECKLIST_FIELDS as Field[], before) });
      expect((await post(`/api/preconstruction/${precon.body.checklist.id}/submit`, {})).status).toBe(200);
      expect(await boardStage(a, key)).toBe('schedule');

      const after = await ownPhotos(key, WALKTHROUGH_FIELDS as Field[], 'after');
      as(a, 'rep');
      const walk = await post('/api/final-walkthrough', { jobExternalId: key, answers: walkedWith(after) });
      expect(walk.status).toBe(200);
      const done = await post(`/api/final-walkthrough/${walk.body.walkthrough.id}/submit`, {});
      expect(done.status).toBe(200);
      expect(done.body.walkthrough).toMatchObject({ status: 'submitted', jobtreadSyncedAt: null });
      expect(done.body.automation).toEqual(expect.arrayContaining([expect.stringContaining('Final Invoice')]));
      expect(await boardStage(a, key)).toBe('final_invoice');
      nothingLeftArchie();
    });

    it('refuses a made-up photo, makes no follow-up and stays a draft', async () => {
      const key = await nativeLead();
      const after = await ownPhotos(key, WALKTHROUGH_FIELDS as Field[], 'after');
      const field = firstPhotoField(WALKTHROUGH_FIELDS as Field[]);
      const firstVerify = (WALKTHROUGH_FIELDS as Field[]).find((f) => f.type === 'verify')!.name;
      as(a, 'rep');
      const walk = await post('/api/final-walkthrough', {
        jobExternalId: key,
        answers: walkedWith(after, { [field]: [{ fileId: randomUUID(), name: 'made up.jpg' }], [firstVerify]: { state: 'issue', note: 'Nails by the driveway.' } }),
      });
      expect(walk.status).toBe(200);
      expect(await post(`/api/final-walkthrough/${walk.body.walkthrough.id}/submit`, {})).toEqual({ status: 400, body: { error: CHECKLIST_PHOTO_NOT_SAVED } });
      expect(await walkRow(a, walk.body.walkthrough.id)).toMatchObject({ status: 'draft', submittedAt: null });
      expect(await runAsCompany(a.id, () => db.select().from(schema.followUps).where(eq(schema.followUps.jobExternalId, key)))).toEqual([]);
      nothingLeftArchie();
    });
  });

  // ---------------------------------------------------------------- every other company

  describe('the original JobTread company, unchanged', () => {
    beforeEach(() => { calls.state.mode = 'ok'; });

    it('takes JobTread file ids as before, never checks them against Archie\'s photos, and still tells JobTread', async () => {
      const key = `jt-${randomUUID().slice(0, 12)}`;
      await runAsCompany(original.id, () => db.insert(schema.leads).values({
        source: 'jobtread', externalId: key, firstName: 'Sam Reyes', jobName: 'Reyes Roof', stage: 'New Lead', status: 'new', jtSalesRep: 'Rep rep',
      } as any));
      as(original, 'rep');
      const jtPhotos = () => [{ fileId: 'jt-file-1', name: 'site.jpg' }];
      const precon = await post('/api/preconstruction', { jobExternalId: key, answers: filled(PRECON_CHECKLIST_FIELDS as Field[], jtPhotos) });
      expect((await post(`/api/preconstruction/${precon.body.checklist.id}/submit`, {})).status).toBe(200);
      expect(await boardStage(original, key)).toBe('schedule');
      const walk = await post('/api/final-walkthrough', { jobExternalId: key, answers: walkedWith(jtPhotos) });
      expect((await post(`/api/final-walkthrough/${walk.body.walkthrough.id}/submit`, {})).status).toBe(200);
      expect(await boardStage(original, key)).toBe('final_invoice');
      expect(calls.state.jobtread.filter((c) => c === 'addJobComment')).toHaveLength(2);
      expect(await runAsCompany(original.id, () => db.select().from(schema.jobPhotos))).toEqual([]);
    });
  });

  it('offers, in the checklist\'s picker, the photos the checklist accepts, filed the way the checklist files them', async () => {
    // The "use a photo already on the job" picker reads the job's photo list,
    // whose ids are exactly what the checklist accepts.
    const key = await nativeLead();
    const added = await addPhoto(key, 'Aerial view of home', 'before');
    as(a, 'rep');
    const list = await get(`/api/clients/${key}/photos`);
    expect(list.body.photos.map((p: any) => p.id)).toEqual([added.fileId]);
    expect(list.body.photos[0]).toMatchObject({ phase: 'before', category: 'checklist', caption: 'Aerial view of home' });
    nothingLeftArchie();
  });
});
