import { describe, it, expect } from 'vitest';
import {
  parseMeasurementText, isMeasurementDocName, isMeasurementDiagram, findMeasurementDocs,
} from '../measurement-doc';

// Verbatim from the GAF/Nearmap report on 550 Manning Dr — labels and values
// run together exactly like this once the PDF text is extracted.
const GAF_TEXT = `
550 Manning Dr, Charlotte, NC 28209
September 7, 2026
Prepared For: Best Roofing Now LLC
Powered by Nearmap Roof & Exterior Measurements
Measurements
Roof Area4,715 sq ft
Roof Facets17
Predominant Pitch5 / 12
Ridges/Hips214 ft
Valleys161 ft
Rakes224 ft
Eaves236 ft
`;

describe('parseMeasurementText', () => {
  it('reads a real GAF report', () => {
    const m = parseMeasurementText(GAF_TEXT, 'GAF Report 5614432')!;
    expect(m.roofAreaSqFt).toBe(4715);
    expect(m.facets).toBe(17);
    expect(m.predominantPitch).toBe('5/12');
    expect(m.ridgesHipsFt).toBe(214);
    expect(m.valleysFt).toBe(161);
    expect(m.rakesFt).toBe(224);
    expect(m.eavesFt).toBe(236);
    expect(m.source).toBe('gaf');
  });

  it('converts area to squares, which is what pricing uses', () => {
    expect(parseMeasurementText(GAF_TEXT)!.squares).toBe(47.2);
  });

  it('parses labels that run straight into their values', () => {
    // PDF extraction produces "Roof Area4,715 sq ft" with no separator; a
    // parser that requires one silently returns nothing.
    expect(parseMeasurementText('Roof Area3,100 sq ft')!.roofAreaSqFt).toBe(3100);
  });

  it('handles thousands separators and decimals', () => {
    expect(parseMeasurementText('Roof Area: 12,345.5 sq ft')!.roofAreaSqFt).toBe(12345.5);
  });

  it('recognises an EagleView report', () => {
    expect(parseMeasurementText('EagleView Technologies\nTotal Area 2,800 sq ft')!.source).toBe('eagleview');
  });

  it('returns null without an area rather than a half-read document', () => {
    // Better to fall back to the satellite estimate than publish a partial
    // measurement as if it were measured.
    expect(parseMeasurementText('Roof Facets17\nPredominant Pitch5 / 12')).toBeNull();
    expect(parseMeasurementText('')).toBeNull();
    expect(parseMeasurementText('too short')).toBeNull();
  });

  it('tolerates a report missing the optional lengths', () => {
    const m = parseMeasurementText('Nearmap\nRoof Area1,900 sq ft\nRoof Facets6')!;
    expect(m.squares).toBe(19);
    expect(m.valleysFt).toBeNull();
  });
});

describe('identifying the files', () => {
  it('recognises measurement reports by name', () => {
    for (const n of ['GAF Report 5614432', 'EagleView Report.pdf', 'Eagle Eye Roof Report - Prepared for Zachary Collins.pdf', 'QuickMeasure 123']) {
      expect(isMeasurementDocName(n), n).toBe(true);
    }
  });

  it('does NOT treat the aerial diagrams as the report', () => {
    // These ship alongside a GAF report and are drawings of a roof, not
    // photographs of one — analysing them as damage photos wastes the photo
    // budget and invents findings.
    for (const n of ['GAF Report 5614432 - NorthImage', 'GAF Report 5614432 - VerticalImage', 'GAF Report 5612808 - WestImage']) {
      expect(isMeasurementDiagram(n), n).toBe(true);
      expect(isMeasurementDocName(n), n).toBe(false);
    }
  });

  it('ignores ordinary job photos and documents', () => {
    for (const n of ['WhatsApp Image 2026-09-03.jpeg', 'Structural Engineer Report.html', 'IMG_2481.jpg']) {
      expect(isMeasurementDocName(n), n).toBe(false);
    }
  });

  it('only picks PDFs, since the sized URL of a PDF is a JPEG', () => {
    const files = [
      { name: 'GAF Report 5614432', type: 'application/pdf', url: 'u', originalUrl: 'o' },
      { name: 'GAF Report 5614432 - NorthImage', type: 'image/jpeg', url: 'u', originalUrl: 'o' },
    ];
    expect(findMeasurementDocs(files).map((f) => f.type)).toEqual(['application/pdf']);
  });
});
