/**
 * Making an Inspection easy to take in:
 *
 *   - "At a Glance": a colour bar of what is fine and what is not, a card for
 *     each thing that needs attention (each one opens that part on the roof
 *     drawing), what looks good, and a strip of the job's photos;
 *   - a sticky chapter bar built from the section headings;
 *   - tap any photo to see it big, swipe or arrow through the rest;
 *   - long reference sections folded away, opened for print.
 *
 * Every card comes from the inspector's own checklist answers.
 */
import { esc } from '../report-theme.js';
import { ASSEMBLY_STANDARDS } from '../damage-standards.js';
import { conditionItems, type Rating } from '../../../../shared/commercial-inspection-form.js';
import { SCAN_COMPONENT_RATING_FIELD } from '../commercial-photo-scan.js';
import { ans, type InspectionFactsContext } from './inspection-facts.js';
import { plainCommercialPart } from './roof-anatomy-flat.js';

type Tone = 'bad' | 'warn' | 'good' | 'unk';
interface Card { tone: Tone; title: string; text: string; part?: string; photo?: string | null; re?: RegExp }

const ICON: Record<Tone, string> = { bad: '!', warn: '!', good: '&#10003;', unk: '?' };

function meter(counts: Record<Tone, number>, labels: Record<Tone, string>): string {
  const total = counts.bad + counts.warn + counts.good + counts.unk;
  if (!total) return '';
  const seg = (t: Tone) => (counts[t] ? `<span class="gl-seg gl-seg--${t}" style="flex:${counts[t]}" title="${counts[t]} ${esc(labels[t])}"></span>` : '');
  const key = (t: Tone) => (counts[t] ? `<span class="gl-key"><i class="gl-dot gl-dot--${t}"></i><b>${counts[t]}</b> ${esc(labels[t])}</span>` : '');
  return `<div class="gl-meter" role="img" aria-label="${(['bad', 'warn', 'good', 'unk'] as Tone[]).filter((t) => counts[t]).map((t) => `${counts[t]} ${labels[t]}`).join(', ')}">
      <div class="gl-bar">${seg('bad')}${seg('warn')}${seg('good')}${seg('unk')}</div>
      <div class="gl-keys">${key('bad')}${key('warn')}${key('good')}${key('unk')}</div>
    </div>`;
}

function cardHtml(c: Card): string {
  const link = c.part ? `<a class="gl-go" href="#anat-${esc(c.part)}" data-anat-go="${esc(c.part)}">See it on the roof &rarr;</a>` : '';
  return `<article class="gl-card gl-card--${c.tone}">
      ${c.photo ? `<img class="gl-thumb" src="${esc(c.photo)}" alt="${esc(c.title)}" loading="lazy">` : `<span class="gl-ico" aria-hidden="true">${ICON[c.tone]}</span>`}
      <div><b>${esc(c.title)}</b><p>${esc(c.text)}</p>${link}</div>
    </article>`;
}

function photoStrip(photos: Array<{ url?: string; caption?: string | null }>, n = 8): string {
  const list = photos.filter((p) => p?.url).slice(0, n);
  if (!list.length) return '';
  return `<div class="gl-photos">${list.map((p, i) => `<img src="${esc(String(p.url))}" alt="${esc(p.caption || `Photo ${i + 1}`)}" loading="lazy">`).join('')}</div>
    <p class="muted tiny" style="margin:6px 0 0">Tap a photo to see it big. ${photos.length > n ? `All ${photos.length} photos are in the Photo Record at the end.` : ''}</p>`;
}

function glanceSection(note: string, body: string): string {
  return `<section class="gl">
    <div class="sec-head"><h2>At a Glance</h2><span class="n">${esc(note)}</span></div>
    ${body}
  </section>`;
}

/* ---------------------------------------------------------- residential --- */

