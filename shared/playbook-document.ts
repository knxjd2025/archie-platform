/**
 * Turns a Sales Playbook document's plain text (exported from Word/PDF
 * training files) into a structured document branded as the company it is
 * for: its name, logo, colors and contact details come from the fill context
 * (companyFillFrom in playbook.ts), and a detail it has not entered is left
 * off rather than filled with another company's.
 *
 * One renderer serves all three places a document appears so they never
 * drift apart:
 *  - `screen`  the Playbook viewer (class-based, styled by PLAYBOOK_DOC_CSS)
 *  - `print`   the print / Save-as-PDF window (same classes, page CSS)
 *  - `email`   HTML sent through GHL or copied into Gmail (inline styles only,
 *              because email clients drop <style> blocks)
 *
 * Every piece of text is HTML-escaped here; callers may inject the result.
 */
import { signatureBlock, subjectOf, type FillContext, type PlaybookDoc } from './playbook';

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

export interface DocListItem { text: string; depth: number; check: boolean; /** Ordinal among tick boxes, for checklist state. */ n?: number }
export type DocBlock =
  | { t: 'title'; text: string }
  | { t: 'h2'; text: string }
  | { t: 'h3'; text: string }
  | { t: 'lead'; label: string; text: string }
  | { t: 'p'; text: string; tone?: 'say' | 'salutation' | 'ps' }
  | { t: 'list'; ordered: boolean; items: DocListItem[] }
  | { t: 'callout'; label: string; text: string }
  | { t: 'rule' }
  | { t: 'links'; label?: string; urls: string[] }
  | { t: 'tags'; items: string[] }
  | { t: 'signoff'; closing: string; lines: string[] };

