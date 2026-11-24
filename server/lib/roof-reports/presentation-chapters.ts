/**
 * presentation-chapters.ts: a company's own chapters for the standard presentation.
 *
 * The base presentation in `scroll-presentation-report.ts` says only what the
 * report itself found, because it renders for every company and a page cannot
 * promise a homeowner something their roofer has not agreed to. Anything that is
 * a promise (how the crew works, what the warranty covers, how long a job takes)
 * belongs to one company and is handed to the renderer as DATA: a `ChapterPack`.
 *
 * This file keeps the mechanism and none of the content. No company's words are
 * in the code. A company with no pack gets the base presentation and nothing
 * more; that is the safe default and it must stay the default.
 *
 * Every value in a pack is plain text and is escaped when it is put on the page.
 * Two placeholders are filled in at that point: `{company}` and `{phone}`.
 */

import { escapeHtml } from './escape-html';
import { isSafeId } from './html-safety.js';
import type { ComprehensiveRoofReport } from './comprehensive-roof-report';

/** The base chapters, in the order they appear. A pack chapter anchors to one of these or to another pack chapter. */
export const BASE_CHAPTER_IDS = [
  'property',
  'looked',
  'measured',
  'condition',
  'findings',
  'evidence',
  'storm',
  'age',
  'estimate',
  'next',
] as const;

/** What a pack chapter is given to write itself with. */
export interface TenantChapterContext {
  /** Zero-padded chapter number, resolved against the set that actually rendered. */
  n: (id: string) => string;
  company: string;
  phone: string;
  /** Whether the report proposes any work. Process and warranty copy needs this. */
  hasWork: boolean;
  report: ComprehensiveRoofReport;
}

export interface PackChapter {
  id: string;
  label: string;
  /** Presenting estimate, in minutes, for the rail clock. */
  minutes: number;
  /** Id of the chapter this one is inserted after (a base chapter or an earlier pack chapter). */
  after: string;
  /** True for a chapter that only makes sense when the report proposes work. */
  onlyWithWork: boolean;
  heading: string;
  ledes: string[];
  steps?: { title: string; text: string }[];
  questions?: { q: string; a: string }[];
  note?: string;
}

export interface ChapterPack {
  chapters: PackChapter[];
  /** Phrases that must appear somewhere in the pack's words (for example a warranty term). */
  mustSay: string[];
  /** Phrases that must not appear anywhere in the pack's words. */
  mustNotSay: string[];
}

/**
 * Escape the pack's words, then fill the two placeholders in ONE pass, from the
 * values this call was handed (the company's own brand record) and nothing
 * else. A function does the filling, so a `$` in a company's name is a `$` and
 * not a replacement pattern, and a value that looks like a placeholder is never
 * filled a second time.
 */
function say(c: TenantChapterContext, text: string): string {
  return escapeHtml(text).replace(/\{(company|phone)\}/g, (_m, name: string) =>
    name === 'company' ? escapeHtml(c.company) : escapeHtml(c.phone || 'the number on this page'));
}

/**
 * The inner HTML of one pack chapter (the renderer supplies the section
 * wrapper): chapter heading and lede, then its steps, questions and note.
 */
export function packChapterHtml(c: TenantChapterContext, ch: PackChapter): string {
  const parts: string[] = [
    `<div class="sc-stack" data-sc-in data-sc-stagger="70">
    <p class="chap"><b>${c.n(ch.id)}</b> &nbsp;${say(c, ch.label)}</p>
    <h2 class="sc-display sc-display--md">${say(c, ch.heading)}</h2>
    ${ch.ledes.map((l) => `<p class="lede">${say(c, l)}</p>`).join('\n    ')}
  </div>`,
  ];
  if (ch.steps?.length) {
    parts.push(
      `<div class="steps">
      ${ch.steps
        .map(
          (s) =>
            `<div class="step"><div class="step__n"></div><div><h3>${say(c, s.title)}</h3><p>${say(c, s.text)}</p></div></div>`,
        )
        .join('\n      ')}
    </div>`,
    );
  }
  if (ch.questions?.length) {
    parts.push(
      ch.questions.map((x) => `<div class="qa"><h3>${say(c, x.q)}</h3><p>${say(c, x.a)}</p></div>`).join('\n    '),
    );
  }
  if (ch.note) parts.push(`<div class="note">${say(c, ch.note)}</div>`);
  return parts.join('\n    ');
}

