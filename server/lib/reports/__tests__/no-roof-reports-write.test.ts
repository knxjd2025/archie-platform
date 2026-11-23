/**
 * Archie never had a roof_reports table, so the write that used to sit in the
 * inspection generator always failed and was swallowed. Once the roof reports
 * feature creates that table, the write would start landing in it with the
 * wrong columns. This holds the write out, and shows the inspection flow
 * behaves the same without it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const execute = vi.fn(async () => ({ rows: [] }));
vi.mock('../../../db', () => ({ db: { execute } }));
vi.mock('../storm-history-service.js', () => ({
  generateStormReport: vi.fn(async () => ({
    property_address: '12 Elm Street',
    city: 'Cedar Falls',
    state: 'IA',
    latitude: 42.5,
    longitude: -92.4,
    start_date: '2023-01-01',
    end_date: '2026-01-01',
    years_covered: 3,
    search_radius_miles: 5,
    summary: { total_events: 0, hail_events: 0, wind_events: 0, tornado_events: 0, insurance_claim_potential: 'none' },
    events: [],
    events_by_year: {},
    significant_events: [],
    risk_assessment: { hail_risk: 'low', wind_risk: 'low', overall_risk: 'low', risk_factors: [] },
  })),
}));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

describe('the reports library and the roof_reports table', () => {
  it('no source file under server/lib/reports mentions roof_reports', () => {
    const root = path.resolve(__dirname, '..');
    const hits = sourceFiles(root).filter((file) => readFileSync(file, 'utf8').includes('roof_reports'));
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });

  describe('the inspection flow without the write', () => {
    beforeEach(() => execute.mockClear());

    it('still returns its report and page, and never touches the database', async () => {
      const { generateInspectionReport } = await import('../generate-inspection');
      const result = await generateInspectionReport({
        address: '12 Elm Street',
        city: 'Cedar Falls',
        state: 'IA',
        zip: '50613',
        photos: [{ url: 'https://photos.example.com/a.jpg', caption: 'Front slope' }],
        analyzePhotos: false,
      });
      expect(result.report.property.address).toBe('12 Elm Street');
      expect((result.report.damageAnalysis as any).analysisSkipped).toBe(true);
      expect(result.html.length).toBeGreaterThan(100);
      expect(typeof result.processingTimeMs).toBe('number');
      expect(execute).not.toHaveBeenCalled();
    });
  });
});
