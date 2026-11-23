/**
 * Tests for the scroll-flight report renderer and the style routing that picks it.
 *
 * The flight is a customer-facing document with tenant-supplied data in it, so
 * the tests that matter most are the escaping ones and the ones that prove a
 * report without enough photography falls back to the document instead of
 * shipping a two-frame slideshow.
 */
import { describe, it, expect } from 'vitest';
import {
  generateScrollFlightReportHTML,
  canRenderFlight,
  orderPhotosForFlight,
  flightTrackHeight,
  MIN_FLIGHT_PHOTOS,
  MAX_FLIGHT_LEGS,
} from '../scroll-flight-report';
import { resolveVisualStyle, isFlightStyle } from '../report-templates';
import { renderReportHtml } from '../render-report-html';
import type { AnalyzedPhoto, ComprehensiveRoofReport } from '../comprehensive-roof-report';
import { makeReport as baseReport } from './fixtures/report';

/** The markup we authored, with the inlined engine script excluded. */
function bodyMarkup(html: string): string {
  return html.slice(html.indexOf('<body>'), html.indexOf('<script>'));
}

/** Our own :root theme block, which is emitted after the engine's stylesheet. */
function themeBlock(html: string): string {
  return html.slice(html.indexOf(':root{\n  --sc-canvas:'), html.indexOf('body{background:'));
}

function photo(over: Partial<AnalyzedPhoto> = {}): AnalyzedPhoto {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    url: 'https://cdn.example.com/roof.jpg',
    damages: [],
    overallSeverity: 'none',
    aiSummary: '',
    analyzedAt: '2026-09-04T00:00:00.000Z',
    ...over,
  } as AnalyzedPhoto;
}

/** The shared fixture, plus the photography a flight needs to be worth telling. */
function makeReport(over: Partial<ComprehensiveRoofReport> = {}): ComprehensiveRoofReport {
  const base = baseReport();
  return {
    ...base,
    damageAnalysis: {
      ...base.damageAnalysis,
      totalPhotosAnalyzed: 5,
      photosWithDamage: 1,
      overallSeverity: 'low',
      aiSummary: 'Roof is in good condition overall.',
      photos: [
        photo({ photoCategory: 'closeup' }),
        photo({ photoCategory: 'overview' }),
        photo({ photoCategory: 'roof_surface' }),
        photo({
          photoCategory: 'vent',
          overallSeverity: 'high',
          damages: [{ type: 'pipe_boot_failure', label: 'Pipe boot failure', severity: 'high', location: 'Rear slope', confidence: 0.9 }] as never,
        }),
      ],
    },
    repairEstimate: { ...base.repairEstimate, total: 1250 },
    ...over,
  } as ComprehensiveRoofReport;
}

describe('orderPhotosForFlight', () => {
  it('flies from the widest shot down to the closest detail', () => {
    const ordered = orderPhotosForFlight(makeReport().damageAnalysis.photos);
    expect(ordered.map((p) => p.photoCategory)).toEqual([
      'overview',
      'roof_surface',
      'vent',
      'closeup',
    ]);
  });

  it('drops photos with no usable url', () => {
    const ordered = orderPhotosForFlight([photo(), photo({ url: '' })] as AnalyzedPhoto[]);
    expect(ordered).toHaveLength(1);
  });

  it('caps the flight so a 60 photo job does not become a 60 leg page', () => {
    const many = Array.from({ length: 60 }, () => photo());
    expect(orderPhotosForFlight(many)).toHaveLength(MAX_FLIGHT_LEGS);
  });
});

describe('canRenderFlight', () => {
  it('accepts a report with enough photography', () => {
    expect(canRenderFlight(makeReport())).toBe(true);
  });

  it('rejects a report with too few photos to read as a flight', () => {
    const thin = makeReport({
      damageAnalysis: { ...makeReport().damageAnalysis, photos: [photo(), photo()] } as never,
    });
    expect(canRenderFlight(thin)).toBe(false);
    expect(MIN_FLIGHT_PHOTOS).toBeGreaterThan(2);
  });

  it('rejects a report with no photos at all', () => {
    const none = makeReport({
      damageAnalysis: { ...makeReport().damageAnalysis, photos: [] } as never,
    });
    expect(canRenderFlight(none)).toBe(false);
  });
});

