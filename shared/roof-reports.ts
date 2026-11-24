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
export const GEOCODE_FAILED = 'We couldn\'t find that address on the map. Check the street, city and ZIP.';
export const NEEDS_CITY_STATE = 'Please enter the city and state as well.';
export const STILL_BEING_MADE = 'This report is still being made. Archive it once it finishes.';
export const ONLY_FAILED_RETRY = 'Only a report that could not be finished can be tried again.';
export const TOO_MANY_TODAY = 'Your company has made a lot of reports today. Please try again tomorrow.';
export const TOO_MANY_WAITING = 'You have a lot of photos waiting. Please put them in a report first.';
export const NOT_A_KIND = 'Pick from inspection, measurements or storm history.';
export const NOT_A_TEMPLATE = 'Pick one of the report styles from the list.';
export const NOT_A_STYLE = 'Pick one of the looks from the list.';
export const BAD_EMAIL = 'That email address doesn\'t look right.';
export const BAD_DATE = 'That date doesn\'t look right.';
export const TEXT_TOO_LONG = 'That is too long. Please shorten it.';
export const NOT_TEXT = 'That needs to be text.';
export const NOTHING_TO_CHANGE = 'There was nothing to change.';
export const CANT_CHANGE = 'That part of a report can\'t be changed here.';
export const REPORT_DATA_BAD = 'The report\'s contents couldn\'t be saved. Please reload it and try again.';
export const PAGE_NOT_SAFE = 'That page contains something that can\'t be saved.';
export const PAGE_NOT_READY = 'This report isn\'t ready to show yet.';
export const BAD_REQUEST_KEY = 'That request could not be used. Please try again.';
export const REQUEST_KEY_REUSED = 'That was already used to make a different report. Please start the report again.';
export const PICK_PHOTO_KIND = 'Pick what the photo shows from the list.';

export const STILL_BEING_MADE_EDIT = 'This report is still being made. Please try again once it finishes.';
export const TOO_MANY_RECENT = 'You have made a lot of reports in the last few minutes. Please wait a little and try again.';

/** Where a report photo is shown from inside the app: a route that checks who is asking. Never a place in the photo store. */
export const roofReportPhotoPath = (reportId: string, photoId: string, variant: 'working' | 'thumb'): string =>
  `/api/roof-reports/${reportId}/photos/${photoId}/${variant}`;

/** The most photos one report may hold. The same cap as Archie's own documents. */
export const MAX_REPORT_PHOTOS = 40;
/** The most uploaded photos one person may leave waiting, unused, in a day. */
export const MAX_WAITING_PHOTOS = 100;
/** The most reports one company may start in a day. */
export const MAX_REPORTS_PER_DAY = 200;
/** What a photo may be said to show. They sit in a report in this order, the way a roof is walked. */
export const REPORT_PHOTO_CATEGORIES = ['overview', 'roof_surface', 'flashing', 'vent', 'chimney', 'gutter', 'interior', 'closeup', 'other'] as const;
export type ReportPhotoCategory = (typeof REPORT_PHOTO_CATEGORIES)[number];

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
