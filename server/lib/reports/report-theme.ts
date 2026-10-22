/**
 * Shared premium "flowing document" theme for reports (inspection,
 * proposal, combined). One CSS block + a document shell + small formatters,
 * so all three report types look like one product. The company's name, logo
 * and colors come from its profile at render time (company-brand.ts).
 */

import { brandStyleTag, companyBrand, documentMetaTags } from './company-brand.js';
import { MOBILE_CSS, MOBILE_JS } from './sections/mobile.js';

export const THEME_CSS = `
  :root{--paper:#FBF7F1;--card:#fff;--ink:#211A14;--muted:#6B6055;--line:#E7DECF;--red:#C8102E;--fire:#EE4B2B;--green:#2E7D52;--gold:#B8860B;color-scheme:light}
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{background:var(--paper);color:var(--ink);font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  .page{max-width:940px;margin:0 auto;padding:0 22px 60px}
  h1,h2,h3,.disp{font-family:'Fraunces',Georgia,serif;font-weight:600;letter-spacing:-.01em;line-height:1.12}
  .muted{color:var(--muted)}.tiny{font-size:12.5px}
  section{margin-top:46px}
  .sec-head{display:flex;align-items:baseline;gap:12px;border-bottom:2px solid var(--red);padding-bottom:8px;margin-bottom:20px}
  .sec-head h2{font-size:25px;margin:0}.sec-head .n{font-size:12.5px;color:var(--muted);font-weight:600;margin-left:auto}
  .lead{font-size:16px;color:#3f372f}

  .hero{background:linear-gradient(135deg,#1c140f,#2c1d14 60%,#3a2114);color:#fff;border-radius:0 0 26px 26px;padding:36px 38px 30px;position:relative;overflow:hidden}
  .hero::after{content:"";position:absolute;right:-60px;top:-60px;width:240px;height:240px;background:radial-gradient(circle,var(--fire),transparent 70%);opacity:.35}
  .hero__brand{font-size:13px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;opacity:.92}
  .hero h1{font-size:42px;margin:14px 0 6px;color:#fff}
  .hero__for{font-size:18px;color:#F4D9C9}
  .hero__promise{margin-top:14px;font-family:'Fraunces',serif;font-style:italic;font-size:18px;color:#fff;opacity:.95}
  .hero__meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:16px;font-size:13.5px;opacity:.92}.hero__meta b{color:#fff}
  .hero__sat{margin-top:22px;border-radius:14px;overflow:hidden;position:relative;border:1px solid rgba(255,255,255,.18)}
  .hero__sat img{display:block;width:100%}.hero__sattag{position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:4px 9px;border-radius:999px}

  .values{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .value{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--red);border-radius:14px;padding:16px}
  .value b{font-family:'Fraunces',serif;font-size:16px;display:block;margin-bottom:6px}.value span{font-size:13px;color:var(--muted)}
  .owner{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px 26px}
  .owner h3{font-size:20px;margin:0 0 4px}.owner p{margin:8px 0 0;color:#3f372f}
  .owner .sig{font-family:'Fraunces',serif;font-style:italic;font-size:17px;margin-top:14px;color:var(--ink)}

  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
  .stat .v{font-family:'Fraunces',serif;font-size:30px;font-weight:600;line-height:1}.stat .k{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-top:6px}

  .prod{display:grid;grid-template-columns:300px 1fr;gap:22px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-bottom:18px}
  .prod--rev{grid-template-columns:1fr 300px}.prod--rev .prod__img{order:2}
  .prod__img{min-height:230px;height:100%;background-size:cover;background-position:center}
  .prod__txt{padding:22px 24px}
  .prod__tier{font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}
  .prod__txt h3{font-size:23px;margin:4px 0 2px}.prod__tag{font-family:'Fraunces',serif;font-size:15px;color:var(--muted);margin-bottom:10px}
  .prod__txt p{margin:0;font-size:14px;color:#3f372f}

  .roofstrip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  .roofstrip img{width:100%;height:150px;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
  .palette{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:16px}
  .palette h3{font-size:17px;margin:0 0 4px}.palette p{margin:0 0 14px;font-size:13px;color:var(--muted)}
  .palette .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .palette img{width:100%;border-radius:10px;border:1px solid var(--line)}
  .fineprint{font-size:11px;color:#9a9082;margin-top:10px}

  .system{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .sysrow{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .sysrow b{display:block;font-size:14px}.sysrow span{font-size:12.5px;color:var(--muted)}

  .warr{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:center;background:linear-gradient(135deg,#2c1d14,#3a2114);color:#fff;border-radius:18px;padding:26px 28px}
  .warr h2{color:#fff;font-size:26px;margin:0 0 8px}.warr p{color:#EAD9CC;font-size:14px;margin:0}
  .warr__badges{display:flex;gap:16px;flex-wrap:wrap}
  .badge{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:16px 18px;text-align:center;flex:1;min-width:150px}
  .badge .num{font-family:'Fraunces',serif;font-size:34px;font-weight:700;color:#fff}.badge .lbl{font-size:12px;color:#EAD9CC;letter-spacing:.04em}

  .tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .tier{position:relative;background:var(--card);border:1px solid var(--line);border-top:5px solid var(--accent);border-radius:16px;padding:22px 20px;text-align:center}
  .tier--rec{box-shadow:0 12px 30px -12px rgba(184,134,11,.5);border-color:var(--accent)}
  .ribbon{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 11px;border-radius:999px}
  .tier__name{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700}
  .tier__shingle{font-family:'Fraunces',serif;font-size:18px;font-weight:600;margin:4px 0 12px}
  .tier__price{font-family:'Fraunces',serif;font-size:36px;font-weight:700;line-height:1}
  .tier__rate{font-size:12.5px;color:var(--muted);margin:4px 0 12px}
  .tier__warranty{font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px}

  table{width:100%;display:block;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:14px;font-size:13.5px;margin-top:16px}
  thead th{background:#2c1d14;color:#fff;padding:12px 14px;text-align:center;font-weight:600;font-size:13px}thead th:first-child{text-align:left}
  tbody td{padding:10px 14px;border-top:1px solid var(--line);text-align:center}tbody td:first-child{text-align:left;color:#3f372f}
  td.yes{color:var(--green);font-weight:700;font-size:16px}td.no{color:#bdb3a4}td.val{font-weight:600}tbody tr:nth-child(even){background:#FCFAF6}

  .cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .photo{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .photo img{width:100%;height:170px;object-fit:cover;display:block}
  .photo .cap{padding:10px 12px;font-size:12.5px}
  .sev{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;text-transform:capitalize}
  .photogrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .photogrid img{width:100%;height:180px;object-fit:cover;border-radius:12px;border:1px solid var(--line);display:block;background:#EFE7DA}
  .findings{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--red);border-radius:14px;padding:18px 22px;margin-bottom:18px}
  .findings h3{font-size:18px;margin:0 0 8px}
  .findings-h{border-left:3px solid var(--red);padding-left:11px}
  .findings .fg{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-top:10px}
  .findings .fi{font-size:13px;color:#3f372f;display:flex;align-items:center;gap:8px}

  .cred{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  .cred span{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600}
  .accept{background:#2c1d14;color:#fff;border-radius:18px;padding:26px 28px;margin-top:42px}
  .accept h2{color:#fff;font-size:24px;margin:0 0 6px}.accept p{color:#EAD9CC;font-size:13.5px;margin:0 0 18px}
  .cta{display:inline-block;background:var(--fire);color:#fff;font-weight:700;padding:11px 20px;border-radius:10px;text-decoration:none;font-size:14px}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:24px}.sigline{border-top:1.5px solid rgba(255,255,255,.5);padding-top:8px;font-size:12px;color:#EAD9CC}
  footer{margin-top:34px;text-align:center;color:var(--muted);font-size:12px;line-height:1.7}

  .brandfoot{max-width:940px;margin:30px auto 0;padding:26px 22px 50px;text-align:center}
  .brandfoot__logo{height:54px;margin-bottom:14px}
  .brandfoot h3{font-size:18px;margin:0 0 4px}
  .brandfoot .awards{display:flex;flex-wrap:wrap;gap:18px;justify-content:center;align-items:center;margin:14px 0 24px}
  .brandfoot .awards img{height:90px;width:auto;filter:drop-shadow(0 6px 14px rgba(60,40,20,.18))}
  .brandfoot .socials{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px}
  .brandfoot .soc{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-size:13px;font-weight:600;color:var(--ink);text-decoration:none}
  .brandfoot .soc span{display:block;font-size:11px;color:var(--muted);font-weight:500;margin-top:2px;word-break:break-all}

  .print-btn{position:fixed;top:14px;right:14px;z-index:9999;background:var(--red);color:#fff;border:none;border-radius:9px;padding:9px 15px;font:600 13px/1 'Inter',-apple-system,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22);display:inline-flex;align-items:center;gap:6px}
  .print-btn:hover{filter:brightness(1.08)}
  @media (max-width:780px){.values,.stats,.roofstrip,.cards3,.photogrid{grid-template-columns:repeat(2,1fr)}.tiers,.system,.warr,.palette .grid2,.findings .fg{grid-template-columns:1fr}.prod,.prod--rev{grid-template-columns:1fr}.prod--rev .prod__img{order:0}.hero h1{font-size:31px}.brandfoot .socials{grid-template-columns:1fr 1fr}.brandfoot .awards img{height:66px}.print-btn{top:10px;right:10px;padding:7px 12px;font-size:12px}}
  @media print{.print-btn{display:none!important}body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{max-width:100%;padding:0 10px}.hero{border-radius:0}section{break-inside:avoid}.tier,.stat,.sysrow,.prod,.palette,.warr,.value,.photo,.photogrid img,.findings,li,table,.accept,.brandfoot{break-inside:avoid}h2,h3,.findings-h,.sec-head{break-after:avoid}a[href]{color:inherit;text-decoration:none}@page{size:letter;margin:12mm}}
`;