const YES_ITEMS: Array<{ field: string; title: string; text: string; okTitle: string; part?: string; bad?: boolean; re: RegExp }> = [
  { field: 'Wind damage found', title: 'Wind damage', text: 'Shingles are lifted, creased or missing.', okTitle: 'No wind damage', part: 'covering', bad: true, re: /wind|lift|crease|missing/i },
  { field: 'Soft metal hits found', title: 'Hail dents on metal', text: 'Hail left dents on vents, gutters or other metal.', okTitle: 'No hail dents on metal', part: 'gutter', re: /dent|soft metal|gutter|vent/i },
  { field: 'Granule loss or accumulation in gutters and downspouts', title: 'Shingles losing grit', text: 'Grit from the shingles is washing into the gutters. That means they are wearing out.', okTitle: 'No grit loss', part: 'covering', re: /granule|grit/i },
  { field: 'Leaks or water damage in the attic or interior', title: 'Signs of a leak inside', text: 'We found water stains or damp spots inside.', okTitle: 'No leaks inside', bad: true, re: /leak|stain|attic|ceiling|water damage/i },
  { field: 'Siding damage', title: 'Siding damage', text: 'The siding has damage too.', okTitle: 'No siding damage', re: /siding/i },
  { field: 'Other exterior damage - windows, fencing, garage doors, AC units', title: 'Other damage outside', text: 'Windows, fences, doors or the AC unit have damage.', okTitle: 'No other outside damage', re: /window|fence|garage|ac unit|condenser/i },
];

const ASSEMBLY_PART: Record<string, string> = {
  'Drip edge': 'drip-edge', 'Felt or underlayment type': 'underlayment', 'Ice and water shield': 'ice-water',
  'Valley type': 'valley', 'Starter course present': 'starter',
};

/** At a Glance for a pitched-roof Inspection. */
export function residentialGlance(insp: InspectionFactsContext | null | undefined, photos: Array<{ url?: string; caption?: string | null }>): string {
  if (!insp?.answers || !Object.keys(insp.answers).length) return '';
  const attention: Card[] = [];
  const good: string[] = [];
  const counts: Record<Tone, number> = { bad: 0, warn: 0, good: 0, unk: 0 };

  const hail = ans(insp, 'Hail hits per test square by slope');
  if (hail && /\d/.test(hail) && !/^none\b/i.test(hail)) {
    attention.push({ tone: 'bad', title: 'Hail hits on the roof', text: `Hits counted per test square: ${hail}`, part: 'covering', re: /hail|test square|hit/i });
    counts.bad++;
  }
  for (const it of YES_ITEMS) {
    const v = ans(insp, it.field);
    if (!v) continue;
    if (/^yes\b/i.test(v)) { attention.push({ tone: it.bad ? 'bad' : 'warn', title: it.title, text: it.text, part: it.part, re: it.re }); counts[it.bad ? 'bad' : 'warn']++; }
    else if (/^no\b/i.test(v)) { good.push(it.okTitle); counts.good++; }
  }
  for (const s of ASSEMBLY_STANDARDS) {
    const v = ans(insp, s.field);
    if (!v) continue;
    const g = s.grade(v);
    if (g.status === 'attention') { attention.push({ tone: 'warn', title: s.label, text: g.note, part: ASSEMBLY_PART[s.field], re: new RegExp(s.label.split(/[ &]/)[0], 'i') }); counts.warn++; }
    else if (g.status === 'present') { good.push(s.label); counts.good++; }
    else counts.unk++;
  }
  // Cards with a photo of their own read faster: give each the first photo whose caption names it.
  const withPhoto = attention.map((c) => ({ ...c, photo: c.re ? photos.find((p) => p.url && p.caption && c.re!.test(p.caption))?.url ?? null : null }));
  const body = `${meter(counts, { bad: 'damage found', warn: 'need attention', good: 'look good', unk: 'not checked' })}
    ${withPhoto.length ? `<h3 class="gl-h">What needs attention</h3><div class="gl-cards">${withPhoto.map(cardHtml).join('')}</div>` : '<p class="gl-allgood">Nothing on the checklist needs attention.</p>'}
    ${good.length ? `<h3 class="gl-h">What looks good</h3><div class="gl-good">${good.map((g) => `<span>&#10003; ${esc(g)}</span>`).join('')}</div>` : ''}
    ${photoStrip(photos)}`;
  return glanceSection('The short version', body);
}

/* ----------------------------------------------------------- commercial --- */

