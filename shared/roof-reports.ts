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
/** What the server keeps with a report that is ready but partly missing. The client finds these inside the sentence to say each in its own words. */
export const WARN_ALL_PHOTOS = 'The photos could not be analysed, so this report does not describe their condition. Please try again.';
export const WARN_OUT_OF_TIME = 'The report ran out of time, so part of it is missing.';
export const WARN_STORM_PARTIAL = 'Some storm data sources did not all answer in time, so the storm history may be incomplete.';
/** "2 of the 5 photos could not be analysed." (the numbers vary), read back by `readSomePhotosFailed`. */
export const warnSomePhotos = (failed: number, total: number): string => `${failed} of the ${total} photos could not be analysed.`;
export const PHOTO_IN_REPORT = 'This photo is part of a report, so it can\'t be removed.';
export const PHOTO_NOT_REMOVED = 'The photo could not be removed. Please try again.';

/**
 * What the editor says when the look a person chose could not be used and the
 * report is shown as a document instead. Built from the counts the renderer's
 * own choice returns (`chooseStyle`), so it is always what the page really is.
 */
export interface StyleNoticeInput { kind: 'flight' | 'presentation'; have: number; need: number }
export function styleNotice(d: StyleNoticeInput | undefined): string | null {
  if (!d) return null;
  const noun = d.kind === 'flight' ? 'photo' : 'chapter';
  const has = d.have === 0 ? `no ${noun}s` : `only ${d.have} ${noun}${d.have === 1 ? '' : 's'}`;
  const of = d.kind === 'flight' ? '' : ' of content';
  return `This report has ${has}${of}, so it is shown as a document. ${d.kind === 'flight' ? 'A flight' : 'A presentation'} needs ${d.need} or more.`;
}

/** The share link: what is told when a link cannot be made yet, and what a customer sees when a link does not open. */
export const SHARE_NOT_READY = 'A link can be made once the report is finished.';
export const SHARE_UNAVAILABLE = 'This report is not available.';
export const SHARE_BUSY = 'This report has been opened a lot in the last few minutes. Wait a little and reload the page.';
export const SHARE_FAILED = 'This report could not be opened right now. Please try again.';

/** Emailing a report to the customer: the limits, and every sentence a person may be told. */
export const MAX_SENDS_PER_REPORT_PER_DAY = 5;
export const MAX_SENDS_PER_COMPANY_PER_DAY = 100;
export const MAX_SEND_MESSAGE = 1000;
export const SEND_BAD_NAME = 'That name can\'t be used. Please keep it to one line.';
export const SEND_MESSAGE_TOO_LONG = `That message is too long. Please keep it under ${MAX_SEND_MESSAGE.toLocaleString('en-US')} characters.`;
export const SEND_NOT_READY = 'A report can be emailed once it is finished.';
export const SEND_FAILED = 'The email could not be sent. Please try again.';
export const SEND_NOT_SET_UP = 'Email is not set up for your company yet. Please ask your administrator to connect it.';
export const SEND_REPORT_CAPPED = 'This report has been emailed several times today. Please try again tomorrow.';
export const SEND_COMPANY_CAPPED = 'Your company has sent a lot of report emails today. Please try again tomorrow.';
export const SEND_TOO_FAST = 'You have sent a lot of emails in the last few minutes. Please wait a little and try again.';
export const SEND_KEY_REUSED = 'That was already used to send a different email. Please send it again.';
export const SEND_SENDING = 'This email is already on its way.';

/** Rewriting one finding or the summary with a model: the limits, and every sentence a person may be told. */
export const MAX_REWRITES_PER_REPORT_PER_DAY = 20;
export const MAX_REWRITES_PER_COMPANY_PER_DAY = 300;
export const REWRITE_FAILED = 'The rewrite did not work, so nothing was changed. Please try again.';
export const REWRITE_NOT_AVAILABLE = 'Rewriting is not available right now. Nothing was changed.';
export const REWRITE_NOT_READY = 'A report can be rewritten once it is finished.';
export const REWRITE_NO_SUCH = 'That part of the report could not be found. Please reload the report and try again.';
export const REWRITE_CHANGED = 'The report changed while it was being rewritten, so nothing was changed. Please try again.';
export const REWRITE_REPORT_CAPPED = 'This report has been rewritten a lot today. Please try again tomorrow.';
export const REWRITE_COMPANY_CAPPED = 'Your company has used a lot of rewrites today. Please try again tomorrow.';
export const REWRITE_TOO_FAST = 'You have asked for a lot of rewrites in the last few minutes. Please wait a little and try again.';

