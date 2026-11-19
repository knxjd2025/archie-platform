/**
 * Takes every metadata block out of a JPEG before Archie stores it
 * (server/photos/native.ts), and again before Roof Lee is handed one
 * (server/sister/leads.ts). A phone writes where a photo was taken into it
 * (Exif GPS, XMP), and often the camera, the owner's name, captions and a
 * second full-size copy with its own Exif after the end of the picture. None
 * of it may reach the photo store or leave Archie, so none of it survives here.
 *
 * It keeps only the blocks a picture needs, and nothing else, whatever the
 * others are called or wherever they sit:
 *   - the start and the end;
 *   - one APP0, only when it comes straight after the start and is a bare
 *     JFIF header (no thumbnail, nothing after it);
 *   - the quantisation tables (DQT) and Huffman tables (DHT), each filled
 *     exactly by its tables;
 *   - the frame header (SOF0 to SOF15), the restart interval (DRI) and the
 *     line count (DNL), each exactly the length its own fields give;
 *   - each scan header (SOS), exactly its length, with its data and restart
 *     markers.
 * Every other block is dropped: APP1 to APP15 (Exif, XMP, ICC,
 * Photoshop/IPTC and the rest), any other APP0, comments, the JPGn extension
 * markers, the reserved markers and anything after the end of the picture.
 * Three blocks change how the picture decodes and the browser never makes
 * them (arithmetic coding conditioning, DAC; the hierarchical DHP and EXP),
 * so a file with one is refused rather than quietly changed. So is a kept
 * block that carries anything past what it holds, since a packet can be
 * tucked in there too.
 *
 * Then it checks its own work on a fresh walk of the result: it starts with
 * FFD8, ends with FFD9, holds only the blocks above, and nowhere holds a mark
 * of Exif, XMP, Photoshop or a GPS tag name (the scan's own data cannot be
 * walked, so it is searched instead). Anything it cannot walk to the end, and
 * anything that is not a JPEG (PNG, WebP, HEIC), is refused. The browser
 * always sends a JPEG it drew itself (client/src/components/JobPhotos.tsx),
 * so a refusal here means a broken or hand-made upload, never an ordinary
 * photo.
 */

export type CleanResult =
  | { ok: true; jpeg: Buffer; width: number | null; height: number | null }
  | { ok: false; reason: string };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DNL = 0xdc;
const DRI = 0xdd;
const DHT = 0xc4;
const APP0 = 0xe0;
const TEM = 0x01;

const isRestart = (m: number) => m >= 0xd0 && m <= 0xd7;
/** Frame headers (SOF0 to SOF15), which are C0 to CF apart from DHT (C4), JPG (C8) and DAC (CC). */
const isFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== DHT && m !== 0xc8 && m !== 0xcc;

/** The blocks a picture is made of. Everything else is dropped or refused. */
const isPicture = (m: number) =>
  m === SOI || m === EOI || m === APP0 || m === DQT || m === DHT || m === DRI || m === DNL || m === SOS
  || isFrame(m) || isRestart(m);

/** Arithmetic conditioning (DAC) and the hierarchical DHP and EXP: dropping one would change the picture. */
const REFUSED = new Set([0xcc, 0xde, 0xdf]);

/**
 * Marks of a metadata block, none of which a cleaned file may hold anywhere.
 * Each is long enough that compressed picture data never holds one by chance.
 */
const METADATA_MARKS = [
  'Exif\0\0', 'http://ns.adobe.com/', 'xmpmeta', '<?xpacket', 'Photoshop 3.0',
  'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSPosition', 'GPSCoordinates',
].map((m) => Buffer.from(m, 'latin1'));

interface Segment {
  marker: number;
  /** The marker and everything after it that belongs to it, as stored. */
  bytes: Buffer;
  /** What the segment carries after its length field (empty for a marker with none). */
  payload: Buffer;
}

/**
 * Every segment of a JPEG in order, each scan's data carried with its scan
 * header, up to and including the end-of-image marker. Null when the bytes
 * are not one whole JPEG.
 */
