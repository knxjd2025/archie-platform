/**
 * Nothing a person can type may reach a report page as markup, script or a
 * script URL. These pages are shared by link and exported to storage, so one
 * unescaped value is a stored attack on whoever opens the report.
 *
 * Rather than check a list of fields (which only protects the fields somebody
 * remembered), this walks a fully populated report and brand record, turns
 * EVERY string in them into an attack payload, renders with every renderer and
 * reads the result back like a browser. See fixtures/injection.ts.
 */
import { describe, it, expect } from 'vitest';
import { generateComprehensiveReportHTML, generateRoofAnalysisReportHTML } from '../roof-analysis-report-html';
import { generateReportHtml } from '../measurement-report-html';
import { generateScrollPresentationHTML } from '../scroll-presentation-report';
import { generateScrollFlightReportHTML } from '../scroll-flight-report';
import { companyHeaderHTML } from '../company-header-html';
import {
  injectDeep,
  numberVariants,
  findLeaks,
  baselineOf,
  richReport,
  richBrand,
  richMeasurementData,
  richAnalysisRecord,
  richPack,
  richHeaderOptions,
  type Leak,
} from './fixtures/injection';

type Template = 'insurance' | 'homeowner' | 'full' | 'quick';
const TEMPLATES: Template[] = ['insurance', 'homeowner', 'full', 'quick'];

function leaksFrom(html: string, markers: Map<number, 'html' | 'colour' | 'url'>, baseline: string): Leak[] {
  return findLeaks(html, markers, baselineOf(baseline));
}

function expectClean(name: string, leaks: Leak[]): void {
  const summary = leaks.map((l) => `${l.why} (marker ${l.marker})`);
  expect({ renderer: name, leaks: summary }).toEqual({ renderer: name, leaks: [] });
}

