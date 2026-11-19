import { describe, it, expect } from 'vitest';
import { exifTakenAt } from '../photo-exif';

type Entry = { tag: number; text: string };

/** An Exif block: IFD0 points at an Exif IFD holding the given text entries (and GPS, which must be ignored). */
function jpegWithExif(entries: Entry[], littleEndian = true, ifd0Extra: Entry[] = []): Uint8Array {
  const buf = new ArrayBuffer(512);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const le = littleEndian;
  let p = 0;
  const w8 = (n: number) => { v.setUint8(p, n); p += 1; };
  w8(0xff); w8(0xd8); w8(0xff); w8(0xe0); v.setUint16(p, 16); p += 2; p += 14;           // APP0, skipped
  w8(0xff); w8(0xe1); const lenAt = p; p += 2;
  for (const c of 'Exif\0\0') w8(c.charCodeAt(0));
  const tiff = p;
  w8(le ? 0x49 : 0x4d); w8(le ? 0x49 : 0x4d); v.setUint16(p, 42, le); p += 2; v.setUint32(p, 8, le); p += 4;
  // IFD0: the Exif IFD pointer, then any extra text entries.
  const ifd0 = [{ tag: 0x8769, text: '' }, ...ifd0Extra];
  const ifd0At = tiff + 8;
  const ifd0Size = 2 + ifd0.length * 12 + 4;
  const exifAt = ifd0At + ifd0Size;
  const exifSize = 2 + entries.length * 12 + 4;
  let data = exifAt + exifSize;
  const writeIfd = (at: number, list: Entry[]) => {
    v.setUint16(at, list.length, le);
    list.forEach((e, i) => {
      const o = at + 2 + i * 12;
      v.setUint16(o, e.tag, le);
      if (e.tag === 0x8769) { v.setUint16(o + 2, 4, le); v.setUint32(o + 4, 1, le); v.setUint32(o + 8, exifAt - tiff, le); return; }
      v.setUint16(o + 2, 2, le); v.setUint32(o + 4, e.text.length + 1, le);
      if (e.text.length + 1 <= 4) { for (let k = 0; k < e.text.length; k++) u8[o + 8 + k] = e.text.charCodeAt(k); return; }
      v.setUint32(o + 8, data - tiff, le);
      for (let k = 0; k < e.text.length; k++) u8[data + k] = e.text.charCodeAt(k);
      data += e.text.length + 1;
    });
    v.setUint32(at + 2 + list.length * 12, 0, le);
  };
  writeIfd(ifd0At, ifd0);
  writeIfd(exifAt, entries);
  v.setUint16(lenAt, data - lenAt);
  p = data;
  w8(0xff); w8(0xda);
  return u8.slice(0, p + 8);
}

describe('when a photo was taken, read from the photo itself', () => {
  it('reads DateTimeOriginal as the phone\'s own local time', () => {
    const iso = exifTakenAt(jpegWithExif([{ tag: 0x9003, text: '2026:11:18 09:30:15' }]));
    expect(iso).toBe(new Date(2026, 10, 18, 9, 30, 15).toISOString());
  });

  it('uses the offset the camera wrote, when it wrote one', () => {
    const iso = exifTakenAt(jpegWithExif([{ tag: 0x9003, text: '2026:11:18 09:30:15' }, { tag: 0x9011, text: '-06:00' }], false));
    expect(iso).toBe('2026-11-18T15:30:15.000Z');
  });

  it('falls back to the photo\'s DateTime when there is no original date', () => {
    const iso = exifTakenAt(jpegWithExif([], true, [{ tag: 0x0132, text: '2025:07:04 18:00:00' }]));
    expect(iso).toBe(new Date(2025, 6, 4, 18, 0, 0).toISOString());
  });

  it('gives nothing for a photo with no date, a blank date, or no Exif at all', () => {
    expect(exifTakenAt(jpegWithExif([]))).toBeNull();
    expect(exifTakenAt(jpegWithExif([{ tag: 0x9003, text: '0000:00:00 00:00:00' }]))).toBeNull();
    expect(exifTakenAt(jpegWithExif([{ tag: 0x9003, text: '    :  :     :  :  ' }]))).toBeNull();
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 0]))).toBeNull();
    expect(exifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(exifTakenAt(new Uint8Array(0))).toBeNull();
  });

  it('never throws on a cut-off or broken block', () => {
    const whole = jpegWithExif([{ tag: 0x9003, text: '2026:11:18 09:30:15' }]);
    for (let cut = 0; cut < whole.length; cut += 7) expect(() => exifTakenAt(whole.slice(0, cut))).not.toThrow();
  });
});
