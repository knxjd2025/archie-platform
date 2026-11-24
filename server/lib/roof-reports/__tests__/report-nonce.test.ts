/**
 * A served report page runs only its own scripts.
 *
 * The page is served with a per-response nonce in its policy. For that to mean
 * anything, every script a renderer writes must carry the nonce AT THE POINT
 * the renderer writes it (never added afterwards by a pass over the finished
 * page, which would bless an injected script as well), and no renderer may rely
 * on an inline event-handler attribute, which a nonce policy cannot allow.
 */
import { describe, it, expect } from 'vitest';
import { renderReportHtml } from '../render-report-html';
import { generateComprehensiveReportHTML } from '../roof-analysis-report-html';
import { generateReportHtml } from '../measurement-report-html';
import { motionRuntime } from '../report-motion';
import { scanHtml, richBrand, richMeasurementData, richPack, richReport } from './fixtures/injection';
import type { ComprehensiveRoofReport } from '../comprehensive-roof-report';

const NONCE = 'dGVzdC1ub25jZS0wMDAxLWFiY2RlZg==';

/** Every script element of a page, as a browser's tokenizer sees it. */
function scripts(html: string) {
  return scanHtml(html).tags.filter((t) => t.name === 'script');
}
const nonceOf = (t: { attrs: Array<{ name: string; value: string }> }) => t.attrs.find((a) => a.name === 'nonce')?.value;
/** Scripts that would NOT run under a policy that allows only this nonce. */
const unapproved = (html: string, nonce: string) => scripts(html).filter((t) => nonceOf(t) !== nonce);
/** Inline handler attributes anywhere in the page: a nonce does not allow these. */
const handlers = (html: string) => scanHtml(html).tags.flatMap((t) => t.attrs.filter((a) => a.name.startsWith('on')).map((a) => `${t.name}:${a.name}`));

const withStyle = (style: 'formal' | 'presentation' | 'flight'): ComprehensiveRoofReport => ({ ...richReport('full'), reportVisualStyle: style });

describe('every script a renderer writes carries the nonce', () => {
  for (const style of ['formal', 'presentation', 'flight'] as const) {
    it(`the ${style} page, through the one renderer the route uses`, async () => {
      const out = await renderReportHtml(withStyle(style), richBrand() as never, { nonce: NONCE, pack: style === 'presentation' ? richPack() : null });
      expect(out.style).toBe(style);
      const all = scripts(out.html);
      expect(all.length).toBeGreaterThan(0);
      expect(unapproved(out.html, NONCE)).toEqual([]);
      expect(handlers(out.html)).toEqual([]);
    });
  }

  it('the classic document, in every template', () => {
    for (const template of ['insurance', 'homeowner', 'full', 'quick'] as const) {
      const html = generateComprehensiveReportHTML(richReport(template), richBrand() as never, { nonce: NONCE });
      expect(scripts(html).length, template).toBeGreaterThan(0);
      expect(unapproved(html, NONCE), template).toEqual([]);
      expect(handlers(html), template).toEqual([]);
    }
  });

  it('the measurement report', () => {
    const html = generateReportHtml(richMeasurementData(), { nonce: NONCE });
    expect(unapproved(html, NONCE)).toEqual([]);
    expect(handlers(html)).toEqual([]);
  });

  it('the vendored engine is inlined under the nonce, and its source is the one that was vendored', async () => {
    const { SCROLLCRAFT_JS } = await import('../../reports/scrollcraft-engine');
    const out = await renderReportHtml(withStyle('flight'), richBrand() as never, { nonce: NONCE });
    expect(out.html).toContain(`<script nonce="${NONCE}">${SCROLLCRAFT_JS}</script>`);
  });

  it('the print button works from a listener in the page\'s own script, not from an inline handler', () => {
    const html = generateComprehensiveReportHTML(richReport('full'), richBrand() as never, { nonce: NONCE });
    expect(html).not.toMatch(/onclick/i);
    expect(html).toMatch(/addEventListener\(\s*'click'/);
    expect(html).toContain('window.print()');
  });

  it('never loads an outside script when it runs under a nonce', () => {
    const html = generateComprehensiveReportHTML(richReport('full'), richBrand() as never, { nonce: NONCE });
    expect(scripts(html).filter((t) => t.attrs.some((a) => a.name === 'src'))).toEqual([]);
    expect(motionRuntime({ nonce: NONCE })).not.toMatch(/<script[^>]*\ssrc=/);
  });
});

describe('without a nonce nothing changes except that the handler is gone', () => {
  it('writes no nonce attribute at all', async () => {
    const out = await renderReportHtml(withStyle('flight'), richBrand() as never);
    expect(out.html).not.toMatch(/nonce=/);
    expect(handlers(out.html)).toEqual([]);
    expect(generateComprehensiveReportHTML(richReport('full'), richBrand() as never)).not.toMatch(/nonce=/);
  });
});

describe('a nonce that is not a plain token is refused, so it can never open an attribute', () => {
  for (const bad of ['', 'short', 'abc"def onload="x', 'a'.repeat(15), "x'y".padEnd(30, 'a'), 'a b'.padEnd(30, 'a'), 'abc>def'.padEnd(30, 'a'), 'a'.repeat(257)]) {
    it(JSON.stringify(bad.slice(0, 24)), async () => {
      await expect(renderReportHtml(withStyle('flight'), richBrand() as never, { nonce: bad })).rejects.toThrow(/nonce/i);
      expect(() => generateComprehensiveReportHTML(richReport('full'), richBrand() as never, { nonce: bad })).toThrow(/nonce/i);
    });
  }
});

describe('a script or handler that gets in anyway does not carry the nonce', () => {
  /** Stands in for a value somebody forgot to escape: raw markup spliced into the finished page. */
  const PAYLOAD = '<script>stealEverything()</script><img src="x" onerror="stealEverything()"><svg onload=stealEverything()>';
  const splice = (html: string) => html.replace('</body>', `${PAYLOAD}</body>`);

  for (const style of ['formal', 'presentation', 'flight'] as const) {
    it(`in the ${style} page`, async () => {
      const out = await renderReportHtml(withStyle(style), richBrand() as never, { nonce: NONCE, pack: style === 'presentation' ? richPack() : null });
      const before = scripts(out.html).length;
      const dirty = splice(out.html);
      const loose = unapproved(dirty, NONCE);
      // Exactly the one injected script is unapproved; every script the renderer wrote still is.
      expect(scripts(dirty)).toHaveLength(before + 1);
      expect(loose).toHaveLength(1);
      expect(nonceOf(loose[0])).toBeUndefined();
      // The injected handlers are there to be seen, and no policy with a nonce allows them to run.
      expect(handlers(dirty)).toEqual(['img:onerror', 'svg:onload']);
    });
  }
});