const MARKER = /^(\s*)(•|●|○|◦|■|▪|☐|☑|✓|✔|\*|-|–|\d{1,2}[.)]|[a-h][.)])\s+(\S.*)$/;
const RULE = /^\s*[-_=—–*~]{3,}\s*$/;
const URL_LINE = /^\s*(?:([^:\n]{1,40}?):\s*)?(https?:\/\/\S+)\s*$/;
const CALLOUT = /^\s*\**\s*(NOTE|TIP|PRO TIP|IMPORTANT|REMEMBER|REMINDER|OPTIONAL|WARNING|DISCLAIMER)\b([^:]{0,40}):\s*(.*)$/i;
const CLOSING = /^\s*(Regards|Best regards|Kind regards|Warm regards|Warmly|Sincerely|Sincerely yours|Respectfully|Thank you|Thanks|Thanks again|Many thanks|Best|All the best|Cheers|Talk soon|To your success|Gratefully|Yours truly),?\s*$/i;
const SALUTATION = /^\s*(Dear|Hi|Hello|Hey|Good (morning|afternoon|evening))\b.{0,60},\s*$/i;
const LEAD = /^\s*((?:Stage|Step|Example|Option|Part|Phase|Round|Scenario|Level|Script|Day|Week|Email|Text|Letter|Version|Tip|Trick|Rule|Text Message|Text)\s*#?\s*\d{1,2}|FOR (?:RETAIL|STORM|INSURANCE|COMMERCIAL)|Subject(?: line)?)\s*(?:[:.)–]|\s-)\s*(.+)$/i;
const SPOKEN = /^\s*(?:[“"‘']|(?:Hi|Hello|Hey|Good (?:morning|afternoon|evening)|Thanks|Thank you|Great|Perfect|Awesome|Excellent|Absolutely|Okay|OK|Sure|My name|This is|Is this|Would you|Could you|Can I|May I|Do you|Have you|Are you|I’m|I'm|I understand|I totally|I completely|That’s|That's|It sounds|Mr\.|Mrs\.|Ms\.)\b)/;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const plainLen = (s: string) => s.replace(/\*\*/g, '').trim().length;

function isHeadingLine(raw: string): 'h2' | 'h3' | null {
  const s = raw.trim();
  if (!s || s.length > 72 || /\S {2,}\S/.test(s)) return null;
  if (/^\*\*[^*]+\*\*:?$/.test(s)) return 'h3';
  if (/^[“"‘'(\[]/.test(s) || SALUTATION.test(s) || CLOSING.test(s)) return null;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase() && !/_{3,}/.test(s)) return 'h2';
  if (/[.,;…!?]$/.test(s) || /[:;]\)$/.test(s) || /_{3,}/.test(s) || /https?:/.test(s)) return null;
  if (!/^[A-Z0-9“]/.test(s) || s.split(/\s+/).length > 9) return null;
  return 'h3';
}

/** Undo PDF hard wraps: a line that stops mid-sentence continues on the next lowercase line. */
function joinSoftWraps(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.trim() && line.trim()
      && !/[.!?:;”"’)\]…]\s*$/.test(prev) && !RULE.test(prev)
      && /^\s*[a-z(]/.test(line) && !MARKER.test(line) && !URL_LINE.test(line) && !/^\s*\S+@\S+\s*$|^\s*[a-z0-9.-]+\.(com|net|org)\s*$/i.test(line)) {
      out[out.length - 1] = `${prev.replace(/\s+$/, '')} ${line.trim()}`;
    } else out.push(line);
  }
  return out;
}

/** PDF exports repeat whole runs of blocks; drop an immediately repeated run. */
function dropRepeatedRuns(blocks: DocBlock[]): DocBlock[] {
  const key = blocks.map((b) => JSON.stringify(b));
  const weight = blocks.map((b) => JSON.stringify(b).length);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let k = 1; k <= 12; k++) {
      for (let i = 0; i + 2 * k <= key.length; i++) {
        let same = true; let w = 0;
        for (let j = 0; j < k; j++) { if (key[i + j] !== key[i + k + j]) { same = false; break; } w += weight[i + j]; }
        if (same && w > 60) {
          key.splice(i + k, k); weight.splice(i + k, k); blocks.splice(i + k, k);
          changed = true; break outer;
        }
      }
    }
  }
  return blocks;
}

export interface ParseOptions {
  /** The document's own title; a first line that repeats it is dropped. */
  title?: string;
  kind?: PlaybookDoc['kind'];
  /** Replaces the template's sign-off lines (NAME / TITLE / PHONE…) with the rep's real signature. */
  signature?: string | null;
}

export function parsePlaybookText(text: string, opts: ParseOptions = {}): DocBlock[] {
  const lines = joinSoftWraps(text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n').map((l) => l.replace(/\s+$/, '')));
  const blocks: DocBlock[] = [];
  let checkN = 0;
  let i = 0;
  const next = (from: number) => { let j = from; while (j < lines.length && !lines[j].trim()) j++; return j; };

  // Title: the first line when it reads like one.
  const first = next(0);
  if (first < lines.length) {
    const s = lines[first].trim().replace(/^\*+|\*+$/g, '');
    const looksTitle = s.length <= 80 && !MARKER.test(lines[first]) && !SALUTATION.test(s) && !/^subject\s*:/i.test(s) && !/[.,;]$/.test(s) && !CALLOUT.test(s) && !URL_LINE.test(s);
    if (looksTitle) {
      const t = norm(s); const docT = norm(opts.title || '');
      const repeatsTitle = !!docT && !!t && (docT.includes(t) || t.includes(docT)) && opts.kind !== 'letter';
      if (!repeatsTitle) blocks.push({ t: 'title', text: s });
      i = first + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const s = line.trim();
    if (!s) { i++; continue; }

    if (RULE.test(line)) { if (blocks[blocks.length - 1]?.t !== 'rule') blocks.push({ t: 'rule' }); i++; continue; }

    // Links: "https://…" or "And this video: https://…", optionally under "Reference these videos:".
    const url = s.match(URL_LINE);
    if (url || (/:\s*$/.test(s) && s.length < 50 && URL_LINE.test(lines[i + 1] || '') && !URL_LINE.test(s))) {
      let label = url ? undefined : s.replace(/:\s*$/, '');
      const urls: string[] = [];
      if (!url) i++;
      while (i < lines.length) {
        const m = lines[i].trim().match(URL_LINE);
        if (m) { if (!label && !urls.length && m[1]) label = m[1].trim(); urls.push(m[2]); i++; continue; }
        if (!lines[i].trim() && URL_LINE.test(lines[next(i)] || '')) { i = next(i); continue; }
        break;
      }
      const prev = blocks[blocks.length - 1];
      if (prev?.t === 'links' && !label) prev.urls.push(...urls); else blocks.push({ t: 'links', label, urls });
      continue;
    }

    const callout = s.match(CALLOUT);
    if (callout && !MARKER.test(line)) {
      const parts = [callout[3]];
      i++;
      while (i < lines.length && lines[i].trim() && !MARKER.test(lines[i]) && !RULE.test(lines[i])) { parts.push(lines[i].trim()); i++; }
      const label = `${callout[1]}${callout[2]}`.trim().replace(/\s+/g, ' ');
      blocks.push({ t: 'callout', label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(), text: parts.join('\n').trim() });
      continue;
    }

    if (CLOSING.test(s)) {
      let j = i + 1;
      if (j < lines.length && !lines[j].trim() && lines[j + 1]?.trim()) j++;
      const sig: string[] = [];
      while (j < lines.length && lines[j].trim() && !MARKER.test(lines[j]) && sig.length < 8) { sig.push(lines[j].trim()); j++; }
      const looksLikeSignature = sig.length > 0 && sig.every((l) => l.length <= 70 && !/[.!?]$/.test(l.replace(/\.(com|net|org)$/i, '')));
      if (looksLikeSignature) {
        const replace = opts.signature && (opts.kind === 'letter' || opts.kind === 'email');
        blocks.push({ t: 'signoff', closing: s.replace(/,?\s*$/, ','), lines: replace ? opts.signature!.split('\n') : sig });
        i = j;
        continue;
      }
    }

    if (opts.signature && (opts.kind === 'letter' || opts.kind === 'email')) {
      const sig = opts.signature.split('\n').map((l) => l.trim()).filter(Boolean);
      if (sig.length && lines.slice(i, i + sig.length).map((l) => l.trim()).join('\n') === sig.join('\n')) {
        const prev = blocks[blocks.length - 1];
        if (prev?.t !== 'signoff') blocks.push({ t: 'signoff', closing: '', lines: sig });
        i += sig.length;
        continue;
      }
    }

    // Lists: consecutive marker lines (blank lines between items allowed).
    if (MARKER.test(line)) {
      const items: DocListItem[] = [];
      const markerDepth = new Map<string, number>();
      const indentStack: number[] = [];
      let ordered = true;
      while (i < lines.length) {
        const m = lines[i].match(MARKER);
        if (!m) {
          const t = lines[i].trim();
          if (!t) { const j = next(i); if (j < lines.length && MARKER.test(lines[j])) { i = j; continue; } break; }
          // An indented line under an item continues it.
          if (items.length && /^\s{3,}\S/.test(lines[i]) && !isHeadingLine(t)) { items[items.length - 1].text += `\n${t}`; i++; continue; }
          // A PDF-wrapped item carries on, unbulleted, on the next line.
          const last = items[items.length - 1]?.text || '';
          if (items.length && !CALLOUT.test(t) && isHeadingLine(t) !== 'h2' && !/[.!?]$/.test(last)
            && (!isHeadingLine(t) || /\b(for|in|the|and|or|using|of|to|a|an|with|from|on|your|by)$/i.test(last) || /:$/.test(last))) {
            items[items.length - 1].text = `${last} ${t}`; i++; continue;
          }
          break;
        }
        const indent = m[1].length;
        const marker = /^\d/.test(m[2]) ? '1.' : /^[a-h][.)]$/.test(m[2]) ? 'a.' : m[2] === '●' ? '•' : m[2] === '◦' ? '○' : m[2] === '▪' ? '■' : m[2];
        while (indentStack.length && indent < indentStack[indentStack.length - 1]) indentStack.pop();
        if (!indentStack.length || indent > indentStack[indentStack.length - 1]) indentStack.push(indent);
        const byIndent = indentStack.length - 1;
        if (!markerDepth.has(marker)) markerDepth.set(marker, items.length ? Math.max(byIndent, (items[items.length - 1]?.depth ?? -1) + 1) : byIndent);
        const depth = Math.min(3, Math.max(byIndent, markerDepth.get(marker)!));
        const check = /^[☐☑]$/.test(m[2]);
        if (marker !== '1.' && depth === 0) ordered = false;
        items.push({ text: m[3].trim(), depth, check, ...(check ? { n: checkN++ } : {}) });
        i++;
      }
      // Normalise so the shallowest item sits at depth 0.
      const min = Math.min(...items.map((it) => it.depth));
      for (const it of items) it.depth -= min;
      blocks.push({ t: 'list', ordered: ordered && items.every((it) => it.depth > 0 || !it.check), items });
      continue;
    }

    // A run of 3+ one- or two-word lines is a set of labels (e.g. the CARPARK letters).
    {
      const run: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim() && lines[j].trim().length <= 24 && /^[A-Z][\w’'&/-]*(\s[\w’'&/-]+)?$/.test(lines[j].trim())) { run.push(lines[j].trim()); j++; }
      if (run.length >= 3 && (j >= lines.length || !lines[j].trim())) { blocks.push({ t: 'tags', items: run }); i = j; continue; }
    }

    const lead = s.match(LEAD);
    if (lead && plainLen(s) <= 240 && !MARKER.test(line)) { blocks.push({ t: 'lead', label: lead[1].trim(), text: lead[2].trim() }); i++; continue; }

    const heading = isHeadingLine(s);
    const after = lines[i + 1];
    if (heading && (after === undefined || !after.trim() || MARKER.test(after) || isHeadingLine(after.trim()) === null)) {
      const text = s.replace(/^\*\*|\*\*:?$/g, '').replace(/:$/, '').trim();
      // A heading directly followed by prose on the next line stays a heading only when it is short.
      if (!after?.trim() || MARKER.test(after) || text.length <= 64) {
        blocks.push({ t: heading, text });
        i++;
        continue;
      }
    }

    // Paragraph: consecutive plain lines keep their line breaks (addresses, short verse-like lines).
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]; const t = l.trim();
      if (!t || MARKER.test(l) || RULE.test(l) || URL_LINE.test(t) || (para.length && (CALLOUT.test(t) || CLOSING.test(t) || LEAD.test(t)))) break;
      if (para.length && para[para.length - 1].length >= 58 && !/[:]$/.test(para[para.length - 1])) para[para.length - 1] += ` ${t}`; else para.push(t);
      i++;
    }
    if (!para.length) { para.push(s); i++; }
    const body = para.join('\n');
    const tone = SALUTATION.test(body) ? 'salutation' : /^P\.?\s?S\.?/i.test(body) ? 'ps' : (opts.kind === 'script' && SPOKEN.test(body)) || /^[“"][^“”"]{8,}[”"]$/.test(body) ? 'say' : undefined;
    blocks.push(tone ? { t: 'p', text: body, tone } : { t: 'p', text: body });
  }
  return dropRepeatedRuns(blocks);
}

