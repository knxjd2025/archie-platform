/**
 * What the roof report routes accept, checked by plain functions (the same
 * approach as shared/crews.ts): each returns `{ ok: true, value }` or
 * `{ ok: false, error }` where the error is a plain sentence for the person.
 *
 * The rule behind all of it: a request names WHAT to change, never WHOSE.
 * Which company a request is for comes from the signed-in session alone, so
 * no function here reads a company, a role, a status, an id or a share token
 * from a body, a query or an address. Update accepts a named set of fields and
 * refuses every other one.
 */
import {
  BAD_DATE, BAD_EMAIL, CANT_CHANGE, MAX_REPORT_PHOTOS, NEEDS_ADDRESS, NEEDS_CITY_STATE, NOTHING_TO_CHANGE, NOT_A_KIND, NOT_A_STYLE,
  NOT_A_TEMPLATE, NOT_TEXT, PAGE_NOT_SAFE, pageLinkNotAllowed, PICK_A_KIND, REPORT_DATA_BAD, REPORT_KINDS, TEMPLATES, TEXT_TOO_LONG, TOO_MANY_PHOTOS, VISUAL_STYLES,
  roofReportPhotoPath, type ReportKindValue, type TemplateValue, type VisualStyleValue,
} from '../../shared/roof-reports';
import { normalizeReportNumbers } from '../lib/roof-reports/report-normalize.js';
import type { ComprehensiveRoofReport } from '../lib/roof-reports/comprehensive-roof-report.js';
import type { GenerateRequest } from './generate';
import { findPageLinkProblems, type PageLinkContext } from './page-links';
import { cleanDamageCounts, cleanMeasurements, cleanRoofDetails } from './inputs';

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const MAX_REPORT_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_EDITED_HTML_BYTES = 500 * 1024;
const MAX_MEASUREMENTS_BYTES = 100 * 1024;
const MAX_PAGE = 10_000;
export const PAGE_SIZE = 25;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/** Text that is required to be short: refused, not quietly cut, when too long. */
function shortText(v: unknown, max: number): Checked<string> {
  if (v === undefined || v === null) return { ok: true, value: '' };
  if (typeof v !== 'string') return fail(NOT_TEXT);
  const t = v.trim();
  return t.length > max ? fail(TEXT_TOO_LONG) : { ok: true, value: t };
}

function email(v: unknown): Checked<string> {
  const t = shortText(v, 254);
  if (!t.ok) return t;
  return t.value === '' || EMAIL_RE.test(t.value) ? { ok: true, value: t.value.toLowerCase() } : fail(BAD_EMAIL);
}

