/**
 * The PDF itself: the real library, drawing the document in Node, and the bytes
 * checked. Nothing is fetched (the fonts are the PDF's own built-in ones, the
 * photos are small pictures held in the test).
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { jpegDataUrl } from './tiny-jpeg';
import { makeReport } from '../../../../../server/lib/roof-reports/__tests__/fixtures/report';
import { pdfContent, type PdfInput } from '../content';

const base = (photos: PdfInput['photos'] = []): PdfInput => ({
  company: { name: 'Summit Ridge Roofing', phone: '555-0100', email: 'office@example.com', website: '' },
  title: 'Roof report, 12 Elm Street', address: '12 Elm Street', cityStateZip: 'Cedar Falls, IA 50613', customerName: 'Dana Whitfield', inspectionDate: null, inspectorNotes: 'Ridge cap lifted.',
  report: makeReport({ executiveSummary: 'The roof has wind damage near the ridge.', structuredFindings: [{ id: 'f0', title: 'Missing shingles', severity: 'high', narrative: 'Several shingles are missing.', relatedPhotoIds: [], repairAction: 'Replace', insuranceRelevant: true }] }) as unknown as Record<string, unknown>,
  photos, generatedOn: new Date('2026-11-24T15:00:00Z'),
});

async function render(input: PdfInput, charts: { storm: string | null; damage: string | null } = { storm: null, damage: null }): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');
  const { RoofReportPDF } = await import('../RoofReportPDF');
  return renderToBuffer(createElement(RoofReportPDF, { content: pdfContent(input), charts }) as never);
}
const pages = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;

describe('the PDF document', () => {
  it('is a real PDF with a cover and more than one page, of sensible size, with no network', async () => {
    const pdf = await render(base());
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-8).toString('latin1')).toContain('%%EOF');
    expect(pages(pdf)).toBeGreaterThanOrEqual(2);
    expect(pdf.length).toBeGreaterThan(3_000);
    expect(pdf.length).toBeLessThan(500_000);
  }, 60_000);

  it('holds the photos it is given, and grows with them', async () => {
    const photos = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, category: 'roof_surface', dataUrl: jpegDataUrl(i) }));
    const without = await render(base());
    const withPhotos = await render(base(photos));
    expect(withPhotos.length).toBeGreaterThan(without.length);
    expect(pages(withPhotos)).toBeGreaterThanOrEqual(pages(without));
    expect(withPhotos.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 60_000);

  it('draws with the PDF\'s own built-in fonts, so nothing is fetched from anywhere', async () => {
    const pdf = (await render(base())).toString('latin1');
    expect(pdf).toMatch(/Helvetica/);
    expect(pdf).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  }, 60_000);

  it('survives a report with nothing in it but an address', async () => {
    const empty = { ...base(), report: {}, inspectorNotes: '', customerName: '' };
    const pdf = await render(empty);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pages(pdf)).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
