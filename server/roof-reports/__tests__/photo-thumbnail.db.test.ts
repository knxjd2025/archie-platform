/**
 * The thumbnail a report photo is stored with, through the real upload route:
 * a real small copy beside the full cleaned one, neither with location data.
 * A file that cannot be decoded keeps the old behaviour (the thumbnail is the
 * cleaned copy), so no upload that worked before is refused now.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jpeg from 'jpeg-js';
import { exifWithGps, makeJpeg, seg, xmpWithGps } from '../../photos/__tests__/jpeg-fixtures';
import { setPhotoStoreForTests } from '../../photos/store';
import { fakeStore, localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

function realJpegWithLocation(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 4, 180);
  for (let i = 0; i < data.length; i += 4) { data[i] = (i / 4) % 251; data[i + 3] = 255; }
  const plain = Buffer.from(jpeg.encode({ data, width, height }, 90).data);
  return Buffer.concat([plain.subarray(0, 2), exifWithGps(), seg(0xe1, xmpWithGps()), plain.subarray(2)]);
}

describe.skipIf(!localDb)('the stored thumbnail (database)', async () => {
  const tag = `rrthumb-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { eq } = await import('drizzle-orm');
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app));
  const { db, schema, runAsCompany } = h;
  const store = fakeStore();
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  let co: Co;

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    setPhotoStoreForTests(store);
    co = await h.company('Summit Ridge Roofing', [['rep', 'sales']]);
  });
  beforeEach(() => { __resetRateLimits(); h.as(co, 'rep'); });
  afterAll(async () => {
    setPhotoStoreForTests(null);
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    await h.close();
  });

  const copiesOf = async (id: string) => {
    const [row] = await runAsCompany(co.id, () => db.select().from(schema.roofReportPhotos).where(eq(schema.roofReportPhotos.id, id)));
    return { working: store.objects.get(row.workingKey)!, thumb: store.objects.get(row.thumbKey)! };
  };

  it('stores a real small thumbnail beside the full cleaned copy, neither with a location', async () => {
    const upload = realJpegWithLocation(2400, 1800);
    const r = await h.upload('/api/roof-reports/photos', upload);
    expect(r.status).toBe(200);
    const { working, thumb } = await copiesOf(r.body.id);
    expect(working.length).toBeGreaterThan(thumb.length * 4);
    const full = jpeg.decode(working, { useTArray: true });
    const small = jpeg.decode(thumb, { useTArray: true });
    expect({ w: full.width, h: full.height }).toEqual({ w: 2400, h: 1800 });
    expect({ w: small.width, h: small.height }).toEqual({ w: 480, h: 360 });
    for (const copy of [working, thumb]) for (const mark of [/Exif/, /GPS/, /XMP/i, /ns\.adobe/]) expect(copy.toString('latin1')).not.toMatch(mark);
  });

  it('makes the thumbnail 480 wide whatever the size of the upload', async () => {
    const r = await h.upload('/api/roof-reports/photos', realJpegWithLocation(1200, 900));
    const { thumb } = await copiesOf(r.body.id);
    expect(jpeg.decode(thumb, { useTArray: true }).width).toBe(480);
  });

  it('keeps an upload it cannot decode, with the cleaned copy as its thumbnail as before', async () => {
    const r = await h.upload('/api/roof-reports/photos', makeJpeg({ exif: true }));
    expect(r.status).toBe(200);
    const { working, thumb } = await copiesOf(r.body.id);
    expect(thumb.equals(working)).toBe(true);
    expect(working.toString('latin1')).not.toMatch(/Exif|GPS/);
  });
});
