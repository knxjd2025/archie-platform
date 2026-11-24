/**
 * A job as the start of a roof report: which job to link, the street, city and
 * state from the job's address, and the customer, and what to do with a draft
 * that is already open. Pure, so it is tested without a browser. Nothing here
 * is sent anywhere: it only fills the boxes the person then checks and edits.
 */
import { emptyDraft, isEmptyDraft, type DraftJob, type WhereDraft, type WizardDraft } from './draft';
import { US_STATES } from './states';

/** What the job page already holds about the job (its detail call). */
export interface JobLead {
  externalId: string | null;
  customer: string | null;
  email: string | null;
  phone: string | null;
  /** The address for display: the street, then the city and state when the job has them. */
  address: string | null;
  /** The street as stored. */
  addressLine?: string | null;
}

export interface JobStart {
  job: DraftJob;
  where: Pick<WhereDraft, 'address' | 'city' | 'state' | 'zip'>;
  customer: { name: string; email: string; phone: string };
}

const trim = (v: string | null | undefined): string => (typeof v === 'string' ? v.trim() : '');

/** "IA", "iowa" or "IA 50613" to its two letters and the ZIP after it. Empty state when it is not one. */
function readState(raw: string): { state: string; zip: string } {
  const text = raw.trim();
  const zip = /\b(\d{5})(?:-\d{4})?\s*$/.exec(text)?.[1] ?? '';
  const word = text.replace(/\b\d{5}(?:-\d{4})?\s*$/, '').trim();
  const byCode = US_STATES.find((s) => s.code === word.toUpperCase());
  const byName = US_STATES.find((s) => s.name.toLowerCase() === word.toLowerCase());
  return { state: (byCode ?? byName)?.code ?? '', zip: byCode || byName ? zip : '' };
}

export function startFromJob(lead: JobLead): JobStart | null {
  const key = trim(lead.externalId);
  if (!key) return null;
  const display = trim(lead.address);
  const street = trim(lead.addressLine) || display.split(',')[0].trim();
  let city = '';
  let state = '';
  let zip = '';
  const rest = street && display.startsWith(street) ? display.slice(street.length).replace(/^\s*,\s*/, '') : '';
  if (rest) {
    const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const s = readState(parts[1]);
      if (s.state) { city = parts[0]; state = s.state; zip = s.zip; }
    }
  }
  const name = trim(lead.customer);
  return {
    job: { externalId: key, label: [name, street].filter(Boolean).join(', ') || key },
    where: { address: street, city, state, zip },
    customer: { name, email: trim(lead.email), phone: trim(lead.phone) },
  };
}

/**
 * The draft to open for this job. A draft already open for the same job is kept;
 * an empty one is taken over quietly; any other is replaced, and the caller says so.
 */
export function draftForJob(existing: WizardDraft | null, start: JobStart): { draft: WizardDraft; replaced: boolean } {
  if (existing && existing.where.job?.externalId === start.job.externalId) return { draft: existing, replaced: false };
  const draft = emptyDraft();
  draft.where = { ...start.where, job: start.job };
  draft.review = { ...draft.review, customerName: start.customer.name, customerEmail: start.customer.email, customerPhone: start.customer.phone };
  return { draft, replaced: !!existing && !isEmptyDraft(existing) };
}