const INSTRUCTION = /(recommend (mailing|sending|dropping)|alternatively|starts on page|copy (and )?paste|remove copyright|send this|mail this|leave this|watch (this|these) video|print (this|on)|use this (letter|template)|fill in|optional)/i;

/**
 * Letter templates often open with notes for the rep ("Send this AFTER you
 * knock… Starts on Page 2: Copy Paste…", video links). Those must never print
 * on the customer's letter, so split them off: the letter proper starts at
 * its headline (the short line just before the salutation) or the salutation.
 */
export function splitLetterNotes(blocks: DocBlock[]): { notes: DocBlock[]; letter: DocBlock[] } {
  const sal = blocks.findIndex((b) => b.t === 'p' && b.tone === 'salutation');
  if (sal <= 0) return { notes: [], letter: blocks };
  const before = blocks.slice(0, sal);
  const textOf = (b: DocBlock) => ('text' in b ? b.text : b.t === 'links' ? 'watch these videos' : '');
  if (!before.some((b) => b.t === 'links' || b.t === 'callout' || INSTRUCTION.test(textOf(b)))) return { notes: [], letter: blocks };
  const headline = (b: DocBlock | undefined): b is Extract<DocBlock, { text: string }> =>
    !!b && (b.t === 'p' || b.t === 'h3' || b.t === 'h2' || b.t === 'title') && (b.t !== 'p' || b.tone === undefined) && b.text.length <= 160 && !INSTRUCTION.test(b.text);
  let start = sal;
  const letter = blocks.slice(sal);
  if (headline(blocks[sal - 1])) {
    start = sal - 1;
    let text = (blocks[sal - 1] as any).text as string;
    // "Courtesy Notice For Neighbors On or Near" + "[STREET, CITY]"
    if (sal >= 2 && (blocks[sal - 2].t === 'h3' || blocks[sal - 2].t === 'h2') && headline(blocks[sal - 2])) { start = sal - 2; text = `${(blocks[sal - 2] as any).text} ${text}`; }
    letter.unshift({ t: 'title', text });
  }
  return { notes: blocks.slice(0, start).filter((b) => b.t !== 'title'), letter };
}

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

/** The document palette. primary/accent are the company's (paletteFor); the rest are neutral. */
export interface DocPalette {
  primary: string; primaryDeep: string; accent: string;
  ink: string; muted: string; line: string; paper: string; wash: string; blankBg: string;
}

export const DEFAULT_PALETTE: DocPalette = {
  primary: '#1F3A5F', primaryDeep: '#16293F', accent: '#1F2937',
  ink: '#1c2233', muted: '#5f6677', line: '#e3e6ee', paper: '#ffffff', wash: '#f4f6fb', blankBg: '#fdf3d7',
};

const HEX = /^#[0-9a-f]{6}$/i;
/** Darken a #rrggbb color by `amount` (0–1). */
const darken = (hex: string, amount: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.round(((n >> shift) & 255) * (1 - amount)));
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
};

/** The company's colors, from the fill context, over the neutral palette. */
export function paletteFor(ctx?: Pick<FillContext, 'brandColor' | 'accentColor'> | null): DocPalette {
  const primary = ctx?.brandColor && HEX.test(ctx.brandColor) ? ctx.brandColor : DEFAULT_PALETTE.primary;
  const accent = ctx?.accentColor && HEX.test(ctx.accentColor) ? ctx.accentColor : primary === DEFAULT_PALETTE.primary ? DEFAULT_PALETTE.accent : primary;
  return { ...DEFAULT_PALETTE, primary, primaryDeep: darken(primary, 0.3), accent };
}

/** The palette the email-mode inline styles use while a document renders (set by renderPlaybookDocument). */
let ACTIVE_PALETTE: DocPalette = DEFAULT_PALETTE;

