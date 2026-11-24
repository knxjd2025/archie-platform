/**
 * render-report-html.ts — the one place that decides how a report is rendered.
 *
 * A report can be presented two ways, and the choice belongs here rather than at
 * each call site, so the wizard, the editor's regenerate button, saved reports
 * and any server-side caller all stay in step:
 *
 *   document     (`formal`)        the classic stacked-section page. Prints, and
 *                                  is the shape a saved report is edited in.
 *   presentation (`presentation`)  Archie's standard presentation: numbered
 *                                  chapters down a fixed rail with a running
 *                                  clock, price held back until late.
 *   flight       (`flight`)        one continuous scroll-driven descent through
 *                                  the job's own photographs.
 *
 * The PDF is built separately by `@react-pdf/renderer` from the report data, not
 * from any of this HTML, so which style is chosen never affects it.
 *
 * Both scroll renderers are imported lazily on purpose. They carry the vendored
 * scroll engine (~78KB of string), and a report using the document style should
 * not pay for that in the bundle.
 */

import { generateComprehensiveReportHTML } from './roof-analysis-report-html.js';
import { resolveVisualStyle, isFlightStyle } from './report-templates.js';
import { nonceAttr } from './html-safety.js';
import type { ComprehensiveRoofReport, ReportVisualStyle } from './comprehensive-roof-report.js';
import type { ChapterPack } from './presentation-chapters.js';

export interface RenderReportOptions {
  /**
   * Style to use when the report itself does not carry one. The backend is
   * deployed separately, and an older build drops fields it does not know
   * about, so the caller's own choice is a better fallback than the default.
   */
  styleFallback?: ReportVisualStyle;
  /**
   * The company's own presentation chapters, handed in by the caller. Only the
   * presentation style uses it; none is the safe default.
   */
  pack?: ChapterPack | null;
  /**
   * The nonce of the response the page is served in. Every script the renderers
   * write carries it, and none is written without it when this is set. Omitted
   * for a page that is stored or exported rather than served.
   */
  nonce?: string;
}

export interface RenderedReport {
  html: string;
  /** What was actually rendered, which is not always what was asked for. */
  style: ReportVisualStyle;
  /** Set when a flight was requested but could not be rendered. */
  downgradeReason?: string;
}

/**
 * Render a report to a complete HTML document, picking the presentation from
 * the report's own visual style. Always resolves; never throws for a style it
 * does not recognise.
 */
export async function renderReportHtml(
  report: ComprehensiveRoofReport,
  brandColors: Record<string, unknown> = {},
  options: RenderReportOptions = {},
): Promise<RenderedReport> {
  // A nonce that is not a plain token fails here, before any style is picked.
  nonceAttr(options.nonce);
  const nonce = options.nonce === undefined ? {} : { nonce: options.nonce };
  const requested = resolveVisualStyle(
    report.reportTemplate,
    report.reportVisualStyle ?? options.styleFallback,
  );

  if (isFlightStyle(requested)) {
    const flight = await import('./scroll-flight-report.js');
    if (flight.canRenderFlight(report)) {
      return {
        html: flight.generateScrollFlightReportHTML(report, brandColors as never, nonce),
        style: 'flight',
      };
    }
    // A flight built from one or two photographs is a slideshow, and worse than
    // the document it replaced. Fall back rather than ship it.
    const downgradeReason =
      `A scroll flight needs at least ${flight.MIN_FLIGHT_PHOTOS} photos. ` +
      'This report has fewer, so it was rendered as a document.';
    return {
      html: generateComprehensiveReportHTML(report, brandColors as never, nonce),
      style: 'formal',
      downgradeReason,
    };
  }

  if (requested === 'presentation') {
    const pres = await import('./scroll-presentation-report.js');
    if (pres.canRenderPresentation(report)) {
      return {
        html: pres.generateScrollPresentationHTML(report, brandColors as never, options.pack ?? null, nonce),
        style: 'presentation',
      };
    }
    // Every chapter has to be earned by data. A report thin enough to produce
    // only two or three of them is a document with a sidebar bolted on, so send
    // the document rather than something worse than what it replaced.
    return {
      html: generateComprehensiveReportHTML(report, brandColors as never, nonce),
      style: 'formal',
      downgradeReason:
        `A presentation needs at least ${pres.MIN_PRESENTATION_CHAPTERS} chapters of real content. ` +
        'This report has fewer, so it was rendered as a document.',
    };
  }

  return {
    html: generateComprehensiveReportHTML(report, brandColors as never, nonce),
    style: requested,
  };
}
