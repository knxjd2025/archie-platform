// Chrome: the rep's signature panel inside the app, and a customer signing on
// a 390px phone with the location shared and with it refused.
//
//   E2E_UI=1 scripts/e2e/run.sh          # as part of the pass
//   E2E_BASE=http://127.0.0.1:3999 E2E_COOKIES=/tmp/e2e/cookies.json node scripts/e2e/signatures-ui.mjs
//
// Screenshots land in /tmp/e2e/shots. Look at them — three of the four real
// bugs the first full signature pass found were invisible to passing
// assertions and obvious the moment someone looked at the board.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { JOB, NEARBY, REPORT_HTML, ensureFixtures, pool, sentRequest } from './signatures-fixtures.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3999';
const SHOTS = process.env.E2E_SHOTS || '/tmp/e2e/shots';
const CHROME = process.env.E2E_CHROME
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const cookies = JSON.parse(fs.readFileSync(process.env.E2E_COOKIES, 'utf8'));

const results = [];
const T = (name, ok, evidence = '') => { results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 220) }); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const bodyText = (page) => page.evaluate(() => document.body.innerText);

/**
 * Wait for text to appear rather than sleeping a guess at it. A send here has
 * to geocode the property and then fail two deliveries, which takes longer
 * than it looks, and the toast that reports it clears itself after a few
 * seconds — a fixed sleep lands either side of it.
 */
async function waitForText(page, re, ms = 25000) {
  const until = Date.now() + ms;
  let seen = '';
  while (Date.now() < until) {
    seen = await bodyText(page);
    if (re.test(seen)) return seen;
    await sleep(500);
  }
  return null;
}

/** Click the innermost element carrying this text — the app uses divs as buttons in places. */
const clickText = (page, selector, needle) => page.evaluate((sel, txt) => {
  const all = [...document.querySelectorAll(sel)].filter((e) => (e.innerText || e.textContent || '').includes(txt));
  const el = all.reverse().find((e) => e.offsetParent !== null || e.tagName === 'BUTTON');
  if (el) { el.click(); return true; }
  return false;
}, selector, needle);

/** Open the client through the app the way a rep does, then expand the panel. */
async function openPanel(page) {
  await clickText(page, 'button, a', 'Leads');
  await sleep(1400);
  await clickText(page, '*', 'Whitfield');
  await sleep(2500);
  await clickText(page, 'button', 'Send for signature');
  await sleep(2500);
}

fs.mkdirSync(SHOTS, { recursive: true });
await ensureFixtures();
const db = pool();

// Two documents genuinely out for signature, and one signed on a job whose
// address never geocoded, so the board has to say why there is no distance.
const forPhone = await sentRequest(db, {
  kind: 'report', ref: 'e2e-sig-report', title: 'Roof Replacement Proposal — Whitfield',
  html: REPORT_HTML, message: 'Sign when you get a minute.',
});
const forRefusal = await sentRequest(db, { message: 'Sign when you get a minute.' });
const unlocated = await sentRequest(db, { title: 'Certificate of Completion (lot with no address)', located: false });
await db.query(
  `UPDATE signature_signers SET signed_at=now(), signed_name='Dana Whitfield', signature_kind='typed',
     ip='73.15.2.9', user_agent='Mozilla/5.0 (iPhone) Safari', geo=$2 WHERE request_id=$1`,
  [unlocated.request.id, JSON.stringify({
    source: 'gps', lat: 35.19, lng: -80.84, accuracyM: 12, address: 'Somewhere in Charlotte',
    city: 'Charlotte', region: 'NC', country: 'US', distanceFromPropertyM: null, capturedAt: new Date().toISOString(),
  })]);
await db.query(`UPDATE signature_requests SET status='signed', completed_at=now() WHERE id=$1`, [unlocated.request.id]);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

