/**
 * Photos of a job Archie keeps, as Roof Lee reads them (Stage A4,
 * docs/archie/02-roof-lee-link.md, "Read and write for Lee", Photos).
 * Against the real test database, through the real request path.
 *
 * What must hold (Archie's copy of the agreement's photo section, in that
 * page): a job lists its photos only once a person recorded that the customer
 * agreed, each as { id, phase, caption, takenAt }, ready ones only, Before
 * then During then After, oldest first within a phase, at most 40. One photo
 * is handed over as a JPEG with no location data in it, never a redirect. A
 * deleted photo, another job's photo, another company's photo, a photo of a
 * job with no consent and anything a crew asks for all answer 404, the same
 * as a photo that is not there. `photos.native` is said only while the photo
 * store is switched on.
 *
 * The photo store is an in-memory fake: no test ever makes a real store client.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { TEST_SECRET, companyBody, dropSecret, localDb, member, sisterSend, startSisterApp, useSecret, type TestMember } from './helpers';
import { signRequest } from '../verify';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

const PHOTO_SETTINGS = ['ARCHIE_PHOTOS_ACCOUNT_ID', 'ARCHIE_PHOTOS_ACCESS_KEY_ID', 'ARCHIE_PHOTOS_SECRET_ACCESS_KEY', 'ARCHIE_PHOTOS_BUCKET'] as const;

describe.skipIf(!localDb)('photos of a job Archie keeps, as Roof Lee reads them', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { runAsCompany } = await import('../../tenant/context');
  const { recordPhotoConsent } = await import('../../production/native-jobs');
  const { addNativePhoto, PHOTO_STORE_OFF } = await import('../../photos/native');
  const { setPhotoStoreForTests } = await import('../../photos/store');

  const tag = `sis-photo-${process.pid}-${Date.now()}`;
  const companies = '/api/sister/v1/companies';
  let server: Server;
  let base = '';
  let outside: string[] = [];
  const savedSettings: Record<string, string | undefined> = {};

  const stored = new Map<string, Buffer>();
  const fakeStore = {
    put: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); },
    get: async (key: string) => {
      const b = stored.get(key);
      return b ? { body: Readable.from(b), length: b.length } : null;
    },
  };

  beforeAll(async () => {
    ({ server, base } = await startSisterApp());
    for (const n of PHOTO_SETTINGS) { savedSettings[n] = process.env[n]; delete process.env[n]; }
  });
  afterAll(() => {
    server?.close();
    setPhotoStoreForTests(null);
    for (const n of PHOTO_SETTINGS) { if (savedSettings[n] === undefined) delete process.env[n]; else process.env[n] = savedSettings[n]; }
  });
  beforeEach(() => {
    useSecret();
    setPhotoStoreForTests(fakeStore);
    const real = globalThis.fetch;
    outside = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const u = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!u.startsWith(base)) { outside.push(u); return Promise.reject(new Error('no outside calls in tests')); }
      return real(input, init);
    });
  });
  afterEach(() => {
    dropSecret();
    vi.restoreAllMocks();
    for (const n of PHOTO_SETTINGS) delete process.env[n];
    expect(outside).toEqual([]);
  });

  interface Made { id: string; roofliId: string; owner: TestMember; office: TestMember; crew: TestMember }
  async function make(): Promise<Made> {
    const owner = member(tag, 'owner', 'Dana Whitfield');
    const office = member(tag, 'office', 'Riley Marsh');
    const crew = member(tag, 'crew', 'Sam Ortiz');
    const body = companyBody(tag, { members: [owner, office, crew] });
    const r = await sisterSend(base, { method: 'POST', path: companies, json: body, version: 1 });
    expect(r.status).toBe(201);
    return { id: r.body.companyId, roofliId: body.roofliCompanyId as string, owner, office, crew };
  }
  const as = (m: TestMember) => ({ authUserId: m.authUserId, role: m.role });
  const who = (m: TestMember) => `actingUserId=${m.authUserId}&actingRole=${m.role}`;
  const read = (c: Made, path: string, m?: TestMember) =>
    sisterSend(base, { path: `${companies}/${c.roofliId}${path}${m ? `?${who(m)}` : ''}`, version: 2 });

  /** One photo, the raw answer, signed the way Roof Lee signs it and never following a redirect. */
  async function fetchPhoto(c: Made, jobId: string, photoId: string, m?: TestMember) {
    const path = `${companies}/${c.roofliId}/jobs/${jobId}/photos/${photoId}${m ? `?${who(m)}` : ''}`;
    const at = Date.now();
    const r = await fetch(`${base}${path}`, {
      redirect: 'manual',
      headers: { 'x-roofli-timestamp': String(at), 'x-roofli-signature': signRequest('GET', path, '', at, TEST_SECRET) },
    });
    return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
  }
  const notFound = async (c: Made, jobId: string, photoId: string, m?: TestMember) => {
    const r = await fetchPhoto(c, jobId, photoId, m);
    expect(r.status).toBe(404);
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-type') ?? '').not.toMatch(/image/);
  };

  /** A lead Roof Lee adds (it gets Archie's own job key at once), with its id and key. */
  async function newJob(c: Made, name = 'Pat Hollis'): Promise<{ id: string; key: string }> {
    const r = await sisterSend(base, {
      method: 'POST', path: `${companies}/${c.roofliId}/leads`, version: 2, headers: { 'idempotency-key': randomUUID() },
      json: { name, town: 'Cedar Falls', jobType: 'replacement', acting: as(c.office) },
    });
    expect(r.status).toBe(201);
    const [row] = await runAsCompany(c.id, () => db.select().from(schema.leads).where(eq(schema.leads.id, Number(r.body.leadId))));
    return { id: r.body.leadId, key: row.externalId! };
  }
  /** A photo added to the job the way Archie's app adds one (a GPS Exif block in what the phone sent). */
  async function addPhoto(c: Made, key: string, over: Record<string, unknown> = {}): Promise<string> {
    const r = await runAsCompany(c.id, () => addNativePhoto({
      user: { email: c.office.email, name: 'Riley Marsh', role: 'customer_service' }, jobKey: key, store: fakeStore, maxBytes: 8 * 1024 * 1024,
      body: { base64: makeJpeg({ exif: true, comment: true }).toString('base64'), contentType: 'image/jpeg', ...over },
    }));
    expect(r.status).toBe(200);
    return (r.body as { fileId: string }).fileId;
  }
  const photoRow = async (c: Made, id: string) =>
    (await runAsCompany(c.id, () => db.select().from(schema.jobPhotos).where(eq(schema.jobPhotos.id, id))))[0];
  const addedAt = (c: Made, id: string, at: Date) =>
    runAsCompany(c.id, () => db.update(schema.jobPhotos).set({ createdAt: at }).where(eq(schema.jobPhotos.id, id)));
  const agree = async (c: Made, key: string, yes = true) => expect(await runAsCompany(c.id, () => recordPhotoConsent(key, yes, c.office.email))).toBe(true);
  const hasNoLocation = (bytes: Buffer) => {
    expect([bytes[0], bytes[1], bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    expect(bytes.includes(Buffer.from('GPS', 'latin1'))).toBe(false);
    expect(bytes.includes(Buffer.from('12 Main St', 'latin1'))).toBe(false);
  };

  // ---------------------------------------------------------------- the list

  it('lists a job\'s photos only once a person recorded consent, each with its phase, caption and when it was taken', async () => {
    const c = await make();
    const { id, key } = await newJob(c);
    const before = await addPhoto(c, key, { phase: 'before', caption: 'North slope', takenAt: '2026-11-18T09:30:00Z' });
    const after = await addPhoto(c, key, { phase: 'after', category: 'roof' });

    const without = await read(c, `/jobs/${id}`, c.office);
    expect(without.status).toBe(200);
    expect(without.body.job).toMatchObject({ photoConsent: false, photos: [] });

    await agree(c, key);
    const job = (await read(c, `/jobs/${id}`, c.office)).body.job;
    expect(job.photoConsent).toBe(true);
    // Exactly these four fields: nothing about who added it, where it is kept or how big it is.
    expect(job.photos).toEqual([
      { id: before, phase: 'before', caption: 'North slope', takenAt: '2026-11-18T09:30:00.000Z' },
      { id: after, phase: 'after', caption: null, takenAt: null },
    ]);
    // The scheduled run, which names nobody, reads the same list.
    expect((await read(c, `/jobs/${id}`)).body.job.photos.map((p: any) => p.id)).toEqual([before, after]);

    // Taken back: listed no more.
    await agree(c, key, false);
    expect((await read(c, `/jobs/${id}`, c.office)).body.job).toMatchObject({ photoConsent: false, photos: [] });
  });

  it('lists ready photos only: Before, During, After, then the rest, oldest first within each', async () => {
    const c = await make();
    const { id, key } = await newJob(c);
    const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));
    const after1 = await addPhoto(c, key, { phase: 'after' });
    const none = await addPhoto(c, key, {});
    const before2 = await addPhoto(c, key, { phase: 'before', caption: 'second' });
    const during = await addPhoto(c, key, { phase: 'during' });
    const before1 = await addPhoto(c, key, { phase: 'before', caption: 'first' });
    const deleted = await addPhoto(c, key, { phase: 'before' });
    await addedAt(c, after1, day(1)); await addedAt(c, none, day(2)); await addedAt(c, before2, day(5));
    await addedAt(c, during, day(3)); await addedAt(c, before1, day(4)); await addedAt(c, deleted, day(1));
    await runAsCompany(c.id, () => db.update(schema.jobPhotos).set({ status: 'deleted', deletedAt: new Date(), deletedBy: c.office.email }).where(eq(schema.jobPhotos.id, deleted)));
    await runAsCompany(c.id, () => db.insert(schema.jobPhotos).values({ jobKey: key, uploadedBy: c.office.email, status: 'pending', phase: 'before' }));
    await agree(c, key);
    expect((await read(c, `/jobs/${id}`, c.office)).body.job.photos.map((p: any) => p.id)).toEqual([before1, before2, during, after1, none]);
  });

  it('lists at most 40, Before first, because Roof Lee keeps at most 40', async () => {
    const c = await make();
    const { id, key } = await newJob(c);
    const rows = Array.from({ length: 45 }, (_, i) => {
      const photoId = randomUUID();
      return {
        id: photoId, jobKey: key, uploadedBy: c.office.email, status: 'ready', phase: i < 30 ? 'after' : 'before',
        workingKey: `c/${c.id}/p/${photoId}/working.jpg`, createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
      };
    });
    await runAsCompany(c.id, () => db.insert(schema.jobPhotos).values(rows as any));
    await agree(c, key);
    const listed = (await read(c, `/jobs/${id}`, c.office)).body.job.photos;
    expect(listed).toHaveLength(40);
    expect(listed.slice(0, 15).every((p: any) => p.phase === 'before')).toBe(true);
    expect(listed.slice(15).every((p: any) => p.phase === 'after')).toBe(true);
    expect(listed.map((p: any) => p.id)).toEqual([...rows.slice(30), ...rows.slice(0, 25)].map((r) => r.id));
  });

  // ---------------------------------------------------------------- one photo

  it('hands over one photo as a JPEG with no location data, never a redirect', async () => {
    const c = await make();
    const { id, key } = await newJob(c);
    const photoId = await addPhoto(c, key, { phase: 'before' });
    await agree(c, key);

    for (const m of [c.office, c.owner, undefined]) {
      const r = await fetchPhoto(c, id, photoId, m);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/jpeg');
      expect(r.headers.get('location')).toBeNull();
      expect(r.headers.get('content-length')).toBe(String(r.bytes.length));
      expect(r.bytes.equals(stored.get((await photoRow(c, photoId)).workingKey!)!)).toBe(true);
      hasNoLocation(r.bytes);
    }
  });

  it('takes any metadata out again on the way out, and hands over nothing it cannot read as a whole JPEG', async () => {
    const c = await make();
    const { id, key } = await newJob(c);
    const photoId = await addPhoto(c, key, { phase: 'before' });
    await agree(c, key);
    const workingKey = (await photoRow(c, photoId)).workingKey!;

    // Something put a copy with location data in the store: none of it leaves.
    stored.set(workingKey, makeJpeg({ exif: true, app13: true, comment: true, trailing: true }));
    const r = await fetchPhoto(c, id, photoId);
    expect(r.status).toBe(200);
    hasNoLocation(r.bytes);
    expect(r.bytes.equals(makeJpeg())).toBe(true);

    // Not a JPEG at all, or gone from the store: not found, and nothing sent.
    stored.set(workingKey, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await notFound(c, id, photoId);
    stored.delete(workingKey);
    await notFound(c, id, photoId);
  });

  it('answers 404, the same as a photo that is not there, for a deleted photo, another job\'s, another company\'s, no consent and a crew', async () => {
    const c = await make();
    const d = await make();
    const job = await newJob(c);
    const other = await newJob(c, 'Jo Marsh');
    const theirs = await newJob(d, 'Lee Ortiz');
    const mine = await addPhoto(c, job.key, { phase: 'before' });
    const deleted = await addPhoto(c, job.key, { phase: 'after' });
    const otherJobs = await addPhoto(c, other.key, { phase: 'before' });
    const otherCompanys = await addPhoto(d, theirs.key, { phase: 'before' });
    for (const [co, key] of [[c, job.key], [c, other.key], [d, theirs.key]] as const) await agree(co, key);
    await runAsCompany(c.id, () => db.update(schema.jobPhotos).set({ status: 'deleted', deletedAt: new Date(), deletedBy: c.office.email }).where(eq(schema.jobPhotos.id, deleted)));
    const [pending] = await runAsCompany(c.id, () => db.insert(schema.jobPhotos).values({ jobKey: job.key, uploadedBy: c.office.email, status: 'pending' }).returning());

    expect((await fetchPhoto(c, job.id, mine)).status).toBe(200);
    await notFound(c, job.id, deleted);
    await notFound(c, job.id, pending.id);
    await notFound(c, job.id, otherJobs);                // another job's photo, through this job
    await notFound(c, job.id, otherCompanys);            // another company's photo, through this company
    await notFound(c, theirs.id, otherCompanys);         // another company's job, through this company
    await notFound(d, job.id, mine);                     // this company's photo, through another company
    await notFound(c, job.id, randomUUID());
    await notFound(c, job.id, 'abc123');
    await notFound(c, job.id, 'not-a-photo_id');
    await notFound(c, job.id, mine, c.crew);             // a crew sees no job here at all
    expect((await read(c, `/jobs/${job.id}`, c.crew)).status).toBe(404);

    // Consent taken back: the job's photos are not handed over any more.
    await agree(c, job.key, false);
    await notFound(c, job.id, mine);
    expect((await read(c, `/jobs/${job.id}`)).body.job.photos).toEqual([]);
  });

  it('says plainly that the store is off, rather than not found, and never redirects', async () => {
    const c = await make();
    const { id, key } = await newJob(c);
    const photoId = await addPhoto(c, key, { phase: 'before' });
    await agree(c, key);
    setPhotoStoreForTests(null);
    const r = await fetchPhoto(c, id, photoId);
    expect(r.status).toBe(503);
    expect(r.headers.get('location')).toBeNull();
    expect(JSON.parse(r.bytes.toString('utf8'))).toEqual({ error: PHOTO_STORE_OFF });
    // A photo that is not there is still just not found.
    await notFound(c, id, randomUUID());
  });

  // ---------------------------------------------------------------- what Archie says it can do

  it('says photos.native only while the photo store is switched on', async () => {
    const c = await make();
    expect((await read(c, '/capabilities')).body).toEqual({ capabilities: ['messages.quiet', 'jobs.native'] });
    for (const n of PHOTO_SETTINGS) process.env[n] = `not-a-real-${n.toLowerCase()}`;
    expect((await read(c, '/capabilities')).body).toEqual({ capabilities: ['messages.quiet', 'jobs.native', 'photos.native'] });
    // Any one setting missing and it is off again.
    delete process.env.ARCHIE_PHOTOS_SECRET_ACCESS_KEY;
    expect((await read(c, '/capabilities')).body.capabilities).not.toContain('photos.native');
  });
});
