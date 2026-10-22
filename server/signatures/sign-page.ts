/**
 * The page the customer signs on.
 *
 * Built as plain server-rendered HTML rather than part of the React app: it
 * opens from a text message, on whatever phone the customer happens to own,
 * often on one bar of signal. Nothing here waits on a bundle.
 *
 * Two rules shape it.
 *
 * It never blocks. Drawing a signature and sharing a location both need
 * JavaScript and permission; typing a name and ticking a box need neither, so
 * the form works with JavaScript off and with location refused. JavaScript
 * upgrades the page — it is not the price of signing.
 *
 * It says what it records. The location notice sits above the signature, in
 * the same size type as everything else, before anyone signs. A page that
 * quietly collected a position would be a worse record, not a better one:
 * consent is the part that makes it evidence.
 */
import { createHash } from 'node:crypto';
import { CONSENT_TEXT, PAPER_NOTICE, escapeHtml, stamp, type SignerView } from '../../shared/signatures';
import { OFFICE_PHONE } from '../../shared/neighbor-letters';

const BRAND = '#b8322b';

/**
 * What the frozen document may do, as an iframe sandbox and as the CSP
 * sandbox on the document itself (so the "Open full screen" copy is held to
 * the same rule as the framed one).
 *
 * The document is a stored report or proposal served from the app's own
 * origin, and reports carry inline scripts (the chapter navigation, the
 * project map, the print button). Unsandboxed, any script that got into one
 * ran with the signer's page — and the app — as its own origin. Scripts still
 * run, but in an origin of their own: never allow-same-origin, which would
 * hand that back. allow-modals keeps "Print / Save PDF" working; allow-popups
 * (escaping the sandbox) keeps links that open a new tab working normally.
 */
export const DOCUMENT_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals';

/**
 * Added to the document as it is served, so the signing page can size the
 * frame to it — the sandbox means the page can no longer read the height
 * itself. It posts one number to its parent and nothing else.
 */
export const DOCUMENT_HEIGHT_SCRIPT = `<script>(function () {
  if (window.parent === window) return;
  function post() {
    try { parent.postMessage({ brnDocHeight: document.body ? document.body.scrollHeight : 0 }, '*'); } catch (e) {}
  }
  window.addEventListener('load', function () { post(); setTimeout(post, 400); setTimeout(post, 1600); });
  window.addEventListener('resize', post);
})();</script>`;

