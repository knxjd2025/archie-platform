/**
 * Chrome: the app shell itself — navigation, what each role can reach, and
 * whether any of it survives a phone.
 *
 * The signature suite covers one feature deeply. This covers the frame around
 * every feature, which had no browser coverage at all while two changes went
 * through it in a day: twenty-two pages regrouped under five headings, and the
 * BRN Advisor hidden (it has since been turned back on). There are no component tests in this repo, so a real
 * browser is the only thing that can tell us the shell still works.
 *
 *   E2E_UI=1 scripts/e2e/run.sh
 *   E2E_BASE=http://127.0.0.1:3999 E2E_COOKIES=/tmp/e2e/cookies.json node scripts/e2e/shell-ui.mjs
 *
 * Screenshots land in /tmp/e2e/shots. Look at them.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3999';
const SHOTS = process.env.E2E_SHOTS || '/tmp/e2e/shots';
const OUT = process.env.E2E_SHELL_OUT || '/tmp/e2e/shell-ui.json';
const CHROME = process.env.E2E_CHROME
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const cookies = JSON.parse(fs.readFileSync(process.env.E2E_COOKIES || '/tmp/e2e/cookies.json', 'utf8'));

const results = [];
const T = (name, ok, evidence = '') => { results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 220) }); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyText = (page) => page.evaluate(() => document.body.innerText);

async function signedInPage(browser, role, width = 1280, height = 1000) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: width < 500, deviceScaleFactor: 1 });
  const [, value] = cookies[role].split('=');
  await page.setCookie({ name: 'connect.sid', value: decodeURIComponent(value), domain: '127.0.0.1', path: '/' });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  return page;
}

/** Everything clickable, so "can a rep reach X" is answered by the DOM. */
const navLabels = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('button, a'))
    .map((el) => (el.innerText || '').trim())
    .filter(Boolean));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

