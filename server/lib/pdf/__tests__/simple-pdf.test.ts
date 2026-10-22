import { describe, it, expect } from 'vitest';
import { buildPdf, pdfText, type PdfLine } from '../simple-pdf';

/**
 * Checked structurally rather than with a PDF parser: the repo's `pdf-parse`
 * (pdf.js 1.10) throws "bad XRef entry" on this Node version even for a PDF
 * produced by macOS itself, so it would test the parser, not the writer. The
 * invariant that actually matters — every xref offset landing exactly on its
 * object — is asserted directly here, and the rendered output was checked by
 * eye in a viewer.
 */
const lines: PdfLine[] = [
  { kind: 'subheading', text: 'Whitfield - 1420 Sardis Rd' },
  { kind: 'row', label: 'Revenue', value: '$24,500.00' },
  { kind: 'rule' },
  { kind: 'row', label: 'Commission', value: '$2,180.00', bold: true },
  { kind: 'text', text: 'Approved by james@bestroofingnow.com on September 15, 2026.' },
];

const objectOffsets = (pdf: string) => {
  const out = new Map<number, number>();
  for (const m of pdf.matchAll(/(\d+) 0 obj/g)) out.set(Number(m[1]), m.index!);
  return out;
};

// '\nxref\n', not 'xref' — the last 'xref' in the file is inside 'startxref'.
const xrefEntries = (pdf: string) =>
  [...pdf.slice(pdf.indexOf('\nxref\n')).matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)].map((m) => ({ offset: Number(m[1]), type: m[3] }));

describe('the PDF writer', () => {
  it('writes a well-formed file whose xref points at every object', () => {
    const pdf = buildPdf('Commission statement', lines, 'Best Roofing Now').toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    const entries = xrefEntries(pdf);
    const objects = objectOffsets(pdf);
    expect(entries[0].type).toBe('f');
    expect(entries.length).toBe(objects.size + 1);
    // Entry n addresses object n. A mismatch here is exactly the corruption a
    // viewer reports as "bad XRef entry" — invisible until someone opens it.
    entries.slice(1).forEach((e, i) => expect([i + 1, e.offset]).toEqual([i + 1, objects.get(i + 1)]));

    const startxref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    expect(pdf).toMatch(/\/Size (\d+) \/Root 1 0 R/);
  });

  it('puts the text on the page', () => {
    const pdf = buildPdf('Commission statement', lines, 'Best Roofing Now').toString('latin1');
    for (const s of ['(Commission statement) Tj', '($24,500.00) Tj', '(Revenue) Tj', '(Best Roofing Now) Tj']) {
      expect(pdf).toContain(s);
    }
  });

  it('declares a stream length that matches the bytes in the stream', () => {
    const pdf = buildPdf('T', lines, 'f').toString('latin1');
    const m = pdf.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/)!;
    expect(Buffer.byteLength(m[2], 'latin1')).toBe(Number(m[1]));
  });

  it('flows onto more pages rather than writing off the bottom of the first', () => {
    const many: PdfLine[] = Array.from({ length: 90 }, (_, i) => ({ kind: 'row', label: `Line ${i + 1}`, value: `$${i}.00` }));
    const pdf = buildPdf('Long', many, 'foot').toString('latin1');
    const count = Number(pdf.match(/\/Count (\d+)/)![1]);
    expect(count).toBeGreaterThan(1);
    expect(pdf).toContain('(Line 90) Tj');
    expect(pdf).toContain('(Page 1 of ');
    // Every page the catalog claims is a real object.
    const kids = pdf.match(/\/Kids \[([^\]]+)\]/)![1].trim().split(/\s+0 R\s*/).filter(Boolean);
    expect(kids).toHaveLength(count);
  });

  it('escapes the characters that would otherwise end a PDF string early', () => {
    expect(pdfText('Smith (Roof) \\ job')).toBe('Smith \\(Roof\\) \\\\ job');
  });

  it('folds typographic characters to ASCII and drops what the font cannot show', () => {
    expect(pdfText('“quoted” — it’s 50…')).toBe('"quoted" - it\'s 50...');
    expect(pdfText('emoji 🧾 gone')).toBe('emoji  gone');
    expect(buildPdf('T', [{ kind: 'text', text: 'Karen’s roof — done' }], 'f').toString('latin1')).toContain("(Karen's roof - done) Tj");
  });
});
