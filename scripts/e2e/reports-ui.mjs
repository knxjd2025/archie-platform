/**
 * Chrome: a rep making commercial reports, the way a rep does it.
 *
 * The API suite proves the server builds the right documents. This drives the
 * screens: the New report form on a commercial job, the Inspection with the
 * photo scan and pricing, the Proposal's pinned layer diagram under a real
 * scroll, a tier tapped on the page, the editor's Commercial tab saved, and
 * every document on a phone. There are no component tests in this repo, so a
 * real browser is the only thing that can tell us these work.
 *
 * Needs api.mjs to have run first (it files the commercial inspection the job
 * is generated from).
 *
 *   E2E_UI=1 scripts/e2e/run.sh
 *   E2E_BASE=http://127.0.0.1:3999 E2E_COOKIES=/tmp/e2e/cookies.json node scripts/e2e/reports-ui.mjs
 *
 * Screenshots land in /tmp/e2e/shots. Look at them.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startScanStandIn } from './scan-standin.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3999';
const SHOTS = process.env.E2E_SHOTS || '/tmp/e2e/shots';
const OUT = process.env.E2E_REPORTS_OUT || '/tmp/e2e/reports-ui.json';
const CHROME = process.env.E2E_CHROME
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
const cookies = JSON.parse(fs.readFileSync(process.env.E2E_COOKIES || '/tmp/e2e/cookies.json', 'utf8'));
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const T = (name, ok, evidence = '') => { results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 240) }); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const shot = (page, name, fullPage = false) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage }).catch(() => {});
const PHOTOS = ['https://photos.example.com/north-seam.jpg', 'https://photos.example.com/drain-2.jpg', 'https://photos.example.com/unreadable.jpg'];

/** Click the first element whose own text starts with the needle. */
const clickText = (page, selector, needle) => page.evaluate((sel, txt) => {
  const el = [...document.querySelectorAll(sel)].find((e) => (e.innerText || '').trim().startsWith(txt));
  if (el) { el.click(); return true; }
  return false;
}, selector, needle);

async function waitFor(page, fn, ms = 20000, arg) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(300);
  }
}

async function signedIn(browser, role, width = 1280, height = 1000) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: 1 });
  const [, value] = cookies[role].split('=');
  await page.setCookie({ name: 'connect.sid', value: decodeURIComponent(value), domain: '127.0.0.1', path: '/' });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  return page;
}

async function openCommercialClient(page) {
  await clickText(page, 'button, a', 'Leads');
  await sleep(1500);
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a, tr, li, div')].filter((e) => /Warehouse LLC/.test(e.innerText || '') && e.children.length < 8);
    els[els.length - 1]?.click();
  });
  return waitFor(page, () => [...document.querySelectorAll('button')].some((b) => /New report/.test(b.innerText)));
}

