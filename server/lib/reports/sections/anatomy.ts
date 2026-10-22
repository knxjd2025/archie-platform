/**
 * "Your Roof, Part by Part" — the shared engine behind the Inspection's
 * interactive roof drawings (roof-anatomy-shingle.ts for a pitched roof,
 * roof-anatomy-flat.ts for a commercial low-slope roof).
 *
 * A drawing is an inline SVG with a numbered hotspot on every part, beside a
 * list of the same parts. Tap a number (or a name) and that part opens: what
 * it is, why it matters, what the inspector recorded, and the job's photos of
 * it. Every status comes from the inspector's checklist — nothing is read off
 * the photos — and a part the checklist says nothing about is "Not checked".
 * Where a manufacturer photo shows what the part looks like, it prints as a
 * labelled example, kept apart from the job's own photos (anatomy-examples.ts).
 *
 * Without script every part prints open, so the PDF and a no-JS viewer get
 * the whole list.
 */
import { esc } from '../report-theme.js';
import type { ResolvedExample } from './anatomy-examples.js';

export type PartStatus = 'good' | 'fair' | 'attention' | 'failed' | 'unknown' | 'info';

export const PART_STATUS_LABEL: Record<PartStatus, string> = {
  good: 'Looks good', fair: 'Fair', attention: 'Needs attention', failed: 'Failed', unknown: 'Not checked', info: 'Noted',
};

export interface AnatomyPhoto { url: string; caption: string }

export interface AnatomyPart {
  id: string;
  /** Hotspot number on the drawing; parts without one are listed but not drawn. */
  n?: number;
  name: string;
  /** What it is, in a sentence. */
  what: string;
  /** Why it matters, in a sentence. */
  why: string;
  /** What the inspector recorded, verbatim. */
  found: string | null;
  status: PartStatus;
  /** A plain line explaining the status, when there is one. */
  note?: string | null;
  photos: AnatomyPhoto[];
  /** Manufacturer photos of what this kind of part looks like — never this roof. */
  examples?: ResolvedExample[];
}

/** Where a hotspot sits on the drawing, in SVG units. */
export interface Hotspot { id: string; n: number; x: number; y: number; name: string }

/** A commercial rating (Good / Fair / Poor / Failed) as a part status. */
export function statusFromRating(r: unknown): PartStatus | null {
  switch (String(r ?? '')) {
    case 'Good': return 'good';
    case 'Fair': return 'fair';
    case 'Poor': return 'attention';
    case 'Failed': return 'failed';
    default: return null;
  }
}

/** The job's photos whose own caption names this part. Captions are the inspector's words. */
export function photosMatching(photos: Array<{ url?: string; caption?: string | null }>, re: RegExp | null, max = 4): AnatomyPhoto[] {
  if (!re) return [];
  return photos
    .filter((p) => p?.url && p.caption && re.test(p.caption))
    .slice(0, max)
    .map((p) => ({ url: String(p.url), caption: String(p.caption) }));
}

export function hotspotsSvg(spots: Hotspot[]): string {
  return spots.map((h) => `<g class="anat-hot" data-hot="${esc(h.id)}" tabindex="0" role="button" aria-label="${h.n}. ${esc(h.name)}" transform="translate(${h.x} ${h.y})">
      <title>${h.n}. ${esc(h.name)}</title>
      <g class="anat-hot-in"><circle class="anat-hot-ring" r="22"/><circle class="anat-hot-dot" r="15"/><text class="anat-hot-n" text-anchor="middle" dy="5.5">${h.n}</text></g>
    </g>`).join('');
}

function partCard(p: AnatomyPart): string {
  const photos = p.photos.length
    ? `<p class="anat-sub">Photos from your roof</p><div class="anat-photos">${p.photos.map((ph) => `<img src="${esc(ph.url)}" alt="${esc(ph.caption)}" loading="lazy">`).join('')}</div>`
    : '';
  const ex = p.examples ?? [];
  const examples = ex.length
    ? `<div class="anat-ex"><p class="anat-sub">What it looks like <span>Example${ex.length > 1 ? 's' : ''} &middot; not your roof</span></p>
        <div class="anat-ex-grid">${ex.map((e) => `<figure><img src="${esc(e.url)}" alt="Example: ${esc(e.name)} (${esc(e.maker)})" loading="lazy"><figcaption>${esc(e.name)}<span>Photo: ${esc(e.maker)}</span></figcaption></figure>`).join('')}</div>
      </div>`
    : '';
  return `<li class="anat-part anat-part--${p.status}" id="anat-${esc(p.id)}" data-part="${esc(p.id)}">
      <button type="button" class="anat-head" aria-expanded="true">
        ${p.n ? `<span class="anat-n">${p.n}</span>` : '<span class="anat-n anat-n--off" aria-hidden="true">&bull;</span>'}
        <span class="anat-name">${esc(p.name)}</span>
        <span class="anat-chip anat-chip--${p.status}">${PART_STATUS_LABEL[p.status]}</span>
      </button>
      <div class="anat-body">
        <p><b>What it is.</b> ${esc(p.what)}</p>
        ${examples}
        <p><b>Why it matters.</b> ${esc(p.why)}</p>
        ${p.found ? `<p class="anat-found"><b>What we found.</b> ${esc(p.found)}</p>` : '<p class="anat-found anat-found--none">The inspection did not record this part.</p>'}
        ${p.note ? `<p class="anat-note">${esc(p.note)}</p>` : ''}
        ${photos}
      </div>
    </li>`;
}

