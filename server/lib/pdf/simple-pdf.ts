/**
 * A minimal PDF writer for one-page business documents — a commission
 * statement, a receipt, anything that is headings, paragraphs and label/value
 * rows. Hand-rolled rather than pulling in a PDF library: the documents are
 * plain text on Letter paper, and a renderer that runs anywhere (no headless
 * Chrome, no native module) is worth more here than a layout engine.
 *
 * Only the standard Helvetica faces are used, so nothing has to be embedded.
 * Text is written as WinAnsi, which is what those fonts are keyed to.
 */

export type PdfLine =
  | { kind: 'heading'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'row'; label: string; value: string; bold?: boolean }
  | { kind: 'rule' }
  | { kind: 'space'; size?: number }
  /** A JPEG drawn into the flow at `width` points; the height follows the image. */
  | { kind: 'image'; jpeg: Buffer; width: number };

const PAGE_W = 612;      // Letter, 72dpi
const PAGE_H = 792;
const MARGIN = 54;       // 0.75"
const VALUE_X = 360;     // where the right-hand column starts
const BOTTOM = 60;

/**
 * WinAnsi-safe text: the typographic characters our templates use have ASCII
 * equivalents, and anything else outside the Latin-1 range is dropped rather
 * than written as a byte the viewer would render as garbage.
 */
