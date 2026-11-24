/**
 * What the editor decides, as plain functions with no screen: the report as it
 * is held, each editable field and its own save state, the one request each
 * field's save sends, and the chain that keeps saves in order. The screen only
 * draws this and carries it out.
 *
 * Fields: title, customer name, email and phone, inspector notes, the summary
 * and each finding's text. The first five go to `PUT /api/roof-reports/:id`
 * on their own; the summary and the findings are inside the report, so each
 * sends the whole report with only that one text changed, taken from what the
 * server last confirmed (so an edit that has not been saved never travels with
 * another field's save).
 */
import type { TeamRole } from '../../../shared/rbac';
import { decisionFor, type TemplateValue, type VisualStyleValue } from '../../../shared/roof-reports';

/** The page is shown in a frame that has no origin of its own: it can run its own scripts and nothing of the app's. Never `allow-same-origin`. */
export const FRAME_SANDBOX = 'allow-scripts';

export const previewSrc = (id: string, version: number): string => `/api/roof-reports/${encodeURIComponent(id)}/html?v=${version}`;

/** Edit controls are drawn only for a role the shared table lets edit. The server decides every save. */
export const editsAllowed = (role: TeamRole): boolean => decisionFor(role, 'edit') !== 'no';

export interface ReportPhotoRef { id: string; category: string | null; thumbUrl: string }

export interface ReportDetail {
  id: string;
  status: string;
  problem: string | null;
  title: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  reportTypes: string[];
  template: TemplateValue;
  visualStyle: VisualStyleValue | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  inspectorNotes: string | null;
  jobExternalId: string | null;
  createdAt: string;
  /** The report's contents when it is ready, else null. */
  report: Record<string, unknown> | null;
  photos: ReportPhotoRef[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** An answer from `GET /api/roof-reports/:id`, or null when it is not a report. */
export function readDetail(value: unknown): ReportDetail | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.status !== 'string' || typeof value.address !== 'string') return null;
  return {
    id: value.id,
    status: value.status,
    problem: textOrNull(value.problem),
    title: textOrNull(value.title),
    address: value.address,
    city: textOrNull(value.city),
    state: textOrNull(value.state),
    zip: textOrNull(value.zip),
    reportTypes: Array.isArray(value.reportTypes) ? value.reportTypes.filter((k): k is string => typeof k === 'string') : [],
    template: (typeof value.template === 'string' ? value.template : 'full') as TemplateValue,
    visualStyle: typeof value.visualStyle === 'string' ? (value.visualStyle as VisualStyleValue) : null,
    customerName: textOrNull(value.customerName),
    customerEmail: textOrNull(value.customerEmail),
    customerPhone: textOrNull(value.customerPhone),
    inspectorNotes: textOrNull(value.inspectorNotes),
    jobExternalId: textOrNull(value.jobExternalId),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    report: isObject(value.report) ? value.report : null,
    photos: Array.isArray(value.photos)
      ? value.photos.filter(isObject).map((p) => ({ id: String(p.id), category: textOrNull(p.category), thumbUrl: String(p.thumbUrl ?? '') }))
      : [],
  };
}

// ---------------------------------------------------------------- the fields

export type SimpleKey = 'title' | 'customerName' | 'customerEmail' | 'customerPhone' | 'inspectorNotes';
export type FieldKey = SimpleKey | 'summary' | `finding:${number}`;

export interface EditValues {
  title: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  inspectorNotes: string;
  summary: string;
  findings: string[];
}

const SIMPLE: readonly SimpleKey[] = ['title', 'customerName', 'customerEmail', 'customerPhone', 'inspectorNotes'];
const isSimple = (key: FieldKey): key is SimpleKey => (SIMPLE as readonly string[]).includes(key);
const findingIndex = (key: FieldKey): number | null => {
  const m = /^finding:(\d{1,3})$/.exec(key);
  return m ? Number(m[1]) : null;
};

/** The findings the report holds, as objects (a stored finding that is not an object counts as empty). */
function findingsOf(report: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const list = report?.structuredFindings;
  return Array.isArray(list) ? list.map((f) => (isObject(f) ? f : {})) : [];
}

