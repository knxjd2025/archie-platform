/**
 * Report photos, kept private (Task B5), through the real request path with
 * the local test database as the app's own role. The photo store is an
 * in-memory fake: no test ever makes a real store client.
 *
 * Holds: what is stored carries no location; every copy sits under its own
 * company's rr/ prefix; an upload is checked by its content (a real JPEG, a
 * size cap, a count cap; SVG, PNG and anything else refused); a photo belongs
 * to one report of one company and cannot be put in another's by sending its
 * id; a photo leaves the store only through the signed-in route or a short
 * signed link; the store switched off answers 503 in plain words; crew get 404.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PHOTO_NOT_JPEG, PHOTO_STORE_OFF, PHOTO_TOO_LARGE, PHOTO_UNREADABLE, PHOTO_MISSING, MAX_PHOTO_BYTES } from '../../photos/native';
import { setPhotoStoreForTests } from '../../photos/store';
import { MAX_WAITING_PHOTOS, TOO_MANY_WAITING, NOT_FOUND, PHOTO_IN_REPORT, PHOTO_NOT_REMOVED } from '../../../shared/roof-reports';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('report photos (database)', async () => {
  const tag = `rrphotos-${process.pid}-${Date.now()}`;
  const { requireRoofReportsOn } = await import('../switch');
  const { photoRouter } = await import('../photos');
  const h = await startRoofApp(tag, (app) => app.use('/api/roof-reports', requireRoofReportsOn, photoRouter()));
  const { db, schema, runAsCompany } = h;
  const { sql, eq } = await import('drizzle-orm');
  const photos = await import('../photos');
  const { signPhotoLink } = await import('../photo-links');

  const store = fakeStore();
  let a: Co; let b: Co;
  const reportOf: Record<string, string> = {};
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;

  async function reportFor(co: Co, makerKey: string, status = 'ready'): Promise<string> {
    const [r] = await runAsCompany(co.id, () => db.insert(schema.roofReports).values({
      address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'], status,
      createdByMemberId: co.people[makerKey].id,
    } as any).returning());
    return r.id;
  }
  const rowsOf = (co: Co) => runAsCompany(co.id, () => db.select().from(schema.roofReportPhotos));
  const upload = async (co: Co, who: string, bytes: Buffer, qs = '') => { h.as(co, who); return h.upload(`/api/roof-reports/photos${qs}`, bytes); };

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(store);
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['repA', 'sales'], ['repB', 'sales'], ['crew', 'production']]);
    b = await h.company('Cedar Falls Roofing Two', [['admin', 'admin']]);
    reportOf.a = await reportFor(a, 'repA');
    reportOf.b = await reportFor(b, 'admin');
  });
  afterEach(() => { process.env.ARCHIE_ROOF_REPORTS = 'on'; setPhotoStoreForTests(store); });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  it('stores a photo with no location in it, under its own company\'s rr/ prefix, and says who it belongs to', async () => {
    const r = await upload(a, 'repA', makeJpeg({ exif: true, app13: true, comment: true, trailing: true }));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual(['id']);
    const rows = (await rowsOf(a)).filter((x) => x.id === r.body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].reportId).toBeNull();
    expect(rows[0].uploadedByMemberId).toBe(a.people.repA.id);
    for (const key of [rows[0].workingKey, rows[0].thumbKey]) {
      expect(key.startsWith(`c/${a.id}/rr/pending/${r.body.id}/`)).toBe(true);
      const bytes = store.objects.get(key)!;
      expect(bytes.length).toBeGreaterThan(0);
      for (const mark of ['Exif', 'GPS', 'Photoshop', 'Main St', 'XMP']) expect(bytes.includes(Buffer.from(mark)), mark).toBe(false);
    }
    expect(r.text).not.toContain('c/');
  });

  it('checks an upload by what it is, not by what it says it is', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const before = (await rowsOf(a)).length;
    // Even when the request says it is a JPEG.
    for (const [name, bytes] of [['svg', svg], ['png', png], ['text', Buffer.from('hello')], ['html', Buffer.from('<html></html>')]] as const) {
      const r = await upload(a, 'repA', bytes);
      expect(r.status, name).toBe(400);
      expect(r.body.error, name).toBe(PHOTO_NOT_JPEG);
    }
    h.as(a, 'repA');
    expect((await h.upload('/api/roof-reports/photos', svg, 'image/svg+xml')).status).toBe(400);
    expect((await h.upload('/api/roof-reports/photos', Buffer.alloc(0))).body.error).toBe(PHOTO_MISSING);
    // A JPEG start with nothing JPEG after it.
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('not a picture at all')]);
    expect((await upload(a, 'repA', broken)).body.error).toBe(PHOTO_UNREADABLE);
    expect((await rowsOf(a)).length).toBe(before);
  });

  it('refuses a photo over the size cap, before reading it', async () => {
    const big = Buffer.concat([makeJpeg(), Buffer.alloc(MAX_PHOTO_BYTES + 10)]);
    const r = await upload(a, 'repA', big);
    expect([400, 413]).toContain(r.status);
    if (r.status === 413) expect(r.body.error).toBe(PHOTO_TOO_LARGE);
  });

  it('refuses more waiting photos than one person may leave in a day', async () => {
    const [m] = await runAsCompany(a.id, () => db.insert(schema.teamMembers).values({ name: 'Cap Test', email: `${tag}-cap@example.test`.toLowerCase(), role: 'sales', canLogin: true, active: true } as any).returning());
    a.people.cap = { id: m.id, email: m.email!, name: 'Cap Test', role: 'sales' };
    await runAsCompany(a.id, async () => {
      for (let i = 0; i < MAX_WAITING_PHOTOS; i++) {
        const id = crypto.randomUUID();
        await db.insert(schema.roofReportPhotos).values({
          id, uploadedByMemberId: m.id,
          workingKey: `c/${a.id}/rr/pending/${id}/working.jpg`, thumbKey: `c/${a.id}/rr/pending/${id}/thumb.jpg`,
        } as any);
      }
    });
    const r = await upload(a, 'cap', makeJpeg());
    expect(r.status).toBe(429);
    expect(r.body.error).toBe(TOO_MANY_WAITING);
  });

  it('answers 503 in plain words when the photo store is off, and writes nothing', async () => {
    setPhotoStoreForTests(null);
    const saved = Object.fromEntries(['ARCHIE_PHOTOS_ACCOUNT_ID', 'ARCHIE_PHOTOS_ACCESS_KEY_ID', 'ARCHIE_PHOTOS_SECRET_ACCESS_KEY', 'ARCHIE_PHOTOS_BUCKET'].map((k) => [k, process.env[k]]));
    for (const k of Object.keys(saved)) delete process.env[k];
    try {
      const before = (await rowsOf(a)).length;
      const r = await upload(a, 'repA', makeJpeg());
      expect(r.status).toBe(503);
      expect(r.body.error).toBe(PHOTO_STORE_OFF);
      expect((await rowsOf(a)).length).toBe(before);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    }
  });

  it('gives crew 404 on every photo route, and signed-out visitors 401', async () => {
    const own = (await upload(a, 'repA', makeJpeg())).body.id;
    h.as(a, 'crew');
    expect((await h.upload('/api/roof-reports/photos', makeJpeg())).status).toBe(404);
    expect((await h.get(`/api/roof-reports/${reportOf.a}/photos/${own}/thumb`)).status).toBe(404);
    h.signedOut();
    expect((await h.upload('/api/roof-reports/photos', makeJpeg())).status).toBe(401);
  });

  describe('taking back a photo that is not in a report yet', () => {
    const removeAs = async (co: Co, who: string, id: string) => { h.as(co, who); return h.del(`/api/roof-reports/photos/${id}`); };
    const keysOf = (id: string) => [...store.objects.keys()].filter((k) => k.includes(`/${id}/`));

    it('removes the row and both stored copies of an unused photo, for the person who uploaded it, and says so plainly', async () => {
      const id = (await upload(a, 'repA', makeJpeg())).body.id as string;
      expect(keysOf(id)).toHaveLength(2);
      const r = await removeAs(a, 'repA', id);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id, removed: true });
      expect((await rowsOf(a)).some((x) => x.id === id)).toBe(false);
      expect(keysOf(id)).toEqual([]);
      // Taking it back again is the same "not found" as a photo that never was.
      expect((await removeAs(a, 'repA', id)).status).toBe(404);
    });

    it('frees the place it held in the day\'s waiting count', async () => {
      const [m] = await runAsCompany(a.id, () => db.insert(schema.teamMembers).values({ name: 'Wait Test', email: `${tag}-wait@example.test`.toLowerCase(), role: 'sales', canLogin: true, active: true } as any).returning());
      a.people.wait = { id: m.id, email: m.email!, name: 'Wait Test', role: 'sales' };
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await upload(a, 'wait', makeJpeg())).body.id);
      const waiting = async () => (await rowsOf(a)).filter((x) => x.reportId === null && x.uploadedByMemberId === m.id).length;
      expect(await waiting()).toBe(3);
      await removeAs(a, 'wait', ids[0]);
      expect(await waiting()).toBe(2);
    });

    it('lets a role that sees every report remove anyone\'s unused photo, and no one else but the uploader', async () => {
      const mine = (await upload(a, 'repA', makeJpeg())).body.id as string;
      // Another rep, and a manager who did not upload it, are told it is not there; it stays.
      expect((await removeAs(a, 'repB', mine)).status).toBe(404);
      expect((await rowsOf(a)).some((x) => x.id === mine)).toBe(true);
      expect(keysOf(mine)).toHaveLength(2);
      expect((await removeAs(a, 'admin', mine)).status).toBe(200);
      expect(keysOf(mine)).toEqual([]);
    });

    it('answers crew, another company, a made-up id and a bad id with the same "not found", and changes nothing', async () => {
      const id = (await upload(a, 'repA', makeJpeg())).body.id as string;
      const before = { rows: (await rowsOf(a)).length, objects: store.objects.size };
      for (const [co, who] of [[a, 'crew'], [b, 'admin']] as Array<[Co, string]>) {
        const r = await removeAs(co, who, id);
        expect(r.status, who).toBe(404);
        expect(r.text).toContain(NOT_FOUND);
        expect(r.text).not.toContain(id);
      }
      expect((await removeAs(a, 'admin', crypto.randomUUID())).status).toBe(404);
      expect((await removeAs(a, 'admin', 'not-an-id')).status).toBe(404);
      h.signedOut();
      expect((await h.del(`/api/roof-reports/photos/${id}`)).status).toBe(401);
      expect({ rows: (await rowsOf(a)).length, objects: store.objects.size }).toEqual(before);
    });

    it('refuses a photo that is already in a report, with a plain sentence, and keeps it (reports and their photos are archived, never deleted)', async () => {
      const report = await reportFor(a, 'repA');
      const id = (await upload(a, 'repA', makeJpeg())).body.id as string;
      await runAsCompany(a.id, () => photos.claimPhotos({ email: a.people.repA.email, name: 'a', role: 'sales' }, report, [id]));
      for (const who of ['repA', 'admin']) {
        const r = await removeAs(a, who, id);
        expect(r.status, who).toBe(409);
        expect(r.body).toEqual({ error: PHOTO_IN_REPORT });
      }
      expect((await rowsOf(a)).find((x) => x.id === id)!.reportId).toBe(report);
      expect(keysOf(id)).toHaveLength(2);
    });

    it('keeps the row when the store cannot remove the copies, so it can be tried again, and never shows why', async () => {
      const id = (await upload(a, 'repA', makeJpeg())).body.id as string;
      const failing = { ...store, delete: async () => { throw Object.assign(new Error('secret bucket detail c/abc'), { name: 'AccessDenied' }); } };
      setPhotoStoreForTests(failing);
      const r = await removeAs(a, 'repA', id);
      expect(r.status).toBe(502);
      expect(r.body).toEqual({ error: PHOTO_NOT_REMOVED });
      expect(r.text).not.toMatch(/secret|bucket|c\//);
      expect((await rowsOf(a)).some((x) => x.id === id)).toBe(true);
      setPhotoStoreForTests(store);
      expect((await removeAs(a, 'repA', id)).status).toBe(200);
    });

    it('is a bare 404 while the switch is off, and 503 in plain words when the store is off', async () => {
      const id = (await upload(a, 'repA', makeJpeg())).body.id as string;
      process.env.ARCHIE_ROOF_REPORTS = 'off';
      const off = await removeAs(a, 'repA', id);
      expect(off.status).toBe(404);
      expect(off.text).toBe('');
      process.env.ARCHIE_ROOF_REPORTS = 'on';
      setPhotoStoreForTests(null);
      const saved = Object.fromEntries(['ARCHIE_PHOTOS_ACCOUNT_ID', 'ARCHIE_PHOTOS_ACCESS_KEY_ID', 'ARCHIE_PHOTOS_SECRET_ACCESS_KEY', 'ARCHIE_PHOTOS_BUCKET'].map((k) => [k, process.env[k]]));
      for (const k of Object.keys(saved)) delete process.env[k];
      try {
        expect((await removeAs(a, 'repA', id)).status).toBe(503);
      } finally {
        for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
        setPhotoStoreForTests(store);
      }
      expect((await rowsOf(a)).some((x) => x.id === id)).toBe(true);
    });
  });

  describe('belonging to one report of one company', () => {
    it('lets only the person who uploaded a photo put it in a report, and only once', async () => {
      const mine = (await upload(a, 'repA', makeJpeg())).body.id as string;
      const theirs = (await upload(a, 'repB', makeJpeg())).body.id as string;
      // Rep B cannot take rep A's photo, whoever's report it is.
      expect(await runAsCompany(a.id, () => photos.claimPhotos({ email: a.people.repB.email, name: 'b', role: 'sales' }, reportOf.a, [mine]))).toEqual([]);
      expect((await rowsOf(a)).find((x) => x.id === mine)!.reportId).toBeNull();
      // Rep A takes their own, and not rep B's: left out quietly, not an error that confirms it exists.
      const claimed = await runAsCompany(a.id, () => photos.claimPhotos({ email: a.people.repA.email, name: 'a', role: 'sales' }, reportOf.a, [mine, theirs, crypto.randomUUID(), 'not-an-id']));
      expect(claimed).toEqual([mine]);
      const row = (await rowsOf(a)).find((x) => x.id === mine)!;
      expect(row.reportId).toBe(reportOf.a);
      expect(row.position).toBe(0);
      // Already in a report: a second claim, even by its owner, takes nothing.
      const second = await reportFor(a, 'repA');
      expect(await runAsCompany(a.id, () => photos.claimPhotos({ email: a.people.repA.email, name: 'a', role: 'sales' }, second, [mine]))).toEqual([]);
      expect((await rowsOf(a)).find((x) => x.id === mine)!.reportId).toBe(reportOf.a);
    });

    it('never takes another company\'s photo, whatever id is sent', async () => {
      const foreign = (await upload(b, 'admin', makeJpeg())).body.id as string;
      const claimed = await runAsCompany(a.id, () => photos.claimPhotos({ email: a.people.admin.email, name: 'x', role: 'admin' }, reportOf.a, [foreign]));
      expect(claimed).toEqual([]);
      expect((await rowsOf(b)).find((x) => x.id === foreign)!.reportId).toBeNull();
      // And the other company's own person cannot put it in company A's report.
      expect(await runAsCompany(b.id, () => photos.claimPhotos({ email: b.people.admin.email, name: 'x', role: 'admin' }, reportOf.a, [foreign]))).toEqual([]);
    });

    it('numbers the photos in the order they were asked for', async () => {
      const report = await reportFor(a, 'repA');
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await upload(a, 'repA', makeJpeg())).body.id);
      const claimed = await runAsCompany(a.id, () => photos.claimPhotos({ email: a.people.repA.email, name: 'a', role: 'sales' }, report, [ids[2], ids[0], ids[1]]));
      expect(claimed).toEqual([ids[2], ids[0], ids[1]]);
      const listed = await runAsCompany(a.id, () => photos.photosOfReport(report));
      expect(listed.map((p) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
    });
  });

  describe('showing a photo', () => {
    let reportId = ''; let photoId = '';
    beforeAll(async () => {
      reportId = await reportFor(a, 'repA');
      photoId = (await upload(a, 'repA', makeJpeg())).body.id;
      await runAsCompany(a.id, () => photos.claimPhotos({ email: a.people.repA.email, name: 'a', role: 'sales' }, reportId, [photoId]));
    });

    it('streams the copy through the signed-in route to the people who may see the report', async () => {
      for (const who of ['repA', 'admin']) {
        h.as(a, who);
        const r = await h.get(`/api/roof-reports/${reportId}/photos/${photoId}/working`);
        expect(r.status, who).toBe(200);
        expect(r.headers.get('content-type')).toBe('image/jpeg');
        expect(r.headers.get('cache-control')).toMatch(/private/);
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
        expect(r.bytes[0]).toBe(0xff);
        expect((await h.get(`/api/roof-reports/${reportId}/photos/${photoId}/thumb`)).status, who).toBe(200);
        expect((await h.get(`/api/roof-reports/${reportId}/photos/${photoId}/original`)).status, who).toBe(404);
      }
    });

    it('answers 404 to a rep who cannot see the report, another company, another report\'s id and a made-up id', async () => {
      h.as(a, 'repB');
      expect((await h.get(`/api/roof-reports/${reportId}/photos/${photoId}/working`)).status).toBe(404);
      h.as(b, 'admin');
      const cross = await h.get(`/api/roof-reports/${reportId}/photos/${photoId}/working`);
      expect(cross.status).toBe(404);
      expect(cross.bytes.length).toBeLessThan(200);
      h.as(a, 'admin');
      expect((await h.get(`/api/roof-reports/${reportOf.a}/photos/${photoId}/working`)).status).toBe(404);
      expect((await h.get(`/api/roof-reports/${reportId}/photos/${crypto.randomUUID()}/working`)).status).toBe(404);
      expect((await h.get(`/api/roof-reports/${reportId}/photos/not-an-id/working`)).status).toBe(404);
      expect((await h.get(`/api/roof-reports/../photos/${photoId}/working`)).status).toBe(404);
    });

    it('never says what is in the store, or where', async () => {
      h.as(a, 'admin');
      const lost = [...store.objects.keys()].find((k) => k.includes(photoId) && k.endsWith('thumb.jpg'))!;
      const saved = store.objects.get(lost)!;
      store.objects.delete(lost);
      const r = await h.get(`/api/roof-reports/${reportId}/photos/${photoId}/thumb`);
      store.objects.set(lost, saved);
      expect(r.status).toBe(404);
      expect(r.text).not.toContain('c/');
      expect(r.text).not.toContain(lost);
    });

    it('hands the copy to anyone holding a short signed link, only while it lasts and only for what it names', async () => {
      h.signedOut();
      const token = signPhotoLink({ companyId: a.id, reportId, photoId, variant: 'working' });
      const ok = await h.get(`/api/roof-reports/linked-photo/${token}`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toBe('image/jpeg');
      expect(ok.headers.get('cache-control')).toMatch(/private/);
      // A link for another photo of the same report, another report, another company: not found.
      const otherPhoto = signPhotoLink({ companyId: a.id, reportId, photoId: crypto.randomUUID(), variant: 'working' });
      expect((await h.get(`/api/roof-reports/linked-photo/${otherPhoto}`)).status).toBe(404);
      const otherReport = signPhotoLink({ companyId: a.id, reportId: reportOf.a, photoId, variant: 'working' });
      expect((await h.get(`/api/roof-reports/linked-photo/${otherReport}`)).status).toBe(404);
      const otherCompany = signPhotoLink({ companyId: b.id, reportId, photoId, variant: 'working' });
      expect((await h.get(`/api/roof-reports/linked-photo/${otherCompany}`)).status).toBe(404);
      // Changed or out of date.
      expect((await h.get(`/api/roof-reports/linked-photo/${token.slice(0, -3)}abc`)).status).toBe(404);
      const old = signPhotoLink({ companyId: a.id, reportId, photoId, variant: 'working' }, Date.now() - 3600_000);
      expect((await h.get(`/api/roof-reports/linked-photo/${old}`)).status).toBe(404);
      expect((await h.get('/api/roof-reports/linked-photo/nonsense')).status).toBe(404);
    });

    it('stops handing out the copy once the report is archived, and is a bare 404 while the switch is off', async () => {
      const token = signPhotoLink({ companyId: a.id, reportId, photoId, variant: 'thumb' });
      process.env.ARCHIE_ROOF_REPORTS = 'off';
      const off = await h.get(`/api/roof-reports/linked-photo/${token}`);
      expect(off.status).toBe(404);
      expect(off.text).toBe('');
      process.env.ARCHIE_ROOF_REPORTS = 'on';
      expect((await h.get(`/api/roof-reports/linked-photo/${token}`)).status).toBe(200);
      await runAsCompany(a.id, () => db.update(schema.roofReports).set({ status: 'archived' }).where(eq(schema.roofReports.id, reportId)));
      expect((await h.get(`/api/roof-reports/linked-photo/${token}`)).status).toBe(404);
      await runAsCompany(a.id, () => db.update(schema.roofReports).set({ status: 'ready' }).where(eq(schema.roofReports.id, reportId)));
    });
  });

  it('keeps every key of every row under its own company\'s prefix (the database says so too)', async () => {
    for (const co of [a, b]) for (const row of await rowsOf(co)) {
      expect(row.workingKey.startsWith(`c/${co.id}/rr/`)).toBe(true);
      expect(row.thumbKey.startsWith(`c/${co.id}/rr/`)).toBe(true);
    }
    const bad = runAsCompany(a.id, () => db.execute(sql`insert into roof_report_photos (working_key, thumb_key) values (${`c/${b.id}/rr/pending/x/working.jpg`}, ${`c/${b.id}/rr/pending/x/thumb.jpg`})`));
    await expect(bad).rejects.toBeTruthy();
    expect(NOT_FOUND).toBeTruthy();
  });
});
