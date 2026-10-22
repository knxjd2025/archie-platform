import { describe, it, expect } from 'vitest';
import { buildPdf, jpegSize, type PdfLine } from '../../lib/pdf/simple-pdf';
import { auditRows, jpegFromBase64 } from '../pdf';
import type { SignerGeo, SignerView } from '../../../shared/signatures';

/**
 * A structurally valid baseline JPEG header. Nothing decodes it — the PDF
 * carries JPEG bytes verbatim under /DCTDecode — so what has to be right is
 * the frame header the size is read from, and that every byte survives the
 * trip through the latin1 string the file is assembled as.
 */
function fakeJpeg(width: number, height: number, comps = 3, padding = 300): Buffer {
  const sof = Buffer.alloc(11 + comps * 3);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8 + comps * 3, 2);   // segment length
  sof.writeUInt8(8, 4);                  // sample precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(comps, 9);
  for (let i = 0; i < comps; i++) sof.writeUInt8(i + 1, 10 + i * 3);

  // A comment segment carrying every byte value, so a mangled encoding shows up.
  const bytes = Buffer.from(Array.from({ length: padding }, (_, i) => i % 256));
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe]), lengthOf(bytes.length + 2), bytes]);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), comment, sof, Buffer.from([0xff, 0xd9])]);
}

