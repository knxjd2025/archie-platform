/**
 * Words a person reads (a rendered report, a model's output instructions) carry
 * no em dash. Two checks: every rendered document for the fixture report, and
 * the source of every file that puts words on a screen (comments excluded).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateComprehensiveReportHTML } from '../roof-analysis-report-html';
import { generateReportHtml, type ReportData } from '../measurement-report-html';
import type { ReportTemplate } from '../comprehensive-roof-report';
import { generateScrollPresentationHTML } from '../scroll-presentation-report';
import { generateScrollFlightReportHTML } from '../scroll-flight-report';
import type { AnalyzedPhoto } from '../comprehensive-roof-report';
import { makeReport } from './fixtures/report';

const EM = '—';
const ROOT = path.resolve(__dirname, '..');

/** Source lines with comments removed, so only strings and markup remain. */
function codeLines(file: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let inBlock = false;
  readFileSync(path.join(ROOT, file), 'utf8').split('\n').forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0 && !line.includes('*/', open)) {
      line = line.slice(0, open);
      inBlock = true;
    }
    line = line.replace(/(^|\s)\/\/.*$/, '');
    out.push({ n: i + 1, text: line });
  });
  return out;
}

export function emDashesInCode(file: string): string[] {
  return codeLines(file)
    .filter((l) => l.text.includes(EM) || /&mdash;|&#8212;|&#x2014;|\\u2014/i.test(l.text))
    .map((l) => `${file}:${l.n}`);
}

const SCREEN_FILES = [
  'report-templates.ts',
  'report-sections.ts',
  'report-motion.ts',
  'company-header-html.ts',
  'roof-analysis-report-html.ts',
  'measurement-report-html.ts',
  'scroll-presentation-report.ts',
  'scroll-flight-report.ts',
  'render-report-html.ts',
  'presentation-chapters.ts',
  'claude-report-narrator.ts',
  'claude-image-labeler.ts',
  // The words that reach a customer through the estimate, the findings, the summary and the photo tips.
  'roof-report-pricing.ts',
  'roof-repair-pricing.ts',
  'default-pricing.ts',
  'damage-knowledge-base.ts',
  'comprehensive-roof-report.ts',
  'storm-history-service.ts',
  'groq-vision.ts',
];

describe('no em dashes in what a person reads', () => {
  it('rendered classic document: none, for every template', () => {
    for (const template of ['insurance', 'homeowner', 'full', 'quick'] as ReportTemplate[]) {
      const html = generateComprehensiveReportHTML(makeReport({ reportTemplate: template }));
      expect(html.length, template).toBeGreaterThan(500);
      expect(html.includes(EM), template).toBe(false);
      expect(/&mdash;/i.test(html), template).toBe(false);
    }
  });

  it('rendered measurement document: none', () => {
    const data = {
      address: '12 Elm Street, Cedar Falls IA',
      date: '2026-06-06',
      segments: [{ label: 'North Slope', areaSqFt: 1200, pitch: '6/12' }],
      totalFootprintSqFt: 1200,
      totalAdjustedSqFt: 1342,
      averagePitch: '6/12',
      wastePercentage: 10,
      materials: {},
      dataSource: 'Satellite imagery',
    } as unknown as ReportData;
    const html = generateReportHtml(data);
    expect(html.length).toBeGreaterThan(500);
    expect(html.includes(EM)).toBe(false);
  });

  it('rendered presentation and flight: none', () => {
    const photos = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      url: `https://cdn.example.com/roof-${i}.jpg`,
      damages: [],
      overallSeverity: 'none',
      aiSummary: 'Looks sound.',
      analyzedAt: '2026-09-05T00:00:00.000Z',
    })) as unknown as AnalyzedPhoto[];
    const report = makeReport();
    const rich = { ...report, damageAnalysis: { ...report.damageAnalysis, photos } };
    const brand = { companyName: 'Summit Ridge Roofing', companyPhone: '(319) 555-0142' };
    const presentation = generateScrollPresentationHTML(rich, brand, null);
    const flight = generateScrollFlightReportHTML(rich, brand);
    for (const [name, html] of [['presentation', presentation], ['flight', flight]]) {
      expect(html.length, name).toBeGreaterThan(500);
      // The vendored engine is not ours to edit; check the page we author around it.
      // Comments inside the page's stylesheet are not read by anyone.
      const authored = (html.slice(0, html.indexOf('<script>')) + html.slice(html.lastIndexOf('</script>')))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      expect(authored.includes(EM), name).toBe(false);
      expect(/&mdash;/i.test(authored), name).toBe(false);
    }
  });

  it('source: no em dash in any string of the files that put words on a screen', () => {
    expect(SCREEN_FILES.flatMap(emDashesInCode)).toEqual([]);
  });
});