const COMMERCIAL_PART: Record<string, string> = {
  'Membrane field condition': 'layer-membrane', 'Seams and laps': 'seams', 'Base flashings (walls and curbs)': 'base-flashing',
  'Parapet coping and wall caps': 'coping', 'Perimeter edge metal (fascia, gravel stop, drip edge)': 'edge',
  'Penetrations (pipes, pitch pockets, conduits)': 'penetrations', 'HVAC curbs and rooftop equipment': 'hvac',
  'Drains and strainers': 'drains', 'Skylights, hatches and smoke vents': 'skylights', 'Walkway pads and traffic protection': 'walkways',
  'Expansion joints': 'expansion',
};

/** The scan's part for each rated field — the photo a card shows. */
const FIELD_COMPONENT: Record<string, string> = Object.fromEntries(Object.entries(SCAN_COMPONENT_RATING_FIELD).map(([c, f]) => [f, c]));

const plainItem = (s: string) => s.replace(/\s*\(.*\)\s*$/, '');

/** At a Glance for a commercial Inspection: every rated part as a colour, the poor and failed ones as cards. */
export function commercialGlance(insp: InspectionFactsContext | null | undefined, photos: Array<{ url?: string; caption?: string | null; component?: string; scanned?: boolean }>): string {
  const a = (insp?.answers ?? {}) as Record<string, any>;
  const items = conditionItems(a).filter((c) => c.rating !== 'N/A');
  if (!items.length) return '';
  const tone = (r: Rating): Tone => (r === 'Failed' ? 'bad' : r === 'Poor' ? 'warn' : 'good');
  const counts: Record<Tone, number> = { bad: 0, warn: 0, good: 0, unk: 0 };
  items.forEach((c) => { counts[tone(c.rating)]++; });
  const fair = items.filter((c) => c.rating === 'Fair').length;
  const cards: Card[] = items.filter((c) => c.rating === 'Failed' || c.rating === 'Poor').map((c) => {
    const part = COMMERCIAL_PART[c.item];
    const component = FIELD_COMPONENT[c.item];
    const photo = component ? photos.find((p) => p.scanned && p.url && p.component === component)?.url ?? null : null;
    const plain = plainCommercialPart(c.item);
    return { tone: tone(c.rating), title: `${plain?.name ?? plainItem(c.item)}: ${c.rating}`, text: plain?.why ?? '', part, photo };
  });
  const good = items.filter((c) => c.rating === 'Good' || c.rating === 'Fair').map((c) => `${plainItem(c.item)}${c.rating === 'Fair' ? ' (fair)' : ''}`);
  const body = `${meter(counts, { bad: 'failed', warn: 'poor', good: fair ? 'good or fair' : 'good', unk: 'not checked' })}
    ${cards.length ? `<h3 class="gl-h">What needs attention</h3><div class="gl-cards">${cards.map(cardHtml).join('')}</div>` : '<p class="gl-allgood">No part of the roof was rated poor or failed.</p>'}
    ${good.length ? `<h3 class="gl-h">In good or fair shape</h3><div class="gl-good">${good.map((g) => `<span>&#10003; ${esc(g)}</span>`).join('')}</div>` : ''}
    ${photoStrip(photos)}`;
  return glanceSection('Every part we graded', body);
}

/* ------------------------------------------------------------- folding --- */

/** A long reference section, folded closed on screen and opened for print. */
export function fold(summary: string, inner: string): string {
  if (!inner) return '';
  return `<details class="fold"><summary>${esc(summary)}</summary><div class="fold-body">${inner}</div></details>`;
}

/* ------------------------------------------------------------------- css --- */