const KIND_EYEBROW: Record<PlaybookDoc['kind'], string> = {
  checklist: 'Checklist', guide: 'Training guide', script: 'Script', letter: 'Letter', email: 'Email', reference: 'Reference sheet',
};

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export type RenderMode = 'screen' | 'print' | 'email';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Email clients need inline styles; screen and print use classes. */
const inlineStyles = (): Record<string, string> => ({
  title: `font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:${ACTIVE_PALETTE.primary};margin:0 0 14px;font-weight:700`,
  h2: `font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:${ACTIVE_PALETTE.accent};margin:22px 0 8px;font-weight:700;border-bottom:2px solid ${ACTIVE_PALETTE.line};padding-bottom:5px`,
  h3: `font-family:Georgia,'Times New Roman',serif;font-size:18px;color:${ACTIVE_PALETTE.primary};margin:18px 0 6px;font-weight:700`,
  lead: `margin:18px 0 8px;font-size:15px;line-height:1.6;color:${ACTIVE_PALETTE.ink}`,
  leadLabel: `display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#ffffff;background:${ACTIVE_PALETTE.primary};border-radius:4px;padding:2px 8px;margin-right:8px;font-weight:700`,
  p: `margin:0 0 14px;font-size:15px;line-height:1.65;color:${ACTIVE_PALETTE.ink}`,
  say: `margin:0 0 14px;font-size:15px;line-height:1.65;color:${ACTIVE_PALETTE.ink};background:${ACTIVE_PALETTE.wash};border-left:4px solid ${ACTIVE_PALETTE.primary};padding:10px 14px;border-radius:0 6px 6px 0`,
  ps: `margin:18px 0 14px;font-size:14px;line-height:1.6;color:${ACTIVE_PALETTE.muted};font-style:italic`,
  ul: `margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.6;color:${ACTIVE_PALETTE.ink}`,
  li: 'margin:0 0 6px',
  callout: `margin:0 0 16px;background:#fbf1f0;border:1px solid #efd3d0;border-radius:8px;padding:10px 14px;font-size:14px;line-height:1.6;color:${ACTIVE_PALETTE.ink}`,
  calloutLabel: `font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${ACTIVE_PALETTE.accent};font-weight:700;display:block;margin-bottom:2px`,
  rule: `border:0;border-top:1px solid ${ACTIVE_PALETTE.line};margin:18px 0`,
  links: `margin:0 0 14px;font-size:14px`,
  a: `color:${ACTIVE_PALETTE.primary};text-decoration:underline`,
  tags: `margin:0 0 14px;font-size:14px;color:${ACTIVE_PALETTE.primary};font-weight:700`,
  signoff: `margin:22px 0 14px;font-size:15px;line-height:1.55;color:${ACTIVE_PALETTE.ink}`,
  sigName: `font-family:Georgia,'Times New Roman',serif;font-size:17px;color:${ACTIVE_PALETTE.primary};font-weight:700`,
});

function attr(mode: RenderMode, cls: string, inlineKey?: string): string {
  if (mode === 'email') { const st = inlineStyles(); return inlineKey && st[inlineKey] ? ` style="${st[inlineKey]}"` : ''; }
  return ` class="${cls}"`;
}

/** Escapes text and marks up blanks, links, **bold**, fill-in lines and PDF column gaps. */
export function inlineHtml(text: string, mode: RenderMode): string {
  text = text.split('\n').map((l) => ((l.trim().match(/\S {2,}(?=\S)/g) || []).length >= 2 ? l : l.replace(/(\S) {2,}(?=\S)/g, '$1 '))).join('\n');
  const parts = text.replace(/^\*{3,}\s*/, '').split(/(\[[^\]\n]{1,80}\]|https?:\/\/[^\s<>"]+|\*\*[^*\n]+\*\*|_{3,}|\S {2,}(?=\S)|\n)/g);
  return parts.map((p) => {
    if (!p) return '';
    if (p === '\n') return '<br>';
    if (/^\[[^\]]+\]$/.test(p)) {
      if (mode === 'screen') return `<mark class="pbd-blank" title="Fill this in">${esc(p)}</mark>`;
      if (mode === 'print') return `<span class="pbd-blank">${esc(p.slice(1, -1))}</span>`;
      return esc(p);
    }
    if (/^https?:\/\//.test(p)) {
      const href = p.replace(/[.,;:)]+$/, ''); const tail = p.slice(href.length);
      const label = /youtu\.?be/.test(href) ? 'Watch the video' : href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      return `<a href="${esc(href)}" target="_blank" rel="noreferrer"${attr(mode, 'pbd-link', 'a')}>${esc(mode === 'print' ? href : label)}</a>${esc(tail)}`;
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) return `<strong>${esc(p.slice(2, -2))}</strong>`;
    if (/^_{3,}$/.test(p)) return mode === 'email' ? esc(p) : `<span class="pbd-fill" aria-label="blank"></span>`;
    if (/^\S {2,}$/.test(p)) return `${esc(p[0])}${mode === 'email' ? ' &nbsp;·&nbsp; ' : '<span class="pbd-gap"></span>'}`;
    return esc(p);
  }).join('');
}