function lengthOf(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

describe('jpegSize', () => {
  it('reads width, height and colour components off the frame header', () => {
    expect(jpegSize(fakeJpeg(640, 180))).toEqual({ width: 640, height: 180, comps: 3 });
    expect(jpegSize(fakeJpeg(200, 60, 1))).toEqual({ width: 200, height: 60, comps: 1 });
  });

  it('refuses anything that is not a JPEG', () => {
    expect(jpegSize(Buffer.from('%PDF-1.4 not an image'))).toBeNull();
    expect(jpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();   // PNG
    expect(jpegSize(Buffer.alloc(0))).toBeNull();
  });
});

describe('a PDF carrying a signature image', () => {
  const jpeg = fakeJpeg(600, 200);
  const lines: PdfLine[] = [
    { kind: 'heading', text: 'Signatures' },
    { kind: 'image', jpeg, width: 190 },
    { kind: 'row', label: 'Dana Whitfield', value: 'Signed Sep 18, 2026', bold: true },
  ];

  it('declares the image and draws it', () => {
    const pdf = buildPdf('Signed document', lines, 'footer').toString('latin1');
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain('/Filter /DCTDecode');
    expect(pdf).toContain('/Width 600 /Height 200');
    expect(pdf).toContain('/ColorSpace /DeviceRGB');
    expect(pdf).toContain('/XObject << /Im1 5 0 R >>');
    expect(pdf).toContain('/Im1 Do');
  });

  it('keeps the image bytes byte-for-byte', () => {
    const pdf = buildPdf('Signed document', lines);
    const at = pdf.indexOf(jpeg);
    expect(at).toBeGreaterThan(0);
    expect(pdf.subarray(at, at + jpeg.length).equals(jpeg)).toBe(true);
  });

  it('scales to the width given, keeping the aspect ratio', () => {
    const pdf = buildPdf('t', lines).toString('latin1');
    // 190 wide on a 600x200 image is 63 tall.
    expect(pdf).toContain('q 190 0 0 63 54 ');
  });

  /**
   * The one that would bite silently: binary in the middle of the file moves
   * every later object, and a reader only says "damaged" if an offset misses.
   */
  it('still points the xref table at the exact start of every object', () => {
    const pdf = buildPdf('Signed document', lines, 'footer').toString('latin1');
    const startxref = Number(/startxref\s+(\d+)/.exec(pdf)![1]);
    const table = pdf.slice(startxref);
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));

    expect(offsets.length).toBeGreaterThanOrEqual(6);
    offsets.forEach((off, i) => {
      expect(pdf.slice(off, off + 20)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });

  it('skips an image it cannot measure rather than drawing it at a guess', () => {
    const pdf = buildPdf('t', [{ kind: 'image', jpeg: Buffer.from('not an image'), width: 190 }]).toString('latin1');
    expect(pdf).not.toContain('/Subtype /Image');
    expect(pdf).not.toContain('/Im1 Do');
  });
});

describe('jpegFromBase64', () => {
  it('takes real JPEG bytes and refuses everything else', () => {
    const b64 = fakeJpeg(300, 100).toString('base64');
    expect(jpegFromBase64(b64)?.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(jpegFromBase64(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]).toString('base64'))).toBeNull();
    expect(jpegFromBase64(null)).toBeNull();
    expect(jpegFromBase64('')).toBeNull();
  });
});

const geo = (over: Partial<SignerGeo> = {}): SignerGeo => ({
  source: 'gps', lat: 30.3322, lng: -81.6557, accuracyM: 12,
  address: '1420 Sardis Rd, Jacksonville, FL', city: 'Jacksonville', region: 'Florida', country: 'United States',
  distanceFromPropertyM: 18, capturedAt: '2026-09-18T15:04:00.000Z', ...over,
});

const signer = (over: Partial<SignerView> = {}): SignerView => ({
  id: 1, name: 'Dana Whitfield', email: 'dana@example.com', phone: '+19045550123', role: 'customer',
  signUrl: null, emailedAt: null, emailError: null, textedAt: null, textError: null,
  remindedAt: null, remindCount: 0, firstViewedAt: null, lastViewedAt: null, viewCount: 0,
  signedAt: null, signedName: null, signatureKind: null, signatureImage: null,
  declinedAt: null, declineReason: null, ip: null, userAgent: null, geo: null, viewGeo: null, ...over,
});

describe('the audit trail', () => {
  it('records how the link travelled, when it was opened, and where it was signed', () => {
    const rows = auditRows(signer({
      textedAt: '2026-09-18T14:00:00Z', emailedAt: '2026-09-18T14:00:01Z',
      firstViewedAt: '2026-09-18T14:40:00Z', viewCount: 3,
      signedAt: '2026-09-18T15:04:00Z', signedName: 'Dana Whitfield', signatureKind: 'drawn',
      ip: '73.15.2.9', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Safari/604.1',
      geo: geo(),
    }));
    const labels = rows.map(([l]) => l);
    expect(labels).toEqual(expect.arrayContaining(['Link texted', 'Link emailed', 'First opened', 'Signed', 'Signed as', 'IP address', 'Device', 'Location', 'Distance']));
    expect(rows.find(([l]) => l === 'Signed as')?.[1]).toContain('drawn on screen');
    expect(rows.find(([l]) => l === 'Device')?.[1]).toBe('iPhone · Safari');
    expect(rows.find(([l]) => l === 'Distance')?.[1]).toBe('At the property');
    expect(rows.find(([l]) => l === 'First opened')?.[1]).toContain('3 views');
  });

  it('leaves out what never happened', () => {
    const labels = auditRows(signer({ email: null, phone: null })).map(([l]) => l);
    expect(labels).not.toContain('Signed');
    expect(labels).not.toContain('Location');
    expect(labels).not.toContain('Reminders');
  });

  it('records a refusal and the reason given', () => {
    const rows = auditRows(signer({ declinedAt: '2026-09-18T15:00:00Z', declineReason: 'The address is wrong' }));
    expect(rows.find(([l]) => l === 'Declined')).toBeTruthy();
    expect(rows.find(([l]) => l === 'Reason given')?.[1]).toBe('The address is wrong');
  });

  it('shows a failed channel next to the one that worked', () => {
    const rows = auditRows(signer({ textedAt: '2026-09-18T14:00:00Z', emailError: 'mailbox full' }));
    expect(rows.find(([l]) => l === 'Email failed')?.[1]).toBe('mailbox full');
    expect(rows.find(([l]) => l === 'Link texted')).toBeTruthy();
  });
});