/** The pack's chapters that apply to this report, in pack order. A pack of null is no chapters. */
export function chaptersToRender(pack: ChapterPack | null, c: TenantChapterContext): PackChapter[] {
  if (!pack) return [];
  return pack.chapters.filter((ch) => !(ch.onlyWithWork && !c.hasWork));
}

/** Every word a pack puts on a page, for the phrase checks. */
function packText(pack: ChapterPack): string {
  return pack.chapters
    .flatMap((ch) => [
      ch.label,
      ch.heading,
      ...ch.ledes,
      ...(ch.steps ?? []).flatMap((s) => [s.title, s.text]),
      ...(ch.questions ?? []).flatMap((x) => [x.q, x.a]),
      ch.note ?? '',
    ])
    .join('\n')
    .toLowerCase();
}

/**
 * Plain sentences naming what is wrong with a pack, empty when it is fit to use.
 * Run it when a pack is saved, never on a customer's page.
 */
export function packProblems(pack: ChapterPack): string[] {
  const problems: string[] = [];
  const base = new Set<string>(BASE_CHAPTER_IDS);
  const seen = new Set<string>();
  for (const ch of pack.chapters) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(ch.id)) {
      problems.push(`The chapter id "${ch.id}" is not allowed. Use lowercase letters, numbers and hyphens, starting with a letter.`);
    } else if (base.has(ch.id)) {
      problems.push(`The chapter id "${ch.id}" is already used by a standard chapter.`);
    } else if (seen.has(ch.id)) {
      problems.push(`The chapter id "${ch.id}" is used more than once.`);
    }
    // An anchor may be a standard chapter or a pack chapter listed earlier.
    if (!base.has(ch.after) && !seen.has(ch.after)) {
      problems.push(`The chapter "${ch.id}" follows "${ch.after}", which is not a standard chapter or an earlier chapter in this pack.`);
    }
    seen.add(ch.id);
  }
  const text = packText(pack);
  for (const phrase of pack.mustNotSay) {
    const p = phrase.trim().toLowerCase();
    if (p && text.includes(p)) problems.push(`The pack says "${phrase}", which it must not say.`);
  }
  for (const phrase of pack.mustSay) {
    const p = phrase.trim().toLowerCase();
    if (p && !text.includes(p)) problems.push(`The pack never says "${phrase}", which it must say.`);
  }
  return problems;
}

// ---------------------------------------------------------------- reading a pack that was typed or stored

const MAX_CHAPTERS = 20;
const MAX_PHRASES = 20;
const LIMITS = { phrase: 300, label: 80, heading: 200, lede: 1000, ledes: 8, stepTitle: 120, stepText: 1000, steps: 12, q: 300, a: 1500, questions: 12, note: 1000 } as const;
const MAX_MINUTES = 120;
const PLAIN_TEXT = /^[^<>\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]*$/;
const PLACEHOLDER = /\{([^{}]*)\}/g;
const ALLOWED_PLACEHOLDERS = new Set(['company', 'phone']);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export type PackReading = { ok: true; pack: ChapterPack } | { ok: false; problems: string[] };

/**
 * Reads a pack from anything (a file somebody typed, a row read back from the
 * database) and gives back either a clean copy holding ONLY the known fields, or
 * plain sentences saying what is wrong. Nothing is repaired and nothing extra is
 * kept: a field the pack has no place for (a script, a style, a link, an image
 * address) is refused, because ignoring it would let a pack that says one thing
 * be saved as another. Text must be plain (no angle brackets, no control
 * characters) and may use only the placeholders {company} and {phone}. The
 * pack's own phrase checks and anchors (`packProblems`) are run as well, so one
 * call says everything that is wrong.
 *
 * Run at load, and again whenever a stored pack is read to be shown.
 */