export function valuesOf(d: ReportDetail): EditValues {
  return {
    title: d.title ?? '',
    customerName: d.customerName ?? '',
    customerEmail: d.customerEmail ?? '',
    customerPhone: d.customerPhone ?? '',
    inspectorNotes: d.inspectorNotes ?? '',
    summary: typeof d.report?.executiveSummary === 'string' ? d.report.executiveSummary : '',
    findings: findingsOf(d.report).map((f) => (typeof f.narrative === 'string' ? f.narrative : '')),
  };
}

/** The keys of every field this report has. */
export const keysOf = (v: EditValues): FieldKey[] => [...SIMPLE, 'summary', ...v.findings.map((_, i) => `finding:${i}` as const)];

export const valueOf = (v: EditValues, key: FieldKey): string => {
  if (isSimple(key)) return v[key];
  if (key === 'summary') return v.summary;
  const i = findingIndex(key);
  return i === null ? '' : v.findings[i] ?? '';
};

const withValue = (v: EditValues, key: FieldKey, text: string): EditValues => {
  if (isSimple(key)) return { ...v, [key]: text };
  if (key === 'summary') return { ...v, summary: text };
  const i = findingIndex(key);
  if (i === null || i >= v.findings.length) return v;
  return { ...v, findings: v.findings.map((f, n) => (n === i ? text : f)) };
};

/**
 * The one request this field's save sends, or null when there is nothing it can
 * send. `confirmed` is the report as the server last confirmed it. Only this
 * field's text is taken from `values`.
 */
export function requestFor(key: FieldKey, values: EditValues, confirmed: Record<string, unknown> | null): Record<string, unknown> | null {
  if (isSimple(key)) return { [key]: values[key] };
  if (!confirmed) return null;
  if (key === 'summary') return { reportJson: { ...confirmed, executiveSummary: values.summary } };
  const i = findingIndex(key);
  const list = findingsOf(confirmed);
  if (i === null || i >= list.length) return null;
  return { reportJson: { ...confirmed, structuredFindings: list.map((f, n) => (n === i ? { ...f, narrative: valueOf(values, key) } : f)) } };
}

export type FieldStatus = { status: 'idle' | 'unsaved' | 'saving' | 'saved' } | { status: 'failed'; error: string };

export interface FieldsState {
  /** What is in the boxes. */
  values: EditValues;
  /** What the server has. */
  saved: EditValues;
  status: Record<string, FieldStatus>;
}

export function initialFields(values: EditValues): FieldsState {
  return { values, saved: values, status: Object.fromEntries(keysOf(values).map((k) => [k, { status: 'idle' } as FieldStatus])) };
}

export const emptyValues = (): EditValues => ({ title: '', customerName: '', customerEmail: '', customerPhone: '', inspectorNotes: '', summary: '', findings: [] });

export type FieldAction =
  | { type: 'reset'; values: EditValues }
  | { type: 'edit'; key: FieldKey; text: string }
  | { type: 'saving'; key: FieldKey }
  | { type: 'saved'; key: FieldKey; text: string }
  | { type: 'failed'; key: FieldKey; error: string };

export function fieldReducer(state: FieldsState, a: FieldAction): FieldsState {
  switch (a.type) {
    case 'reset': return initialFields(a.values);
    case 'edit': {
      const values = withValue(state.values, a.key, a.text);
      const same = a.text === valueOf(state.saved, a.key);
      return { ...state, values, status: { ...state.status, [a.key]: { status: same ? 'idle' : 'unsaved' } } };
    }
    case 'saving':
      return { ...state, status: { ...state.status, [a.key]: { status: 'saving' } } };
    case 'saved': {
      const saved = withValue(state.saved, a.key, a.text);
      const still = valueOf(state.values, a.key) === a.text;
      return { ...state, saved, status: { ...state.status, [a.key]: { status: still ? 'saved' : 'unsaved' } } };
    }
    case 'failed':
      return { ...state, status: { ...state.status, [a.key]: { status: 'failed', error: a.error } } };
  }
}

/** Runs saves one at a time in the order asked for, so two saves of the report never cross. A failed one does not stop the next. */
export class SaveChain {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
