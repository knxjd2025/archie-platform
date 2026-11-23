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

  it('source: no em dash in any string of the files that put words on a screen', () => {
    expect(SCREEN_FILES.flatMap(emDashesInCode)).toEqual([]);
  });
});
