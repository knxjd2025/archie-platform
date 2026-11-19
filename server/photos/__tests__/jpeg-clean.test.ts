import { describe, it, expect } from 'vitest';
import { cleanJpeg, jpegMarkers } from '../jpeg-clean';
import { makeJpeg, cleanJpegFixture, dht, dqt, jfif, jpegOf, pictureParts, scan, seg, sof0, sos, xmpWithGps } from './jpeg-fixtures';

const EXIF = Buffer.from('Exif\0\0', 'latin1');
const DROPPED = (m: number) => (m >= 0xe1 && m <= 0xef) || m === 0xfe;

describe('cleaning a JPEG before it is stored', () => {
  it('takes out the Exif block with its GPS position, the APP13 block and the comment', () => {
    const dirty = makeJpeg({ exif: true, app13: true, comment: true });
    expect(dirty.includes(EXIF)).toBe(true);
    const r = cleanJpeg(dirty);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jpeg.includes(EXIF)).toBe(false);
    expect(r.jpeg.includes(Buffer.from('GPS', 'latin1'))).toBe(false);
    expect(r.jpeg.includes(Buffer.from('8BIM', 'latin1'))).toBe(false);
    expect(r.jpeg.includes(Buffer.from('Main St', 'latin1'))).toBe(false);
    const markers = jpegMarkers(r.jpeg)!;
    expect(markers.filter(DROPPED)).toEqual([]);
  });

  it('keeps what the picture needs: start, header, tables, frame, scan and end', () => {
    const r = cleanJpeg(makeJpeg({ exif: true, app13: true, comment: true }));
    if (!r.ok) throw new Error(r.reason);
    expect([r.jpeg[0], r.jpeg[1]]).toEqual([0xff, 0xd8]);
    expect([r.jpeg[r.jpeg.length - 2], r.jpeg[r.jpeg.length - 1]]).toEqual([0xff, 0xd9]);
    expect(jpegMarkers(r.jpeg)).toEqual([0xd8, 0xe0, 0xdb, 0xc0, 0xc4, 0xda, 0xd9]);
    // The scan comes through byte for byte, stuffed bytes and restart marker included.
    expect(r.jpeg.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]))).toBe(true);
    expect({ width: r.width, height: r.height }).toEqual({ width: 1600, height: 1200 });
  });

  it('leaves a JPEG that has nothing to take out exactly as it was', () => {
    const clean = cleanJpegFixture(400, 300);
    const r = cleanJpeg(clean);
    if (!r.ok) throw new Error(r.reason);
    expect(r.jpeg.equals(clean)).toBe(true);
    expect({ width: r.width, height: r.height }).toEqual({ width: 400, height: 300 });
  });

  it('drops anything after the end of the picture (a second picture with its own Exif)', () => {
    const r = cleanJpeg(makeJpeg({ trailing: true }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.jpeg.includes(EXIF)).toBe(false);
    expect(r.jpeg.equals(cleanJpegFixture())).toBe(true);
  });

  it('refuses anything that is not a whole JPEG', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1')]);
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic', 'latin1')]);
    const whole = makeJpeg({ exif: true });
    for (const bad of [png, webp, heic, Buffer.alloc(0), Buffer.from([0xff, 0xd8]), Buffer.from('not a photo')]) {
      expect(cleanJpeg(bad).ok).toBe(false);
    }
    // Cut short anywhere: inside the Exif block, inside the scan, or just before the end.
    for (const cut of [20, whole.length - 6, whole.length - 1]) {
      expect(cleanJpeg(whole.subarray(0, cut)).ok, `cut at ${cut}`).toBe(false);
    }
  });

  it('refuses a segment whose length runs past the end', () => {
    const bad = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x40, 0x00]), Buffer.alloc(8)]);
    expect(cleanJpeg(bad).ok).toBe(false);
  });

  it('refuses a JPEG with no picture in it (no frame or no scan)', () => {
    expect(cleanJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xd9])).ok).toBe(false);
  });

  // ------------------------------------------------------------------
  // Only the blocks a picture needs are kept. Every other block, wherever
  // it sits and whatever it is called, goes, so a GPS position cannot ride
  // through in one the cleaner did not think to name.

  const GPS = Buffer.from('GPSLatitude', 'latin1');
  const [header, ...rest] = pictureParts();

  it('takes out an XMP packet with a GPS position in any block a viewer skips', () => {
    const skipped: Array<[string, number]> = [
      ['a second APP0', 0xe0],
      ['JPG0 (F0)', 0xf0], ['JPG7 (F7)', 0xf7], ['JPG13 (FD)', 0xfd],
      ['a reserved marker (02)', 0x02], ['a reserved marker (50)', 0x50], ['a reserved marker (BF)', 0xbf],
      ['JPG (C8)', 0xc8],
    ];
    for (const [name, marker] of skipped) {
      const dirty = jpegOf(header, seg(marker, xmpWithGps()), ...rest);
      expect(dirty.includes(GPS), name).toBe(true);
      const r = cleanJpeg(dirty);
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      expect(r.jpeg.includes(GPS), name).toBe(false);
      expect(r.jpeg.equals(cleanJpegFixture()), name).toBe(true);
    }
  });

  it('keeps APP0 only as a bare JFIF header right after the start, never one that carries more', () => {
    const jfifHead = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01]);
    const carrying: Array<[string, Buffer]> = [
      // Not a JFIF header at all (JFXX is the JFIF extension that holds a thumbnail).
      ['an APP0 that is not JFIF', seg(0xe0, Buffer.concat([Buffer.from('JFXX\0\x10', 'latin1'), xmpWithGps()]))],
      // A JFIF header with a packet after it.
      ['a JFIF header with more after it', seg(0xe0, Buffer.concat([jfifHead, Buffer.from([0, 0]), xmpWithGps()]))],
      // A JFIF header with a one-pixel thumbnail: its pixels are not the picture.
      ['a JFIF header with a thumbnail', seg(0xe0, Buffer.concat([jfifHead, Buffer.from([1, 1]), Buffer.from([0x10, 0x20, 0x30])]))],
    ];
    for (const [name, app0] of carrying) {
      const r = cleanJpeg(jpegOf(app0, ...rest));
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      expect(r.jpeg.includes(GPS), name).toBe(false);
      expect(jpegMarkers(r.jpeg), name).toEqual([0xd8, 0xdb, 0xc0, 0xc4, 0xda, 0xd9]);
    }
    // A bare JFIF header anywhere but first is dropped too.
    const late = cleanJpeg(jpegOf(dqt(), jfif(), sof0(1600, 1200), dht(), sos(), scan()));
    if (!late.ok) throw new Error(late.reason);
    expect(jpegMarkers(late.jpeg)).toEqual([0xd8, 0xdb, 0xc0, 0xc4, 0xda, 0xd9]);
  });

  it('refuses a table, frame or scan header that carries anything past what it holds', () => {
    const withTail = (b: Buffer) => {
      // The same segment with the packet added inside it, its length grown to match.
      const body = Buffer.concat([b.subarray(4), xmpWithGps()]);
      return seg(b[1], body);
    };
    const dri = seg(0xdd, Buffer.from([0x00, 0x10]));
    const cases: Array<[string, Buffer[]]> = [
      ['quantisation tables', [header, withTail(dqt()), sof0(1600, 1200), dht(), sos(), scan()]],
      ['Huffman tables', [header, dqt(), sof0(1600, 1200), withTail(dht()), sos(), scan()]],
      ['the frame header', [header, dqt(), withTail(sof0(1600, 1200)), dht(), sos(), scan()]],
      ['the scan header', [header, dqt(), sof0(1600, 1200), dht(), withTail(sos()), scan()]],
      ['the restart interval', [header, dqt(), withTail(dri), sof0(1600, 1200), dht(), sos(), scan()]],
    ];
    for (const [name, parts] of cases) {
      expect(cleanJpeg(jpegOf(...parts)).ok, name).toBe(false);
    }
    // The same restart interval with nothing extra in it is kept.
    const ok = cleanJpeg(jpegOf(header, dqt(), dri, sof0(1600, 1200), dht(), sos(), scan()));
    if (!ok.ok) throw new Error(ok.reason);
    expect(jpegMarkers(ok.jpeg)).toEqual([0xd8, 0xe0, 0xdb, 0xdd, 0xc0, 0xc4, 0xda, 0xd9]);
  });

  it('refuses the arithmetic and hierarchical tables, which the browser never makes and which cannot be dropped without changing the picture', () => {
    for (const marker of [0xcc, 0xde, 0xdf]) {
      expect(cleanJpeg(jpegOf(header, seg(marker, xmpWithGps()), ...rest)).ok, marker.toString(16)).toBe(false);
    }
  });

  it('refuses a file with an XMP packet or a GPS tag name anywhere in what it would keep, even in the scan', () => {
    const inScan = jpegOf(header, dqt(), sof0(1600, 1200), dht(), sos(), Buffer.concat([scan(), xmpWithGps()]));
    expect(cleanJpeg(inScan)).toEqual({ ok: false, reason: 'metadata could not be taken out' });
    const bareTag = jpegOf(header, dqt(), sof0(1600, 1200), dht(), sos(), Buffer.concat([scan(), Buffer.from('GPSLongitude 92.4453W', 'latin1')]));
    expect(cleanJpeg(bareTag).ok).toBe(false);
  });

  it('keeps a progressive picture: tables between scans, and every scan', () => {
    const sof2 = seg(0xc2, sof0(800, 600).subarray(4));
    const progressive = jpegOf(header, dqt(), sof2, dht(), sos(), scan(), dht(), sos(), scan());
    const r = cleanJpeg(progressive);
    if (!r.ok) throw new Error(r.reason);
    expect(r.jpeg.equals(progressive)).toBe(true);
    expect({ width: r.width, height: r.height }).toEqual({ width: 800, height: 600 });
  });
});