function segments(buf: Buffer): { list: Segment[]; width: number | null; height: number | null } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== SOI) return null;
  const none = Buffer.alloc(0);
  const list: Segment[] = [{ marker: SOI, bytes: buf.subarray(0, 2), payload: none }];
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
      list.push({ marker, bytes: markerBytes, payload: none });
      return { list, width, height };
    }
    if (marker === 0x00 || marker === SOI) return null;
    if (isRestart(marker) || marker === TEM) { list.push({ marker, bytes: markerBytes, payload: none }); continue; }

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
    if (marker !== SOS) { list.push({ marker, bytes: Buffer.concat([markerBytes, body]), payload: body.subarray(2) }); continue; }

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
    list.push({ marker, bytes: Buffer.concat([markerBytes, body, buf.subarray(p, q)]), payload: body.subarray(2) });
    p = q;
  }
}

/** Quantisation tables, each 64 or 128 bytes after its precision and number, filling the block exactly. */
function tablesFillDqt(b: Buffer): boolean {
  let i = 0;
  while (i < b.length) {
    const precision = b[i] >> 4;
    if (precision > 1 || (b[i] & 0x0f) > 3) return false;
    i += 1 + (precision ? 128 : 64);
  }
  return b.length > 0 && i === b.length;
}

/** Huffman tables, each its class and number, 16 counts and that many values, filling the block exactly. */
function tablesFillDht(b: Buffer): boolean {
  let i = 0;
  while (i < b.length) {
    if (b[i] >> 4 > 1 || (b[i] & 0x0f) > 3 || i + 17 > b.length) return false;
    let values = 0;
    for (let k = 1; k <= 16; k++) values += b[i + k];
    if (values > 256) return false;
    i += 17 + values;
  }
  return b.length > 0 && i === b.length;
}

/** A JFIF header and nothing more: version 1, units 0 to 2, no thumbnail. */
function isBareJfif(b: Buffer): boolean {
  return b.length === 14 && b.subarray(0, 5).equals(Buffer.from('JFIF\0', 'latin1'))
    && b[5] === 1 && b[7] <= 2 && b[12] === 0 && b[13] === 0;
}

/** Is a kept block exactly what its own fields say it is, with nothing tucked after? */
function holdsOnlyItself(s: Segment): boolean {
  const b = s.payload;
  if (s.marker === DQT) return tablesFillDqt(b);
  if (s.marker === DHT) return tablesFillDht(b);
  if (s.marker === DRI || s.marker === DNL) return b.length === 2;
  if (s.marker === SOS) return b.length >= 1 && b[0] >= 1 && b[0] <= 4 && b.length === 4 + 2 * b[0];
  if (isFrame(s.marker)) return b.length >= 6 && b[5] >= 1 && b.length === 6 + 3 * b[5];
  return true;
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
  if (parsed.list.some((s) => REFUSED.has(s.marker))) return { ok: false, reason: 'not a picture Archie keeps' };

  const kept = parsed.list.filter((s, i) => {
    if (!isPicture(s.marker)) return false;
    // APP0 stays only as the bare JFIF header straight after the start.
    if (s.marker === APP0) return i === 1 && isBareJfif(s.payload);
    return true;
  });
  if (!kept.every(holdsOnlyItself)) return { ok: false, reason: 'metadata could not be taken out' };
  const jpeg = Buffer.concat(kept.map((s) => s.bytes));

  // Check the result on its own, not by trusting the walk above.
  const again = segments(jpeg);
  const starts = jpeg.length >= 4 && jpeg[0] === 0xff && jpeg[1] === SOI;
  const ends = jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === EOI;
  if (!again || !starts || !ends
    || !again.list.every((s, i) => isPicture(s.marker) && (s.marker !== APP0 || (i === 1 && isBareJfif(s.payload))) && holdsOnlyItself(s))
    || METADATA_MARKS.some((m) => jpeg.includes(m))) {
    return { ok: false, reason: 'metadata could not be taken out' };
  }
  return { ok: true, jpeg, width: parsed.width, height: parsed.height };
}
