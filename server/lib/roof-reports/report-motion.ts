/**
 * report-motion.ts — Shared, isomorphic motion layer for Archie report HTML.
 *
 * `motionStyles()` returns CSS; `motionRuntime()` returns a <script>. Generators
 * opt in by injecting both and tagging markup with data-* attributes.
 *
 * Content-first: hidden states live ONLY under `.gsap-anim`, which the runtime
 * adds at run time only when GSAP loaded AND prefers-reduced-motion is off. With
 * no JS, reduced motion, or print, every element is fully visible.
 *
 * No Node-only or browser-only imports — safe in the Vite frontend bundle and
 * the Render server. The server passes inlined GSAP via `gsapSource`; other
 * callers fall back to a pinned CDN.
 */

export function motionStyles(): string {
  return `
/* ── Archie report motion (content-first; hidden states gated by .gsap-anim) ── */
.archie-progress{position:fixed;top:0;left:0;height:3px;width:0;background:var(--primary,#ea580c);z-index:9999}
.gsap-anim [data-reveal]{opacity:0;will-change:transform,opacity}
.gsap-anim [data-bar-fill]{transform:scaleX(0);transform-origin:left center}
@media print{
  .archie-progress{display:none!important}
  .gsap-anim [data-reveal]{opacity:1!important;transform:none!important}
  .gsap-anim [data-bar-fill]{transform:none!important}
}
@media (prefers-reduced-motion: reduce){
  .gsap-anim [data-reveal]{opacity:1!important;transform:none!important}
  .gsap-anim [data-bar-fill]{transform:none!important}
}
`.trim();
}

export interface MotionRuntimeOptions {
  /** When false, returns '' (feature off). Default true. */
  enabled?: boolean;
  /** 'subtle' = smaller offsets/shorter durations. Default 'standard'. */
  intensity?: 'subtle' | 'standard';
  /**
   * Pre-read minified GSAP+ScrollTrigger to inline. Omit → pinned CDN fallback.
   * TRUSTED INPUT ONLY: this string is inlined raw into <script>...</script>.
   * It must come from our own node_modules (server gsap-inline helper) — NEVER
   * pass user/tenant-controlled data through it (stored XSS in R2-hosted reports).
   */
  gsapSource?: string;
}

const GSAP_VERSION = '3.14.2';
const GSAP_CDN = `https://cdn.jsdelivr.net/npm/gsap@${GSAP_VERSION}/dist/gsap.min.js`;
const ST_CDN = `https://cdn.jsdelivr.net/npm/gsap@${GSAP_VERSION}/dist/ScrollTrigger.min.js`;

export function motionRuntime(opts: MotionRuntimeOptions = {}): string {
  const { enabled = true, intensity = 'standard', gsapSource } = opts;
  if (!enabled) return '';

  const dist = intensity === 'subtle' ? 24 : 40;
  const dur = intensity === 'subtle' ? 0.5 : 0.7;

  const libTags = gsapSource
    ? `<script>${gsapSource}</script>`
    : `<script src="${GSAP_CDN}" crossorigin="anonymous"></script>\n<script src="${ST_CDN}" crossorigin="anonymous"></script>`;

  return `
<!-- archie-motion-runtime -->
${libTags}
<script>
(function(){
  if (typeof window === 'undefined' || !window.gsap || !window.ScrollTrigger) return;
  var gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);
  gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', function(){
    document.documentElement.classList.add('gsap-anim');

    gsap.set('[data-reveal]', { y: ${dist} });
    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 88%',
      onEnter: function(b){ gsap.to(b, { opacity: 1, y: 0, duration: ${dur}, stagger: 0.08, ease: 'power2.out', overwrite: true }); }
    });

    document.querySelectorAll('[data-counter]').forEach(function(el){
      var to = parseFloat(el.getAttribute('data-to') || '0');
      var dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
      var pre = el.getAttribute('data-prefix') || '';
      var suf = el.getAttribute('data-suffix') || '';
      var obj = { v: 0 };
      ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: function(){
        gsap.to(obj, { v: to, duration: 1.2, ease: 'power1.out', onUpdate: function(){
          el.textContent = pre + obj.v.toFixed(dec).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + suf;
        }});
      }});
    });

    // Generator must render the arc in its FINAL (filled) state; this only animates
    // FROM empty, so a JS failure leaves the gauge fully drawn (content-first).
    document.querySelectorAll('[data-gauge-arc]').forEach(function(arc){
      var len = (arc.getTotalLength && arc.getTotalLength()) || 100;
      var prog = parseFloat(arc.getAttribute('data-progress') || '1');
      gsap.fromTo(arc, { strokeDasharray: len, strokeDashoffset: len },
        { strokeDashoffset: len * (1 - prog), duration: 1.4, ease: 'power2.out',
          scrollTrigger: { trigger: arc, start: 'top 92%', once: true } });
    });

    document.querySelectorAll('[data-bar-fill]').forEach(function(el){
      gsap.to(el, { scaleX: 1, duration: 1, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 94%', once: true } });
    });

    // The progress element needs BOTH the .archie-progress class (CSS/print) and the data-progress-bar attribute (this query).
    var pb = document.querySelector('[data-progress-bar]');
    if (pb) ScrollTrigger.create({ start: 0, end: 'max',
      onUpdate: function(self){ pb.style.width = (self.progress * 100) + '%'; } });

    // Content-first safety net: never leave an in-view [data-reveal] stranded at
    // opacity:0 (e.g. if batch onEnter missed it due to late image/font layout).
    // Only acts on elements still hidden, so the normal batch stagger is preserved.
    function revealInView(){
      document.querySelectorAll('[data-reveal]').forEach(function(el){
        if (parseFloat(gsap.getProperty(el, 'opacity')) > 0.01) return;
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
          gsap.to(el, { opacity: 1, y: 0, duration: 0.4, overwrite: true });
        }
      });
    }
    function settle(){ ScrollTrigger.refresh(); revealInView(); }
    if (document.readyState === 'complete') settle();
    else window.addEventListener('load', settle);
    setTimeout(revealInView, 1500);
  });
})();
</script>`.trim();
}
