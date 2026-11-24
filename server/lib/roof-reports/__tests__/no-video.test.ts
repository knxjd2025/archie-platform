/**
 * Stills only. There is no ffmpeg on Archie's hosting, and a homeowner on a
 * phone should not be sent tens of megabytes: no renderer writes a video
 * element, a video source or a video address, in any style, served or not.
 */
import { describe, it, expect } from 'vitest';
import { renderReportHtml } from '../render-report-html';
import { generateComprehensiveReportHTML } from '../roof-analysis-report-html';
import { generateScrollFlightReportHTML } from '../scroll-flight-report';
import { generateScrollPresentationHTML } from '../scroll-presentation-report';
import { generateReportHtml } from '../measurement-report-html';
import { SCROLLCRAFT_JS } from '../../reports/scrollcraft-engine';
import { richBrand, richMeasurementData, richPack, richReport, scanHtml } from './fixtures/injection';

const NONCE = 'dGVzdC1ub25jZS0wMDAxLWFiY2RlZg==';
const VIDEO_TAGS = new Set(['video', 'source', 'track']);

/** The markup the page is made of: tags of the page itself (engine text inside scripts is not markup). */
function videoThings(html: string): string[] {
  const page = scanHtml(html);
  const tags = page.tags.filter((t) => VIDEO_TAGS.has(t.name)).map((t) => `<${t.name}>`);
  const addresses = page.tags.flatMap((t) => t.attrs.filter((a) => /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(a.value) || /^(data-sc-)?(video|clip|poster-video)$/i.test(a.name)).map((a) => `${t.name}[${a.name}]`));
  return [...tags, ...addresses];
}

describe('no renderer writes a video', () => {
  it('through the one renderer the route uses, in every style, with and without a nonce and a pack', async () => {
    for (const style of ['formal', 'presentation', 'flight'] as const) {
      for (const nonce of [undefined, NONCE]) {
        const out = await renderReportHtml({ ...richReport('full'), reportVisualStyle: style }, richBrand() as never, { nonce, pack: richPack() });
        expect(out.style).toBe(style);
        expect(videoThings(out.html), `${style} ${nonce ? 'with' : 'without'} a nonce`).toEqual([]);
        // The page's own scripts name no clip either (the vendored engine can play one, so its own text is left out):
        // the legs are posters pushed in.
        const own = scanHtml(out.html).rawBlocks.filter((b) => b.name === 'script' && b.text !== SCROLLCRAFT_JS).map((b) => b.text).join('\n');
        expect(own, style).not.toMatch(/\.(mp4|webm|mov|m4v|ogv)\b|createElement\(['"]video|<video/i);
      }
    }
  });

  it('in each renderer called directly, and the measurement document', () => {
    const r = richReport('full');
    for (const [name, html] of [
      ['document', generateComprehensiveReportHTML(r, richBrand() as never)],
      ['presentation', generateScrollPresentationHTML(r, richBrand() as never, richPack())],
      ['flight', generateScrollFlightReportHTML(r, richBrand() as never)],
      ['measurement', generateReportHtml(richMeasurementData())],
    ] as const) expect(videoThings(html), name).toEqual([]);
  });
});
