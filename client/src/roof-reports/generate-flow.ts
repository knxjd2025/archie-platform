/**
 * What making a report decides, as plain functions with no screen: the request
 * the wizard sends, the one key made for each try (so a double click or a
 * refresh never starts a second report), how an answer or a failure reads, how
 * often to ask again, and the words for a report that is ready but partly
 * missing. The step and the run only draw and carry this out.
 */
import {
  GEOCODE_FAILED, GENERATE_FAILED, MAX_REPORT_PHOTOS, TOO_MANY_RECENT, TOO_MANY_TODAY, WARN_ALL_PHOTOS, WARN_OUT_OF_TIME, WARN_STORM_PARTIAL,
  type ReportKindValue, type TemplateValue,
} from '../../../shared/roof-reports';
import type { AttemptDraft, WizardDraft } from './draft';
import { toDamageCounts, toRoofDetails } from './wizard-model';
import { RR, plainMessage } from './words';

export interface GenerateBody {
  reportTypes: ReportKindValue[];
  template: TemplateValue;
  address: string;
  city: string;
  state: string;
  zip: string;
  photoIds: string[];
  roofDetails?: ReturnType<typeof toRoofDetails>;
  damageCounts: ReturnType<typeof toDamageCounts>;
  inspectorNotes: string;
  customer?: { name: string; email: string; phone: string };
  jobExternalId?: string;
}

/** The request this draft makes. Only saved photos go in, at most what a report holds, in the order they sit. */
export function buildGenerateBody(draft: WizardDraft, photoIds: readonly string[]): GenerateBody {
  const w = draft.where;
  const r = draft.review;
  const customer = { name: r.customerName.trim(), email: r.customerEmail.trim(), phone: r.customerPhone.trim() };
  const body: GenerateBody = {
    reportTypes: [...r.kinds],
    template: r.template,
    address: w.address.trim(),
    city: w.city.trim(),
    state: w.state.trim(),
    zip: w.zip.trim(),
    photoIds: photoIds.slice(0, MAX_REPORT_PHOTOS),
    damageCounts: toDamageCounts(draft.damage),
    inspectorNotes: r.notes.trim(),
  };
  const roof = toRoofDetails(draft.roof);
  if (roof) body.roofDetails = roof;
  if (customer.name || customer.email || customer.phone) body.customer = customer;
  if (w.job?.externalId) body.jobExternalId = w.job.externalId;
  return body;
}

/** A short fingerprint of text (cyrb53). Not a secret: it only tells "the same request" from "a changed one". */
export function fingerprintOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}-${text.length.toString(16)}`;
}

/** A new request key: 8 to 200 plain characters the server accepts. */
export function newAttemptKey(random: () => string = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`)): string {
  return `rr-${random()}`;
}

/**
 * The attempt for this request. The same request as the attempt already kept
 * gets the same key (a double click, a refresh, "Make the report" pressed
 * again before anything changed); a changed request gets a new one, because
 * the server refuses one key for two different requests.
 */
export function attemptFor(existing: AttemptDraft | null, body: GenerateBody, makeKey: () => string = newAttemptKey): AttemptDraft {
  const fingerprint = fingerprintOf(JSON.stringify(body));
  return existing && existing.fingerprint === fingerprint ? existing : { key: makeKey(), fingerprint };
}

// ---------------------------------------------------------------- answers

export interface ReportAnswer { id: string; status: string; problem: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the server said about a report, or null when it is not an answer about a report (for example a refusal sent with a success code). */
export function readAnswer(value: unknown): ReportAnswer | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !UUID_RE.test(v.id) || typeof v.status !== 'string') return null;
  return { id: v.id, status: v.status, problem: typeof v.problem === 'string' && v.problem.trim() ? v.problem : null };
}

/** The sentence inside a refusal that carries no report. */
export function refusalSentence(value: unknown): string | null {
  const e = value && typeof value === 'object' ? (value as Record<string, unknown>).error : null;
  return typeof e === 'string' ? e : null;
}

export type Outcome = 'ready' | 'failed' | 'waiting';
export const outcomeOf = (a: ReportAnswer): Outcome => (a.status === 'ready' ? 'ready' : a.status === 'generating' ? 'waiting' : 'failed');