try {
  // ------------------------------------------------------- the rep's panel ----
  const app = await browser.newPage();
  await app.setViewport({ width: 1280, height: 1000 });
  const [, value] = cookies.rep.split('=');
  await app.setCookie({ name: 'connect.sid', value: decodeURIComponent(value), domain: '127.0.0.1', path: '/' });
  await app.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  T('ui: the forged session signs the rep in', !/sign in with google/i.test(await bodyText(app)));

  await openPanel(app);
  T('ui: the signature panel is on the client page', /Send for signature/i.test(await bodyText(app)));
  T('ui: it loads what can be sent', /Send a document for signature/i.test(await bodyText(app)));
  await app.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => (b.innerText || '').includes('Send for signature'))?.scrollIntoView({ block: 'start' }));
  await sleep(300);
  await shot(app, 'sig-01-panel');

  await clickText(app, 'button', 'Send a document for signature');
  await sleep(900);
  const composer = await bodyText(app);
  T('ui: the composer opens', /Which document/i.test(composer) && /Who signs it/i.test(composer));
  const options = await app.evaluate(() => [...document.querySelectorAll('select option')].map((o) => o.textContent).join(' | '));
  T('ui: it offers the documents the API listed', /Roof Replacement Proposal/i.test(options) && /Certificate of Completion/i.test(options), options.slice(0, 90));
  T('ui: the customer is prefilled', await app.evaluate(() => [...document.querySelectorAll('input')].some((i) => i.value === 'Dana Whitfield')));
  T('ui: both channels are on by default',
    await app.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).length >= 2));
  await shot(app, 'sig-02-composer');

  await clickText(app, 'button', '+ Another signer');
  await sleep(400);
  T('ui: a second signer can be added', await app.evaluate(() => document.querySelectorAll('input[placeholder="Full name"]').length) === 2);
  await clickText(app, 'button', '+ Countersign for Best Roofing Now');
  await sleep(400);
  T('ui: the rep can add themselves as a countersigner',
    await app.evaluate(() => document.querySelectorAll('input[placeholder="Full name"]').length) === 3);

  // Drop the empty row, then send. Delivery fails here by design.
  await app.evaluate(() => {
    const empty = [...document.querySelectorAll('input[placeholder="Full name"]')].find((n) => !n.value);
    empty?.closest('div.grid')?.querySelector('button[title=Remove]')?.click();
  });
  await sleep(400);
  await clickText(app, 'button', 'Send it');
  const told = await waitForText(app, /did not send|Couldn't send|didn't go out/i);
  T('ui: a send that cannot be delivered tells the rep so', !!told,
    (told || '').split('\n').find((l) => /didn't go out|Couldn't send/i.test(l)) || 'no message appeared in 25s');
  await app.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => (b.innerText || '').includes('Send for signature'))?.scrollIntoView({ block: 'start' }));
  await sleep(300);
  await shot(app, 'sig-03-send-failed');

  await app.reload({ waitUntil: 'networkidle2' });   // a reload drops SPA state back to Leads
  await sleep(1200);
  await openPanel(app);
  const board = await bodyText(app);
  T('ui: the board lists what has gone out', /Out for signature|Signed|Draft/.test(board));
  T('ui: it shows who signed and when', /Signed \w{3} \d/.test(board), (board.match(/Signed \w{3} \d+[^\n]*/) || [])[0]);
  T('ui: it shows where they signed', /the property|Charlotte/i.test(board), (board.match(/[^\n]*the property[^\n]*/) || [])[0]);
  T('ui: a signed document offers its PDF', /Signed PDF/.test(board));
  T('ui: an open one offers a reminder', /Remind/.test(board));
  const mapHref = await app.evaluate(() => document.querySelector('a[href*="google.com/maps"]')?.getAttribute('href') || '');
  T('ui: the location links to a map', /google\.com\/maps\?q=3[0-9]\./.test(mapHref), mapHref);
  T('ui: it says when the property could not be put on the map', /couldn't put this address on the map/i.test(board));
  await app.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => (b.innerText || '').includes('Send for signature'))?.scrollIntoView({ block: 'start' }));
  await sleep(500);
  await shot(app, 'sig-04-board');

  // ---------------------------------------------------- the customer's phone ----
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);
  await phone.setGeolocation({ latitude: NEARBY.lat + 0.0002, longitude: NEARBY.lng, accuracy: 9 });
  await phone.goto(`${BASE}/r/s/${forPhone.signers[0].token}`, { waitUntil: 'networkidle0' });
  await sleep(2500);

  const frame = await phone.evaluate(() => {
    const f = document.getElementById('docframe');
    return { present: !!f, height: parseInt(f?.style.height || '0', 10) };
  });
  T('ui: a designed document is shown in a frame', frame.present);
  T('ui: the frame grows to the document so the page scrolls once', frame.height > 600, `${frame.height}px`);
  T('ui: nothing scrolls sideways on a phone',
    await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  // The document runs in a sandbox without same-origin, so the page itself
  // can no longer reach into it (that is the point). Read it as its own frame.
  const docFrame = phone.frames().find((f) => /\/r\/s\/[^/]+\/document/.test(f.url()));
  T('ui: the document really renders inside it',
    /Roof Replacement Proposal/.test(docFrame ? await docFrame.evaluate(() => document.body?.innerText?.slice(0, 60) || '') : ''),
    docFrame ? docFrame.url() : 'no document frame');
  T('ui: the page cannot reach into the document (sandboxed)',
    await phone.evaluate(() => document.getElementById('docframe')?.contentDocument == null));
  T('ui: the page says the location was shared',
    /Location shared/i.test(await phone.evaluate(() => document.getElementById('geotext')?.textContent || '')));
  await shot(phone, 'sig-05-phone');

  await phone.evaluate(() => document.getElementById('canvas').scrollIntoView({ block: 'center' }));
  await sleep(400);
  const box = await (await phone.$('#canvas')).boundingBox();
  await phone.mouse.move(box.x + 25, box.y + 115);
  await phone.mouse.down();
  for (let i = 0; i < 36; i++) await phone.mouse.move(box.x + 25 + i * 6, box.y + 115 - Math.sin(i / 3.5) * 40);
  await phone.mouse.up();
  T('ui: the pad takes a signature', await phone.evaluate(() => document.getElementById('pad').classList.contains('inked')));
  await shot(phone, 'sig-06-drawn');

  await phone.evaluate(() => { document.querySelector('input[name=affirm]').checked = true; });
  await Promise.all([phone.waitForNavigation({ waitUntil: 'domcontentloaded' }), phone.click('#submit')]);
  T('ui: signing on a phone works', /this is signed/i.test(await bodyText(phone)));
  await shot(phone, 'sig-07-thanks');

  const { rows: [row] } = await db.query(`SELECT signature_kind, geo FROM signature_signers WHERE token=$1`, [forPhone.signers[0].token]);
  T('ui: the drawn signature was stored', row.signature_kind === 'drawn');
  T('ui: the GPS position was stored with it', row.geo?.source === 'gps', row.geo?.source);
  T('ui: it measured the signer against the property',
    typeof row.geo?.distanceFromPropertyM === 'number', `${row.geo?.distanceFromPropertyM} m from the roof`);

  // A fresh context has no geolocation permission: the refusal path.
  const ctx = await browser.createBrowserContext();
  const denied = await ctx.newPage();
  await denied.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await denied.goto(`${BASE}/r/s/${forRefusal.signers[0].token}`, { waitUntil: 'networkidle0' });
  await sleep(2500);
  const deniedText = await denied.evaluate(() => document.getElementById('geotext')?.textContent || '');
  T('ui: refusing location says so plainly and does not block',
    /not shared/i.test(deniedText) && /still sign/i.test(deniedText), deniedText.slice(0, 70));
  await denied.evaluate(() => {
    document.getElementById('usetyped').click();
    document.getElementById('name').value = 'Dana Whitfield';
    document.querySelector('input[name=affirm]').checked = true;
  });
  await Promise.all([denied.waitForNavigation({ waitUntil: 'domcontentloaded' }), denied.click('#submit')]);
  T('ui: a signer who refused location can still sign', /this is signed/i.test(await bodyText(denied)));
  await shot(denied, 'sig-08-location-refused');
} finally {
  await browser.close();
  await db.end();
}

const passed = results.filter((r) => r.ok).length;
console.log(`signature ui: PASS ${passed} FAIL ${results.length - passed} of ${results.length}  (screenshots: ${SHOTS})`);
for (const r of results.filter((x) => !x.ok)) console.log('FAIL:', r.name, '::', r.evidence);
process.exit(results.length === passed ? 0 : 1);
