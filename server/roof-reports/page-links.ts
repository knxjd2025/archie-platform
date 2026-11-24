/**
 * Where a saved report page may point a reader.
 *
 * A page a person saved is served at the customer's share address under the
 * company's brand. A link in it that goes to a host of someone's choosing is a
 * phishing link wearing the company's name, and a remote stylesheet or picture
 * is a beacon that tells its owner who opened the page. So a saved page may
 * point only at:
 *
 *   links (a, area)   the app itself, a fragment, a relative address, tel:,
 *                     mailto:, and the company's OWN website (exact origin,
 *                     from its brand record)
 *   pictures          the app itself, a relative address, a small inline
 *                     picture, the company's logo origin and its website
 *   <link>            the app itself, Google Fonts (styles and fonts), a small
 *                     inline icon
 *   CSS url(), @import  the app itself, the logo origin, Google Fonts, a small
 *                     inline picture or font
 *
 * and never at a form target, a <base>, a refresh, a ping or a script scheme.
 *
 * The same rule runs twice: when a page is saved (`findPageLinkProblems`, the
 * save is refused with a sentence) and again when it is served
 * (`stripPageLinks`, which takes the offending piece out and keeps everything
 * else), so a page saved before the rule existed is still safe to show.
 *
 * The page is read the way a browser reads it: tags and attributes as the HTML
 * rules split them (any case, `/` as a separator, quoted or not), character
 * references and CSS escapes decoded first, tabs and newlines dropped from an
 * address, an address resolved against the app's origin so `//host`, `\\host`
 * and `/\host` are seen as the other host they are.
 */

export interface PageLinkContext {
  /** The origin the app is reached at. */
  appOrigin: string;
  /** The company's website as its profile holds it, or ''. Only its origin is used. */
  website: string;
  /** The company's logo address, or ''. Only its origin is used, and only for pictures. */
  logoUrl: string;
}

export interface PageLinkProblem {
  /** The host the page pointed at, as a plain lower-case host, or null when it was not a host (a script scheme, a form, a refresh). */
  host: string | null;
}

type Use = 'nav' | 'link' | 'media' | 'css';

const FONTS_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const BASE_FALLBACK = 'https://page.invalid';

// ---------------------------------------------------------------------------
// Reading values the way a browser does
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', apos: "'", colon: ':', Tab: '\t', NewLine: '\n', sol: '/', bsol: '\\',
  lpar: '(', rpar: ')', period: '.', comma: ',', semi: ';', excl: '!', num: '#', percnt: '%', equals: '=', quest: '?', commat: '@', dollar: '$',
  ast: '*', midast: '*', plus: '+', lsqb: '[', lbrack: '[', rsqb: ']', rbrack: ']', Hat: '^', lowbar: '_', UnderBar: '_', grave: '`', lcub: '{',
  lbrace: '{', verbar: '|', vert: '|', VerticalLine: '|', rcub: '}', rbrace: '}', nbsp: '\u00a0',
};

/** Character references in an attribute value: numeric ones (with or without the closing `;`) and the named ones that stand for plain ASCII. */
export function decodeEntities(value: string): string {
  return value.replace(/&(?:#(x[0-9a-f]+|[0-9]+);?|([A-Za-z]+);)/gi, (whole, num: string | undefined, name: string | undefined) => {
    if (num) {
      const code = num[0] === 'x' || num[0] === 'X' ? Number.parseInt(num.slice(1), 16) : Number.parseInt(num, 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
      return String.fromCodePoint(code);
    }
    return name !== undefined && Object.hasOwn(NAMED, name) ? NAMED[name] : whole;
  });
}

/** CSS with its comments taken out and its escapes (`\75 rl`) turned into the characters they stand for. */
function readCss(css: string): string {
  const noComments = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');
  return noComments.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f0-9a-fA-F]))/g, (_m, hex: string | undefined, ch: string | undefined) => {
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
    }
    return ch ?? '';
  });
}