export const GLANCE_CSS = `
.gl-meter { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
.gl-bar { display:flex; height:18px; border-radius:999px; overflow:hidden; gap:2px; background:#EFEAE2; }
.gl-seg--bad { background:#B91C1C; } .gl-seg--warn { background:#EA7A1A; } .gl-seg--good { background:#2E7D52; } .gl-seg--unk { background:#C9C1B6; }
.gl-keys { display:flex; flex-wrap:wrap; gap:14px; margin-top:10px; font-size:14px; }
.gl-key { display:inline-flex; align-items:center; gap:6px; }
.gl-dot { width:11px; height:11px; border-radius:50%; display:inline-block; }
.gl-dot--bad { background:#B91C1C; } .gl-dot--warn { background:#EA7A1A; } .gl-dot--good { background:#2E7D52; } .gl-dot--unk { background:#C9C1B6; }
.gl-h { font-size:17px; margin:20px 0 10px; }
.gl-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:10px; }
.gl-card { display:flex; gap:12px; align-items:flex-start; background:var(--card); border:1px solid var(--line); border-top:4px solid #EA7A1A; border-radius:12px; padding:12px; }
.gl-card--bad { border-top-color:#B91C1C; }
.gl-card b { display:block; font-size:15px; }
.gl-card p { margin:4px 0 6px; font-size:13.5px; color:var(--muted); line-height:1.45; }
.gl-ico { flex:0 0 38px; height:38px; border-radius:50%; display:grid; place-items:center; font-weight:800; font-size:18px; color:#fff; background:#EA7A1A; }
.gl-card--bad .gl-ico { background:#B91C1C; }
.gl-thumb { flex:0 0 72px; width:72px; height:72px; object-fit:cover; border-radius:10px; }
.gl-go { font-size:13px; font-weight:700; color:var(--red); text-decoration:none; }
.gl-go:hover { text-decoration:underline; }
.gl-good { display:flex; flex-wrap:wrap; gap:8px; }
.gl-good span { background:#E3F3E9; color:#1F5E3B; border-radius:999px; padding:6px 12px; font-size:13.5px; font-weight:600; }
.gl-allgood { background:#E3F3E9; color:#1F5E3B; border-radius:12px; padding:12px 14px; font-weight:600; margin-top:14px; }
.gl-photos { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:6px; margin-top:20px; }
.gl-photos img { width:100%; height:96px; object-fit:cover; border-radius:10px; display:block; }

.fold { background:var(--card); border:1px solid var(--line); border-radius:12px; }
.fold > summary { cursor:pointer; padding:12px 16px; font-weight:700; list-style:none; display:flex; align-items:center; gap:10px; }
.fold > summary::-webkit-details-marker { display:none; }
.fold > summary::before { content:"+"; width:22px; height:22px; border-radius:50%; background:var(--red); color:#fff; display:grid; place-items:center; font-size:16px; line-height:1; }
.fold[open] > summary::before { content:"\\2212"; }
.fold-body { padding:0 16px 14px; }

.docnav { position:sticky; top:0; z-index:50; margin:0 -22px 18px; padding:8px 22px; background:rgba(251,247,241,.94); backdrop-filter:blur(6px); border-bottom:1px solid var(--line); display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; }
.docnav::-webkit-scrollbar { display:none; }
.docnav a { flex:0 0 auto; font-size:13px; font-weight:600; color:var(--muted); text-decoration:none; padding:6px 11px; border-radius:999px; border:1px solid transparent; white-space:nowrap; }
.docnav a:hover { color:var(--ink); border-color:var(--line); }
.docnav a.is-on { background:var(--ink); color:#fff; }
[data-section] { scroll-margin-top:62px; }

.photogrid img, .ev-card img, .ev-strip img, .anat-photos img, .anat-ex img, .gl-photos img, .gl-thumb { cursor:zoom-in; }
.lb { position:fixed; inset:0; z-index:9999; background:rgba(16,12,9,.92); display:none; align-items:center; justify-content:center; padding:24px 64px; }
.lb.is-open { display:flex; }
.lb figure { margin:0; max-width:100%; max-height:100%; display:flex; flex-direction:column; align-items:center; }
.lb img { max-width:100%; max-height:calc(100vh - 110px); object-fit:contain; border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
.lb figcaption { color:#F1E8DC; font-size:14px; margin-top:12px; text-align:center; max-width:70ch; }
.lb button { position:absolute; background:rgba(255,255,255,.12); color:#fff; border:none; border-radius:50%; width:48px; height:48px; font-size:28px; line-height:1; cursor:pointer; }
.lb button:hover, .lb button:focus-visible { background:rgba(255,255,255,.28); outline:none; }
.lb-x { top:16px; right:16px; } .lb-p { left:12px; top:50%; translate:0 -50%; } .lb-n { right:12px; top:50%; translate:0 -50%; }
@media (max-width:780px) { .lb { padding:16px 8px 80px; } .lb-p, .lb-n { top:auto; bottom:16px; translate:none; } .lb-p { left:calc(50% - 60px); } .lb-n { right:calc(50% - 60px); } .gl-cards { grid-template-columns:1fr; } .docnav { margin:0 -16px 14px; padding:8px 16px; } }
@media print { .docnav, .lb { display:none !important; } .fold > summary::before { display:none; } .fold-body { padding-top:0; } .gl-card { break-inside:avoid; } }
`;

