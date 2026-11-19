import { describe, it, expect } from 'vitest';
import { cleanJpeg, jpegMarkers } from '../jpeg-clean';
import { makeJpeg, cleanJpegFixture } from './jpeg-fixtures';

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
});