export function pdfText(s: string): string {
  return String(s ?? '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•·]/g, '-')
    .replace(/−/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/[\\()]/g, (m) => `\\${m}`);
}

interface PdfImage { jpeg: Buffer; w: number; h: number; comps: number }

interface Ctx { ops: string[]; y: number; pages: string[][]; images: PdfImage[] }

/**
 * Width, height and colour-component count from a JPEG's start-of-frame
 * marker. PDF can carry JPEG bytes verbatim (/DCTDecode), so nothing has to
 * decode the image — but the image dictionary still has to state its size, and
 * only the file itself knows it.
 */
export function jpegSize(buf: Buffer): { width: number; height: number; comps: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }              // resync past padding
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, minus the four that are not frame headers (DHT/JPG/DAC/DNL).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function newPage(ctx: Ctx) {
  ctx.pages.push(ctx.ops);
  ctx.ops = [];
  ctx.y = PAGE_H - MARGIN;
}

function write(ctx: Ctx, font: 'F1' | 'F2', size: number, x: number, text: string) {
  ctx.ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${ctx.y} Tm (${pdfText(text)}) Tj ET`);
}

/** Break a line to fit the column, measured with an average glyph width — Helvetica has no metrics here. */
function wrap(text: string, size: number, width: number): string[] {
  const perChar = size * 0.5;
  const max = Math.max(12, Math.floor(width / perChar));
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line.length) line = w;
    else if (line.length + 1 + w.length <= max) line += ` ${w}`;
    else { lines.push(line); line = w; }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [''];
}

export interface PdfOptions {
  /**
   * Where the value column starts. The default suits a statement of short
   * money values; a document whose values are addresses and coordinates wants
   * it further left so they have room.
   */
  valueX?: number;
}

/**
 * Render the lines to a PDF. Pages break automatically; every page carries the
 * same footer so a printed copy that gets separated still says what it is.
 */
export function buildPdf(title: string, lines: PdfLine[], footer?: string, opts: PdfOptions = {}): Buffer {
  const valueX = Math.max(MARGIN + 60, Math.min(opts.valueX ?? VALUE_X, PAGE_W - MARGIN - 80));
  const ctx: Ctx = { ops: [], y: PAGE_H - MARGIN, pages: [], images: [] };
  const room = (needed: number) => { if (ctx.y - needed < BOTTOM) newPage(ctx); };

  write(ctx, 'F2', 16, MARGIN, title);
  ctx.y -= 26;

  for (const line of lines) {
    switch (line.kind) {
      case 'heading':
        room(28); ctx.y -= 6; write(ctx, 'F2', 13, MARGIN, line.text); ctx.y -= 18; break;
      case 'subheading':
        room(22); write(ctx, 'F2', 10, MARGIN, line.text); ctx.y -= 15; break;
      case 'text':
        for (const l of wrap(line.text, 10, PAGE_W - MARGIN * 2)) { room(16); write(ctx, 'F1', 10, MARGIN, l); ctx.y -= 14; }
        break;
      case 'row': {
        // A long value used to run straight off the right edge of the page —
        // an address or a pair of coordinates would simply be cut in half.
        const font = line.bold ? 'F2' : 'F1';
        const parts = wrap(line.value, 10, PAGE_W - MARGIN - valueX);
        room(15 * parts.length + 3);
        write(ctx, font, 10, MARGIN, line.label);
        parts.forEach((part, i) => {
          if (i) ctx.y -= 13;
          write(ctx, font, 10, valueX, part);
        });
        ctx.y -= 15;
        break;
      }
      case 'rule':
        room(12);
        ctx.ops.push(`0.6 w 0.6 0.6 0.6 RG ${MARGIN} ${ctx.y + 4} m ${PAGE_W - MARGIN} ${ctx.y + 4} l S`);
        ctx.y -= 10;
        break;
      case 'image': {
        const size = jpegSize(line.jpeg);
        // An image we cannot measure is skipped rather than drawn at a guessed
        // size: a squashed signature on a signed document is worse than none.
        if (!size || !size.width || !size.height) break;
        const w = Math.min(line.width, PAGE_W - MARGIN * 2);
        const h = Math.round((w * size.height) / size.width);
        room(h + 8);
        ctx.images.push({ jpeg: line.jpeg, w: size.width, h: size.height, comps: size.comps });
        const id = ctx.images.length;
        ctx.y -= h;
        ctx.ops.push(`q ${w} 0 0 ${h} ${MARGIN} ${ctx.y} cm /Im${id} Do Q`);
        ctx.y -= 6;
        break;
      }
      case 'space':
        ctx.y -= line.size ?? 10; break;
    }
  }
  newPage(ctx);

  const pages = ctx.pages.filter((p) => p.length);
  if (footer) {
    for (const [i, ops] of pages.entries()) {
      ops.push(`0.4 w 0.75 0.75 0.75 RG ${MARGIN} ${BOTTOM + 14} m ${PAGE_W - MARGIN} ${BOTTOM + 14} l S`);
      ops.push(`BT /F1 8 Tf 1 0 0 1 ${MARGIN} ${BOTTOM} Tm 0.4 0.4 0.4 rg (${pdfText(footer)}) Tj ET`);
      if (pages.length > 1) ops.push(`BT /F1 8 Tf 1 0 0 1 ${PAGE_W - MARGIN - 40} ${BOTTOM} Tm 0.4 0.4 0.4 rg (${pdfText(`Page ${i + 1} of ${pages.length}`)}) Tj ET`);
    }
  }

  return assemble(pages, ctx.images);
}

/**
 * Object 1 catalog, 2 pages, 3 + 4 the fonts, then a content stream and a page
 * object per page. The xref table needs each object's byte offset, so the file
 * is built up as a byte length counter alongside the string.
 */
function assemble(pages: string[][], images: PdfImage[] = []): Buffer {
  const objects: string[] = [];
  // 1 catalog, 2 pages, 3 + 4 the fonts, then one object per image, then the
  // content stream + page object pairs.
  const imageIds = images.map((_, i) => 5 + i);
  const firstPageId = 5 + images.length;
  const pageIds = pages.map((_, i) => firstPageId + i * 2);   // content stream id; the page object is +1
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id + 1} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  // JPEG bytes go in untouched under /DCTDecode. The whole file is built as a
  // latin1 string, where every byte round-trips 1:1, so binary is safe here.
  for (const img of images) {
    const cs = img.comps === 1 ? '/DeviceGray' : img.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace ${cs} `
      + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
      + `${img.jpeg.toString('latin1')}\nendstream`,
    );
  }
  const xobjects = imageIds.length
    ? ` /XObject << ${imageIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>`
    : '';

  for (const [i, ops] of pages.entries()) {
    const content = ops.join('\n');
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] `
      + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects} >> /Contents ${pageIds[i]} 0 R >>`,
    );
  }

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
