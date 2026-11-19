/**
 * Made-up JPEGs for the photo tests. Only the segment layout matters to the
 * cleaner (server/photos/jpeg-clean.ts), so these are built byte by byte:
 * they carry exactly the blocks a phone photo can carry, location included.
 */

/** One segment: its marker, its length and what it carries. */
export const seg = (marker: number, payload: Buffer | number[]): Buffer => {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const head = Buffer.alloc(4);
  head[0] = 0xff; head[1] = marker; head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
};

/** An Exif block (APP1) with a GPS position in it, the way a phone writes one. */
export function exifWithGps(): Buffer {
  // TIFF header (little endian), IFD0 with one entry: the GPS IFD pointer (0x8825).
  const tiff = Buffer.alloc(64);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);                 // one entry
  tiff.writeUInt16LE(0x8825, 10);           // GPSInfo
  tiff.writeUInt16LE(4, 12);                // LONG
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);               // the GPS IFD is at 26
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26);                // GPS IFD: one entry
  tiff.writeUInt16LE(0x0001, 28);           // GPSLatitudeRef
  tiff.writeUInt16LE(2, 30);                // ASCII
  tiff.writeUInt32LE(2, 32);
  tiff.write('N\0', 34, 'latin1');
  tiff.write('GPS 42.5348N 92.4453W', 40, 'latin1');
  return seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
}

/** A JFIF header (APP0): kept, it says how to read the pixels. */
export const jfif = () => seg(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));
export const dqt = () => seg(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]));
/** Baseline frame header: 8 bit, the given size, one component. */
export const sof0 = (width: number, height: number) => {
  const b = Buffer.alloc(9);
  b[0] = 8; b.writeUInt16BE(height, 1); b.writeUInt16BE(width, 3); b[5] = 1; b[6] = 1; b[7] = 0x11; b[8] = 0;
  return seg(0xc0, b);
};
export const dht = () => seg(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.from([0, 1, ...Array(14).fill(0)]), Buffer.from([0])]));
export const sos = () => seg(0xda, Buffer.from([1, 1, 0x00, 0, 63, 0]));
/** Entropy-coded data with a stuffed 0xFF00 and a restart marker in it, as real scans have. */
export const scan = () => Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]);

export interface FixtureOptions {
  exif?: boolean;
  app13?: boolean;
  comment?: boolean;
  /** Bytes after the end-of-image marker (phones put a second, full-size picture there). */
  trailing?: boolean;
  width?: number;
  height?: number;
}

/** A JPEG with whichever metadata blocks are asked for. */
export function makeJpeg(o: FixtureOptions = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8]), jfif()];
  if (o.exif) parts.push(exifWithGps());
  if (o.app13) parts.push(seg(0xed, Buffer.from('Photoshop 3.0\u00008BIM IPTC city Cedar Falls', 'latin1')));
  parts.push(dqt());
  if (o.comment) parts.push(seg(0xfe, Buffer.from('12 Main St, shot by the rep', 'latin1')));
  parts.push(sof0(o.width ?? 1600, o.height ?? 1200), dht(), sos(), scan(), Buffer.from([0xff, 0xd9]));
  if (o.trailing) parts.push(Buffer.from([0xff, 0xd8]), exifWithGps(), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

/**
 * A JPEG put together from the given segments, in order, between its start
 * and its end: for building one with a block in an unusual place.
 */
export const jpegOf = (...parts: Buffer[]): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8]), ...parts, Buffer.from([0xff, 0xd9])]);

/** The segments a clean picture is made of, after its start: JFIF header, tables, frame, scan. */
export const pictureParts = (width = 1600, height = 1200) => [jfif(), dqt(), sof0(width, height), dht(), sos(), scan()];

/**
 * An XMP packet with a GPS position in it, the way photo apps write one. It
 * can be put in any block, so it is the test of every block the cleaner keeps.
 */
export const xmpWithGps = () => Buffer.from(
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF>'
  + '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="42,32.09N" exif:GPSLongitude="92,26.72W"/>'
  + '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>', 'latin1');

/** A clean JPEG, the shape the browser's canvas makes. */
export const cleanJpegFixture = (width = 1600, height = 1200) => makeJpeg({ width, height });
