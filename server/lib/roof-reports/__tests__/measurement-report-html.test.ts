/**
 * Render tests for the measurement-report HTML generator
 * (lib/measurement-report-html.ts).
 *
 * These measurement reports interpolate user-controlled free text — customer /
 * company name, property address, inspector name, segment labels, notes — into
 * a self-contained HTML document that is exported to R2 / shared links and
 * printed to PDF. An injected "<script>" must never survive as raw markup, or
 * it would execute in the shared/exported report.
 *
 * The generator must route every user free-text interpolation through
 * escapeHtml() (from lib/escape-html.ts). This suite is the regression lock:
 * it asserts XSS payloads come out entity-encoded while ordinary content still
 * renders verbatim.
 */
import { describe, it, expect } from 'vitest';
import { generateReportHtml, type ReportData } from '../measurement-report-html';
import type { RoofSegment } from '../geometry-utils';

const XSS = '<script>alert(1)</script>';
const XSS_ENCODED = '&lt;script&gt;alert(1)&lt;/script&gt;';

function baseData(overrides: Partial<ReportData> = {}): ReportData {
  const segments: RoofSegment[] = [
    { label: 'North Slope', areaSqFt: 1200, pitch: '6/12' } as RoofSegment,
  ];
  return {
    address: '12 Elm Street, Cedar Falls IA',
    date: '2026-06-06',
    segments,
    totalFootprintSqFt: 1200,
    totalAdjustedSqFt: 1342,
    averagePitch: '6/12',
    wastePercentage: 10,
    materials: {
      shingleSquares: 13,
      shingleBundles: 39,
      underlaymentRolls: 3,
      starterStripLF: 120,
      starterStripBoxes: 1,
      ridgeCapLF: 40,
      ridgeCapBundles: 2,
      dripEdgeLF: 160,
      dripEdgePieces: 16,
      iceShieldLF: 80,
      iceShieldRolls: 2,
      flashingLF: 30,
      flashingPieces: 3,
      nailPounds: 26,
      ventSquareInches: 1500,
    } as ReportData['materials'],
    dataSource: 'Satellite imagery',
    ...overrides,
  };
}

describe('generateReportHtml — XSS escaping of user free-text fields', () => {
  it('entity-encodes a <script> payload in the property address', () => {
    const html = generateReportHtml(baseData({ address: XSS }));
    expect(html).toContain(XSS_ENCODED);
    expect(html).not.toContain(XSS); // no raw script tag survives
  });

  it('entity-encodes a <script> payload in the company name', () => {
    const html = generateReportHtml(baseData({ companyName: XSS }));
    expect(html).toContain(XSS_ENCODED);
    expect(html).not.toContain(XSS);
  });

  it('entity-encodes a <script> payload in the inspector name', () => {
    const html = generateReportHtml(baseData({ inspectorName: XSS }));
    expect(html).toContain(XSS_ENCODED);
    expect(html).not.toContain(XSS);
  });

  it('entity-encodes a <script> payload in a segment label', () => {
    const segments: RoofSegment[] = [
      { label: XSS, areaSqFt: 1000, pitch: '4/12' } as RoofSegment,
    ];
    const html = generateReportHtml(baseData({ segments }));
    expect(html).toContain(XSS_ENCODED);
    expect(html).not.toContain(XSS);
  });

  it('entity-encodes a <script> payload in the data source', () => {
    const html = generateReportHtml(baseData({ dataSource: XSS }));
    expect(html).toContain(XSS_ENCODED);
    expect(html).not.toContain(XSS);
  });

  it('entity-encodes a <script> payload in the company address and contact line', () => {
    const html = generateReportHtml(
      baseData({
        companyName: 'Acme Roofing',
        companyAddress: XSS,
        companyPhone: XSS,
      }),
    );
    expect(html).toContain(XSS_ENCODED);
    expect(html).not.toContain(XSS);
  });

  it('renders ordinary user content verbatim (no over-escaping of plain text)', () => {
    const html = generateReportHtml(
      baseData({
        address: '12 Elm Street, Cedar Falls IA',
        companyName: 'Acme Roofing Co',
        inspectorName: 'Jane Doe',
      }),
    );
    expect(html).toContain('12 Elm Street, Cedar Falls IA');
    expect(html).toContain('Acme Roofing Co');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('North Slope');
  });
});