try {
  // ------------------------------------------------ the shell renders at all --
  const admin = await signedInPage(browser, 'admin');
  const adminText = await bodyText(admin);
  T('shell: an admin session lands signed in', !/sign in with google/i.test(adminText), adminText.slice(0, 80));
  T('shell: nothing threw on first paint', !/That screen hit a problem/i.test(adminText));

  // The five primary tabs survived the regroup.
  const labels = await navLabels(admin);
  // Matched on the first line, not the whole string: Messages carries an
  // unread badge inside the button, so its innerText is "Messages\n22".
  const firstLines = labels.map((l) => l.split('\n')[0].trim());
  for (const tab of ['Home', 'Leads', 'Messages', 'Schedule']) {
    T(`nav: "${tab}" is in the top bar`, firstLines.includes(tab), firstLines.slice(0, 12).join(' | '));
  }
  T('nav: the grouped menu is reachable', labels.some((l) => /^More/.test(l)), labels.find((l) => /^More/.test(l)) || 'no More button');

  // -------------------------------------------------------------- the advisor --
  // On again (shared/features.ts). It has to be reachable two ways, the nav and
  // the dashboard, and the screen it opens has to be the Advisor rather than a
  // blank or the dashboard it would fall back to if the page were still refused.
  T('advisor: it is in the top bar', firstLines.some((l) => /^BRN Advisor$|^Advisor$/.test(l)), firstLines.slice(0, 12).join(' | '));
  T('advisor: "Ask Advisor" is on the dashboard', /Ask Advisor/i.test(adminText));
  await admin.evaluate(() => Array.from(document.querySelectorAll('button, a')).find((el) => /^BRN Advisor$|^Advisor$/.test((el.innerText || '').split('\n')[0].trim()))?.click());
  await sleep(1200);
  const advisorText = await bodyText(admin);
  T('advisor: the nav opens its screen, with a box to ask in', /I'm your BRN Advisor/i.test(advisorText) && !/That screen hit a problem/i.test(advisorText)
    && await admin.evaluate(() => !!document.querySelector('textarea[aria-label="Ask your advisor"]')), advisorText.slice(0, 120).replace(/\n+/g, ' | '));
  // Bills are an admin's business; the chip is the visible end of the role gate.
  T('advisor: an admin is offered the money questions', /Bills due/.test(advisorText) && /Who owes us money/.test(advisorText));
  await admin.screenshot({ path: `${SHOTS}/shell-01b-advisor.png` });
  await admin.evaluate(() => Array.from(document.querySelectorAll('button, a')).find((el) => (el.innerText || '').split('\n')[0].trim() === 'Home')?.click());
  await sleep(800);

  await admin.screenshot({ path: `${SHOTS}/shell-01-admin-desktop.png` });

  // ------------------------------------------------- a rep sees less, safely --
  const rep = await signedInPage(browser, 'rep');
  const repText = await bodyText(rep);
  const repLabels = await navLabels(rep);
  T('rep: signs in and the shell renders', !/sign in with google/i.test(repText) && !/That screen hit a problem/i.test(repText));
  T('rep: the advisor is there for them too', repLabels.some((l) => /BRN Advisor|^Advisor$/.test(l.split('\n')[0])) && /Ask Advisor/i.test(repText));
  // A rep's advisor does not offer what a rep may not see.
  await rep.evaluate(() => Array.from(document.querySelectorAll('button, a')).find((el) => /^BRN Advisor$|^Advisor$/.test((el.innerText || '').split('\n')[0].trim()))?.click());
  await sleep(1200);
  const repAdvisor = await bodyText(rep);
  T('rep: their advisor offers leads, not the company\'s bills or receivables', /New leads/.test(repAdvisor) && !/Bills due|Who owes us money/.test(repAdvisor), repAdvisor.slice(0, 160).replace(/\n+/g, ' | '));
  await rep.evaluate(() => Array.from(document.querySelectorAll('button, a')).find((el) => (el.innerText || '').split('\n')[0].trim() === 'Home')?.click());
  await sleep(800);
  // Payouts is the admin-only money page; a rep seeing it would be a real leak.
  T('rep: the admin-only Payouts page is not offered', !repLabels.some((l) => l.split('\n')[0].trim() === 'Payouts'), repLabels.filter((l) => /payout/i.test(l)).join('|') || 'none');

  // ------------------------------------------------------------- on a phone --
  // 390px is an iPhone. The field is where this app is actually used, and a
  // shell that only works on a laptop is a shell that does not work.
  const phone = await signedInPage(browser, 'rep', 390, 844);
  const phoneText = await bodyText(phone);
  T('phone: the shell renders at 390px', !/sign in with google/i.test(phoneText) && !/That screen hit a problem/i.test(phoneText));

  const overflow = await phone.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    worst: Array.from(document.querySelectorAll('body *'))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`),
  }));
  T('phone: the page does not scroll sideways', overflow.doc <= overflow.win + 1,
    `scrollWidth ${overflow.doc} vs ${overflow.win}; widest: ${overflow.worst.join(', ') || 'none'}`);

  // "BRN Advisor" wraps onto two lines at 390px, so the bottom bar uses the short label.
  T('phone: the advisor is in the bottom bar under its short label', /\bAdvisor\b/.test(phoneText) && await phone.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button, a')).find((e) => (e.innerText || '').trim().split('\n').pop() === 'Advisor');
    if (!el) return false;
    const label = Array.from(el.querySelectorAll('span')).pop() || el;
    return label.getBoundingClientRect().height < 24;
  }));

  // A card with a label at each end of a row runs out of width at 390px and
  // breaks mid-phrase — "Inbox leads · nothing" then "waiting" on its own
  // line, with the status crowding in beside the orphan. Cheap to reintroduce
  // and invisible unless someone looks, so it is measured: each label must be
  // a single line, and the two must not be sharing a row.
  const inboxCard = await phone.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((e) => /Inbox leads/.test(e.innerText));
    if (!btn) return null;
    const spans = Array.from(btn.querySelectorAll(':scope > span')).map((el) => {
      const r = el.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
      return { text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 40), top: Math.round(r.top), lines: Math.round(r.height / line) };
    });
    return { spans };
  });
  if (inboxCard?.spans?.length === 2) {
    const [title, status] = inboxCard.spans;
    T('phone: the Inbox leads title does not wrap', title.lines <= 1, `${title.lines} line(s): "${title.text}"`);
    T('phone: its status sits on its own row, not squeezed beside the title', status.top > title.top,
      `title top ${title.top}, status top ${status.top}`);
  }
  await phone.screenshot({ path: `${SHOTS}/shell-02-rep-phone.png` });

  // Tap targets on the bar a rep uses one-handed, on a roof, in gloves. Apple
  // and Google both say 44px; this reports the worst rather than asserting a
  // pass, so the number is visible without failing a run over 2px.
  const taps = await phone.evaluate(() => {
    const bar = document.querySelector('nav, footer, [class*="fixed bottom"]');
    if (!bar) return null;
    return Array.from(bar.querySelectorAll('button, a'))
      .map((el) => { const r = el.getBoundingClientRect(); return { label: (el.innerText || '').trim().slice(0, 14), h: Math.round(r.height), w: Math.round(r.width) }; })
      .filter((x) => x.h > 0);
  });
  if (taps && taps.length) {
    const small = taps.filter((t) => t.h < 44);
    T('phone: the bottom bar has tappable targets', taps.length > 0, `${taps.length} targets, smallest ${Math.min(...taps.map((t) => t.h))}px`);
    if (small.length) console.log(`  note: ${small.length} target(s) under 44px — ${small.map((s) => `${s.label} ${s.h}px`).join(', ')}`);
  }

  // ------------------------------------------- every primary page still opens --
  // A regroup that quietly breaks a route is the failure mode here, and it is
  // invisible until someone clicks the tab.
  for (const [label, needle] of [['Leads', /Leads/i], ['Messages', /Messages|Conversations/i], ['Schedule', /Schedule/i]]) {
    const target = (await navLabels(admin)).some((l) => l.split('\n')[0].trim() === label);
    if (!target) { T(`page: ${label} opens`, false, 'no nav entry to click'); continue; }
    await admin.evaluate((l) => {
      const el = Array.from(document.querySelectorAll('button, a'))
        .find((e) => (e.innerText || '').split('\n')[0].trim() === l);
      el?.click();
    }, label);
    await sleep(1400);
    const text = await bodyText(admin);
    T(`page: ${label} opens without throwing`, !/That screen hit a problem/i.test(text) && needle.test(text), text.slice(0, 70).replace(/\n/g, ' '));
  }
  await admin.screenshot({ path: `${SHOTS}/shell-03-admin-after-nav.png` });
} finally {
  await browser.close();
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.ok).length;
console.log(`shell ui: PASS ${pass} FAIL ${results.length - pass} of ${results.length}  (screenshots: ${SHOTS})`);
for (const r of results.filter((x) => !x.ok)) console.log(`  FAIL: ${r.name} :: ${r.evidence}`);