export const STILL_BEING_MADE_EDIT = 'This report is still being made. Please try again once it finishes.';
export const TOO_MANY_RECENT = 'You have made a lot of reports in the last few minutes. Please wait a little and try again.';

/** Where a report photo is shown from inside the app: a route that checks who is asking. Never a place in the photo store. */
export const roofReportPhotoPath = (reportId: string, photoId: string, variant: 'working' | 'thumb'): string =>
  `/api/roof-reports/${reportId}/photos/${photoId}/${variant}`;

/** The most photos one report may hold. The same cap as Archie's own documents. */
export const MAX_REPORT_PHOTOS = 40;
/** The largest roof the form takes, in squares (100 square feet each). The server holds the same cap. */
export const ROOF_SQUARES_MAX = 1000;
/** The most damaged shingles one count may hold. */
export const MAX_DAMAGE_COUNT = 9999;
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
export const ROOF_REPORT_ACTIONS = ['see', 'make', 'edit', 'send', 'archive', 'see_archived', 'change_job', 'remove_photo', 'share', 'unshare', 'rewrite'] as const;
export type RoofReportAction = (typeof ROOF_REPORT_ACTIONS)[number];

/**
 * How far an action reaches for a role (for `change_job`, moving a report to
 * another job or taking it off its job, `all` is any report the role may see and
 * `own` is only a report the person made themselves, a leader's team excluded;
 * either way the person must also be able to see the job the report is on;
 * for `share` and `unshare`, making a customer link for a report and turning it off, the reach is the same as `send`: a role that sees everything may for any report, a leader for their team's, a salesperson for their own;
 * for `rewrite`, asking a model to rewrite one finding or the summary, the reach is exactly the reach of `edit`;
 * for `remove_photo`, taking back a photo that is not in a report yet, `all` is
 * anyone's waiting photo in the company and `own` only one the person uploaded
 * themselves, and a photo already in a report is never removed by anyone):
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
  admin:            { see: 'all',  make: 'all',  edit: 'all',  send: 'all',  archive: 'all',  see_archived: 'all', change_job: 'all', remove_photo: 'all', share: 'all', unshare: 'all', rewrite: 'all' },
  sales_director:   { see: 'all',  make: 'all',  edit: 'all',  send: 'all',  archive: 'all',  see_archived: 'all', change_job: 'all', remove_photo: 'all', share: 'all', unshare: 'all', rewrite: 'all' },
  customer_service: { see: 'all',  make: 'all',  edit: 'all',  send: 'all',  archive: 'all',  see_archived: 'all', change_job: 'all', remove_photo: 'all', share: 'all', unshare: 'all', rewrite: 'all' },
  manager:          { see: 'team', make: 'team', edit: 'team', send: 'team', archive: 'team', see_archived: 'no',  change_job: 'own', remove_photo: 'own', share: 'team', unshare: 'team', rewrite: 'team' },
  sales:            { see: 'own',  make: 'own',  edit: 'own',  send: 'own',  archive: 'own',  see_archived: 'no',  change_job: 'own', remove_photo: 'own', share: 'own', unshare: 'own', rewrite: 'own' },
  production:       { see: 'no',   make: 'no',   edit: 'no',   send: 'no',   archive: 'no',   see_archived: 'no',  change_job: 'no', remove_photo: 'no', share: 'no', unshare: 'no', rewrite: 'no' },
};

/** What this role may do, how far. An unknown role may do nothing. The server and the screens read the same table through this one function. */
export function decisionFor(role: TeamRole, action: RoofReportAction): RoofReportDecision {
  if (typeof role !== 'string' || !Object.hasOwn(ROOF_REPORT_RULES, role)) return 'no';
  return ROOF_REPORT_RULES[role][action] ?? 'no';
}