/** The drawing and the parts list, wired together. */
export function anatomyBlock(opts: { svg: string; parts: AnatomyPart[]; caption: string }): string {
  const counts = opts.parts.reduce<Record<string, number>>((m, p) => ({ ...m, [p.status]: (m[p.status] ?? 0) + 1 }), {});
  const legend = (['failed', 'attention', 'fair', 'good', 'info', 'unknown'] as PartStatus[])
    .filter((s) => counts[s])
    .map((s) => `<span class="anat-chip anat-chip--${s}">${counts[s]} ${PART_STATUS_LABEL[s].toLowerCase()}</span>`).join('');
  return `<div class="anat" data-anat>
    <div class="anat-legend">${legend}</div>
    <div class="anat-grid">
      <figure class="anat-fig">${opts.svg}<figcaption>${esc(opts.caption)}</figcaption></figure>
      <ol class="anat-parts">${opts.parts.map(partCard).join('')}</ol>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------- css --- */

export const ANATOMY_CSS = `
.anat { --a-good:#2E7D52; --a-fair:#B7791F; --a-att:#C2410C; --a-fail:#B91C1C; --a-unk:#8A8178; --a-info:#1D4E89; margin-top:6px; }
.anat-legend { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
.anat-grid { display:grid; grid-template-columns:minmax(0,1.7fr) minmax(0,1fr); gap:18px; align-items:start; }
.anat-fig { margin:0; position:sticky; top:64px; background:linear-gradient(180deg,#EAF2FA,#F8F4EC); border:1px solid var(--line); border-radius:16px; padding:10px; }
.anat-fig svg { display:block; width:100%; height:auto; }
.anat-fig figcaption { font-size:12px; color:var(--muted); text-align:center; margin-top:4px; }
.anat-parts { list-style:none; margin:0; padding:0; display:grid; gap:8px; max-height:640px; overflow:auto; padding-right:4px; }
.anat-part { background:var(--card); border:1px solid var(--line); border-left:5px solid var(--a-unk); border-radius:12px; overflow:hidden; scroll-margin:80px; }
.anat-part--good { border-left-color:var(--a-good); } .anat-part--fair { border-left-color:var(--a-fair); }
.anat-part--attention { border-left-color:var(--a-att); } .anat-part--failed { border-left-color:var(--a-fail); }
.anat-part--info { border-left-color:var(--a-info); }
.anat-head { all:unset; box-sizing:border-box; width:100%; display:flex; align-items:center; gap:10px; padding:10px 12px; cursor:pointer; }
.anat-head:focus-visible { outline:2px solid var(--red); outline-offset:-2px; }
.anat-n { flex:0 0 26px; height:26px; border-radius:50%; background:var(--ink); color:#fff; font-size:13px; font-weight:700; display:grid; place-items:center; }
.anat-n--off { background:#D8CFC2; }
.anat-name { flex:1; font-weight:700; font-size:15px; }
.anat-chip { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.03em; padding:3px 9px; border-radius:999px; white-space:nowrap; background:#EFEAE2; color:var(--a-unk); }
.anat-chip--good { background:#DCF2E4; color:var(--a-good); } .anat-chip--fair { background:#FCF0D2; color:#8A5A0B; }
.anat-chip--attention { background:#FFE6D5; color:var(--a-att); } .anat-chip--failed { background:#FDE0E0; color:var(--a-fail); }
.anat-chip--info { background:#E1ECF8; color:var(--a-info); }
.anat-body { padding:0 14px 14px 48px; font-size:14px; line-height:1.55; }
.anat-body p { margin:6px 0; }
.anat-found { background:#F7F3EC; border-radius:8px; padding:8px 10px; }
.anat-found--none { color:var(--muted); font-style:italic; background:none; padding:0; }
.anat-note { color:var(--muted); font-size:13px; }
.anat-sub { margin:12px 0 6px !important; font-size:12px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
.anat-sub span { display:inline-block; white-space:nowrap; text-transform:none; letter-spacing:0; font-weight:600; margin:2px 0 0 6px; color:#8A5A0B; background:#FCF0D2; border-radius:999px; padding:2px 8px; }
.anat-ex { background:#fff; border:1px dashed #D8CFC2; border-radius:10px; padding:2px 10px 10px; margin:8px 0; }
.anat-ex-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:8px; }
.anat-ex figure { margin:0; }
.anat-ex img { width:100%; height:104px; object-fit:contain; background:#fff; border-radius:8px; display:block; }
.anat-ex figcaption { font-size:12px; line-height:1.35; margin-top:4px; }
.anat-ex figcaption span { display:block; color:var(--muted); font-size:11px; }
.anat-photos { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:6px; margin-top:8px; }
.anat-photos img { width:100%; height:84px; object-fit:cover; border-radius:8px; display:block; }
.anat--js .anat-part:not(.is-on) .anat-body { display:none; }
.anat--js .anat-part.is-on { box-shadow:0 6px 18px rgba(60,40,20,.12); }
.anat-hot { cursor:pointer; outline:none; }
.anat-hot-ring { fill:rgba(200,16,46,.18); opacity:0; transition:opacity .2s; }
.anat-hot-dot { fill:#fff; stroke:var(--red); stroke-width:2.5; transition:fill .15s; }
.anat-hot-n { font:700 16px Inter,system-ui,sans-serif; fill:var(--red); pointer-events:none; }
.anat-hot:hover .anat-hot-dot, .anat-hot:focus-visible .anat-hot-dot, .anat-hot.is-on .anat-hot-dot { fill:var(--red); }
.anat-hot:hover .anat-hot-n, .anat-hot:focus-visible .anat-hot-n, .anat-hot.is-on .anat-hot-n { fill:#fff; }
.anat-hot.is-on .anat-hot-ring { opacity:1; animation:anatPulse 1.6s ease-in-out infinite; }
@keyframes anatPulse { 50% { transform:scale(1.25); } }
.anat-layer { transition:opacity .2s, filter .2s; }
.anat-layer.is-on { filter:drop-shadow(0 0 6px rgba(200,16,46,.55)); }
@media (prefers-reduced-motion: reduce) { .anat-hot.is-on .anat-hot-ring { animation:none; } }
@media (max-width:780px) { .anat-hot-in { transform:scale(1.75); } .anat-grid { grid-template-columns:1fr; } .anat-fig { position:static; } .anat-parts { max-height:none; overflow:visible; } }
@media print { .anat-grid { grid-template-columns:1fr; } .anat-fig { position:static; } .anat-parts { max-height:none; overflow:visible; }
  .anat--js .anat-part .anat-body { display:block !important; } .anat-part { break-inside:avoid; } .anat-hot-ring { display:none; } }
`;

/* -------------------------------------------------------------------- js --- */

/**
 * Wires every [data-anat] block: hotspot ↔ part, one part open at a time,
 * the matching layer highlighted, and [data-anat-go] links elsewhere on the
 * page that open a part and bring the drawing into view.
 */
export const ANATOMY_JS = `(function(){
  function wire(root){
    root.classList.add('anat--js');
    var parts = [].slice.call(root.querySelectorAll('[data-part]'));
    function sel(id, scrollList){
      parts.forEach(function(p){ var on = p.getAttribute('data-part') === id; p.classList.toggle('is-on', on); var b = p.querySelector('.anat-head'); if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false'); });
      [].forEach.call(root.querySelectorAll('[data-hot]'), function(h){ h.classList.toggle('is-on', h.getAttribute('data-hot') === id); });
      [].forEach.call(root.querySelectorAll('[data-layer]'), function(l){ l.classList.toggle('is-on', l.getAttribute('data-layer') === id); });
      if (scrollList) { var el = root.querySelector('[data-part="' + id + '"]'); var list = root.querySelector('.anat-parts');
        if (el && list && list.scrollHeight > list.clientHeight) list.scrollTop = el.offsetTop - list.offsetTop - 8;
        else if (el && el.scrollIntoView && window.innerWidth <= 780) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
    root.__sel = sel;
    root.addEventListener('click', function(e){
      var h = e.target.closest && e.target.closest('[data-hot]');
      if (h) { sel(h.getAttribute('data-hot'), true); return; }
      var b = e.target.closest && e.target.closest('.anat-head');
      if (b) { var p = b.closest('[data-part]'); sel(p.classList.contains('is-on') ? '' : p.getAttribute('data-part'), false); }
    });
    root.addEventListener('keydown', function(e){
      var h = e.target.closest && e.target.closest('[data-hot]');
      if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sel(h.getAttribute('data-hot'), true); }
    });
    var first = root.querySelector('.anat-part--failed, .anat-part--attention') || parts[0];
    if (first) sel(first.getAttribute('data-part'), false);
  }
  [].forEach.call(document.querySelectorAll('[data-anat]'), wire);
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('[data-anat-go]');
    if (!a) return;
    var id = a.getAttribute('data-anat-go'); var part = document.getElementById('anat-' + id); if (!part) return;
    e.preventDefault();
    var root = part.closest('[data-anat]'); if (root && root.__sel) root.__sel(id, true);
    (root || part).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();`;