export function renderBlocks(blocks: DocBlock[], mode: RenderMode, o: { checked?: ReadonlySet<number>; kind?: PlaybookDoc['kind'] } = {}): string {
  const out: string[] = [];
  const say = (i: number) => blocks[i]?.t === 'p' && (blocks[i] as any).tone === 'say';
  blocks.forEach((b, idx) => {
    switch (b.t) {
      case 'title': out.push(`<h1${attr(mode, 'pbd-title', 'title')}>${inlineHtml(b.text, mode)}</h1>`); break;
      case 'h2': out.push(`<h2${attr(mode, 'pbd-h2', 'h2')}>${inlineHtml(b.text, mode)}</h2>`); break;
      case 'h3': out.push(`<h3${attr(mode, 'pbd-h3', 'h3')}>${inlineHtml(b.text, mode)}</h3>`); break;
      case 'lead': out.push(`<p${attr(mode, 'pbd-lead', 'lead')}><span${attr(mode, 'pbd-lead-label', 'leadLabel')}>${esc(b.label)}</span>${inlineHtml(b.text, mode)}</p>`); break;
      case 'p': {
        const cls = b.tone === 'say' ? 'pbd-p pbd-say' : b.tone === 'ps' ? 'pbd-p pbd-ps' : b.tone === 'salutation' ? 'pbd-p pbd-salutation' : 'pbd-p';
        const inlineKey = b.tone === 'say' ? 'say' : b.tone === 'ps' ? 'ps' : 'p';
        out.push(`<p${attr(mode, cls, inlineKey)}>${inlineHtml(b.text, mode)}</p>`);
        break;
      }
      case 'callout': out.push(`<div${attr(mode, 'pbd-callout', 'callout')}><span${attr(mode, 'pbd-callout-label', 'calloutLabel')}>${esc(b.label)}</span>${inlineHtml(b.text, mode)}</div>`); break;
      case 'rule': {
        const between = o.kind === 'script' && say(idx - 1) && say(idx + 1);
        out.push(mode === 'email' ? `<hr${attr(mode, '', 'rule')}>` : between ? '<div class="pbd-or"><span>or try</span></div>' : '<hr class="pbd-rule">');
        break;
      }
      case 'links': {
        const links = b.urls.map((u) => inlineHtml(u, mode)).join(mode === 'email' ? ' &nbsp;|&nbsp; ' : '');
        out.push(`<div${attr(mode, 'pbd-links', 'links')}>${b.label ? `<span${attr(mode, 'pbd-links-label')}>${esc(b.label)}${mode === 'email' ? ': ' : ''}</span>` : ''}${links}</div>`);
        break;
      }
      case 'tags': out.push(`<div${attr(mode, 'pbd-tags', 'tags')}>${b.items.map((t) => mode === 'email' ? esc(t) : `<span><b>${esc(t.charAt(0))}</b>${esc(t.slice(1))}</span>`).join(mode === 'email' ? ' · ' : '')}</div>`); break;
      case 'signoff': {
        const [name, ...rest] = b.lines;
        out.push(`<div${attr(mode, 'pbd-signoff', 'signoff')}>${b.closing ? `${esc(b.closing)}<br>${mode === 'email' ? '<br>' : ''}` : ''}<span${attr(mode, 'pbd-sig-name', 'sigName')}>${inlineHtml(name || '', mode)}</span>${rest.length ? `<br>${rest.map((l) => inlineHtml(l, mode)).join('<br>')}` : ''}</div>`);
        break;
      }
      case 'list': out.push(renderList(b, mode, o.checked)); break;
    }
  });
  return out.join('\n');
}

function renderList(b: Extract<DocBlock, { t: 'list' }>, mode: RenderMode, checked?: ReadonlySet<number>): string {
  // Build nested lists from depths.
  let html = '';
  const stack: number[] = [];
  const open = (depth: number) => {
    const tag = b.ordered && depth === 0 ? 'ol' : 'ul';
    const hasChecks = b.items.some((it) => it.check);
    html += `<${tag}${mode === 'email' ? ` style="${inlineStyles().ul}${hasChecks ? ';list-style:none;padding-left:4px' : ''}"` : ` class="pbd-list${hasChecks ? ' pbd-checks' : ''} pbd-d${depth}"`}>`;
    stack.push(depth);
  };
  const close = () => { const d = stack.pop()!; html += `</li></${b.ordered && d === 0 ? 'ol' : 'ul'}>`; };
  b.items.forEach((it, k) => {
    if (!stack.length) open(it.depth);
    else if (it.depth > stack[stack.length - 1]) open(it.depth);
    else {
      while (stack.length > 1 && it.depth < stack[stack.length - 1]) close();
      if (k > 0) html += '</li>';
    }
    const done = it.check && it.n !== undefined && !!checked?.has(it.n);
    if (it.check) {
      if (mode === 'email') html += `<li style="${inlineStyles().li}">☐ ${inlineHtml(it.text, mode)}`;
      else if (mode === 'print') html += `<li class="pbd-check-item${done ? ' is-done' : ''}"><span class="pbd-box">${done ? '✓' : ''}</span><span>${inlineHtml(it.text, mode)}</span>`;
      else html += `<li class="pbd-check-item${done ? ' is-done' : ''}"><button type="button" class="pbd-box" data-check="${it.n}" aria-pressed="${done}" aria-label="Mark done">${done ? '✓' : ''}</button><span>${inlineHtml(it.text, mode)}</span>`;
    } else {
      html += `<li${mode === 'email' ? ` style="${inlineStyles().li}"` : ''}>${inlineHtml(it.text, mode)}`;
    }
  });
  while (stack.length) close();
  return html;
}

/* ------------------------------------------------------------------ */
/* Whole documents                                                     */
/* ------------------------------------------------------------------ */

export interface DocumentOptions {
  mode: RenderMode;
  /** Filled text (after fillTemplate); defaults to the raw body. */
  text?: string;
  ctx?: (FillContext & { customerLabel?: string | null }) | null;
  checked?: ReadonlySet<number>;
  /** Absolute or root-relative logo URL. */
  logoUrl?: string;
}

const STAGE_LABEL = (s: string) => s.replace(/_/g, ' ');

export function checklistTotal(doc: Pick<PlaybookDoc, 'body' | 'title' | 'kind'>): number {
  return parsePlaybookText(doc.body, { title: doc.title, kind: doc.kind })
    .reduce((n, b) => n + (b.t === 'list' ? b.items.filter((it) => it.check).length : 0), 0);
}

/** The full branded sheet: letterhead, body and footer, in the company's name and colors. */
export function renderPlaybookDocument(doc: PlaybookDoc, o: DocumentOptions): string {
  const outer = ACTIVE_PALETTE;
  ACTIVE_PALETTE = paletteFor(o.ctx);
  try { return renderWithPalette(doc, o); } finally { ACTIVE_PALETTE = outer; }
}

