/**
 * Where a saved report page may point a reader (server/roof-reports/page-links.ts).
 * The page is served at the customer's share address under the company's brand,
 * so a link in it must be to the app itself, a fragment, a phone number, an email
 * address, the company's OWN website, or Google Fonts for styles and fonts.
 * Every other form is refused when the page is saved and taken out when it is
 * served. Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { describe, expect, it } from 'vitest';
import { findPageLinkProblems, stripPageLinks, type PageLinkContext } from '../page-links';

const ctx: PageLinkContext = { appOrigin: 'https://app.example.test', website: 'https://summitridge.example', logoUrl: 'https://cdn.summitridge.example/logo.png' };
const wrap = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body><h1>Roof report</h1>${body}<p>Kept words</p></body></html>`;

const FORBIDDEN: Array<[string, string]> = [
  ['an absolute link to another host', '<a href="https://evil.example/login">Pay</a>'],
  ['a link to another host over plain http', '<a href="http://evil.example/login">Pay</a>'],
  ['a protocol-relative link', '<a href="//evil.example/login">Pay</a>'],
  ['a mixed-case scheme and host', '<a href="HtTpS://EVIL.example/">Pay</a>'],
  ['leading whitespace before the scheme', '<a href="   https://evil.example/">Pay</a>'],
  ['a tab inside the scheme', '<a href="htt\tps://evil.example/">Pay</a>'],
  ['a newline entity inside the scheme', '<a href="htt&NewLine;ps://evil.example/">Pay</a>'],
  ['a space inside a script scheme', '<a href="java script:alert(1)">Pay</a>'],
  ['a control character inside the scheme', '<a href="jav\u0001ascript:alert(1)">Pay</a>'],
  ['javascript:', '<a href="javascript:alert(1)">Pay</a>'],
  ['JaVaScRiPt: with an entity tab', '<a href="JaVa&#x09;ScRiPt:alert(1)">Pay</a>'],
  ['javascript with entity letters and colon', '<a href="&#106;av&#x61;script&colon;alert(1)">Pay</a>'],
  ['vbscript:', '<a href="vbscript:msgbox(1)">Pay</a>'],
  ['a data: page in a link', '<a href="data:text/html;base64,PHNjcmlwdD4=">Pay</a>'],
  ['a data: page as an image source', '<img src="data:text/html,<p>x</p>">'],
  ['a blob: link', '<a href="blob:https://app.example.test/1234">Pay</a>'],
  ['a base tag', '<base href="https://evil.example/">'],
  ['a refresh meta tag', '<meta http-equiv="refresh" content="0;url=https://evil.example/">'],
  ['a refresh meta tag in capitals', '<META HTTP-EQUIV="Refresh" CONTENT="0;url=https://evil.example/">'],
  ['a form action', '<form action="https://evil.example/"><input name="a"></form>'],
  ['a button form action', '<button formaction="https://evil.example/">Go</button>'],
  ['a srcset candidate', '<img src="a.jpg" srcset="a.jpg 1x, https://evil.example/b.jpg 2x">'],
  ['a srcset with only another host', '<img srcset="https://evil.example/b.jpg">'],
  ['an image on another host', '<img src="https://evil.example/pixel.gif">'],
  ['a remote stylesheet', '<link rel="stylesheet" href="https://evil.example/x.css">'],
  ['a protocol-relative stylesheet', '<link rel="stylesheet" href="//evil.example/x.css">'],
  ['a stylesheet link with the rel in capitals', '<LINK REL="StyleSheet" HREF="https://evil.example/x.css">'],
  ['an import with url()', '<style>@import url("https://evil.example/x.css");</style>'],
  ['an import with a bare string', '<style>@import "https://evil.example/x.css";</style>'],
  ['a url() in a style block', '<style>p{background:url(https://evil.example/t.gif)}</style>'],
  ['a quoted url() with spaces in a style block', "<style>p{background:url( 'https://evil.example/t.gif' )}</style>"],
  ['a url() hidden with a CSS escape', '<style>p{background:\\75rl(https://evil.example/t.gif)}</style>'],
  ['a url() with a comment in the style block before it', '<style>/* x */p{background:url(https://evil.example/t.gif)}</style>'],
  ['an image-set string', '<style>p{background:image-set("https://evil.example/t.gif" 1x)}</style>'],
  ['a url() in a style attribute', '<div style="background:url(https://evil.example/t.gif)">x</div>'],
  ['a quoted entity url() in a style attribute', '<div style="background:url(&quot;https://evil.example/t.gif&quot;)">x</div>'],
  ['an import in a style attribute value', '<div style="background:url(//evil.example/t.gif)">x</div>'],
  ['a look-alike subdomain of the company website', '<a href="https://summitridge.example.evil.example/">x</a>'],
  ['credentials in front of the company host', '<a href="https://summitridge.example@evil.example/">x</a>'],
  ['the company host over plain http (not the exact origin)', '<a href="http://summitridge.example/">x</a>'],
  ['the company host on another port', '<a href="https://summitridge.example:8443/">x</a>'],
  ['a look-alike of the app host', '<a href="https://app.example.test.evil.example/">x</a>'],
  ['backslashes in place of slashes', '<a href="\\\\evil.example/x">x</a>'],
  ['a slash and a backslash', '<a href="/\\evil.example/x">x</a>'],
  ['an unquoted href', '<a href=https://evil.example/x>x</a>'],
  ['a slash used as the separator before href', '<a/href="https://evil.example/x">x</a>'],
  ['an upper-case HREF', '<A HREF="https://evil.example/x">x</A>'],
  ['a tag the comment tricks hide from a naive scan', '<!--><a href="https://evil.example/x">x</a><!-- -->'],
  ['a ping attribute', '<a href="#a" ping="https://evil.example/p">x</a>'],
  ['another host in a font stylesheet position of a nav link', '<a href="https://fonts.googleapis.com/css2?family=Inter">x</a>'],
];

const ALLOWED: Array<[string, string]> = [
  ['a fragment', '<a href="#roof">Roof</a>'],
  ['an empty href', '<a href="">x</a>'],
  ['a phone link', '<a href="tel:+15550100142">Call</a>'],
  ['a phone link in capitals', '<a href="TEL:5550100142">Call</a>'],
  ['an email link with a subject', '<a href="mailto:office@summitridge.example?subject=Roof%20Report">Email</a>'],
  ['the company website', '<a href="https://summitridge.example/contact">Contact</a>'],
  ['the app itself', '<a href="https://app.example.test/r/roof/abc">Open</a>'],
  ['a relative path', '<a href="/relative/path">x</a><a href="relative.html">y</a>'],
  ['the app\'s photo link', '<img src="https://app.example.test/api/roof-reports/linked-photo/abc.def">'],
  ['a relative image', '<img src="/api/roof-reports/linked-photo/abc">'],
  ['the company logo', '<img src="https://cdn.summitridge.example/logo.png">'],
  ['a small inline picture', '<img src="data:image/png;base64,iVBORw0KGgo=">'],
  ['a same-origin srcset', '<img src="a.jpg" srcset="a.jpg 1x, https://app.example.test/b.jpg 2x">'],
  ['a words-only mention of another address', '<p>Visit https://evil.example for more</p><a href="#a" title="https://evil.example">x</a>'],
  ['a style attribute with a same-origin url()', '<div style="background:url(https://app.example.test/api/roof-reports/linked-photo/abc);color:#333">x</div>'],
  ['a style attribute with no url', '<div style="color:#333;margin:0">x</div>'],
  ['a style block with nothing remote', '<style>p{color:#333;background:url(/a.png)}/* kept */</style>'],
];

const ALLOWED_HEAD: Array<[string, string]> = [
  ['a Google Fonts preconnect', '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'],
  ['a Google Fonts stylesheet', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=Geist:wght@400&display=swap">'],
  ['an inline icon', '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3C/svg%3E">'],
  ['a Google Fonts import and font file in a style block', '<style>@import url("https://fonts.googleapis.com/css2?family=Inter");@font-face{font-family:x;src:url(https://fonts.gstatic.com/s/inter.woff2)}</style>'],
];

describe('a saved page is checked for where it points a reader', () => {
  for (const [name, html] of FORBIDDEN) {
    it(`finds ${name}`, () => {
      expect(findPageLinkProblems(wrap(html), ctx).length, html).toBeGreaterThan(0);
    });
    it(`takes out ${name} when the page is served, keeping the rest`, () => {
      const served = stripPageLinks(wrap(html), ctx);
      expect(findPageLinkProblems(served, ctx), served).toEqual([]);
      expect(served).not.toMatch(/evil\.example/i);
      expect(served).not.toMatch(/javascript|vbscript/i);
      expect(served).toContain('<h1>Roof report</h1>');
      expect(served).toContain('<p>Kept words</p>');
    });
  }

  for (const [name, html] of ALLOWED) {
    it(`lets ${name} through untouched`, () => {
      expect(findPageLinkProblems(wrap(html), ctx), html).toEqual([]);
      expect(stripPageLinks(wrap(html), ctx)).toBe(wrap(html));
    });
  }
  for (const [name, head] of ALLOWED_HEAD) {
    it(`lets ${name} through untouched`, () => {
      expect(findPageLinkProblems(wrap('', head), ctx), head).toEqual([]);
      expect(stripPageLinks(wrap('', head), ctx)).toBe(wrap('', head));
    });
  }

  it('names the host that was found, as a plain host and nothing else', () => {
    const [p] = findPageLinkProblems(wrap('<a href="https://Evil.Example:444/a?b=c">x</a>'), ctx);
    expect(p.host).toBe('evil.example');
  });

  it('refuses the company\'s own website when the company has none on record, and a logo host only for pictures', () => {
    const none = { ...ctx, website: '', logoUrl: '' };
    expect(findPageLinkProblems(wrap('<a href="https://summitridge.example/">x</a>'), none).length).toBe(1);
    expect(findPageLinkProblems(wrap('<img src="https://cdn.summitridge.example/logo.png">'), none).length).toBe(1);
    expect(findPageLinkProblems(wrap('<a href="https://cdn.summitridge.example/logo.png">x</a>'), ctx).length).toBe(1);
  });

  it('keeps an allowed link next to a taken-out one', () => {
    const served = stripPageLinks(wrap('<a href="https://evil.example/x">bad</a><a href="tel:5550100142">good</a>'), ctx);
    expect(served).toContain('bad</a>');
    expect(served).toContain('<a href="tel:5550100142">good</a>');
  });
});