export interface ShellOptions {
  title: string;
  /** Full hero block HTML (already rendered). */
  hero: string;
  /** Page body sections HTML. */
  body: string;
  /** Extra <head> content (e.g. a widget's own stylesheet link) — optional, defaults to none. */
  extraHead?: string;
  /** Extra <script> content injected at the end of <body> — optional, defaults to none. */
  extraScripts?: string;
}

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

/** Shared brand footer (logo, award badges, links) appended to every report. Parts the company has not entered are left out. */
export function brandFooter(): string {
  const p = companyBrand();
  const awards = p.awards
    .map((a) => `<img src="${esc(a.src)}" alt="${esc(a.alt)}"/>`)
    .join('');
  const socials = p.links
    .map((s) => `<a class="soc" href="${esc(s.url)}">${esc(s.label)}<span>${esc(s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span></a>`)
    .join('');
  if (!p.logoUrl && !awards && !socials) return '';
  return `<div class="brandfoot">
  ${p.logoUrl ? `<img class="brandfoot__logo" src="${esc(p.logoUrl)}" alt="${esc(p.displayName)}"/>` : ''}
  ${awards ? `<h3>Recognized for service</h3>
  <div class="awards">${awards}</div>` : ''}
  ${socials ? `<h3>Connect with ${esc(p.displayName)}</h3>
  <div class="socials">${socials}</div>` : ''}
</div>`;
}

export function premiumShell(opts: ShellOptions): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
<title>${esc(opts.title)}</title>
${documentMetaTags(opts.title)}
<meta name="theme-color" content="#2c1d14"/>
${FONTS}
<style>${THEME_CSS}</style>
${opts.extraHead || ''}
<style>${MOBILE_CSS}</style>
${brandStyleTag()}
</head>
<body>
<button class="print-btn" type="button" onclick="window.print()" aria-label="Print or save as PDF">&#9113; Print / Save PDF</button>
${opts.hero}
<div class="page">
${opts.body}
</div>
${brandFooter()}
${opts.extraScripts || ''}
<script>${MOBILE_JS}</script>
</body></html>`;
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&(?!(?:[a-zA-Z]+|#\d+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const usd = (n: number): string => '$' + Math.round(n || 0).toLocaleString('en-US');
export const usd2 = (n: number): string => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function checkCell(v: boolean | string): string {
  if (v === true) return '<td class="yes" aria-label="Included">&#10003;</td>';
  if (v === false) return '<td class="no" aria-label="Not included">&ndash;</td>';
  return `<td class="val">${esc(v)}</td>`;
}