function renderWithPalette(doc: PlaybookDoc, o: DocumentOptions): string {
  const c = { ...Object.fromEntries(Object.entries(o.ctx || {}).filter(([, v]) => v)) } as FillContext & { customerLabel?: string | null };
  const name = c.companyName || '';
  const legal = c.companyLegalName || name;
  const logo = o.logoUrl || c.companyLogoUrl || '';
  const text = o.text ?? doc.body;
  const email = doc.kind === 'email' ? subjectOf(doc, text) : null;
  const signature = o.ctx?.repName ? signatureBlock({ ...c }) : null;
  const parsed = parsePlaybookText(email ? email.body : text, { title: doc.title, kind: doc.kind, signature });
  const { notes, letter: blocks } = doc.kind === 'letter' ? splitLetterNotes(parsed) : { notes: [] as DocBlock[], letter: parsed };
  const body = renderBlocks(blocks, o.mode, { checked: o.checked, kind: doc.kind });
  const notesHtml = notes.length && o.mode === 'screen'
    ? `<aside class="pbd-notes"><span class="pbd-notes-label">Before you send · not printed</span>${renderBlocks(notes, 'screen', { kind: doc.kind })}</aside>` : '';
  const phone = c.officePhone || ''; const site = c.companyWebsite || '';
  const siteLink = (style = '') => (site ? `<a href="https://${esc(site)}"${style}>${esc(site)}</a>` : '');
  // The logo, or the company's name in its place when it has no logo.
  const mark = (cls: string) => (logo
    ? `<img class="${cls}" src="${esc(logo)}" alt="${esc(name)}">`
    : name ? `<span class="pbd-wordmark">${esc(name)}</span>` : '');

  if (o.mode === 'email') {
    const contact = [name ? `<b style="font-size:13px">${esc(name)}</b>` : '', esc(phone), siteLink(' style="color:#ffffff"')].filter(Boolean).join(' &nbsp;·&nbsp; ');
    const head = logo
      ? `<img src="${esc(logo)}" alt="${esc(name)}" width="180" style="display:block;width:180px;max-width:60%;height:auto;border:0">`
      : name ? `<b style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:${ACTIVE_PALETTE.primary}">${esc(name)}</b>` : '';
    return `<div style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:${ACTIVE_PALETTE.ink};background:#ffffff">
${head ? `<div style="padding:18px 24px 12px;border-bottom:3px solid ${ACTIVE_PALETTE.accent}">${head}</div>` : ''}
<div style="padding:22px 24px 8px">${body}</div>
${contact || c.credentials ? `<div style="background:${ACTIVE_PALETTE.primary};color:#ffffff;padding:14px 24px;font-size:12px;line-height:1.6">
${contact}${c.credentials ? `${contact ? '<br>' : ''}<span style="color:#e5e7eb">${esc(capitalise(c.credentials))}</span>` : ''}</div>` : ''}</div>`;
  }

  const credentials = c.credentials ? `<p class="pbd-cred">${esc(capitalise(c.credentials))}</p>` : '';
  let head = '';
  let foot = '';
  if (doc.kind === 'letter') {
    const contact = [o.ctx?.repName ? `<b>${esc(o.ctx.repName)}</b>` : null, o.ctx?.repTitle ? esc(o.ctx.repTitle) : null, o.ctx?.repCell ? `Cell ${esc(o.ctx.repCell)}` : null, phone ? `Office ${esc(phone)}` : null, o.ctx?.repEmail ? esc(o.ctx.repEmail) : null, site ? esc(site) : null].filter(Boolean).join('<br>');
    head = `<header class="pbd-letterhead">${mark('pbd-logo')}<address>${contact}</address></header><div class="pbd-bars"><i></i><i></i></div>`;
    const line = [legal, c.companyCityState, phone, site].filter(Boolean).map((x) => esc(String(x))).join(' · ');
    foot = `<footer class="pbd-foot pbd-foot--letter">${credentials}${line ? `<p>${line}</p>` : ''}</footer>`;
  } else if (doc.kind === 'email') {
    const from = o.ctx?.repName ? `${esc(o.ctx.repName)}${o.ctx.repEmail ? ` &lt;${esc(o.ctx.repEmail)}&gt;` : ''}` : 'You';
    const to = o.ctx?.customerLabel ? esc(o.ctx.customerLabel) : '<span class="pbd-muted">Pick a customer</span>';
    head = `<div class="pbd-envelope"><div><span>From</span>${from}</div><div><span>To</span>${to}</div><div class="pbd-subject"><span>Subject</span>${inlineHtml(email!.subject, o.mode)}</div></div>
<header class="pbd-mailhead">${mark('pbd-logo')}</header>`;
    const line = [name ? `<b>${esc(name)}</b>` : '', esc(phone), esc(site)].filter(Boolean).join(' · ');
    foot = `<footer class="pbd-mailfoot">${line ? `<p>${line}</p>` : ''}${credentials}</footer>`;
  } else {
    const meta = [
      doc.audience ? `For ${esc(doc.audience)}` : null,
      doc.stage ? `Stage: ${esc(STAGE_LABEL(doc.stage))}` : null,
      doc.videos.length ? `${doc.videos.length} training video${doc.videos.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean).map((m) => `<span>${m}</span>`).join('');
    head = `<header class="pbd-cover"><div class="pbd-cover-top">${mark('pbd-logo')}<span class="pbd-eyebrow">Sales Playbook<b>${KIND_EYEBROW[doc.kind]}</b></span></div>
<h1 class="pbd-doc-title">${esc(doc.title)}</h1>${doc.summary && !norm(doc.body).includes(norm(doc.summary).slice(0, 40)) ? `<p class="pbd-summary">${esc(doc.summary)}</p>` : ''}${meta ? `<div class="pbd-meta">${meta}</div>` : ''}</header>`;
    foot = `<footer class="pbd-foot"><p>${name ? `<b>${esc(name)}</b> · ` : ''}Sales Playbook · ${KIND_EYEBROW[doc.kind]}</p><p>For the ${name ? `${esc(name)} ` : ''}team. Not for distribution.</p></footer>`;
  }
  const vars = `--pb-primary:${ACTIVE_PALETTE.primary};--pb-primary-deep:${ACTIVE_PALETTE.primaryDeep};--pb-accent:${ACTIVE_PALETTE.accent}`;
  return `<article class="pbd pbd--${doc.kind} pbd--${o.mode}" style="${vars}">${notesHtml}${head}<div class="pbd-body">${body}</div>${foot}</article>`;
}

function capitalise(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** Standalone printable page (letterhead and all), opened in a new window. */
export function renderPlaybookPrintPage(doc: PlaybookDoc, o: Omit<DocumentOptions, 'mode'>): string {
  const pal = paletteFor(o.ctx);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc([doc.kind === 'letter' || doc.kind === 'email' ? '' : doc.title, o.ctx?.companyName || ''].filter(Boolean).join(' · ') || doc.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap">
<style>${PLAYBOOK_DOC_CSS}
html,body{margin:0;background:#e9ecf3}
.pbd-printbar{position:sticky;top:0;z-index:2;display:flex;gap:10px;justify-content:center;padding:10px;background:${pal.primaryDeep};font:500 13px Inter,Arial,sans-serif;color:#fff}
.pbd-printbar button{font:600 13px Inter,Arial,sans-serif;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;background:${pal.accent};color:#fff}
.pbd--print{margin:24px auto;max-width:8.5in;box-shadow:0 8px 30px rgba(8,17,52,.18)}
@media print{html,body{background:#fff}.pbd-printbar{display:none}.pbd--print{margin:0;max-width:none;box-shadow:none}}
</style></head><body>
<div class="pbd-printbar">Print it, or choose “Save as PDF” as the printer. <button onclick="window.print()">Print / Save PDF</button></div>
${renderPlaybookDocument(doc, { ...o, mode: 'print' })}
<script>document.fonts&&document.fonts.ready?document.fonts.ready.then(function(){setTimeout(function(){window.print()},250)}):window.onload=function(){window.print()}</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Stylesheet (screen + print)                                         */
/* ------------------------------------------------------------------ */

export const PLAYBOOK_DOC_CSS = `
.pbd{--pb-primary:${DEFAULT_PALETTE.primary};--pb-primary-deep:${DEFAULT_PALETTE.primaryDeep};--pb-accent:${DEFAULT_PALETTE.accent};--ink:${DEFAULT_PALETTE.ink};--muted:${DEFAULT_PALETTE.muted};--line:${DEFAULT_PALETTE.line};--wash:${DEFAULT_PALETTE.wash};
  background:#fff;color:var(--ink);font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.65;
  -webkit-font-smoothing:antialiased;border-radius:4px;overflow:hidden;position:relative;text-align:left}
.pbd *{box-sizing:border-box}
.pbd-logo{display:block;height:auto;width:190px;max-width:48%}
.pbd-wordmark{display:block;font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:700;color:var(--pb-primary);max-width:60%}
.pbd-body{padding:28px 44px 12px;overflow-wrap:anywhere}
.pbd-muted{color:var(--muted)}

/* Internal documents: cover band */
.pbd-cover{padding:26px 44px 22px;border-bottom:3px solid var(--pb-accent);background:linear-gradient(180deg,#fff 0%,var(--wash) 100%)}
.pbd-cover-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}
.pbd-cover .pbd-logo{width:150px}
.pbd-eyebrow{display:flex;flex-direction:column;align-items:flex-end;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600;text-align:right}
.pbd-eyebrow b{color:var(--pb-accent);font-size:12px;letter-spacing:.12em;margin-top:2px}
.pbd-doc-title{font-family:Fraunces,Georgia,'Times New Roman',serif;font-weight:700;font-size:30px;line-height:1.15;color:var(--pb-primary);margin:0;text-wrap:balance;letter-spacing:-.01em}
.pbd-summary{margin:8px 0 0;color:var(--muted);font-size:15px;max-width:62ch}
.pbd-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.pbd-meta span{font-size:11.5px;font-weight:600;color:var(--pb-primary);background:#fff;border:1px solid var(--line);border-radius:999px;padding:2px 10px;text-transform:capitalize}

/* Rep-only notes above a letter (screen only) */
.pbd-notes{background:#fff8e6;border-bottom:1px solid #f0dfae;padding:14px 44px 4px;font-size:13.5px}
.pbd-notes .pbd-p,.pbd-notes .pbd-list li{max-width:none}
.pbd-notes-label{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#8a5a00;margin-bottom:8px}
.pbd-notes .pbd-callout{background:#fff;border-color:#f0dfae}
@media (max-width:640px){.pbd-notes{padding:12px 18px 2px}}

/* Letters: letterhead */
.pbd-letterhead{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:30px 48px 14px}
.pbd-letterhead address{font-style:normal;font-size:12px;line-height:1.55;color:var(--muted);text-align:right}
.pbd-letterhead address b{color:var(--pb-primary);font-size:13px}
.pbd-bars{padding:0 48px}.pbd-bars i{display:block;height:3px;background:var(--pb-accent);border-radius:2px}.pbd-bars i+i{height:5px;background:var(--pb-primary);margin-top:3px}
.pbd--letter .pbd-body{padding:30px 60px 12px;font-size:15.5px}
.pbd--letter .pbd-title{text-align:center}

/* Emails: envelope + mail header */
.pbd-envelope{background:var(--wash);border-bottom:1px solid var(--line);padding:12px 20px;font-size:13px}
.pbd-envelope div{display:flex;gap:10px;padding:2px 0}
.pbd-envelope span{width:58px;flex-shrink:0;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;padding-top:2px}
.pbd-subject{font-weight:600;color:var(--pb-primary)}
.pbd-mailhead{padding:22px 36px 14px;border-bottom:3px solid var(--pb-accent)}
.pbd-mailhead .pbd-logo{width:170px}
.pbd--email .pbd-body{padding:26px 36px 8px}
.pbd-mailfoot{background:var(--pb-primary);color:#fff;padding:14px 36px;font-size:12.5px}
.pbd-mailfoot p{margin:0}.pbd-mailfoot .pbd-cred{color:#c9d0e6;margin-top:4px;text-align:left}

/* Body typography */
.pbd-title{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:27px;line-height:1.2;color:var(--pb-primary);margin:0 0 16px;text-wrap:balance}
.pbd-h2{font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--pb-accent);font-weight:700;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--line)}
.pbd-h3{font-family:Fraunces,Georgia,serif;font-size:19px;line-height:1.3;color:var(--pb-primary);font-weight:600;margin:22px 0 6px;text-wrap:balance}
.pbd-body>:first-child{margin-top:0}
.pbd-p{margin:0 0 14px;max-width:72ch}
.pbd-salutation{margin-top:6px}
.pbd-ps{color:var(--muted);font-style:italic;margin-top:18px}
.pbd-say{position:relative;background:var(--wash);border-left:4px solid var(--pb-primary);border-radius:0 10px 10px 0;padding:12px 16px 12px 18px;max-width:none}
.pbd-lead{margin:22px 0 10px;max-width:72ch}
.pbd-lead-label{display:inline-block;background:var(--pb-primary);color:#fff;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;border-radius:4px;padding:2px 8px;margin-right:8px;vertical-align:2px}
.pbd-callout{background:#fbf1f0;border:1px solid #efd3d0;border-radius:10px;padding:10px 16px;margin:0 0 16px;font-size:14.5px}
.pbd-callout-label{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--pb-accent);font-weight:700;margin-bottom:2px}
.pbd-rule{border:0;border-top:1px solid var(--line);margin:20px 0}
.pbd-or{display:flex;align-items:center;gap:10px;margin:4px 0 14px;color:var(--muted);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}
.pbd-or:before,.pbd-or:after{content:'';flex:1;border-top:1px dashed var(--line)}
.pbd-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 16px}
.pbd-links-label{font-size:12px;color:var(--muted);margin-right:4px}
.pbd-links .pbd-link{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;text-decoration:none;color:var(--pb-primary);border:1px solid var(--line);border-radius:999px;padding:3px 12px 3px 10px;background:#fff}
.pbd-links .pbd-link:before{content:'▶';font-size:9px;color:var(--pb-accent)}
.pbd-link{color:var(--pb-primary);text-decoration:underline;text-underline-offset:2px}
.pbd-tags{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 18px}
.pbd-tags span{border:1.5px solid var(--pb-primary);border-radius:8px;padding:4px 12px;font-weight:600;color:var(--pb-primary);font-size:14px}
.pbd-tags b{color:var(--pb-accent);font-family:Fraunces,Georgia,serif;font-size:17px}
.pbd-signoff{margin:26px 0 16px;line-height:1.55}
.pbd-sig-name{display:inline-block;font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;color:var(--pb-primary);margin-top:14px}
.pbd strong{color:var(--pb-primary)}
mark.pbd-blank{background:#fdf0c4;color:#7a4b00;border-radius:4px;padding:0 3px;font-weight:500}
span.pbd-blank{display:inline-block;min-width:1.6in;border-bottom:1px solid #8a90a0;color:#9aa0ad;font-size:.7em;line-height:1.2;vertical-align:baseline;padding:0 4px}
.pbd-fill{display:inline-block;min-width:1.1in;border-bottom:1px solid #8a90a0;height:1em;vertical-align:baseline;margin:0 2px}
.pbd-gap{display:inline-block;width:1.4em}

/* Lists */
.pbd-list{margin:0 0 16px;padding-left:22px}
.pbd-list .pbd-list{margin:6px 0 4px}
.pbd-list li{margin:0 0 7px;padding-left:4px;max-width:72ch}
ul.pbd-list>li::marker{color:var(--pb-accent);font-size:1.05em}
ul.pbd-list.pbd-d1>li::marker{color:var(--pb-primary)}
ul.pbd-list.pbd-d1{list-style:circle}ul.pbd-list.pbd-d2{list-style:square}
ol.pbd-list>li::marker{color:var(--pb-accent);font-weight:700;font-family:Fraunces,Georgia,serif}
.pbd-checks{list-style:none;padding-left:0}
.pbd-checks .pbd-checks{padding-left:28px}
.pbd-check-item{display:flex;gap:10px;align-items:flex-start;padding:7px 0 7px;margin:0!important;border-bottom:1px solid #eef0f5}
.pbd-check-item:last-child{border-bottom:0}
.pbd-box{flex-shrink:0;width:20px;height:20px;margin-top:2px;border:2px solid var(--pb-primary);border-radius:5px;background:#fff;color:#fff;font:700 12px/16px Inter,Arial,sans-serif;text-align:center;padding:0;cursor:pointer}
.pbd-check-item.is-done .pbd-box{background:var(--pb-primary)}
.pbd-check-item.is-done>span:last-child{color:#8a90a0;text-decoration:line-through;text-decoration-color:#b9bfcc}
button.pbd-box:focus-visible{outline:3px solid #9fb3ea;outline-offset:2px}

/* Footers */
.pbd-foot{margin-top:18px;padding:14px 44px 18px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 16px}
.pbd-foot p{margin:0}.pbd-foot b{color:var(--pb-primary)}
.pbd-foot--letter{display:block;text-align:center;padding:14px 48px 22px;border-top:0;position:relative}
.pbd-foot--letter:before{content:'';display:block;height:3px;background:var(--pb-accent);margin:0 0 12px;border-radius:2px}
.pbd-cred{margin:0 0 3px;font-size:11.5px;color:var(--pb-primary);font-weight:500;text-align:center}

/* Small screens */
@media (max-width:640px){
  .pbd-body,.pbd--letter .pbd-body,.pbd--email .pbd-body{padding:20px 18px 8px}
  .pbd-cover{padding:18px 18px 16px}.pbd-doc-title{font-size:24px}
  .pbd-letterhead{flex-direction:column;align-items:flex-start;padding:20px 18px 12px}.pbd-letterhead address{text-align:left}
  .pbd-bars{padding:0 18px}.pbd-mailhead{padding:16px 18px 10px}.pbd-mailfoot{padding:12px 18px}
  .pbd-foot,.pbd-foot--letter{padding:12px 18px 16px}.pbd-title{font-size:23px}
}

/* Paper */
@media print{
  @page{size:letter;margin:.55in .6in}
  .pbd{border-radius:0;font-size:11pt}
  .pbd--letter .pbd-body{font-size:11.5pt;padding:22px 30px 8px}
  .pbd-letterhead{padding:0 0 10px}.pbd-bars{padding:0}.pbd-foot--letter{padding:14px 0 0}
  .pbd-cover{padding:0 0 16px;background:none}.pbd-body{padding:20px 0 6px}.pbd-foot{padding:10px 0 0}
  .pbd-mailhead{padding:0 0 10px}.pbd--email .pbd-body{padding:18px 0 6px}
  .pbd-say,.pbd-callout,.pbd-check-item,.pbd-signoff,.pbd-lead{break-inside:avoid}
  .pbd-h2,.pbd-h3,.pbd-title{break-after:avoid}
  .pbd-say{background:#f4f6fb!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .pbd-lead-label,.pbd-mailfoot,.pbd-bars i,.pbd-check-item.is-done .pbd-box{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  a.pbd-link{text-decoration:none;color:var(--pb-primary)}
}
`;