export function parsePack(value: unknown): PackReading {
  const problems: string[] = [];
  const bad = (sentence: string) => { problems.push(sentence); };
  if (!isRecord(value)) return { ok: false, problems: ['A pack must be an object with chapters, mustSay and mustNotSay.'] };

  const only = (o: Record<string, unknown>, known: readonly string[], where: string) => {
    for (const k of Object.keys(o)) if (!known.includes(k)) bad(`${where} has a field "${k}" that a pack has no place for.`);
  };
  const text = (v: unknown, max: number, where: string, required = true): string => {
    if (typeof v !== 'string') { if (required || v !== undefined) bad(`${where} must be text.`); return ''; }
    if (required && v.trim() === '') bad(`${where} must not be empty.`);
    if (v.length > max) bad(`${where} is too long (at most ${max} characters).`);
    if (!PLAIN_TEXT.test(v)) bad(`${where} must be plain text: no angle brackets or control characters.`);
    for (const m of v.matchAll(PLACEHOLDER)) if (!ALLOWED_PLACEHOLDERS.has(m[1])) bad(`${where} uses {${m[1]}}, which is not one of {company} or {phone}.`);
    return v;
  };
  const list = (v: unknown, max: number, where: string): unknown[] => {
    if (!Array.isArray(v)) { bad(`${where} must be a list.`); return []; }
    if (v.length > max) bad(`${where} has too many entries (at most ${max}).`);
    return v.slice(0, max);
  };

  only(value, ['chapters', 'mustSay', 'mustNotSay'], 'The pack');
  const chapters: PackChapter[] = list(value.chapters, MAX_CHAPTERS, 'The chapters').map((raw, i) => {
    const where = `Chapter ${i + 1}`;
    if (!isRecord(raw)) { bad(`${where} must be an object.`); return null; }
    only(raw, ['id', 'label', 'minutes', 'after', 'onlyWithWork', 'heading', 'ledes', 'steps', 'questions', 'note'], where);
    if (typeof raw.id !== 'string' || !isSafeId(raw.id)) bad(`${where} has an id that is not allowed. Use lowercase letters, numbers and hyphens, starting with a letter.`);
    if (typeof raw.after !== 'string' || !isSafeId(raw.after)) bad(`${where} follows something that is not a plain chapter id.`);
    if (typeof raw.minutes !== 'number' || !Number.isInteger(raw.minutes) || raw.minutes < 0 || raw.minutes > MAX_MINUTES) bad(`${where} needs whole minutes from 0 to ${MAX_MINUTES}.`);
    if (typeof raw.onlyWithWork !== 'boolean') bad(`${where} must say whether it is only for reports with work (true or false).`);
    const ch: PackChapter = {
      id: typeof raw.id === 'string' ? raw.id : '',
      label: text(raw.label, LIMITS.label, `${where}'s label`),
      minutes: typeof raw.minutes === 'number' ? raw.minutes : 0,
      after: typeof raw.after === 'string' ? raw.after : '',
      onlyWithWork: raw.onlyWithWork === true,
      heading: text(raw.heading, LIMITS.heading, `${where}'s heading`),
      ledes: list(raw.ledes, LIMITS.ledes, `${where}'s opening lines`).map((l, n) => text(l, LIMITS.lede, `${where}, opening line ${n + 1}`)),
    };
    if (raw.steps !== undefined) {
      ch.steps = list(raw.steps, LIMITS.steps, `${where}'s steps`).map((s, n) => {
        const w = `${where}, step ${n + 1}`;
        if (!isRecord(s)) { bad(`${w} must be an object.`); return { title: '', text: '' }; }
        only(s, ['title', 'text'], w);
        return { title: text(s.title, LIMITS.stepTitle, `${w}'s title`), text: text(s.text, LIMITS.stepText, `${w}'s text`) };
      });
    }
    if (raw.questions !== undefined) {
      ch.questions = list(raw.questions, LIMITS.questions, `${where}'s questions`).map((q, n) => {
        const w = `${where}, question ${n + 1}`;
        if (!isRecord(q)) { bad(`${w} must be an object.`); return { q: '', a: '' }; }
        only(q, ['q', 'a'], w);
        return { q: text(q.q, LIMITS.q, `${w}'s question`), a: text(q.a, LIMITS.a, `${w}'s answer`) };
      });
    }
    if (raw.note !== undefined) ch.note = text(raw.note, LIMITS.note, `${where}'s note`, false);
    return ch;
  }).filter((c): c is PackChapter => c !== null);
  const phrases = (v: unknown, where: string) => list(v, MAX_PHRASES, where).map((p, i) => text(p, LIMITS.phrase, `${where}, entry ${i + 1}`));
  const pack: ChapterPack = { chapters, mustSay: phrases(value.mustSay, 'The mustSay list'), mustNotSay: phrases(value.mustNotSay, 'The mustNotSay list') };
  if (problems.length === 0) problems.push(...packProblems(pack));
  return problems.length ? { ok: false, problems } : { ok: true, pack };
}