/** The report rows on the client page, newest first, as { title, href }. */
const reportRows = (page) => page.evaluate(() => [...document.querySelectorAll('a')]
  .filter((a) => a.textContent.trim() === 'View' && /\/r\//.test(a.getAttribute('href') || ''))
  .map((a) => ({ href: a.getAttribute('href'), title: a.closest('.px-4')?.querySelector('p')?.textContent || '' })));

/** Generate from the open form and wait for the new row; returns its share link. */
async function generateAndWait(page, titleRe, before) {
  await clickText(page, 'button', 'Generate report');
  const row = await waitFor(page, ({ re, had }) => {
    const rows = [...document.querySelectorAll('a')].filter((a) => a.textContent.trim() === 'View' && /\/r\//.test(a.getAttribute('href') || ''));
    const hit = rows.find((a) => !had.includes(a.getAttribute('href')) && new RegExp(re).test(a.closest('.px-4')?.querySelector('p')?.textContent || ''));
    return hit ? hit.getAttribute('href') : null;
  }, 90000, { re: titleRe.source, had: before });
  return row;
}

/** Scroll a page to a fraction of an element's own travel and let it settle. */
async function scrollInto(page, selector, fraction) {
  await page.evaluate((sel, f) => {
    const el = document.querySelector(sel);
    const top = el.getBoundingClientRect().top + window.scrollY;
    const travel = Math.max(0, el.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top + travel * f, behavior: 'instant' });
  }, selector, fraction);
  await sleep(900);
}

const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

const standIn = await startScanStandIn().catch(() => null); // already up when run inside another suite
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

try {
  const rep = await signedIn(browser, 'rep');
  T('client: the rep reaches the commercial job', await openCommercialClient(rep));

  // ------------------------------------------------ the New report form ----
  await clickText(rep, 'button', '＋ New report');
  const formReady = await waitFor(rep, () => /Include options and pricing/.test(document.body.innerText));
  await shot(rep, 'r1-new-report-form', true);
  const formText = await bodyText(rep);
  T('form: on a commercial job the Inspection says what it is', /commercial condition report/i.test(formText) && /live diagram/i.test(formText), formText.match(/The commercial condition report[^.]*\./)?.[0]);
  T('form: pricing on the Inspection is offered, and off by default', formReady && await rep.evaluate(() => {
    const box = [...document.querySelectorAll('label')].find((l) => /Include options and pricing/.test(l.innerText))?.querySelector('input');
    return !!box && !box.checked && !/Roof size \(squares\)/.test(document.body.innerText);
  }));

  // Tick it: the three commercial systems and the roof size from the checklist are filled in.
  await rep.evaluate(() => [...document.querySelectorAll('label')].find((l) => /Include options and pricing/.test(l.innerText))?.querySelector('input')?.click());
  await sleep(600);
  const picked = await rep.evaluate(() => ({
    tiers: [...document.querySelectorAll('select')].map((s) => s.value).filter((v) => /dura_last|gaf_commercial/.test(v)),
    squares: document.querySelector('input[placeholder="e.g. 32"]')?.value,
    iso: /ISO insulation \(tear-off tiers\)/.test(document.body.innerText),
  }));
  T('form: ticking it fills the commercial systems, the ISO choice and the roof size', picked.tiers.length === 3 && picked.squares === '240' && picked.iso, JSON.stringify(picked));

  await rep.click('textarea[placeholder^="Extra photo URLs"]');
  await rep.keyboard.type(PHOTOS.join('\n'));
  await shot(rep, 'r2-form-priced', true);

  const before = (await reportRows(rep)).map((r) => r.href);
  const inspHref = await generateAndWait(rep, /Commercial Roof Condition Report/, before);
  const toast = await rep.evaluate(() => document.querySelector('.bg-gray-900.text-white')?.textContent || '');
  T('form: generating adds the Inspection to the list', !!inspHref, inspHref || (await bodyText(rep)).slice(0, 200));
  T('form: the rep is told the scan came up short on one photo', /2 of 3/.test(toast) || /2 of 3/.test(await bodyText(rep)), toast);

  // --------------------------------------------- the Inspection, desktop ----
  if (inspHref) {
    const doc = await browser.newPage();
    await doc.setViewport({ width: 1280, height: 900 });
    await doc.goto(BASE + inspHref, { waitUntil: 'networkidle2' });
    const text = await bodyText(doc);
    T('inspection: photos are described beside the inspector rating', /3 photos, 2 read and described/.test(text) && /The lap is open at the centre of the frame\./.test(text) && /Inspector's rating for seams and laps/i.test(text), text.match(/\d photos, [^\n]*/)?.[0]);
    T('inspection: options, what is included, and the commitments', /Your Options/.test(text) && /QUOTED/i.test(text) && /What Is Included/.test(text) && /Certificate of Insurance \(COI\) and our W-9 are provided to you before any work starts/.test(text) && /every permit is pulled before the start of work/.test(text));

    // The diagram plays as it rises through the screen.
    const progress = async (offset) => {
      await doc.evaluate((off) => { const d = document.querySelector('.asm-doc'); window.scrollTo(0, d.getBoundingClientRect().top + window.scrollY - window.innerHeight * off); }, offset);
      await sleep(700);
      return doc.evaluate(() => {
        const d = document.querySelector('.asm-doc'); const a = [...d.querySelectorAll('.asm')].find((x) => getComputedStyle(x).display !== 'none');
        const op = (sel) => [...a.querySelectorAll(sel)].map((e) => Number(getComputedStyle(e).opacity));
        return { p: Number(d.style.getPropertyValue('--sc-p')), tags: op('.asm-col--today .asm-tag'), fresh: op('.asm-col--after .is-new') };
      });
    };
    const entering = await progress(0.97);
    const middle = await progress(0.55);
    await shot(doc, 'r3-inspection-diagram-mid');
    const done = await progress(0.12);
    await shot(doc, 'r4-inspection-diagram-done');
    T('inspection: the diagram starts untagged, tags the layers, then builds the new roof as you scroll',
      entering.p < 0.1 && entering.tags.every((o) => o < 0.05)
      && middle.tags.every((o) => o > 0.95) && middle.fresh.some((o) => o < 0.95)
      && done.p > 0.95 && done.fresh.every((o) => o > 0.95),
      JSON.stringify({ entering: entering.p, middle: middle.p, midNew: middle.fresh, done: done.p }));

    T('inspection: the option the document opens on is marked as picked', await doc.evaluate(() => document.querySelector('[data-asm-pick="better"]')?.getAttribute('aria-pressed') === 'true'));

    // Another option, and a layer opened.
    await doc.evaluate(() => document.querySelector('[data-asm-pick="good"]').click());
    await sleep(300);
    const switched = await doc.evaluate(() => {
      const shown = [...document.querySelectorAll('.asm')].filter((x) => getComputedStyle(x).display !== 'none');
      const layer = shown[0]?.querySelector('[data-asm-layer="t-membrane"]'); layer?.click();
      return { tiers: shown.map((x) => x.getAttribute('data-asm-tier')).join(','), headline: shown[0]?.querySelector('.asm-headline')?.textContent, info: shown[0]?.querySelector('.asm-info.is-open')?.textContent };
    });
    T('inspection: tapping an option redraws the diagram, and tapping a layer explains it', switched.tiers === 'good' && /layover/i.test(switched.headline || '') && /stays/i.test(switched.info || ''), JSON.stringify(switched).slice(0, 220));
    await shot(doc, 'r5-inspection-layover-layer-open');
    await shot(doc, 'r6-inspection-full', true);

    const phone = await browser.newPage();
    await phone.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    await phone.goto(BASE + inspHref, { waitUntil: 'networkidle2' });
    await phone.evaluate(() => { const d = document.querySelector('.asm-doc'); window.scrollTo(0, d.getBoundingClientRect().top + window.scrollY - 60); });
    await sleep(800);
    const phoneState = await phone.evaluate(() => {
      const a = [...document.querySelectorAll('.asm')].find((x) => getComputedStyle(x).display !== 'none');
      const box = (e) => e.getBoundingClientRect();
      const today = a.querySelector('.asm-col--today'), after = a.querySelector('.asm-col--after');
      return { stacked: box(after).top >= box(today).bottom - 2, bothVisible: Number(getComputedStyle(today).opacity) > 0.9 && Number(getComputedStyle(after).opacity) > 0.9 };
    });
    T('inspection on a phone: both stacks show, one under the other, and nothing scrolls sideways', phoneState.stacked && phoneState.bothVisible && await noSidewaysScroll(phone), JSON.stringify(phoneState));
    await shot(phone, 'r7-inspection-phone');
    await phone.close();
    await doc.close();
  }

  // -------------------------------------------------- a Proposal, by form ----
  await clickText(rep, 'button', '＋ New report');
  await sleep(500);
  await rep.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Proposal' && b.getAttribute('aria-pressed') !== null)?.click());
  await sleep(500);
  const proposalForm = await rep.evaluate(() => ({
    tiers: [...document.querySelectorAll('select')].map((s) => s.value).filter((v) => /dura_last|gaf_commercial/.test(v)).length,
    squares: document.querySelector('input[placeholder="e.g. 32"]')?.value,
    pricingBox: /Include options and pricing/.test(document.body.innerText),
    ready: ![...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Generate report')?.disabled,
  }));
  T('form: a Proposal on a commercial job opens ready, with the commercial systems picked', proposalForm.tiers === 3 && proposalForm.squares === '240' && !proposalForm.pricingBox && proposalForm.ready, JSON.stringify(proposalForm));
  const before2 = (await reportRows(rep)).map((r) => r.href);
  const propHref = await generateAndWait(rep, /Commercial Roofing Proposal/, before2);
  T('form: generating adds the Proposal to the list', !!propHref, propHref);

  if (propHref) {
    const doc = await browser.newPage();
    await doc.setViewport({ width: 1280, height: 900 });
    await doc.goto(BASE + propHref, { waitUntil: 'networkidle2' });
    await sleep(800);
    await shot(doc, 'r8a-proposal-cover');
    const cover = await doc.evaluate(() => { const h = document.querySelector('.title-name'); const r = h.getBoundingClientRect(); return { text: h.innerText.trim(), opacity: Number(getComputedStyle(h).opacity), height: Math.round(r.height) }; });
    T('proposal: the cover shows who it is for', /Warehouse LLC/.test(cover.text) && cover.opacity > 0.9 && cover.height > 20, JSON.stringify(cover));
    const chapters = await doc.evaluate(() => document.querySelectorAll('main > section[id^="ch-"]').length);
    T('proposal: at least ten chapters, with the diagram and Before We Start', chapters >= 10 && await doc.evaluate(() => !!document.getElementById('ch-layers') && !!document.getElementById('ch-before-start') && !!document.getElementById('ch-company')), `chapters=${chapters}`);

    // The pinned diagram under a real scroll: the stage holds while the story plays.
    const at = async (f) => {
      await scrollInto(doc, '#ch-layers', f);
      return doc.evaluate(() => {
        const act = document.getElementById('ch-layers'); const stage = act.querySelector('[data-sc-stage]');
        const a = [...act.querySelectorAll('.asm')].find((x) => getComputedStyle(x).display !== 'none');
        const op = (sel) => [...a.querySelectorAll(sel)].map((e) => Number(getComputedStyle(e).opacity));
        const shell = act.querySelector('.asm-shell').getBoundingClientRect();
        return { stageTop: Math.round(stage.getBoundingClientRect().top), fits: shell.top >= -1 && shell.bottom <= window.innerHeight + 1, tags: op('.asm-col--today .asm-tag'), fresh: op('.asm-col--after .is-new'), phase: a.getAttribute('data-phase') };
      });
    };
    const start = await at(0.03);
    await shot(doc, 'r8-proposal-diagram-start');
    const mid = await at(0.5);
    await shot(doc, 'r9-proposal-diagram-mid');
    const end = await at(0.97);
    await shot(doc, 'r10-proposal-diagram-end');
    T('proposal: the diagram stage stays pinned and fits one screen while it plays', [start, mid, end].every((s) => Math.abs(s.stageTop) <= 2 && s.fits), JSON.stringify([start, mid, end].map((s) => [s.stageTop, s.fits])));
    T('proposal: scroll tags the old layers, then builds the new roof', start.tags.some((o) => o < 0.5) && mid.tags.every((o) => o > 0.95) && end.fresh.every((o) => o > 0.95) && start.phase === 'today' && end.phase === 'after', JSON.stringify({ start: start.tags, endNew: end.fresh, phases: [start.phase, mid.phase, end.phase] }));

    // Tap Good on the options; the diagram and the investment follow.
    await doc.evaluate(() => document.querySelector('.opt-card[data-tier="good"]').scrollIntoView({ block: 'center' }));
    await sleep(600);
    await doc.click('.opt-card[data-tier="good"]');
    await sleep(1600);
    const followed = await doc.evaluate(() => ({
      tier: document.documentElement.getAttribute('data-tier'),
      diagram: [...document.querySelectorAll('.asm')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.getAttribute('data-asm-tier')).join(','),
      chip: document.querySelector('[data-asm-pick="good"]')?.getAttribute('aria-pressed'),
      invName: document.querySelector('[data-inv-tier-name]')?.textContent,
    }));
    T('proposal: tapping Good on the options moves the diagram and the investment to Good', followed.tier === 'good' && followed.diagram === 'good' && followed.chip === 'true' && /layover/i.test(followed.invName || ''), JSON.stringify(followed));
    await shot(doc, 'r11-proposal-options');

    // And the other way: a chip on the diagram moves the options, without throwing the reader down the page.
    await scrollInto(doc, '#ch-layers', 0.6);
    const yBefore = await doc.evaluate(() => window.scrollY);
    await doc.evaluate(() => document.querySelector('[data-asm-pick="best"]').click());
    await sleep(900);
    const back = await doc.evaluate(() => ({ tier: document.documentElement.getAttribute('data-tier'), card: document.querySelector('.opt-card[data-tier="best"]')?.getAttribute('aria-selected'), y: window.scrollY }));
    T('proposal: a chip on the diagram moves the options too, and the page stays put', back.tier === 'best' && back.card === 'true' && Math.abs(back.y - yBefore) < 4, JSON.stringify({ ...back, yBefore }));

    await scrollInto(doc, '#ch-found', 0.15);
    await shot(doc, 'r12-proposal-photos');
    await scrollInto(doc, '#ch-before-start', 0);
    await shot(doc, 'r13-proposal-before-start');
    await doc.close();

    const phone = await browser.newPage();
    await phone.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    await phone.goto(BASE + propHref, { waitUntil: 'networkidle2' });
    await sleep(800);
    const pAt = async (f) => {
      await scrollInto(phone, '#ch-layers', f);
      return phone.evaluate(() => {
        const act = document.getElementById('ch-layers');
        const a = [...act.querySelectorAll('.asm')].find((x) => getComputedStyle(x).display !== 'none');
        const shell = act.querySelector('.asm-shell').getBoundingClientRect();
        const o = (sel) => Number(getComputedStyle(a.querySelector(sel)).opacity);
        return { fits: shell.top >= -1 && shell.bottom <= window.innerHeight + 1, shellH: Math.round(shell.height), today: o('.asm-col--today'), after: o('.asm-col--after'), phase: a.getAttribute('data-phase') };
      });
    };
    const p1 = await pAt(0.2);
    await shot(phone, 'r14-proposal-phone-today');
    const p2 = await pAt(0.95);
    await shot(phone, 'r15-proposal-phone-after');
    T('proposal on a phone: one stack at a time, today then the new roof, inside one screen', p1.fits && p2.fits && p1.today > 0.9 && p1.after < 0.1 && p2.today < 0.1 && p2.after > 0.9 && p1.phase === 'today' && p2.phase === 'after', JSON.stringify({ p1, p2 }));
    T('proposal on a phone: nothing scrolls sideways', await noSidewaysScroll(phone));
    await phone.close();

    // ------------------------------------------------------- the editor ----
    await rep.evaluate((href) => {
      const view = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === href);
      [...view.closest('.px-4').querySelectorAll('button')].find((b) => /Edit/.test(b.innerText))?.click();
    }, propHref);
    const opened = await waitFor(rep, () => [...document.querySelectorAll('nav button')].some((b) => /Commercial/.test(b.innerText)));
    T('editor: a commercial Proposal opens with the Commercial tab', opened);
    await waitFor(rep, () => !!document.querySelector('iframe[title="Report preview"]'));
    T('editor: every tab is on screen, none cut off at the edge of the rail', await rep.evaluate(() => {
      const nav = document.querySelector('aside nav'); const box = nav.getBoundingClientRect();
      return [...nav.querySelectorAll('button')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; });
    }));
    const layoutState = await rep.evaluate(() => ({
      pins: [...document.querySelectorAll('[aria-label="Always shown"]')].length,
      notes: [...document.querySelectorAll('button[aria-label^="Note on"]')].length,
      hint: /always runs at least 10 chapters/.test(document.body.innerText),
    }));
    T('editor: Layout marks the four chapters that are always shown and offers a note on each chapter', layoutState.pins === 4 && layoutState.notes > 10 && layoutState.hint, JSON.stringify(layoutState));

    // Pin a note to a chapter.
    await rep.evaluate(() => document.querySelector('button[aria-label="Note on Where the Water Goes"]')?.click());
    await sleep(300);
    await rep.type('textarea[aria-label="Note on Where the Water Goes"]', 'UI note: two drains added at the NE corner.');

    await rep.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /Commercial/.test(b.innerText))?.click());
    await sleep(500);
    await shot(rep, 'r16-editor-commercial-tab');
    const tabText = await bodyText(rep);
    T('editor: the Commercial tab shows the scan, the summary, the diagram, the list and your own chapters', /AI read 2 of 3 photos/.test(tabText) && /The Short Version/.test(tabText) && /Layer diagram/.test(tabText) && /Before We Start/.test(tabText) && /Your own chapters/.test(tabText) && /Always printed, word for word/.test(tabText));

    // The summary, a layer's wording, a new line on the list, and a chapter of the rep's own.
    const setValue = (selector, text, index = 0) => rep.evaluate((sel, value, i) => {
      const el = document.querySelectorAll(sel)[i];
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, selector, text, index);
    await rep.evaluate(() => { [...document.querySelectorAll('label')].find((l) => /The Short Version/.test(l.innerText))?.querySelector('textarea')?.setAttribute('data-e2e', 'summary'); });
    await setValue('textarea[data-e2e="summary"]', 'UI summary written by the rep.');
    await setValue('input[aria-label="Layer name"]', 'UI layer wording');
    await clickText(rep, 'button', '＋ Add a line');
    await sleep(200);
    const lines = await rep.evaluate(() => document.querySelectorAll('textarea[aria-label^="Line "]').length);
    await setValue('textarea[aria-label^="Line "]', 'UI term: site walk the week before.', lines - 1);
    await clickText(rep, 'button', '＋ Add a chapter');
    await sleep(200);
    await setValue('input[aria-label="Chapter title"]', 'UI Phasing Plan');
    await setValue('textarea[placeholder="What you want the owner to read"]', '## Week one\n- North half first');

    // The count climbs as each debounced preview lands; wait for it to settle on all five.
    await waitFor(rep, () => /5 unsaved change/i.test(document.body.innerText), 15000);
    const unsaved = await rep.evaluate(() => /(\d+) unsaved change/i.exec(document.body.innerText)?.[1]);
    T('editor: each change is counted as unsaved and previewed', Number(unsaved) === 5, `unsaved=${unsaved}`);
    const previewed = await waitFor(rep, async () => {
      const f = document.querySelector('iframe[title="Report preview"]');
      const html = await fetch(f.src).then((r) => r.text()).catch(() => '');
      return ['UI summary written by the rep.', 'UI layer wording', 'UI term: site walk the week before.', 'UI Phasing Plan', 'UI note: two drains added'].every((x) => html.includes(x));
    }, 15000);
    T('editor: the live preview carries all five edits before anything is saved', previewed);
    await shot(rep, 'r17-editor-with-edits');

    await clickText(rep, 'button', 'Save');
    const saved = await waitFor(rep, () => /Saved 5 changes/.test(document.body.innerText), 20000);
    T('editor: Save writes them', saved, (await bodyText(rep)).match(/Saved[^\n]*/)?.[0]);
    const after = await fetch(BASE + propHref).then((r) => r.text());
    T('editor: the customer\'s link now shows the edits', ['UI summary written by the rep.', 'UI layer wording', 'UI term: site walk the week before.', 'UI Phasing Plan', 'UI note: two drains added'].every((x) => after.includes(x)) && after.includes('Our Certificate of Insurance (COI) and our W-9 are provided to you before any work starts'));

    // Try to hide a required chapter: there is no control to do it with.
    await rep.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /Layout/.test(b.innerText))?.click());
    await sleep(400);
    const locks = await rep.evaluate(() => ['Before We Start', 'Company Information', 'Your Roof Today'].map((label) => !!document.querySelector(`button[aria-label="Hide ${label}"]`)));
    T('editor: the required chapters have no hide control', locks.every((x) => x === false), JSON.stringify(locks));
  }
} catch (e) {
  T('the browser suite ran to the end', false, e?.stack || e?.message || String(e));
} finally {
  await browser.close();
  await standIn?.close?.();
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`reports-ui: ${results.length - failed.length}/${results.length} passed`);
for (const f of failed) console.log(`  FAIL ${f.name} | ${f.evidence}`);
process.exit(failed.length ? 1 : 0);
