/**
 * Roof reports: the plain words the screens and routes share, and who may do
 * what (docs/superpowers/plans/2026-11-24-roof-reports-into-archie.md).
 *
 * Reports carry prices, so crew (the Production role) never see one. The rule
 * table below is the one written decision per action per role; the permanent
 * test server/roof-reports/__tests__/roof-report-roles.db.test.ts holds it, so
 * a new action or a new role fails there until somebody decides it. The server
 * is the authority: nothing on a screen is a lock.
 */
import type { TeamRole } from './rbac';

export const REPORT_KINDS = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'measurement', label: 'Measurements' },
  { value: 'storm', label: 'Storm history' },
] as const;

export const TEMPLATES = [
  { value: 'insurance', label: 'Insurance claim' },
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'full', label: 'Full report' },
  { value: 'quick', label: 'Quick summary' },
] as const;

export const VISUAL_STYLES = [
  { value: 'formal', label: 'Classic document' },
  { value: 'presentation', label: 'Presentation' },
  { value: 'flight', label: 'Flight over the photos' },
] as const;

export type ReportKindValue = (typeof REPORT_KINDS)[number]['value'];
export type TemplateValue = (typeof TEMPLATES)[number]['value'];
export type VisualStyleValue = (typeof VISUAL_STYLES)[number]['value'];

/** The plain sentences every roof report route uses. Never an id, a code or a provider's words. */
export const NOT_FOUND = 'That report could not be found.';
export const NEEDS_ADDRESS = 'Please enter the street address.';
export const PICK_A_KIND = 'Pick at least one: inspection, measurements or storm history.';
export const TOO_MANY_PHOTOS = 'Please pick 40 photos or fewer.';
export const GENERATE_FAILED = 'The report could not be finished. Please try again.';
/** Never shown: while the feature is off every route answers a bare 404. */
export const SWITCHED_OFF = 'Roof reports are not switched on.';

/** Every thing a person may do with a roof report. */
export const ROOF_REPORT_ACTIONS = ['see', 'make', 'edit', 'send', 'archive', 'see_archived'] as const;
export type RoofReportAction = (typeof ROOF_REPORT_ACTIONS)[number];

/**
 * How far an action reaches for a role:
 *   all   every report in the company
 *   team  the person's own reports and their direct reports' (a sales leader)
 *   own   only the person's own: reports on their own jobs, and address
 *         reports they made themselves (a sales rep, Roof Lee's salesperson)
 *   no    never
 */
export type RoofReportDecision = 'all' | 'team' | 'own' | 'no';

/**
 * One decision per action per role. Roof Lee's six roles are decided through
 * the role Archie gives them (server/sister/contract.ts, ROLE_MAP): an owner
 * or admin is an Archie admin, office and sales manager are customer service
 * (every report, no money screens), a salesperson is a sales rep (their own
 * only) and crew are Production (no report at all, because reports carry prices).
 *
 * Archived reports are kept, never deleted: only a role that sees everything
 * may list them.
 */
export const ROOF_REPORT_RULES: Record<TeamRole, Record<RoofReportAction, RoofReportDecision>> = {
  admin:            { see: 'all',  make: 'all',  edit: 'all',  send: 'all',  archive: 'all',  see_archived: 'all' },
  sales_director:   { see: 'all',  make: 'all',  edit: 'all',  send: 'all',  archive: 'all',  see_archived: 'all' },
  customer_service: { see: 'all',  make: 'all',  edit: 'all',  send: 'all',  archive: 'all',  see_archived: 'all' },
  manager:          { see: 'team', make: 'team', edit: 'team', send: 'team', archive: 'team', see_archived: 'no' },
  sales:            { see: 'own',  make: 'own',  edit: 'own',  send: 'own',  archive: 'own',  see_archived: 'no' },
  production:       { see: 'no',   make: 'no',   edit: 'no',   send: 'no',   archive: 'no',   see_archived: 'no' },
};