// ---------------------------------------------------------------- failures

export type FailureKind = 'again' | 'address' | 'capped' | 'wait';
export interface FailureView {
  kind: FailureKind;
  sentence: string;
  /** "Try again" is offered. */
  canTryAgain: boolean;
  /** "Change the address" is offered instead. */
  canChangeAddress: boolean;
  /** Said under the sentence. Empty for none. */
  note: string;
}

/** What a person is told when a report could not be made, and what they may do next. Only the sentences this feature wrote reach the screen. */
export function failureView(error: unknown): FailureView {
  const raw = error && typeof error === 'object' && 'message' in error ? (error as { message: unknown }).message : error;
  const message = typeof raw === 'string' ? raw.trim() : '';
  if (message === TOO_MANY_TODAY) return { kind: 'capped', sentence: RR.generate.capped, canTryAgain: false, canChangeAddress: false, note: RR.generate.kept };
  if (message === TOO_MANY_RECENT) return { kind: 'wait', sentence: RR.generate.tooFast, canTryAgain: true, canChangeAddress: false, note: '' };
  if (message === GEOCODE_FAILED) return { kind: 'address', sentence: RR.generate.noAddress, canTryAgain: false, canChangeAddress: true, note: '' };
  return { kind: 'again', sentence: plainMessage({ message }, RR.generate.couldNotFinish), canTryAgain: true, canChangeAddress: false, note: '' };
}

// ---------------------------------------------------------------- a report that is ready but partly missing

export type PartialKind = 'time' | 'photos' | 'storm';
export interface PartialNote { kind: PartialKind; sentence: string }

/** "2 of the 5 photos could not be analysed." anywhere in the sentence the server kept. */
const SOME_PHOTOS = /(\d{1,3}) of the (\d{1,3}) photos could not be analysed\./;

/** Each way a ready report can be partly missing, in its own plain sentence. Empty for a whole report. */
export function partialNotes(problem: string | null | undefined): PartialNote[] {
  const text = typeof problem === 'string' ? problem : '';
  if (!text) return [];
  const notes: PartialNote[] = [];
  if (text.includes(WARN_OUT_OF_TIME)) notes.push({ kind: 'time', sentence: RR.generate.partialTime });
  const some = SOME_PHOTOS.exec(text);
  if (text.includes(WARN_ALL_PHOTOS)) notes.push({ kind: 'photos', sentence: RR.generate.partialNoPhotos });
  else if (some) notes.push({ kind: 'photos', sentence: RR.generate.partialSomePhotos(Number(some[1]), Number(some[2])) });
  if (text.includes(WARN_STORM_PARTIAL)) notes.push({ kind: 'storm', sentence: RR.generate.partialStorm });
  return notes;
}

// ---------------------------------------------------------------- waiting

/** Seconds between asks: 2, 3, 5, 8, then every 10. */
const POLL_STEPS_MS = [2000, 3000, 5000, 8000];
export const POLL_EVERY_MS = 10_000;
/** After this long the screen stops asking and says it is taking long. The server calls a run that long dead after 8 minutes. */
export const POLL_GIVE_UP_MS = 10 * 60 * 1000;
/** Asks in a row that may fail before the screen says it is taking long. */
export const POLL_FAILS_ALLOWED = 3;

export const nextPollDelayMs = (n: number): number => POLL_STEPS_MS[n] ?? POLL_EVERY_MS;

/** The line that changes while the report is made: only steps this report will really take, in the order they happen. */
export function statusLines(kinds: readonly ReportKindValue[], photoCount: number): string[] {
  const lines: string[] = [RR.generate.linePlacing];
  if (kinds.includes('storm') || kinds.includes('inspection')) lines.push(RR.generate.lineStorm);
  if (photoCount > 0 && kinds.includes('inspection')) lines.push(RR.generate.linePhotos);
  lines.push(RR.generate.lineWriting);
  return lines;
}

export const LINE_EVERY_MS = 6000;

/** Which line to show after this many milliseconds: one at a time, staying on the last. */
export const lineAt = (lines: readonly string[], elapsedMs: number): string =>
  lines[Math.min(lines.length - 1, Math.max(0, Math.floor(elapsedMs / LINE_EVERY_MS)))] ?? '';

export { GENERATE_FAILED };