const originOf = (value: string): string | null => {
  if (!value) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
};

interface Allowed { base: string; app: string; website: string | null; logo: string | null }

function allowedFor(ctx: PageLinkContext): Allowed {
  const app = originOf(ctx.appOrigin);
  const website = originOf(ctx.website);
  const logo = ctx.logoUrl.startsWith('https://') ? originOf(ctx.logoUrl) : null;
  return { base: app ?? BASE_FALLBACK, app: app ?? BASE_FALLBACK, website, logo };
}

const INLINE_PICTURE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
const INLINE_FONT = /^data:(?:font\/[a-z0-9.+-]+|application\/(?:x-)?font-[a-z0-9.+-]+|application\/vnd\.ms-fontobject);base64,[A-Za-z0-9+/=]+$/i;
const INLINE_ICON = /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i;

type Verdict = { ok: true } | { ok: false; host: string | null };
const OK: Verdict = { ok: true };
const NO = (host: string | null = null): Verdict => ({ ok: false, host });

const INVISIBLE = /[\u0000-\u001f\u007f-\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/;

/** One address, judged for what it is used for. The value is the attribute's text after character references are decoded. */
function judge(raw: string, use: Use, allowed: Allowed): Verdict {
  // A browser drops tabs and newlines anywhere in an address and trims the ends.
  const v = raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  if (v === '') return OK;
  // Whitespace or an odd invisible character where a scheme would be: a trick, never an address.
  const head = v.split(/[/?#\\]/, 1)[0];
  const colon = head.indexOf(':');
  if (colon >= 0 && (/\s/.test(head.slice(0, colon)) || INVISIBLE.test(head.slice(0, colon)))) return NO();

  let u: URL;
  try {
    u = new URL(v, allowed.base.endsWith('/') ? allowed.base : `${allowed.base}/`);
  } catch {
    return NO();
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    const origins: Array<string | null> = [allowed.app];
    if (use === 'nav') origins.push(allowed.website);
    if (use === 'media') origins.push(allowed.logo, allowed.website);
    if (use === 'link') origins.push(...FONTS_ORIGINS);
    if (use === 'css') origins.push(allowed.logo, allowed.website, ...FONTS_ORIGINS);
    return origins.includes(u.origin) ? OK : NO(u.hostname.toLowerCase());
  }
  if (u.protocol === 'tel:' || u.protocol === 'mailto:') return use === 'nav' ? OK : NO();
  if (u.protocol === 'data:') {
    if (use === 'media') return INLINE_PICTURE.test(v) ? OK : NO();
    if (use === 'css') return INLINE_PICTURE.test(v) || INLINE_FONT.test(v) ? OK : NO();
    if (use === 'link') return INLINE_ICON.test(v) ? OK : NO();
  }
  return NO();
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

interface CssResult { problems: PageLinkProblem[]; cleaned: string }

const URL_FN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
const IMPORT_RULE = /@import\b[^;{}]*(?:;|(?=[{}])|$)/gi;
const EXOTIC_FN = /(?:-webkit-)?(?:image-set|cross-fade|element|paint)\s*\([^)]*\)/gi;
const SCRIPTY_CSS = /expression\s*\([^)]*\)|(?:^|[;{\s])behavior\s*:[^;}]*|-moz-binding\s*:[^;}]*/gi;

/** What a piece of CSS points at, and the same CSS with each such piece taken out. The original text is only replaced when something was wrong. */
function checkCss(css: string, allowed: Allowed): CssResult {
  const text = readCss(css);
  const problems: PageLinkProblem[] = [];
  let cleaned = text;

  cleaned = cleaned.replace(IMPORT_RULE, (rule) => {
    const m = /@import\s*(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|"([^"]*)"|'([^']*)')/i.exec(rule);
    const target = m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '') : '';
    const verdict = m ? judge(decodeEntities(target), 'css', allowed) : NO();
    if (verdict.ok) return rule;
    problems.push({ host: verdict.host });
    return '';
  });
  cleaned = cleaned.replace(URL_FN, (call, a: string | undefined, b: string | undefined, c: string | undefined) => {
    const verdict = judge(a ?? b ?? c ?? '', 'css', allowed);
    if (verdict.ok) return call;
    problems.push({ host: verdict.host });
    return 'none';
  });
  cleaned = cleaned.replace(EXOTIC_FN, () => { problems.push({ host: null }); return 'none'; });
  cleaned = cleaned.replace(SCRIPTY_CSS, (m) => { problems.push({ host: null }); return /^[;{\s]/.test(m) ? m[0] : ''; });
  return { problems, cleaned: problems.length ? cleaned : css };
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

interface Attr { name: string; value: string; start: number; end: number }
interface Tag { name: string; attrs: Attr[]; start: number; end: number }

const SPACE = /[\t\n\f\r ]/;

/** The attributes of a start tag, split the way the HTML rules split them. `from`/`to` bound the text between the tag name and the closing `>`. */
function readAttrs(src: string, from: number, to: number): Attr[] {
  const out: Attr[] = [];
  let i = from;
  while (i < to) {
    while (i < to && (SPACE.test(src[i]) || src[i] === '/')) i++;
    if (i >= to) break;
    const start = i;
    let name = '';
    if (src[i] === '=') { name = '='; i++; }
    while (i < to && !SPACE.test(src[i]) && src[i] !== '/' && src[i] !== '=') name += src[i++];
    let j = i;
    while (j < to && SPACE.test(src[j])) j++;
    let value = '';
    if (src[j] === '=') {
      j++;
      while (j < to && SPACE.test(src[j])) j++;
      if (src[j] === '"' || src[j] === "'") {
        const q = src[j];
        const close = src.indexOf(q, j + 1);
        const stop = close === -1 || close >= to ? to : close;
        value = src.slice(j + 1, stop);
        i = Math.min(to, stop + 1);
      } else {
        const s = j;
        while (j < to && !SPACE.test(src[j])) j++;
        value = src.slice(s, j);
        i = j;
      }
    }
    out.push({ name: name.toLowerCase(), value, start, end: i });
  }
  return out;
}

const TOKEN = /<!--(?:-?>|[\s\S]*?--!?>)|<[!?][^>]*>|<\/[^>]*>|<([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

interface Piece { kind: 'tag'; tag: Tag }
interface Style { kind: 'style'; start: number; end: number; css: string }

/** Every start tag of the page, and the text of every style block (read as CSS, never as tags). */
function walk(html: string): Array<Piece | Style> {
  const out: Array<Piece | Style> = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (m[1] === undefined) continue;
    const name = m[1].toLowerCase();
    const start = m.index;
    const end = start + m[0].length;
    const attrsFrom = start + 1 + m[1].length;
    const attrsTo = end - 1;
    out.push({ kind: 'tag', tag: { name, attrs: readAttrs(html, attrsFrom, attrsTo), start, end } });
    if (name === 'style') {
      const close = /<\/style(?=[\s/>])/gi;
      close.lastIndex = end;
      const c = close.exec(html);
      const cssEnd = c ? c.index : html.length;
      out.push({ kind: 'style', start: end, end: cssEnd, css: html.slice(end, cssEnd) });
      TOKEN.lastIndex = cssEnd;
    } else if (name === 'script' || name === 'textarea' || name === 'title' || name === 'xmp' || name === 'noembed' || name === 'noframes') {
      // Text, not markup, up to the matching close: a tag-looking piece in it is not a tag.
      const close = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
      close.lastIndex = end;
      const c = close.exec(html);
      TOKEN.lastIndex = c ? c.index : html.length;
    }
  }
  return out;
}

const NEVER = new Set(['ping', 'formaction', 'action']);
const SRC_ATTRS = new Set(['src', 'poster', 'background', 'data', 'longdesc', 'cite', 'manifest', 'codebase', 'icon', 'profile', 'archive', 'lowsrc', 'dynsrc', 'xlink:href', 'usemap']);

/** The candidate addresses of a srcset, read as the HTML rules read it. */
function srcsetUrls(value: string): string[] {
  const urls: string[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (SPACE.test(value[i]) || value[i] === ',')) i++;
    if (i >= value.length) break;
    const s = i;
    while (i < value.length && !SPACE.test(value[i])) i++;
    let url = value.slice(s, i);
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else while (i < value.length && value[i] !== ',') i++;
    if (url) urls.push(url);
  }
  return urls;
}

interface Edit { start: number; end: number; text: string }

function inspect(html: string, ctx: PageLinkContext): { problems: PageLinkProblem[]; edits: Edit[] } {
  const allowed = allowedFor(ctx);
  const problems: PageLinkProblem[] = [];
  const edits: Edit[] = [];
  const bad = (host: string | null) => problems.push({ host });

  for (const piece of walk(html)) {
    if (piece.kind === 'style') {
      const r = checkCss(piece.css, allowed);
      if (r.problems.length) { problems.push(...r.problems); edits.push({ start: piece.start, end: piece.end, text: r.cleaned }); }
      continue;
    }
    const { tag } = piece;
    const attr = (n: string) => tag.attrs.find((a) => a.name === n);
    // Whole tags that move a reader or send a form: taken out entirely.
    if (tag.name === 'base' || tag.name === 'form' || (tag.name === 'meta' && attr('http-equiv'))) {
      bad(null);
      edits.push({ start: tag.start, end: tag.end, text: '' });
      continue;
    }
    let dropTag = false;
    for (const a of tag.attrs) {
      const value = decodeEntities(a.value);
      let verdict: Verdict = OK;
      if (a.name === 'href') {
        const use: Use = tag.name === 'a' || tag.name === 'area' ? 'nav' : tag.name === 'link' ? 'link' : 'media';
        verdict = judge(value, use, allowed);
        if (!verdict.ok && tag.name === 'link') { bad(verdict.host); dropTag = true; continue; }
      } else if (NEVER.has(a.name)) {
        verdict = value.trim() === '' ? OK : NO();
      } else if (SRC_ATTRS.has(a.name)) {
        verdict = judge(value, 'media', allowed);
      } else if (a.name === 'srcset' || a.name === 'imagesrcset') {
        for (const u of srcsetUrls(value)) {
          const v = judge(u, 'media', allowed);
          if (!v.ok) { verdict = v; break; }
        }
      } else if (a.name === 'style') {
        const r = checkCss(value, allowed);
        if (r.problems.length) {
          problems.push(...r.problems);
          edits.push({ start: a.start, end: a.end, text: `style="${r.cleaned.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` });
        }
        continue;
      }
      if (!verdict.ok) {
        bad(verdict.host);
        edits.push({ start: a.start, end: a.end, text: '' });
      }
    }
    if (dropTag) edits.push({ start: tag.start, end: tag.end, text: '' });
  }
  return { problems, edits };
}

/** Everything in the page that points where it may not. Empty when the page is fine. */
export function findPageLinkProblems(html: string, ctx: PageLinkContext): PageLinkProblem[] {
  return inspect(html, ctx).problems;
}

/** The page with each piece that points where it may not taken out, and everything else exactly as it was. */
export function stripPageLinks(html: string, ctx: PageLinkContext): string {
  let out = html;
  // One pass can reveal what an earlier piece hid; a few passes at most.
  for (let pass = 0; pass < 3; pass++) {
    const { edits } = inspect(out, ctx);
    if (edits.length === 0) return out;
    // An edit inside a tag that is removed whole is covered by that removal.
    const whole = edits.filter((e) => !edits.some((o) => o !== e && o.start <= e.start && o.end >= e.end && (o.start < e.start || o.end > e.end)));
    for (const e of [...whole].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
