/**
 * The page a person is shown for a roof report, made ONE way for both doors: the
 * signed-in view (GET /api/roof-reports/:id/html) and the customer's share link
 * (GET /r/roof/:token). Both serve it in a sandbox with no origin of its own, a
 * policy that lets only this response's nonce run script, and images only from
 * the app (page-policy.ts). They differ only in WHERE the photo addresses point:
 * a short signed link for the signed-in view, the share token's own photo route
 * for the customer's.
 *
 * Run as the company in context (the session's, or the share link's).
 */
import type { Request } from 'express';
import { MOTION_PATH } from '../lib/roof-reports/report-motion.js';
import { normalizeReportNumbers } from '../lib/roof-reports/report-normalize.js';
import { renderReportHtml } from '../lib/roof-reports/render-report-html.js';
import type { ComprehensiveRoofReport } from '../lib/roof-reports/comprehensive-roof-report.js';
import type { RoofReport, RoofReportPhoto } from '../../shared/schema';
import { currentProfile } from '../tenant/context';
import { brandFor } from './brand';
import { packForCurrentCompany } from './packs';
import { newNonce, pagePolicy } from './page-policy';

/** The address the app is reached at, for the links inside a page. */
export function appOrigin(req: Request): string {
  const configured = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

export type PhotoLinker = (photoId: string, variant: 'working' | 'thumb') => string;

/** The report to show a person: the saved report with the row's own settings on top, and every photo from the address `link` gives it. */
export function reportForPage(row: RoofReport, photos: RoofReportPhoto[], link: PhotoLinker): ComprehensiveRoofReport {
  const base = normalizeReportNumbers(row.reportJson as unknown as ComprehensiveRoofReport);
  const own = new Map(photos.map((p) => [p.id, p]));
  return {
    ...base,
    reportTemplate: row.template as ComprehensiveRoofReport['reportTemplate'],
    reportVisualStyle: (row.visualStyle ?? undefined) as ComprehensiveRoofReport['reportVisualStyle'],
    customerName: row.customerName ?? undefined,
    customerEmail: row.customerEmail ?? undefined,
    inspectionDate: row.inspectionDate ? row.inspectionDate.toISOString() : undefined,
    inspectorNotes: row.inspectorNotes ?? base.inspectorNotes,
    damageAnalysis: {
      ...base.damageAnalysis,
      // A photo not on this report is shown with no picture, whatever address the saved report holds.
      photos: (base.damageAnalysis?.photos ?? []).map((p) => ({
        ...p,
        url: own.has(p.id) ? link(p.id, 'working') : '',
        thumbnailUrl: own.has(p.id) ? link(p.id, 'thumb') : undefined,
      })),
    },
  };
}

export interface ServedPage { html: string; policy: string }

/**
 * The page and the policy it is served under. A page a person saved is shown as
 * saved, with no script (`savedPage` can change its text first, for the share
 * link); otherwise it is built here by the escaped renderers, with the company's
 * own chapters if it has any, and runs only scripts that carry this response's nonce.
 */
export async function servedPage(args: {
  row: RoofReport;
  photos: RoofReportPhoto[];
  origin: string;
  link: PhotoLinker;
  savedPage?: (html: string) => string;
}): Promise<ServedPage> {
  const { row, photos, origin, link } = args;
  const brand = brandFor(currentProfile());
  const logoUrl = brand.brandColors.companyLogo;
  if (row.editedHtml) {
    return { html: args.savedPage ? args.savedPage(row.editedHtml) : row.editedHtml, policy: pagePolicy({ kind: 'saved', appOrigin: origin, logoUrl }) };
  }
  // The scroll pages carry the app's own scripts. They run in the sandbox, and only because
  // they carry this response's nonce: a script that got in any other way does not.
  const nonce = newNonce();
  // The company's own chapters (its data, found by the company in context), or none: the base presentation.
  const pack = await packForCurrentCompany();
  const rendered = await renderReportHtml(reportForPage(row, photos, link), brand.brandColors, { nonce, motionBase: `${origin}${MOTION_PATH}`, pack });
  return { html: rendered.html, policy: pagePolicy({ kind: 'built', nonce, appOrigin: origin, logoUrl }) };
}
