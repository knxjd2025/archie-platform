/**
 * The wizard's draft, kept in this browser so a refresh does not lose work.
 *
 *  - Kept per person AND per company (the key holds both), so two people on one
 *    machine, or one person in two companies, never see each other's draft.
 *  - It lives for 24 hours from the last change.
 *  - Photos are kept only as the server's id for the photo, its file name and
 *    what it shows. No bytes, no preview, no address of a photo: the pictures
 *    are in the server's private store, never in the browser.
 *  - Everything read back is checked and cut to size, and every read and write
 *    sits inside try and catch: blocked or full storage means "no draft", said
 *    to nobody.
 */
import { MAX_REPORT_PHOTOS, REPORT_KINDS, REPORT_PHOTO_CATEGORIES, TEMPLATES, type ReportKindValue, type ReportPhotoCategory, type TemplateValue } from '../../../shared/roof-reports';

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** Where, Photos, Roof, Damage, Review, Make. The last is the waiting step, reached only by making the report. */
export const LAST_STEP = 6;
export const REVIEW_STEP = 5;
const VERSION = 1;
/** A draft saved by a clock this far ahead of ours is not believed. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;
const KEY_RE = /^[A-Za-z0-9_.:-]{8,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DraftJob { externalId: string; label: string }
export interface WhereDraft { address: string; city: string; state: string; zip: string; job: DraftJob | null }
export interface DraftPhoto { id: string; name: string; category: ReportPhotoCategory | null }
export interface RoofDraft { squares: string; pitch: string; stories: string; material: string }
export interface DamageDraft { wind: string; hail: string; general: string }

export interface ReviewDraft {
  kinds: ReportKindValue[];
  template: TemplateValue;
  notes: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}
/** The one request key made for this try at making the report, and a fingerprint of what it asked for. */
export interface AttemptDraft { key: string; fingerprint: string }

export interface WizardDraft {
  step: number;
  where: WhereDraft;
  photos: DraftPhoto[];
  /** What the next photos added are said to show. */
  photoKind: '' | ReportPhotoCategory;
  roof: RoofDraft;
  damage: DamageDraft;
  review: ReviewDraft;
  /** Set when "Make the report" was pressed, so a refresh picks the same report up instead of starting another. */
  attempt: AttemptDraft | null;
}

export const emptyReview = (): ReviewDraft => ({ kinds: ['inspection'], template: 'full', notes: '', customerName: '', customerEmail: '', customerPhone: '' });

export const emptyDraft = (): WizardDraft => ({
  step: 1,
  where: { address: '', city: '', state: '', zip: '', job: null },
  photos: [],
  photoKind: '',
  roof: { squares: '', pitch: '', stories: '', material: '' },
  damage: { wind: '0', hail: '0', general: '0' },
  review: emptyReview(),
  attempt: null,
});

/** True when nothing has been filled in, so there is nothing worth keeping. */
export const isEmptyDraft = (d: WizardDraft): boolean => JSON.stringify(d) === JSON.stringify(emptyDraft());

