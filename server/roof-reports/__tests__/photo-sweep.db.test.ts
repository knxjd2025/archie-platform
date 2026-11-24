/**
 * The sweep that removes stored roof report photo copies that have no row
 * (server/roof-reports/photo-sweep.ts): what a failed removal or a failed save
 * leaves behind. A dry run by default; never touches a copy that has a row, a
 * copy that is young enough to be mid-upload, another company's copy, or a job
 * photo. In-memory store: no test talks to Cloudflare.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { roofReportPhotoKey } from '../../photos/store';
import { makeJpeg } from '../../photos/__tests__/jpeg-fixtures';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('sweeping stored photo copies with no row (database)', async () => {
  const tag = `rrsweep-${process.pid}-${Date.now()}`;
  const { requireRoofReportsOn } = await import('../switch');
  const { photoRouter } = await import('../photos');
  const h = await startRoofApp(tag, (app) => app.use('/api/roof-reports', requireRoofReportsOn, photoRouter()));
  const { db, schema, runAsCompany } = h;
  const { sweepOrphanCopies, SWEEP_GRACE_MS } = await import('../photo-sweep');
  const { setPhotoStoreForTests } = await import('../../photos/store');
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  const store = fakeStore();
  let a: Co; let b: Co;
  const uuid = () => crypto.randomUUID();
  const HOUR = 60 * 60 * 1000;

  const orphan = async (co: Co, ageMs: number, scope = 'pending') => {
    const id = uuid();
    const keys = (['working', 'thumb'] as const).map((v) => roofReportPhotoKey(co.id, scope, id, v));
    for (const k of keys) { await store.put(k, Buffer.from('x')); store.modified.set(k, new Date(Date.now() - ageMs)); }
    return { id, keys };
  };
  const notes = async (co: Co) => (await runAsCompany(co.id, () => db.select().from(schema.writeLog))).filter((n) => n.action === 'sweep_roof_report_photo_copy');

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(store);
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['rep', 'sales']]);
    b = await h.company('Cedar Falls Roofing Two', [['admin', 'admin']]);
  });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  it('is a dry run unless told to apply: it names the orphans and removes nothing', async () => {
    const o = await orphan(a, 3 * HOUR);
    const r = await sweepOrphanCopies({ store, companyId: a.id, apply: false });
    expect(r.orphans).toEqual(expect.arrayContaining(o.keys));
    expect(r.removed).toBe(0);
    for (const k of o.keys) expect(store.objects.has(k)).toBe(true);
  });

  it('removes the copies that have no row when told to apply, and notes each one', async () => {
    const o = await orphan(a, 3 * HOUR);
    const r = await sweepOrphanCopies({ store, companyId: a.id, apply: true });
    expect(r.failed).toBe(0);
    for (const k of o.keys) expect(store.objects.has(k), k).toBe(false);
    expect((await notes(a)).filter((n) => n.targetId === o.id && n.ok)).toHaveLength(2);
  });

  it('never touches a copy that has a row (waiting or in a report), one younger than the grace, another company\'s copy, or a job photo', async () => {
    h.as(a, 'rep');
    const up = await h.upload('/api/roof-reports/photos', makeJpeg());
    const kept = (await runAsCompany(a.id, () => db.select().from(schema.roofReportPhotos))).find((x) => x.id === up.body.id)!;
    store.modified.set(kept.workingKey, new Date(Date.now() - 5 * HOUR));
    store.modified.set(kept.thumbKey, new Date(Date.now() - 5 * HOUR));
    const young = await orphan(a, SWEEP_GRACE_MS - 60_000);
    const theirs = await orphan(b, 5 * HOUR);
    const jobPhoto = `c/${a.id}/p/${uuid()}/working.jpg`;
    await store.put(jobPhoto, Buffer.from('job'));
    store.modified.set(jobPhoto, new Date(Date.now() - 5 * HOUR));

    const r = await sweepOrphanCopies({ store, companyId: a.id, apply: true });
    expect(r.orphans).not.toEqual(expect.arrayContaining([kept.workingKey]));
    for (const k of [kept.workingKey, kept.thumbKey, ...young.keys, ...theirs.keys, jobPhoto]) expect(store.objects.has(k), k).toBe(true);
  });

  it('keeps going when one copy cannot be removed, counts it, and notes it plainly without the error\'s message', async () => {
    const bad = await orphan(a, 3 * HOUR);
    const good = await orphan(a, 3 * HOUR);
    const failing = { ...store, delete: async (key: string) => {
      if (bad.keys.includes(key)) throw Object.assign(new Error('secret bucket detail c/abc'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
      await store.delete(key);
    } };
    const r = await sweepOrphanCopies({ store: failing, companyId: a.id, apply: true });
    expect(r.failed).toBe(bad.keys.length);
    for (const k of good.keys) expect(store.objects.has(k)).toBe(false);
    for (const k of bad.keys) expect(store.objects.has(k)).toBe(true);
    const failed = (await notes(a)).filter((n) => !n.ok);
    expect(failed.length).toBeGreaterThanOrEqual(bad.keys.length);
    for (const n of failed) { expect(n.error).toBe('AccessDenied 403'); expect(`${n.summary}${n.error}`).not.toMatch(/secret|bucket|c\/abc/); }
    // The next sweep finishes the job.
    await sweepOrphanCopies({ store, companyId: a.id, apply: true });
    for (const k of bad.keys) expect(store.objects.has(k)).toBe(false);
  });

  it('ignores a key the store lists that is not one of this company\'s roof report copies, whatever it says', async () => {
    const stray = `c/${b.id}/rr/pending/${uuid()}/working.jpg`;
    const hostile = { ...store, list: async () => [{ key: stray, lastModified: new Date(0) }, { key: 'c/not-a-key', lastModified: new Date(0) }] };
    await store.put(stray, Buffer.from('x')); store.modified.set(stray, new Date(0));
    const r = await sweepOrphanCopies({ store: hostile, companyId: a.id, apply: true });
    expect(r.orphans).toEqual([]);
    expect(store.objects.has(stray)).toBe(true);
  });

  it('says plainly it cannot run when the store cannot list or remove', async () => {
    const { list: _l, ...noList } = store;
    await expect(sweepOrphanCopies({ store: noList, companyId: a.id, apply: true })).rejects.toThrow(/cannot list/i);
    const { delete: _d, ...noDelete } = store;
    await expect(sweepOrphanCopies({ store: noDelete, companyId: a.id, apply: true })).rejects.toThrow(/cannot remove/i);
    // A dry run needs only to list.
    await expect(sweepOrphanCopies({ store: noDelete, companyId: a.id, apply: false })).resolves.toBeTruthy();
  });

  it('refuses an id that is not a company', async () => {
    await expect(sweepOrphanCopies({ store, companyId: 'nope', apply: false })).rejects.toThrow(/company/i);
  });
});