describe('generateScrollFlightReportHTML', () => {
  it('renders one worldflight stage with a segment per photo', () => {
    const html = generateScrollFlightReportHTML(makeReport());
    expect(html).toContain('data-sc-mode="worldflight"');
    expect(bodyMarkup(html).match(/data-sc-segment/g) || []).toHaveLength(4);
  });

  it('inlines the engine so a saved copy still works offline', () => {
    const html = generateScrollFlightReportHTML(makeReport());
    expect(html).toContain('ScrollCraft.mount');
    expect(html).not.toContain('src="scrollcraft.js"');
  });

  it('carries no <video>: the flight is built from stills so it needs no ffmpeg', () => {
    const html = generateScrollFlightReportHTML(makeReport());
    expect(bodyMarkup(html)).not.toContain('<video');
    expect(bodyMarkup(html)).not.toContain('data-sc-src');
    expect(html).toContain('sc-world__poster');
  });

  it('uses the tenant brand colour, not a hard-coded one', () => {
    const html = generateScrollFlightReportHTML(makeReport(), { brandPrimaryColor: '#0055AA' });
    expect(themeBlock(html)).toContain('--sc-accent:#0055AA');
  });

  it('rejects a brand colour that is not a hex value', () => {
    const html = generateScrollFlightReportHTML(makeReport(), {
      brandPrimaryColor: 'red;} body{display:none}',
    });
    expect(html).not.toContain('--sc-accent:red');
    expect(themeBlock(html)).toContain('--sc-accent:#EA580C');
  });

  it('escapes tenant and property text', () => {
    const html = generateScrollFlightReportHTML(
      makeReport({
        property: { ...makeReport().property, address: '<script>alert(1)</script>' },
      }),
      { companyName: '<img src=x onerror=alert(1)>' },
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a photo url so it cannot break out of the src attribute', () => {
    const html = generateScrollFlightReportHTML(
      makeReport({
        damageAnalysis: {
          ...makeReport().damageAnalysis,
          photos: [
            photo({ url: 'https://x/a.jpg" onerror="alert(1)' }),
            photo(),
            photo(),
          ],
        } as never,
      }),
    );
    expect(html).not.toContain('onerror="alert(1)"');
  });

  it('says the honest thing when the roof is fine', () => {
    const html = generateScrollFlightReportHTML(makeReport());
    expect(html).toContain('You do not need a new roof.');
  });

  it('changes the verdict when the damage is severe', () => {
    const html = generateScrollFlightReportHTML(
      makeReport({
        damageAnalysis: { ...makeReport().damageAnalysis, overallSeverity: 'critical' } as never,
      }),
    );
    expect(html).toContain('needs attention now');
    expect(html).not.toContain('You do not need a new roof.');
  });

  it('gives the verdict the widest copy window on the page', () => {
    const html = generateScrollFlightReportHTML(makeReport());
    const spans = [...bodyMarkup(html).matchAll(/data-sc-window="([\d.]+) ([\d.]+)"/g)]
      .map((m) => +m[2] - +m[1]);
    expect(spans.length).toBeGreaterThan(1);
    expect(Math.max(...spans)).toBeCloseTo(0.22, 2);
  });

  it('omits the estimate figure when there is no estimate', () => {
    const html = generateScrollFlightReportHTML(
      makeReport({ repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] } as never }),
    );
    expect(html).not.toContain('Estimated to put right');
  });

  it('renders no phone CTA when the tenant has no phone on file', () => {
    const html = generateScrollFlightReportHTML(makeReport(), {});
    expect(html).not.toContain('href="tel:');
  });
});

describe('flightTrackHeight', () => {
  it('grows with the number of legs', () => {
    expect(flightTrackHeight(makeReport())).toBeGreaterThan(flightTrackHeight(
      makeReport({ damageAnalysis: { ...makeReport().damageAnalysis, photos: [photo(), photo(), photo()] } as never }),
    ));
  });
});

describe('visual style routing', () => {
  it('falls back to the template default when nothing is set', () => {
    expect(resolveVisualStyle('insurance')).toBe('formal');
  });

  it('lets an explicit override win', () => {
    expect(resolveVisualStyle('insurance', 'flight')).toBe('flight');
    expect(isFlightStyle(resolveVisualStyle('insurance', 'flight'))).toBe(true);
  });

  it('ignores an unrecognised override rather than throwing', () => {
    expect(resolveVisualStyle('full', 'nonsense')).toBe(getFullDefault());
  });

  function getFullDefault() {
    return resolveVisualStyle('full');
  }
});

describe('renderReportHtml', () => {
  it('renders a flight when the style asks for one', async () => {
    const out = await renderReportHtml(makeReport({ reportVisualStyle: 'flight' }));
    expect(out.style).toBe('flight');
    expect(out.html).toContain('data-sc-mode="worldflight"');
    expect(out.downgradeReason).toBeUndefined();
  });

  it('falls back to the document, and says why, when there are too few photos', async () => {
    const thin = makeReport({
      reportVisualStyle: 'flight',
      damageAnalysis: { ...makeReport().damageAnalysis, photos: [photo()] } as never,
    });
    const out = await renderReportHtml(thin);
    // The downgrade reports what was actually rendered, and that is the document.
    expect(out.style).toBe('formal');
    expect(out.html).not.toContain('<div data-sc-mode="worldflight"');
    expect(out.downgradeReason).toMatch(/at least/);
  });

  it('uses the caller fallback when the backend dropped the field', async () => {
    const out = await renderReportHtml(makeReport(), {}, { styleFallback: 'flight' });
    expect(out.style).toBe('flight');
  });

  it('does not render a flight by default', async () => {
    // The default template's style is `presentation`, which is its own renderer.
    // The engine's own source documents the worldflight markup in a comment, so
    // a string match over the whole document proves nothing — look for the
    // mounted element in the markup we author, ahead of the inlined script.
    const out = await renderReportHtml(makeReport());
    expect(out.style).not.toBe('flight');
    const authored = out.html.slice(0, out.html.indexOf('<script>'));
    expect(authored).not.toContain('<div data-sc-mode="worldflight"');
  });
});
