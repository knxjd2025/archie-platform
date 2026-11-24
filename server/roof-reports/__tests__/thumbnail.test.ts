/**
 * The small copy of a report photo: a real thumbnail, longest side 480 px,
 * made from the cleaned copy, with no location data in it. It is made with
 * jpeg-js (pure JavaScript, no native code), the only JPEG decoder and encoder
 * Archie has. Fictional photo: a roof, drawn as flat colours.
 */
import { describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { cleanJpeg } from '../../photos/jpeg-clean';
import { exifWithGps, makeJpeg, seg, xmpWithGps } from '../../photos/__tests__/jpeg-fixtures';
import { THUMB_LONGEST_SIDE, makeThumbnail } from '../thumbnail';

/** A real JPEG: left half red, right half blue, with a texture so it does not compress to nothing. */
function realJpeg(width: number, height: number, withLocation = false): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const noise = ((x * 7 + y * 13) % 29) * 2;
      data[i] = x < width / 2 ? 200 + noise / 2 : 30; data[i + 1] = 40 + noise; data[i + 2] = x < width / 2 ? 30 : 200 + noise / 2; data[i + 3] = 255;
    }
  }
  const plain = Buffer.from(jpeg.encode({ data, width, height }, 90).data);
  if (!withLocation) return plain;
  // Put a phone's location after the start of the picture, in the blocks a phone uses.
  return Buffer.concat([plain.subarray(0, 2), exifWithGps(), seg(0xe1, xmpWithGps()), seg(0xfe, Buffer.from('12 Elm Street, Cedar Falls', 'latin1')), plain.subarray(2)]);
}

const decode = (b: Buffer) => jpeg.decode(b, { useTArray: true });
const pixel = (d: ReturnType<typeof decode>, x: number, y: number) => { const i = (y * d.width + x) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
const LOCATION_MARKS = [/Exif/, /GPS/, /XMP/i, /ns\.adobe/, /Elm Street/, /Cedar Falls/, /exif:/];

describe('makeThumbnail', () => {
  it('makes a small picture, longest side 480, from a large one', () => {
    const source = realJpeg(2400, 1800);
    const thumb = makeThumbnail(source)!;
    expect(thumb).not.toBeNull();
    const d = decode(thumb);
    expect({ w: d.width, h: d.height }).toEqual({ w: THUMB_LONGEST_SIDE, h: 360 });
    expect(THUMB_LONGEST_SIDE).toBe(480);
    expect(thumb.length).toBeLessThan(80 * 1024);
    expect(thumb.length * 8).toBeLessThan(source.length);
  });

  it('keeps the shape of a tall picture', () => {
    const d = decode(makeThumbnail(realJpeg(1200, 1800))!);
    expect({ w: d.width, h: d.height }).toEqual({ w: 320, h: THUMB_LONGEST_SIDE });
  });

  it('shows the same picture, not a flipped, shifted or washed-out one', () => {
    const d = decode(makeThumbnail(realJpeg(2400, 1200))!);
    const left = pixel(d, 60, 120); const right = pixel(d, d.width - 60, 120);
    expect(left[0]).toBeGreaterThan(150); expect(left[2]).toBeLessThan(90);
    expect(right[2]).toBeGreaterThan(150); expect(right[0]).toBeLessThan(90);
  });

  it('does not make a small picture larger', () => {
    const d = decode(makeThumbnail(realJpeg(300, 200))!);
    expect({ w: d.width, h: d.height }).toEqual({ w: 300, h: 200 });
  });

  it('carries no location data, whether it was given the cleaned copy or the raw upload', () => {
    const raw = realJpeg(1600, 1200, true);
    for (const mark of LOCATION_MARKS) expect(raw.toString('latin1')).toMatch(mark); // the test would catch it
    const cleaned = cleanJpeg(raw);
    expect(cleaned.ok).toBe(true);
    for (const input of [cleaned.ok ? cleaned.jpeg : raw, raw]) {
      const thumb = makeThumbnail(input)!;
      expect(thumb).not.toBeNull();
      for (const mark of LOCATION_MARKS) expect(thumb.toString('latin1'), String(mark)).not.toMatch(mark);
      // Cleaning it again finds nothing to take out: it already holds only what a picture needs.
      const again = cleanJpeg(thumb);
      expect(again.ok && again.jpeg.equals(thumb)).toBe(true);
    }
  });

  it('gives nothing for a file it cannot read, rather than guessing', () => {
    expect(makeThumbnail(makeJpeg())).toBeNull();
    expect(makeThumbnail(Buffer.from('not a picture'))).toBeNull();
    expect(makeThumbnail(Buffer.alloc(0))).toBeNull();
    expect(makeThumbnail(realJpeg(800, 600).subarray(0, 900))).toBeNull();
  });

  it('refuses a picture that claims an enormous size, quickly, without building it', () => {
    const started = Date.now();
    expect(makeThumbnail(makeJpeg({ width: 30000, height: 30000 }))).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
