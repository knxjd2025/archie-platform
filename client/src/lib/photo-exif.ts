/**
 * When a photo was taken, read in the browser from the photo's own Exif block
 * BEFORE the photo is redrawn on a canvas (components/JobPhotos.tsx). The
 * redraw drops every metadata block, the date included, and the server takes
 * out anything left (server/photos/jpeg-clean.ts), so this is the only chance
 * to read it. Only the date is read: nothing else in the block, and never the
 * location, leaves the phone.
 *
 * Reads DateTimeOriginal (falling back to DateTime), with the camera's
 * OffsetTimeOriginal when it wrote one, else the phone's own time zone.
 * Returns an ISO time, or null for anything it cannot read. Never throws.
 */

/** How much of the start of a file holds its Exif block (it comes before the picture). */
export const EXIF_READ_BYTES = 128 * 1024;

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_ORIGINAL = 0x9011;

/** The text entries of one IFD, by tag. */
function readIfd(v: DataView, tiff: number, at: number, le: boolean): Map<number, { type: number; count: number; valueAt: number }> {
  const out = new Map<number, { type: number; count: number; valueAt: number }>();
  if (at + 2 > v.byteLength) return out;
  const n = v.getUint16(at, le);
  for (let i = 0; i < n && i < 512; i++) {
    const o = at + 2 + i * 12;
    if (o + 12 > v.byteLength) break;
    const type = v.getUint16(o + 2, le);
    const count = v.getUint32(o + 4, le);
    // Values of four bytes or fewer sit in the entry itself; longer ones are at an offset from the TIFF header.
    const size = type === 2 ? count : 4;
    const valueAt = size <= 4 ? o + 8 : tiff + v.getUint32(o + 8, le);
    out.set(v.getUint16(o, le), { type, count, valueAt });
  }
  return out;
}

function readText(v: DataView, e: { type: number; count: number; valueAt: number } | undefined): string | null {
  if (!e || e.type !== 2 || e.count > 64 || e.valueAt + e.count > v.byteLength) return null;
  let s = '';
  for (let i = 0; i < e.count; i++) {
    const c = v.getUint8(e.valueAt + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** "YYYY:MM:DD HH:MM:SS" (and an optional "+HH:MM") as an ISO time, or null. */
function toIso(text: string | null, offset: string | null): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text || '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const off = /^([+-])(\d{2}):(\d{2})$/.exec(offset || '');
  const when = off
    ? new Date(Date.UTC(y, mo - 1, d, h, mi, s) - (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) * 60_000)
    : new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

/** The time a JPEG says it was taken, from the first bytes of the file. */
export function exifTakenAt(bytes: ArrayBuffer | Uint8Array): string | null {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xff) return null;
      const marker = v.getUint8(p + 1);
      if (marker === 0xda || marker === 0xd9) return null; // the picture starts: no Exif before it
      const len = v.getUint16(p + 2);
      if (len < 2) return null;
      const isExif = marker === 0xe1 && p + 10 <= v.byteLength
        && String.fromCharCode(...u8.subarray(p + 4, p + 8)) === 'Exif' && v.getUint16(p + 8) === 0;
      if (isExif) {
        const tiff = p + 10;
        if (tiff + 8 > v.byteLength) return null;
        const order = v.getUint16(tiff);
        if (order !== 0x4949 && order !== 0x4d4d) return null;
        const le = order === 0x4949;
        if (v.getUint16(tiff + 2, le) !== 42) return null;
        const ifd0 = readIfd(v, tiff, tiff + v.getUint32(tiff + 4, le), le);
        const pointer = ifd0.get(TAG_EXIF_IFD);
        const exif = pointer && pointer.type === 4 ? readIfd(v, tiff, tiff + v.getUint32(pointer.valueAt, le), le) : new Map();
        const offset = readText(v, exif.get(TAG_OFFSET_ORIGINAL));
        return toIso(readText(v, exif.get(TAG_DATETIME_ORIGINAL)), offset) ?? toIso(readText(v, ifd0.get(TAG_DATETIME)), null);
      }
      p += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}
