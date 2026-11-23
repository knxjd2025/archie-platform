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

/** Fill the two placeholders, then escape. The company's values are escaped too. */
function say(c: TenantChapterContext, text: string): string {
  return escapeHtml(text)
    .replace(/\{company\}/g, escapeHtml(c.company))
    .replace(/\{phone\}/g, escapeHtml(c.phone || 'the number on this page'));
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