/** The key a person's draft is kept under, or null while the person or company is not known yet. */
export function draftKey(companyId: string | null | undefined, email: string | null | undefined): string | null {
  const c = (companyId ?? '').trim();
  const e = (email ?? '').trim().toLowerCase();
  return c && e ? `archie.roofReportDraft.v${VERSION}.${c}.${e}` : null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Checks and cuts down whatever was stored; null when it is not a draft at all. */
function cleanDraft(raw: unknown): WizardDraft | null {
  if (!isObject(raw)) return null;
  const base = emptyDraft();
  const w = isObject(raw.where) ? raw.where : {};
  const job = isObject(w.job) && typeof w.job.externalId === 'string' && w.job.externalId.trim()
    ? { externalId: text(w.job.externalId, 120), label: text(w.job.label, 200) }
    : null;
  const seen = new Set<string>();
  const photos: DraftPhoto[] = [];
  for (const p of Array.isArray(raw.photos) ? raw.photos : []) {
    if (photos.length >= MAX_REPORT_PHOTOS) break;
    if (!isObject(p) || typeof p.id !== 'string' || !UUID_RE.test(p.id)) continue;
    const id = p.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const category = (REPORT_PHOTO_CATEGORIES as readonly string[]).includes(p.category as string) ? (p.category as ReportPhotoCategory) : null;
    photos.push({ id, name: text(p.name, 120), category });
  }
  const r = isObject(raw.roof) ? raw.roof : {};
  const d = isObject(raw.damage) ? raw.damage : {};
  const rv = isObject(raw.review) ? raw.review : {};
  const wantedKinds = new Set<string>(REPORT_KINDS.map((k) => k.value));
  const kinds = (Array.isArray(rv.kinds) ? rv.kinds : []).filter((k): k is ReportKindValue => typeof k === 'string' && wantedKinds.has(k));
  const at = isObject(raw.attempt) ? raw.attempt : null;
  const attempt = at && typeof at.key === 'string' && KEY_RE.test(at.key) && typeof at.fingerprint === 'string' && at.fingerprint.length > 0 && at.fingerprint.length <= 64
    ? { key: at.key, fingerprint: at.fingerprint }
    : null;
  const rawStep = typeof raw.step === 'number' && Number.isFinite(raw.step) ? Math.min(LAST_STEP, Math.max(1, Math.floor(raw.step))) : 1;
  // The waiting step is only a place to be while a try is under way.
  const step = rawStep >= LAST_STEP && !attempt ? REVIEW_STEP : rawStep;
  return {
    step,
    where: { address: text(w.address, 200), city: text(w.city, 100), state: text(w.state, 50), zip: text(w.zip, 20), job },
    photos,
    photoKind: (REPORT_PHOTO_CATEGORIES as readonly string[]).includes(raw.photoKind as string) ? (raw.photoKind as ReportPhotoCategory) : '',
    roof: { squares: text(r.squares, 12), pitch: text(r.pitch, 20), stories: text(r.stories, 6), material: text(r.material, 40) },
    damage: { wind: text(d.wind, 8) || base.damage.wind, hail: text(d.hail, 8) || base.damage.hail, general: text(d.general, 8) || base.damage.general },
    review: {
      kinds: kinds.length ? [...new Set(kinds)] : (Array.isArray(rv.kinds) && rv.kinds.length === 0 ? [] : base.review.kinds),
      template: TEMPLATES.some((t) => t.value === rv.template) ? (rv.template as TemplateValue) : base.review.template,
      notes: text(rv.notes, 20_000), customerName: text(rv.customerName, 200), customerEmail: text(rv.customerEmail, 254), customerPhone: text(rv.customerPhone, 40),
    },
    attempt,
  };
}

function forget(storage: StorageLike | null, key: string): void {
  try { storage?.removeItem(key); } catch { /* blocked storage: nothing to forget */ }
}

/** The draft kept under this key, with when it was saved; null when there is none, it is too old or it cannot be trusted. */
export function readDraft(storage: StorageLike | null, key: string, now: number = Date.now()): { draft: WizardDraft; savedAt: number } | null {
  if (!storage) return null;
  let parsed: unknown;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    parsed = JSON.parse(raw);
  } catch {
    forget(storage, key);
    return null;
  }
  if (!isObject(parsed) || parsed.v !== VERSION || typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) { forget(storage, key); return null; }
  if (parsed.savedAt > now + FUTURE_SLACK_MS || now - parsed.savedAt >= DRAFT_TTL_MS) { forget(storage, key); return null; }
  const draft = cleanDraft(parsed.draft);
  if (!draft) { forget(storage, key); return null; }
  return { draft, savedAt: parsed.savedAt };
}

/** Keeps the draft. False when it could not be kept (no storage, blocked or full). Only the cleaned shape is written. */
export function writeDraft(storage: StorageLike | null, key: string, draft: WizardDraft, now: number = Date.now()): boolean {
  if (!storage) return false;
  const clean = cleanDraft(draft);
  if (!clean) return false;
  try {
    storage.setItem(key, JSON.stringify({ v: VERSION, savedAt: now, draft: clean }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage: StorageLike | null, key: string): void {
  forget(storage, key);
}

/** The browser's own storage, or null where it is blocked. */
export function browserStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/** This tab's own storage, or null where it is blocked. Used only for "the wizard was open", which a refresh keeps and a new tab does not. */
export function tabStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

const openKey = (key: string) => `${key}.open`;

/** Notes that the wizard is open (or closed) in this tab, so a refresh can put the person back in it. */
export function markWizardOpen(storage: StorageLike | null, key: string, open: boolean): void {
  try {
    if (!storage) return;
    if (open) storage.setItem(openKey(key), '1'); else storage.removeItem(openKey(key));
  } catch { /* blocked storage: the person just lands on the list and taps Make a roof report */ }
}

export function wasWizardOpen(storage: StorageLike | null, key: string): boolean {
  try { return storage?.getItem(openKey(key)) === '1'; } catch { return false; }
}

/** How long ago, in plain words: "just now", "5 minutes ago", "2 hours ago". */
export function agoText(savedAt: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - savedAt) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
