/**
 * Takes every metadata block out of a JPEG before Archie stores it
 * (server/photos/native.ts). A phone writes where a photo was taken into it
 * (Exif GPS), and often the camera, the owner's name, captions and a second
 * full-size copy with its own Exif after the end of the picture. None of it
 * may reach the photo store, so none of it survives here.
 *
 * Walks the JPEG's segments and keeps only what the picture needs: the start,
 * APP0 (the JFIF header), the quantisation and Huffman tables, the frame
 * header, restart intervals, each scan with its data, and the end. APP1 to
 * APP15 (Exif, XMP, ICC, Photoshop/IPTC and the rest) and COM (comments) are
 * dropped, and so is anything after the end-of-image marker.
 *
 * Then it checks its own work on a fresh walk of the result: it starts with
 * FFD8, ends with FFD9, holds no APP1 to APP15 or COM block, and nowhere holds
 * the bytes "Exif\0\0". Anything it cannot walk to the end, and anything that
 * is not a JPEG (PNG, WebP, HEIC), is refused. The browser always sends a
 * JPEG it drew itself (client/src/components/JobPhotos.tsx), so a refusal
 * here means a broken or hand-made upload, never an ordinary photo.
 */

export type CleanResult =
  | { ok: true; jpeg: Buffer; width: number | null; height: number | null }
  | { ok: false; reason: string };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const TEM = 0x01;

/** APP1 to APP15 and comments: the blocks that carry metadata. */
const isMetadata = (m: number) => (m >= 0xe1 && m <= 0xef) || m === COM;
const isRestart = (m: number) => m >= 0xd0 && m <= 0xd7;
/** Frame headers (SOF0 to SOF15), which are C0 to CF apart from DHT (C4), JPG (C8) and DAC (CC). */
const isFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

const EXIF_ID = Buffer.from('Exif\0\0', 'latin1');

interface Segment {
  marker: number;
  /** The marker and everything after it that belongs to it, as stored. */
  bytes: Buffer;
}

/**
 * Every segment of a JPEG in order, each scan's data carried with its scan
 * header, up to and including the end-of-image marker. Null when the bytes
 * are not one whole JPEG.
 */
function segments(buf: Buffer): { list: Segment[]; width: number | null; height: number | null } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== SOI) return null;
  const list: Segment[] = [{ marker: SOI, bytes: buf.subarray(0, 2) }];
  let width: number | null = null;
  let height: number | null = null;
  let sawFrame = false;
  let sawScan = false;
  let p = 2;
  for (;;) {
    if (p >= buf.length || buf[p] !== 0xff) return null;
    while (p < buf.length && buf[p] === 0xff) p++; // fill bytes before a marker
    if (p >= buf.length) return null;
    const marker = buf[p++];
    const markerBytes = Buffer.from([0xff, marker]);
    if (marker === EOI) {
      if (!sawFrame || !sawScan) return null;
      list.push({ marker, bytes: markerBytes });
      return { list, width, height };
    }
    if (marker === 0x00 || marker === SOI) return null;
    if (isRestart(marker) || marker === TEM) { list.push({ marker, bytes: markerBytes }); continue; }

    if (p + 2 > buf.length) return null;
    const len = buf.readUInt16BE(p);
    if (len < 2 || p + len > buf.length) return null;
    const body = buf.subarray(p, p + len);
    p += len;

    if (isFrame(marker)) {
      if (len < 8) return null;
      height = body.readUInt16BE(3);
      width = body.readUInt16BE(5);
      sawFrame = true;
    }
    if (marker !== SOS) { list.push({ marker, bytes: Buffer.concat([markerBytes, body]) }); continue; }

    // A scan: its header, then entropy-coded data up to the next real marker.
    // Inside the data 0xFF is followed by 0x00 (a stuffed byte), a restart
    // marker, or more 0xFF fill; anything else ends the scan.
    if (!sawFrame) return null;
    sawScan = true;
    let q = p;
    for (;;) {
      if (q >= buf.length) return null;
      if (buf[q] !== 0xff) { q++; continue; }
      if (q + 1 >= buf.length) return null;
      const next = buf[q + 1];
      if (next === 0x00 || isRestart(next)) { q += 2; continue; }
      if (next === 0xff) { q++; continue; }
      break;
    }
    list.push({ marker, bytes: Buffer.concat([markerBytes, body, buf.subarray(p, q)]) });
    p = q;
  }
}

/** The markers of a JPEG in order, or null when it is not one whole JPEG. Used to check a cleaned file. */
export function jpegMarkers(buf: Buffer): number[] | null {
  const s = segments(buf);
  return s ? s.list.map((x) => x.marker) : null;
}

/** A JPEG with every metadata block taken out, checked, or the reason it was refused. */
export function cleanJpeg(input: Buffer): CleanResult {
  const parsed = segments(input);
  if (!parsed) return { ok: false, reason: 'not a whole JPEG' };
  const jpeg = Buffer.concat(parsed.list.filter((s) => !isMetadata(s.marker)).map((s) => s.bytes));

  // Check the result on its own, not by trusting the walk above.
  const again = jpegMarkers(jpeg);
  const starts = jpeg.length >= 4 && jpeg[0] === 0xff && jpeg[1] === SOI;
  const ends = jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === EOI;
  if (!again || !starts || !ends || again.some(isMetadata) || jpeg.includes(EXIF_ID)) {
    return { ok: false, reason: 'metadata could not be taken out' };
  }
  return { ok: true, jpeg, width: parsed.width, height: parsed.height };
}