describe('every value on a report page is escaped', () => {
  for (const template of TEMPLATES) {
    it(`classic document, ${template} template`, () => {
      const baseline = generateComprehensiveReportHTML(richReport(template), richBrand() as never);
      const report = injectDeep(richReport(template));
      const brand = injectDeep(richBrand());
      const html = generateComprehensiveReportHTML(report.value, brand.value as never);
      expectClean(`document/${template}`, leaksFrom(html, mergeMarkers(report, brand), baseline));
    });
  }

  it('classic document: a string where a number belongs never reaches the page', () => {
    const baseline = generateComprehensiveReportHTML(richReport('full'), richBrand() as never);
    const bad: string[] = [];
    const variants = numberVariants(richReport('full'));
    expect(variants.length).toBeGreaterThan(80); // the fixture really is populated
    for (const v of variants) {
      let html: string;
      try {
        html = generateComprehensiveReportHTML(v.value, richBrand() as never);
      } catch {
        continue; // refusing to render is safe; only a page that carries the payload is not
      }
      if (leaksFrom(html, v.markers, baseline).length) bad.push(v.path);
    }
    expect(bad).toEqual([]);
  });

  it('measurement document', () => {
    const baseline = generateReportHtml(richMeasurementData());
    const data = injectDeep(richMeasurementData());
    const html = generateReportHtml(data.value);
    expectClean('measurement', leaksFrom(html, data.markers, baseline));
  });

  it('roof analysis (satellite) document', () => {
    const baseline = generateRoofAnalysisReportHTML(richAnalysisRecord(), '<div>header</div>', richBrand() as never);
    const rec = injectDeep(richAnalysisRecord());
    const brand = injectDeep(richBrand());
    const html = generateRoofAnalysisReportHTML(rec.value, '<div>header</div>', brand.value as never);
    expectClean('analysis', leaksFrom(html, mergeMarkers(rec, brand), baseline));
  });

  it('measurement document: a string where a number belongs never reaches the page', () => {
    const baseline = generateReportHtml(richMeasurementData());
    const bad: string[] = [];
    for (const v of numberVariants(richMeasurementData())) {
      let html: string;
      try {
        html = generateReportHtml(v.value);
      } catch {
        continue;
      }
      if (leaksFrom(html, v.markers, baseline).length) bad.push(v.path);
    }
    expect(bad).toEqual([]);
  });

  it('roof analysis document: a string where a number belongs never reaches the page', () => {
    const baseline = generateRoofAnalysisReportHTML(richAnalysisRecord(), '<div>header</div>', richBrand() as never);
    const bad: string[] = [];
    for (const v of numberVariants(richAnalysisRecord())) {
      let html: string;
      try {
        html = generateRoofAnalysisReportHTML(v.value, '<div>header</div>', richBrand() as never);
      } catch {
        continue;
      }
      if (leaksFrom(html, v.markers, baseline).length) bad.push(v.path);
    }
    expect(bad).toEqual([]);
  });

  it('every page keeps the photo text when the photo links are valid (so the text is checked too)', () => {
    const baseline = generateComprehensiveReportHTML(richReport('full'), richBrand() as never);
    const report = injectDeep(richReport('full'), { keep: ['url', 'thumbnailUrl'] });
    const brand = injectDeep(richBrand());
    const html = generateComprehensiveReportHTML(report.value, brand.value as never);
    expectClean('document/photos', leaksFrom(html, mergeMarkers(report, brand), baseline));
    expect(html.match(/<img /g)?.length ?? 0).toBeGreaterThan(3); // the photos really rendered

    const pBase = generateScrollPresentationHTML(richReport('full'), richBrand() as never, richPack());
    const pRep = injectDeep(richReport('full'), { keep: ['url', 'thumbnailUrl'] });
    expectClean('presentation/photos', leaksFrom(generateScrollPresentationHTML(pRep.value, brand.value as never, richPack()), pRep.markers, pBase));

    const fBase = generateScrollFlightReportHTML(richReport('full'), richBrand() as never);
    const fRep = injectDeep(richReport('full'), { keep: ['url', 'thumbnailUrl'] });
    expectClean('flight/photos', leaksFrom(generateScrollFlightReportHTML(fRep.value, brand.value as never), fRep.markers, fBase));
  });

  it('company header block', () => {
    const baseline = companyHeaderHTML(richHeaderOptions());
    for (const compact of [false, true]) {
      const opts = injectDeep({ ...richHeaderOptions(), compact });
      const html = companyHeaderHTML(opts.value as never);
      expectClean(`header/${compact ? 'compact' : 'full'}`, leaksFrom(html, opts.markers, baseline));
    }
  });

  it('presentation', () => {
    const baseline = generateScrollPresentationHTML(richReport('full'), richBrand() as never, richPack());
    const report = injectDeep(richReport('full'));
    const brand = injectDeep(richBrand());
    const pack = injectDeep(richPack());
    const html = generateScrollPresentationHTML(report.value, brand.value as never, pack.value);
    expectClean('presentation', leaksFrom(html, mergeMarkers(report, brand, pack), baseline));
  });

  it('presentation, pack ids kept valid so every pack chapter renders', () => {
    const baseline = generateScrollPresentationHTML(richReport('full'), richBrand() as never, richPack());
    const report = injectDeep(richReport('full'));
    const brand = injectDeep(richBrand());
    const pack = injectDeep(richPack(), { keep: ['id', 'after', 'onlyWithWork'] });
    const html = generateScrollPresentationHTML(report.value, brand.value as never, pack.value);
    expectClean('presentation/pack', leaksFrom(html, mergeMarkers(report, brand, pack), baseline));
    // and the chapters really rendered, so the check above looked at them
    expect(html).toContain('id="ventilation"');
  });

  it('presentation: a string where a number belongs never reaches the page', () => {
    const baseline = generateScrollPresentationHTML(richReport('full'), richBrand() as never, richPack());
    const bad: string[] = [];
    for (const v of numberVariants({ report: richReport('full'), pack: richPack() })) {
      let html: string;
      try {
        html = generateScrollPresentationHTML(v.value.report, richBrand() as never, v.value.pack);
      } catch {
        continue;
      }
      if (leaksFrom(html, v.markers, baseline).length) bad.push(v.path);
    }
    expect(bad).toEqual([]);
  });

  it('presentation, pack id with markup is dropped, not rendered', () => {
    const pack = richPack();
    pack.chapters[0].id = 'x"><img src=x onerror=PACKID>';
    pack.chapters[1].minutes = '1</script><script>PACKMIN</script>' as never;
    const html = generateScrollPresentationHTML(richReport('full'), richBrand() as never, pack);
    expect(html).not.toContain('onerror=PACKID');
    expect(html).not.toContain('<script>PACKMIN');
    expect(html).not.toContain('PACKMIN</script>');
  });

  it('flight', () => {
    const baseline = generateScrollFlightReportHTML(richReport('full'), richBrand() as never);
    const report = injectDeep(richReport('full'));
    const brand = injectDeep(richBrand());
    const html = generateScrollFlightReportHTML(report.value, brand.value as never);
    expectClean('flight', leaksFrom(html, mergeMarkers(report, brand), baseline));
  });

  it('flight: a string where a number belongs never reaches the page', () => {
    const baseline = generateScrollFlightReportHTML(richReport('full'), richBrand() as never);
    const bad: string[] = [];
    for (const v of numberVariants(richReport('full'))) {
      let html: string;
      try {
        html = generateScrollFlightReportHTML(v.value, richBrand() as never);
      } catch {
        continue;
      }
      if (leaksFrom(html, v.markers, baseline).length) bad.push(v.path);
    }
    expect(bad).toEqual([]);
  });

  it('the website link only ever carries http, https, mailto or tel', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' \tjavascript:alert(1)', 'data:text/html,<b>x', 'vbscript:x', '//evil.example/x']) {
      const html = generateComprehensiveReportHTML(richReport('full'), { ...richBrand(), companyWebsite: bad } as never);
      for (const m of html.matchAll(/href="([^"]*)"/g)) {
        expect(m[1].replace(/[\u0000- ]/g, '').toLowerCase()).not.toMatch(/^(javascript|vbscript|data):/);
      }
    }
  });
});

/** Merge the marker tables of several injected values into one (they share one counter, so numbers never clash). */
function mergeMarkers(...parts: Array<{ markers: Map<number, 'html' | 'colour' | 'url'> }>): Map<number, 'html' | 'colour' | 'url'> {
  const out = new Map<number, 'html' | 'colour' | 'url'>();
  for (const p of parts) for (const [n, k] of p.markers) out.set(n, k);
  return out;
}
