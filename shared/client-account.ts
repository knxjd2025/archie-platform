/**
 * The parts of a client's account an admin can correct from the client page,
 * at any time and at any stage: who the customer is, what the job is called,
 * where it is, who runs it, and every insurance-claim detail.
 *
 * JobTread is the source of truth, so each job-level field here names the
 * JobTread custom field it writes. Projected value and the schedule are not
 * here on purpose — JobTread works those out from the estimate and the tasks,
 * so they are changed there, not typed over.
 */

export type AccountFieldKind = 'text' | 'boolean' | 'date' | 'email' | 'phone';

export interface AccountFieldDef {
  key: string;
  /** The JobTread job custom field this writes. */
  jtName: string;
  label: string;
  kind: AccountFieldKind;
}

export const ACCOUNT_JOB_FIELDS = [
  { key: 'projectManager', jtName: 'Project Manager', label: 'Project Manager', kind: 'text' },
  { key: 'isClaim', jtName: 'Insurance Claim', label: 'Insurance claim', kind: 'boolean' },
  { key: 'carrier', jtName: 'Insurance Carrier', label: 'Carrier', kind: 'text' },
  { key: 'claimNumber', jtName: 'Claim Number', label: 'Claim #', kind: 'text' },
  { key: 'policyNumber', jtName: 'Policy Number', label: 'Policy #', kind: 'text' },
  { key: 'dateOfLoss', jtName: 'Date of Loss', label: 'Date of Loss', kind: 'date' },
  { key: 'typeOfLoss', jtName: 'Type of Loss', label: 'Type of Loss', kind: 'text' },
  { key: 'adjusterName', jtName: 'Adjuster Name', label: 'Adjuster', kind: 'text' },
  { key: 'adjusterPhone', jtName: 'Adjuster Phone', label: 'Adjuster Phone', kind: 'phone' },
  { key: 'adjusterEmail', jtName: 'Adjuster Email', label: 'Adjuster Email', kind: 'email' },
  { key: 'claimsEmail', jtName: 'Claims Email', label: 'Claims Email', kind: 'email' },
] as const satisfies readonly AccountFieldDef[];

export type AccountFieldKey = (typeof ACCOUNT_JOB_FIELDS)[number]['key'];

export interface AccountEdit {
  customer?: string;
  jobName?: string;
  address?: string;
  /** Job custom fields by key. null clears the field in JobTread. */
  fields?: Partial<Record<AccountFieldKey, string | boolean | null>>;
}

export type ParsedAccountEdit = { ok: true; edit: AccountEdit } | { ok: false; error: string };

const MAX_NAME = 128;
const MAX_ADDRESS = 300;
const MAX_FIELD = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[\d\s()+.\-x]{7,25}$/i;

const fieldByKey = new Map<string, AccountFieldDef>(ACCOUNT_JOB_FIELDS.map((f) => [f.key, f]));

function parseRequiredText(v: unknown, label: string, max: number): { value?: string; error?: string } {
  if (typeof v !== 'string') return { error: `${label} must be text.` };
  const t = v.trim();
  if (!t) return { error: `${label} can't be blank.` };
  if (t.length > max) return { error: `${label} is too long (${max} characters at most).` };
  return { value: t };
}

function parseField(def: AccountFieldDef, v: unknown): { value?: string | boolean | null; error?: string } {
  if (def.kind === 'boolean') {
    if (typeof v !== 'boolean') return { error: `${def.label} must be yes or no.` };
    return { value: v };
  }
  if (v === null) return { value: null };
  if (typeof v !== 'string') return { error: `${def.label} must be text.` };
  const t = v.trim();
  if (!t) return { value: null };
  if (t.length > MAX_FIELD) return { error: `${def.label} is too long (${MAX_FIELD} characters at most).` };
  if (def.kind === 'email' && !EMAIL_RE.test(t)) return { error: `${def.label} doesn't look like an email address.` };
  if (def.kind === 'date' && (!DATE_RE.test(t) || Number.isNaN(Date.parse(t)))) return { error: `${def.label} must be a date (YYYY-MM-DD).` };
  if (def.kind === 'phone' && !PHONE_RE.test(t)) return { error: `${def.label} doesn't look like a phone number.` };
  return { value: t };
}

/**
 * Validate an account edit off a request body. Only the keys sent are
 * changed; an unknown key is refused rather than ignored, so a typo in the UI
 * can never look like a save that happened.
 */
export function parseAccountEdit(body: unknown): ParsedAccountEdit {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Nothing to change.' };
  const b = body as Record<string, unknown>;
  const allowed = new Set(['customer', 'jobName', 'address', 'fields']);
  const unknownTop = Object.keys(b).find((k) => !allowed.has(k));
  if (unknownTop) return { ok: false, error: `Unknown field "${unknownTop}".` };

  const edit: AccountEdit = {};
  if (b.customer !== undefined) {
    const r = parseRequiredText(b.customer, 'Customer name', MAX_NAME);
    if (r.error) return { ok: false, error: r.error };
    edit.customer = r.value;
  }
  if (b.jobName !== undefined) {
    const r = parseRequiredText(b.jobName, 'Job name', MAX_NAME);
    if (r.error) return { ok: false, error: r.error };
    edit.jobName = r.value;
  }
  if (b.address !== undefined) {
    const r = parseRequiredText(b.address, 'Address', MAX_ADDRESS);
    if (r.error) return { ok: false, error: r.error };
    edit.address = r.value;
  }
  if (b.fields !== undefined) {
    if (!b.fields || typeof b.fields !== 'object' || Array.isArray(b.fields)) return { ok: false, error: 'fields must be an object.' };
    const fields: NonNullable<AccountEdit['fields']> = {};
    for (const [key, raw] of Object.entries(b.fields as Record<string, unknown>)) {
      const def = fieldByKey.get(key);
      if (!def) return { ok: false, error: `Unknown field "${key}".` };
      const r = parseField(def, raw);
      if (r.error) return { ok: false, error: r.error };
      fields[key as AccountFieldKey] = r.value ?? null;
    }
    if (Object.keys(fields).length) edit.fields = fields;
  }

  const hasChange = edit.customer !== undefined || edit.jobName !== undefined || edit.address !== undefined || !!edit.fields;
  return hasChange ? { ok: true, edit } : { ok: false, error: 'Nothing to change.' };
}

/** The account's job fields keyed by their JobTread name, ready to write. */
export function jobFieldWrites(fields: AccountEdit['fields']): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    const def = fieldByKey.get(key);
    if (def && value !== undefined) out[def.jtName] = value;
  }
  return out;
}