/* -------------------------------------------------------------------- js --- */

export const GLANCE_JS = `(function(){
  // Chapter bar, built from the section headings that are on the page.
  var page = document.querySelector('.page');
  var secs = page ? [].slice.call(page.querySelectorAll('[data-section]')).filter(function(s){ return s.querySelector('.sec-head h2'); }) : [];
  secs.forEach(function(s){ if (!s.id) s.id = 'sec-' + s.getAttribute('data-section'); });
  if (secs.length > 3) {
    var nav = document.createElement('nav'); nav.className = 'docnav'; nav.setAttribute('aria-label', 'Sections');
    secs.forEach(function(s){ var a = document.createElement('a'); a.href = '#' + s.id; a.textContent = s.querySelector('.sec-head h2').textContent.replace(/\\s+/g, ' ').trim(); nav.appendChild(a); });
    page.insertBefore(nav, page.firstChild);
    var links = [].slice.call(nav.querySelectorAll('a'));
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (!e.isIntersecting) return; links.forEach(function(l){ var on = l.getAttribute('href') === '#' + e.target.id; l.classList.toggle('is-on', on); if (on && l.scrollIntoView) nav.scrollLeft = l.offsetLeft - 40; }); }); }, { rootMargin: '-45% 0px -50% 0px' });
      secs.forEach(function(s){ io.observe(s); });
    }
  }
  // Folded sections open for print.
  window.addEventListener('beforeprint', function(){ [].forEach.call(document.querySelectorAll('details.fold'), function(d){ d.setAttribute('open', ''); }); });

  // Photo viewer.
  var SEL = '.photogrid img, .ev-card img, .ev-strip img, .anat-photos img, .anat-ex img, .gl-photos img, .gl-thumb';
  var box, img, cap, list = [], i = 0, x0 = null, last = null;
  function build(){
    box = document.createElement('div'); box.className = 'lb'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Photo viewer');
    box.innerHTML = '<button type="button" class="lb-x" aria-label="Close">&times;</button><button type="button" class="lb-p" aria-label="Previous photo">&lsaquo;</button><figure><img alt=""><figcaption></figcaption></figure><button type="button" class="lb-n" aria-label="Next photo">&rsaquo;</button>';
    document.body.appendChild(box); img = box.querySelector('img'); cap = box.querySelector('figcaption');
    box.addEventListener('click', function(e){ var c = e.target.classList; if (e.target === box || c.contains('lb-x')) close(); else if (c.contains('lb-p')) go(-1); else if (c.contains('lb-n')) go(1); });
    box.addEventListener('touchstart', function(e){ x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function(e){ if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); x0 = null; });
  }
  function show(){ var el = list[i]; img.src = el.currentSrc || el.src; img.alt = el.alt || ''; cap.textContent = (el.alt ? el.alt + '  \\u00b7  ' : '') + (i + 1) + ' of ' + list.length; }
  function open(el){ if (!box) build(); last = el; list = [].slice.call(document.querySelectorAll(SEL)).filter(function(x, k, all){ return all.findIndex(function(y){ return y.src === x.src; }) === k; }); i = Math.max(0, list.findIndex(function(y){ return y.src === el.src; })); show(); box.classList.add('is-open'); document.documentElement.style.overflow = 'hidden'; box.querySelector('.lb-x').focus(); }
  function close(){ box.classList.remove('is-open'); document.documentElement.style.overflow = ''; if (last && last.focus) last.focus(); }
  function go(d){ i = (i + d + list.length) % list.length; show(); }
  [].forEach.call(document.querySelectorAll(SEL), function(el){ el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); });
  document.addEventListener('click', function(e){ var t = e.target; if (t && t.tagName === 'IMG' && t.matches(SEL)) { e.preventDefault(); open(t); } });
  document.addEventListener('keydown', function(e){
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.matches && t.matches(SEL) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(t); return; }
    if (!box || !box.classList.contains('is-open')) return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
  });
})();`;