export function parseGenerateBody(body: unknown): Checked<GenerateRequest> {
  const b = isObject(body) ? body : {};
  const rawKinds = b.reportTypes;
  if (!Array.isArray(rawKinds) || rawKinds.length === 0) return fail(PICK_A_KIND);
  const wanted = new Set<string>(REPORT_KINDS.map((k) => k.value));
  const reportTypes = [...new Set(rawKinds.filter((k): k is ReportKindValue => typeof k === 'string' && wanted.has(k)))];
  if (reportTypes.length === 0) return fail(NOT_A_KIND);

  const address = shortText(b.address, 200);
  if (!address.ok) return address.error === TEXT_TOO_LONG ? address : fail(NEEDS_ADDRESS);
  if (!address.value) return fail(NEEDS_ADDRESS);
  const city = shortText(b.city, 100);
  if (!city.ok) return city.error === TEXT_TOO_LONG ? city : fail(NEEDS_CITY_STATE);
  const state = shortText(b.state, 50);
  if (!state.ok) return state.error === TEXT_TOO_LONG ? state : fail(NEEDS_CITY_STATE);
  if (!city.value || !state.value) return fail(NEEDS_CITY_STATE);
  const zip = shortText(b.zip, 20);
  if (!zip.ok) return zip;

  let template: TemplateValue = 'full';
  if (b.template !== undefined && b.template !== null) {
    const t = TEMPLATES.find((x) => x.value === b.template);
    if (!t) return fail(NOT_A_TEMPLATE);
    template = t.value;
  }

  const photoIds = Array.isArray(b.photoIds)
    ? [...new Set(b.photoIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).map((id) => id.toLowerCase()))]
    : [];
  if (photoIds.length > MAX_REPORT_PHOTOS) return fail(TOO_MANY_PHOTOS);

  const notes = shortText(b.inspectorNotes, 20_000);
  if (!notes.ok) return notes;

  let customer: GenerateRequest['customer'];
  if (isObject(b.customer)) {
    const name = shortText(b.customer.name, 200);
    if (!name.ok) return name;
    const mail = email(b.customer.email);
    if (!mail.ok) return mail;
    const phone = shortText(b.customer.phone, 40);
    if (!phone.ok) return phone;
    customer = { name: name.value, email: mail.value, phone: phone.value };
  }

  if (b.measurements !== undefined && JSON.stringify(b.measurements ?? null).length > MAX_MEASUREMENTS_BYTES) return fail(TEXT_TOO_LONG);
  const job = typeof b.jobExternalId === 'string' && b.jobExternalId.trim() && b.jobExternalId.trim().length <= 120 ? b.jobExternalId.trim() : undefined;

  return {
    ok: true,
    value: {
      reportTypes, template, address: address.value, city: city.value, state: state.value, zip: zip.value, photoIds,
      roofDetails: cleanRoofDetails(b.roofDetails), damageCounts: cleanDamageCounts(b.damageCounts), measurements: cleanMeasurements(b.measurements),
      inspectorNotes: notes.value, customer, jobExternalId: job,
    },
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateFields {
  title?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  inspectorNotes?: string | null;
  inspectionDate?: Date | null;
  reportJson?: unknown;
  editedHtml?: string | null;
  template?: TemplateValue;
  visualStyle?: VisualStyleValue | null;
  jobExternalId?: string | null;
}

/** The only fields an update may name. Anything else is refused. */
export const EDITABLE_FIELDS = ['title', 'customerName', 'customerEmail', 'customerPhone', 'inspectorNotes', 'inspectionDate', 'reportJson', 'editedHtml', 'template', 'visualStyle', 'jobExternalId'] as const;

/** Markup that can run or move a reader, in a page a person saved. The page is also served in a sandbox; this keeps it from being stored. */
const UNSAFE_PAGE = [
  /<\s*(script|iframe|frame|frameset|object|embed|applet|base|form|svg|math)\b/i,
  /<\s*meta\b[^>]*http-equiv/i,
  /\son[a-z]+\s*=/i,
  /\b(java|vb)script\s*:/i,
  /data\s*:\s*text\/html/i,
];

/** True when the saved page holds nothing that can run script or send the reader elsewhere. */
export function checkEditedHtml(html: string): boolean {
  return !UNSAFE_PAGE.some((re) => re.test(html));
}

function optionalText(v: unknown, max: number): Checked<string | null> {
  if (v === null) return { ok: true, value: null };
  const t = shortText(v, max);
  return t.ok ? { ok: true, value: t.value || null } : t;
}

/** Where a saved page may point when the caller gives no origins: only the page's own relative addresses, fragments, phone numbers and email addresses. */
const NO_ORIGINS: PageLinkContext = { appOrigin: '', website: '', logoUrl: '' };

export function parseUpdateBody(body: unknown, page: PageLinkContext = NO_ORIGINS): Checked<UpdateFields> {
  if (!isObject(body)) return fail(NOTHING_TO_CHANGE);
  const keys = Object.keys(body);
  if (keys.length === 0) return fail(NOTHING_TO_CHANGE);
  if (keys.some((k) => !(EDITABLE_FIELDS as readonly string[]).includes(k))) return fail(CANT_CHANGE);

  const out: UpdateFields = {};
  for (const [field, max] of [['title', 200], ['customerName', 200], ['customerPhone', 40], ['inspectorNotes', 20_000]] as const) {
    if (!(field in body)) continue;
    const t = optionalText(body[field], max);
    if (!t.ok) return t;
    out[field] = t.value;
  }
  if ('customerEmail' in body) {
    const e = body.customerEmail === null ? ({ ok: true, value: '' } as const) : email(body.customerEmail);
    if (!e.ok) return e;
    out.customerEmail = e.value || null;
  }
  if ('inspectionDate' in body) {
    const v = body.inspectionDate;
    if (v === null || v === '') out.inspectionDate = null;
    else {
      const d = typeof v === 'string' ? new Date(v) : null;
      if (!d || Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100) return fail(BAD_DATE);
      out.inspectionDate = d;
    }
  }
  if ('template' in body) {
    const t = TEMPLATES.find((x) => x.value === body.template);
    if (!t) return fail(NOT_A_TEMPLATE);
    out.template = t.value;
  }
  if ('visualStyle' in body) {
    if (body.visualStyle === null || body.visualStyle === '') out.visualStyle = null;
    else {
      const s = VISUAL_STYLES.find((x) => x.value === body.visualStyle);
      if (!s) return fail(NOT_A_STYLE);
      out.visualStyle = s.value;
    }
  }
  if ('jobExternalId' in body) {
    const j = optionalText(body.jobExternalId, 120);
    if (!j.ok) return j;
    out.jobExternalId = j.value;
  }
  if ('reportJson' in body) {
    if (!isObject(body.reportJson)) return fail(REPORT_DATA_BAD);
    if (JSON.stringify(body.reportJson).length > MAX_REPORT_JSON_BYTES) return fail(TEXT_TOO_LONG);
    out.reportJson = body.reportJson;
  }
  if ('editedHtml' in body) {
    if (body.editedHtml === null || body.editedHtml === '') out.editedHtml = null;
    else if (typeof body.editedHtml !== 'string') return fail(NOT_TEXT);
    else if (Buffer.byteLength(body.editedHtml) > MAX_EDITED_HTML_BYTES) return fail(TEXT_TOO_LONG);
    else if (!checkEditedHtml(body.editedHtml)) return fail(PAGE_NOT_SAFE);
    else {
      // Where the page points is judged after what can run: a link to another host is refused, never quietly taken out of what was typed.
      const [problem] = findPageLinkProblems(body.editedHtml, page);
      if (problem) return fail(pageLinkNotAllowed(problem.host));
      out.editedHtml = body.editedHtml;
    }
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// A saved report's contents
// ---------------------------------------------------------------------------

/** The keys a report has. Anything else in an edit is dropped. */
const REPORT_KEYS = [
  'id', 'generatedAt', 'version', 'property', 'stormHistory', 'damageAnalysis', 'repairEstimate', 'roofDetails', 'damageCounts',
  'replacementOptions', 'measurements', 'reportTypes', 'reportTemplate', 'reportVisualStyle', 'stormEnhanced', 'measurementReport',
  'inspectorNotes', 'roofConditionIndex', 'executiveSummary', 'narrativeFindings', 'structuredFindings', 'photoLabels',
  'customerName', 'customerEmail', 'inspectionDate', 'dataQuality', 'dataSources', 'analysisSource',
] as const;

/**
 * Makes an edited report safe to store. It keeps only the keys a report has,
 * forces the report's own id, makes every figure a number (so a page can never
 * get a word where a number goes), and rebuilds the photo list from this
 * report's own photos: a photo whose id is not one of them is dropped, and
 * every photo's address is rewritten to the app's own route, so an edit can
 * never point a page at an outside address, another report's photo or a place
 * in the photo store. Text is left as typed: the page renderers escape it.
 */
export function sanitizeReportJson(input: unknown, reportId: string, ownPhotoIds: readonly string[]): Checked<ComprehensiveRoofReport> {
  if (!isObject(input)) return fail(REPORT_DATA_BAD);
  const out: Record<string, unknown> = {};
  for (const key of REPORT_KEYS) if (key in input) out[key] = input[key];
  for (const required of ['property', 'stormHistory', 'damageAnalysis', 'repairEstimate'] as const) {
    if (!isObject(out[required])) return fail(REPORT_DATA_BAD);
  }
  const analysis = { ...(out.damageAnalysis as Record<string, unknown>) };
  if (!Array.isArray(analysis.photos)) return fail(REPORT_DATA_BAD);

  const own = new Set(ownPhotoIds.map((id) => id.toLowerCase()));
  const seen = new Set<string>();
  const photos: Record<string, unknown>[] = [];
  for (const p of analysis.photos) {
    if (!isObject(p) || typeof p.id !== 'string') continue;
    const id = p.id.toLowerCase();
    if (!own.has(id) || seen.has(id)) continue;
    seen.add(id);
    photos.push({ ...p, id, url: roofReportPhotoPath(reportId, id, 'working'), thumbnailUrl: roofReportPhotoPath(reportId, id, 'thumb') });
  }
  analysis.photos = photos;
  out.damageAnalysis = analysis;

  if (isObject(out.photoLabels)) {
    out.photoLabels = Object.fromEntries(Object.entries(out.photoLabels).filter(([id, labels]) => own.has(id.toLowerCase()) && Array.isArray(labels)));
  } else {
    delete out.photoLabels;
  }
  out.id = reportId;
  const normalized = normalizeReportNumbers(out as unknown as ComprehensiveRoofReport);
  return { ok: true, value: JSON.parse(JSON.stringify(normalized)) as ComprehensiveRoofReport };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface ListQuery { page: number; search: string; kind: ReportKindValue | null; status: 'generating' | 'ready' | 'failed' | 'archived' | null }

const STATUSES = ['generating', 'ready', 'failed', 'archived'] as const;

export function parseListQuery(query: unknown): ListQuery {
  const q = isObject(query) ? query : {};
  const asText = (v: unknown) => (typeof v === 'string' ? v : '');
  const n = Number.parseInt(asText(q.page), 10);
  const kind = REPORT_KINDS.find((k) => k.value === asText(q.kind))?.value ?? null;
  const status = STATUSES.find((s) => s === asText(q.status)) ?? null;
  return { page: Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PAGE) : 1, search: asText(q.search).trim().slice(0, 100), kind, status };
}