const shell = (title: string, body: string, extraHead = ''): string => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #1a1a1a; background: #f5f1ea; margin: 0; padding: 16px 12px 64px }
  .wrap { max-width: 780px; margin: 0 auto }
  .card { background: #fff; border-radius: 14px; padding: 20px 18px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 14px }
  .brand { font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: ${BRAND}; font-weight: 700; margin: 0 0 6px }
  h1 { font-size: 20px; margin: 0 0 6px; line-height: 1.25 }
  .sub { color: #666; font-size: 14px; margin: 0 }
  .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 14px; font-size: 14px; margin-top: 14px }
  .doc { border: 1px solid #e6e2da; border-radius: 12px; overflow: hidden; background: #fff }
  .doc iframe { display: block; width: 100%; border: 0; min-height: 420px; background: #fff }
  .doc-inline { padding: 20px 18px; overflow-x: auto }
  .docbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 14px; background: #faf8f4; border-bottom: 1px solid #e6e2da; font-size: 13px; color: #666 }
  .docbar a { color: ${BRAND}; font-weight: 600; text-decoration: none; white-space: nowrap }
  h2 { font-size: 16px; margin: 0 0 4px }
  label.f { display: block; font-weight: 600; font-size: 13px; margin: 16px 0 5px }
  input[type=text] { width: 100%; font: 17px Georgia, serif; padding: 11px 12px; border: 1px solid #cfcfcf; border-radius: 9px; background: #fff }
  input[type=text]:focus { outline: 2px solid ${BRAND}; outline-offset: 1px }
  .pad { position: relative; border: 1px solid #cfcfcf; border-radius: 9px; background: #fff; touch-action: none }
  .pad canvas { display: block; width: 100%; height: 170px; border-radius: 9px; touch-action: none }
  .pad .hint { position: absolute; left: 14px; right: 14px; bottom: 38px; border-bottom: 1px dashed #d4d4d4; color: #b9b9b9; font-size: 13px; text-align: center; pointer-events: none; padding-bottom: 6px }
  .pad.inked .hint { display: none }
  .padrow { display: flex; justify-content: space-between; align-items: center; margin-top: 7px; font-size: 13px }
  .link { background: none; border: 0; color: ${BRAND}; font-weight: 600; font-size: 13px; padding: 0; cursor: pointer; text-decoration: underline }
  .affirm { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; color: #333; margin: 18px 0 4px; line-height: 1.45 }
  .affirm input { margin-top: 3px; width: 19px; height: 19px; flex: none; accent-color: ${BRAND} }
  .fine { color: #777; font-size: 12.5px; margin: 6px 0 0 29px }
  .geo { display: flex; gap: 10px; align-items: flex-start; background: #f4f7fb; border: 1px solid #dbe6f3; border-radius: 10px; padding: 11px 13px; font-size: 13.5px; color: #33475b; margin-top: 16px }
  .geo b { color: #1a2b3c }
  .geo.on { background: #f0fdf4; border-color: #bbf7d0; color: #14532d }
  .geo.off { background: #faf8f4; border-color: #e6e2da; color: #6b6b6b }
  button.go { margin-top: 18px; width: 100%; padding: 15px; font-size: 17px; font-weight: 700; color: #fff; background: ${BRAND}; border: 0; border-radius: 11px; cursor: pointer }
  button.go:disabled { opacity: .45 }
  .decline { text-align: center; margin-top: 14px; font-size: 13px }
  .decline a, .decline button { color: #888; text-decoration: underline; background: none; border: 0; font-size: 13px; cursor: pointer }
  .done { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; border-radius: 11px; padding: 14px 16px }
  .err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 11px; padding: 12px 14px; margin-bottom: 14px }
  .foot { text-align: center; color: #999; font-size: 12px; margin-top: 18px }
  @media (max-width: 420px) { .card { padding: 16px 14px } h1 { font-size: 18px } }
</style>${extraHead}</head><body><div class="wrap">${body}</div></body></html>`;

export const notFoundPage = (): string => shell('Link expired', `<div class="card">
  <p class="brand">Best Roofing Now</p>
  <h1>That link isn't valid any more</h1>
  <p class="sub">It may have been replaced by a newer copy of the document, or cancelled. Give us a call and we'll send a fresh one.</p>
</div>`);

export const voidedPage = (title: string, reason: string | null): string => shell('Cancelled', `<div class="card">
  <p class="brand">Best Roofing Now</p>
  <h1>This document was cancelled</h1>
  <p class="sub">${escapeHtml(title)} is no longer out for signature${reason ? ` — ${escapeHtml(reason)}` : ''}. Nothing further is needed from you.</p>
</div>`);

export const signedPage = (title: string, signer: SignerView, emailed: boolean): string => shell('Signed', `<div class="card">
  <p class="brand">Best Roofing Now</p>
  <div class="done">
    <b>Thank you — this is signed.</b><br>
    ${escapeHtml(title)}, signed by ${escapeHtml(signer.signedName || signer.name)}${signer.signedAt ? ` on ${escapeHtml(stamp(signer.signedAt))}` : ''}.
    ${emailed ? '<br>A copy is on its way to your email.' : ''}
  </div>
  <p class="sub" style="margin-top:14px">You can close this page.</p>
</div>`);

/** Shown to a signer the limiter has turned away — a page, not a JSON error. */
export const tooManyPage = (): string => shell('One moment', `<div class="card">
  <p class="brand">Best Roofing Now</p>
  <h1>Give it a moment</h1>
  <p class="sub">That came through more times than we expected, so we've paused this link for a little while.
  Wait a minute and open it again — nothing you did has been lost. If it keeps happening, call the office on ${escapeHtml(OFFICE_PHONE)} and we'll sort it out.</p>
</div>`);

export const declinedPage = (title: string): string => shell('Declined', `<div class="card">
  <p class="brand">Best Roofing Now</p>
  <h1>Thanks — we've let your rep know</h1>
  <p class="sub">${escapeHtml(title)} has not been signed, and someone from our office will follow up with you.</p>
</div>`);

export interface SignPageOptions {
  token: string;
  title: string;
  propertyAddress: string | null;
  message: string | null;
  signer: SignerView;
  /** Everyone on the document, so a signer can see who else has to sign. */
  signers: SignerView[];
  /** True when the frozen document is a full designed page and goes in a frame. */
  framed: boolean;
  /** The fragment itself, for documents that are not framed. */
  inlineHtml: string;
  error?: string | null;
}

export function signPage(o: SignPageOptions): string {
  const action = `/r/s/${encodeURIComponent(o.token)}`;
  const others = o.signers.filter((s) => s.id !== o.signer.id);
  const waiting = others.filter((s) => !s.signedAt);

  const doc = o.framed
    ? `<div class="doc">
        <div class="docbar"><span>The document</span><a href="${action}/document" target="_blank" rel="noopener">Open full screen ↗</a></div>
        <iframe id="docframe" src="${action}/document" title="${escapeHtml(o.title)}" loading="eager" sandbox="${DOCUMENT_SANDBOX}"></iframe>
      </div>`
    : `<div class="doc">
        <div class="docbar"><span>The document</span><a href="${action}/document" target="_blank" rel="noopener">Open full screen ↗</a></div>
        <div class="doc-inline">${o.inlineHtml}</div>
      </div>`;

  return shell(o.title, `
  <div class="card">
    <p class="brand">Best Roofing Now</p>
    <h1>${escapeHtml(o.title)}</h1>
    <p class="sub">${o.propertyAddress ? escapeHtml(o.propertyAddress) : ''}</p>
    ${o.message ? `<div class="note">${escapeHtml(o.message)}</div>` : ''}
    ${others.length ? `<p class="sub" style="margin-top:12px">Also signing: ${others.map((s) => `${escapeHtml(s.name)}${s.signedAt ? ' ✓' : ''}`).join(', ')}${waiting.length ? '' : ' — everyone else has signed'}</p>` : ''}
  </div>

  ${doc}

  <div class="card" style="margin-top:14px">
    ${o.error ? `<div class="err">${escapeHtml(o.error)}</div>` : ''}
    <h2>Sign here</h2>
    <p class="sub">Hi ${escapeHtml(firstName(o.signer.name))} — draw your signature below, or type your name.</p>

    <form method="post" action="${action}" id="signform">
      <div id="padwrap" hidden>
        <label class="f" for="pad">Your signature</label>
        <div class="pad" id="pad">
          <canvas id="canvas" aria-label="Draw your signature"></canvas>
          <div class="hint">Sign with your finger</div>
        </div>
        <div class="padrow">
          <button type="button" class="link" id="clear">Clear</button>
          <button type="button" class="link" id="usetyped">Type my name instead</button>
        </div>
      </div>

      <div id="typedwrap">
        <label class="f" for="name">Type your full name to sign</label>
        <input id="name" name="name" type="text" autocomplete="name" autocapitalize="words"
               placeholder="${escapeHtml(o.signer.name)}" value="" required minlength="3" maxlength="120">
        <div class="padrow"><span></span><button type="button" class="link" id="usedrawn" hidden>Draw it instead</button></div>
      </div>

      <div class="geo" id="geo">
        <span aria-hidden="true">📍</span>
        <span id="geotext"><b>Where you sign is recorded.</b> Your device may ask to share your location — it's part of the signed record, and you can say no and still sign.</span>
      </div>

      <label class="affirm">
        <input type="checkbox" name="affirm" value="yes" required>
        <span>${escapeHtml(CONSENT_TEXT)}</span>
      </label>
      <p class="fine">${escapeHtml(PAPER_NOTICE)}</p>

      <input type="hidden" name="kind" id="kind" value="typed">
      <input type="hidden" name="signature" id="signature">
      <input type="hidden" name="lat" id="lat">
      <input type="hidden" name="lng" id="lng">
      <input type="hidden" name="accuracy" id="accuracy">

      <button type="submit" class="go" id="submit">Sign ${escapeHtml(shortTitle(o.title))}</button>
    </form>

    <p class="decline"><a href="${action}/decline">I can't sign this</a></p>
  </div>
  <p class="foot">Best Roofing Now · This link is personal to ${escapeHtml(o.signer.name)}. Please don't forward it.</p>
  ${SIGN_SCRIPT}`);
}

export function declinePage(token: string, title: string): string {
  const action = `/r/s/${encodeURIComponent(token)}/decline`;
  return shell('Not signing', `<div class="card">
    <p class="brand">Best Roofing Now</p>
    <h1>Not signing ${escapeHtml(title)}</h1>
    <p class="sub">Tell us what's wrong and we'll sort it out — nothing is sent until you're happy with it.</p>
    <form method="post" action="${action}">
      <label class="f" for="reason">What's the problem? (optional)</label>
      <input id="reason" name="reason" type="text" maxlength="300" placeholder="The address is wrong, the price changed…">
      <button type="submit" class="go">Send this to my rep</button>
    </form>
    <p class="decline"><a href="/r/s/${encodeURIComponent(token)}">Go back to the document</a></p>
  </div>`);
}

const firstName = (n: string): string => String(n || '').trim().split(/\s+/)[0] || 'there';
const shortTitle = (t: string): string => (t.length > 26 ? 'document' : t.toLowerCase());

/**
 * The upgrade layer: the drawing pad, the location request, and sizing the
 * document frame to its contents so the page scrolls once instead of twice.
 * Everything it touches starts in a state that works without it.
 */
const SIGN_SCRIPT = `<script>
(function () {
  var form = document.getElementById('signform');
  if (!form) return;
  var pad = document.getElementById('pad'), canvas = document.getElementById('canvas');
  var padwrap = document.getElementById('padwrap'), typedwrap = document.getElementById('typedwrap');
  var nameInput = document.getElementById('name'), kind = document.getElementById('kind');
  var sigField = document.getElementById('signature'), submit = document.getElementById('submit');

  // ---- The document frame grows to its content: one scrollbar, not two.
  // The frame is sandboxed into its own origin, so its height can no longer be
  // read off contentDocument; the document posts it instead (DOCUMENT_HEIGHT_SCRIPT).
  // Only a number from that one frame is taken. Without it the frame keeps its
  // own scrollbar.
  var frame = document.getElementById('docframe');
  if (frame) {
    window.addEventListener('message', function (e) {
      if (e.source !== frame.contentWindow || !e.data || typeof e.data.brnDocHeight !== 'number' || !isFinite(e.data.brnDocHeight)) return;
      frame.style.height = Math.min(9000, Math.max(420, e.data.brnDocHeight + 32)) + 'px';
    });
  }

  // ---- Drawing.
  var drawing = false, inked = false, ctx = null, last = null;
  function size() {
    var ratio = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    var keep = inked ? canvas.toDataURL('image/png') : null;
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    if (keep) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, w, h); }; img.src = keep; }
  }
  function at(e) {
    var r = canvas.getBoundingClientRect();
    var p = e.touches && e.touches[0] ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function start(e) { e.preventDefault(); drawing = true; last = at(e); }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    var p = at(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
    if (!inked) { inked = true; pad.classList.add('inked'); }
  }
  function stop() { drawing = false; }

  padwrap.hidden = false;
  typedwrap.hidden = true;
  nameInput.required = false;
  kind.value = 'drawn';
  document.getElementById('usedrawn').hidden = false;
  size();
  window.addEventListener('resize', size);

  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', stop);

  document.getElementById('clear').addEventListener('click', function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    inked = false; pad.classList.remove('inked');
  });
  document.getElementById('usetyped').addEventListener('click', function () {
    padwrap.hidden = true; typedwrap.hidden = false; kind.value = 'typed';
    nameInput.required = true; nameInput.focus();
  });
  document.getElementById('usedrawn').addEventListener('click', function () {
    typedwrap.hidden = true; padwrap.hidden = false; kind.value = 'drawn';
    nameInput.required = false; size();
  });

  // ---- Location. Asked for once, never required, and said out loud either way.
  var geo = document.getElementById('geo'), geotext = document.getElementById('geotext');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function (pos) {
      document.getElementById('lat').value = pos.coords.latitude;
      document.getElementById('lng').value = pos.coords.longitude;
      document.getElementById('accuracy').value = pos.coords.accuracy;
      geo.className = 'geo on';
      geotext.innerHTML = '<b>Location shared.</b> It will be recorded with your signature.';
    }, function () {
      geo.className = 'geo off';
      geotext.innerHTML = '<b>Location not shared.</b> That is fine — you can still sign, and the record will show the approximate area from your connection.';
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  // ---- Submit. A drawn signature is flattened onto white and sent as a JPEG,
  // which PDF can carry as-is, and the name is taken from the field either way.
  form.addEventListener('submit', function (e) {
    if (kind.value === 'drawn') {
      if (!inked) {
        e.preventDefault();
        geo.scrollIntoView({ block: 'center' });
        alertless('Please draw your signature first, or choose "Type my name instead".');
        return;
      }
      var flat = document.createElement('canvas');
      flat.width = canvas.width; flat.height = canvas.height;
      var c = flat.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, flat.width, flat.height);
      c.drawImage(canvas, 0, 0);
      sigField.value = flat.toDataURL('image/jpeg', 0.92);
      if (!nameInput.value.trim()) nameInput.value = nameInput.getAttribute('placeholder') || '';
    }
    submit.disabled = true;
    submit.textContent = 'Signing…';
    // The button is re-enabled if the browser restores the page from cache.
    setTimeout(function () { submit.disabled = false; submit.textContent = submit.dataset.label || 'Sign'; }, 15000);
  });
  submit.dataset.label = submit.textContent;

  // A modal dialog would freeze the page on some in-app browsers; a line of
  // text under the pad says the same thing without that risk.
  function alertless(msg) {
    var row = document.querySelector('.padrow');
    var n = document.getElementById('padmsg') || document.createElement('p');
    n.id = 'padmsg'; n.style.cssText = 'color:#991b1b;font-size:13px;margin:6px 0 0';
    n.textContent = msg;
    if (row && !document.getElementById('padmsg')) row.parentNode.insertBefore(n, row.nextSibling);
  }
})();
</script>`;

/**
 * The signing page's own CSP: its one script, by hash, and nothing else.
 *
 * The certificate fragment is placed straight into this page (inlineHtml).
 * It is escaped when it is built, but this page takes a signature on the
 * app's origin, so a script or handler that ever got into a document must not
 * run here — whatever went wrong upstream.
 */
const SIGN_SCRIPT_HASH = createHash('sha256')
  .update(SIGN_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, ''), 'utf8')
  .digest('base64');
export const SIGN_PAGE_CSP = `script-src 'sha256-${SIGN_SCRIPT_HASH}'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`;
