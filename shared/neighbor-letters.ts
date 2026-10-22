/**
 * The three neighbor letters a rep sends while a roof goes up nearby:
 * a door-knock leave-behind, a neighbor email, and a mailed letter. James's
 * templates, filled from the job (street), the rep (name, cell), the
 * approved proposal (what the neighbor is getting) and the verified brand
 * facts (review count). Pure — used by the server for prefill and by the
 * client for the live preview and print, so both always agree.
 *
 * Rules carried over from the templates: never the customer's name or house
 * number; the email keeps its CAN-SPAM footer; the mailer says "recently"
 * because it may land after the job is done.
 */

export type LetterKind = 'leave_behind' | 'email' | 'mailer';

export const LETTER_KINDS: Array<{ kind: LetterKind; label: string; use: string }> = [
  { kind: 'leave_behind', label: 'Door-knock leave-behind', use: 'Leave at neighbor doors while the roof is going on.' },
  { kind: 'email', label: 'Neighbor email', use: 'Send from GHL so the unsubscribe link works. Shorter — people skim email.' },
  { kind: 'mailer', label: 'Mailed letter', use: 'Mail within 1–2 weeks of the install, including homes you could not reach.' },
];

export interface LetterFields {
  repName: string;
  repCell: string;
  /** Street only — never the house number. */
  streetName: string;
  /** Neighborhood name, or "this area" / "your area". */
  neighborhood: string;
  /** Year homes were built, or "the same time". */
  yearBuilt: string;
  reviewCount: string;
  /** "What your neighbor is getting" — up to three lines; empty = section omitted. */
  gettingLines: string[];
  /** A storm/insurance job changes the "didn't wait" paragraph so it stays true. */
  insuranceJob: boolean;
  /** Mailer only. */
  date: string;
  recipientName: string;
  mailingAddress: string;
  mailingCityStateZip: string;
  /** Email only: which subject line, and the two button links. */
  subjectIndex: number;
  estimateUrl: string;
  bookingUrl: string;
  /** Company mailing address for the email footer. */
  officeAddress: string;
}

export const OFFICE_PHONE = '(704) 605-6047';
export const OFFICE_ADDRESS_DEFAULT = '10130 Mallard Creek Road, Suite 300, Charlotte, NC 28262';
export const SITE = 'bestroofingnow.com';
export const HUB = 'charlotteroofinghub.com';

/** "550 Manning Dr, Charlotte, NC 28209, USA" → "Manning Dr". Never the number. */
export function streetOnly(address: string | null | undefined): string {
  const first = String(address || '').split(',')[0].trim();
  return first.replace(/^\s*\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+/, '').replace(/\s+(apt|unit|ste|suite|#)\s*\S*$/i, '').trim();
}

/** "5.0★ on Google · 65+ reviews" → "65". Rounded down to the nearest 5, as the template says. */
export function reviewCountFrom(stat: string | null | undefined): string {
  const m = String(stat || '').match(/(\d+)\s*\+?\s*reviews/i);
  if (!m) return '65';
  const n = Math.floor(Number(m[1]) / 5) * 5;
  return String(n || Number(m[1]));
}

export const SUBJECT_LINES = (f: Pick<LetterFields, 'streetName'>) => [
  `A new roof is going up on ${f.streetName || 'your street'}`,
  `Your neighbor on ${f.streetName || 'your street'} just planned ahead`,
  'Is your roof the same age as your neighbor\'s?',
];

export function defaultFields(over: Partial<LetterFields> = {}): LetterFields {
  return {
    repName: '', repCell: '', streetName: '', neighborhood: 'this area', yearBuilt: 'the same time', reviewCount: '65',
    gettingLines: [], insuranceJob: false,
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    recipientName: 'Current Resident', mailingAddress: '', mailingCityStateZip: '',
    subjectIndex: 0, estimateUrl: `https://${SITE}`, bookingUrl: `https://${SITE}`, officeAddress: OFFICE_ADDRESS_DEFAULT,
    ...over,
  };
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nb = (f: LetterFields, your: boolean) => f.neighborhood.trim() || (your ? 'your area' : 'this area');
const yr = (f: LetterFields) => f.yearBuilt.trim() || 'the same time';

/** The "didn't wait" paragraph, in the tense each letter uses, kept true on a storm job. */
function didntWait(f: LetterFields, tense: 'now' | 'recent'): string {
  const street = f.streetName || 'your street';
  if (f.insuranceJob) {
    return tense === 'now'
      ? `This week we're putting a brand new roof on a home right here on ${street}. Their roof was damaged in a storm, and rather than wait for a small problem to turn into a big one, they had it taken care of.`
      : `We recently installed a brand new roof for one of your neighbors on ${street}. Their roof was damaged in a storm, and rather than wait for a small problem to become a big one, they had it taken care of.`;
  }
  return tense === 'now'
    ? `This week we're putting a brand new roof on a home right here on ${street}. The homeowner didn't wait for a small problem to turn into a big one. They knew their roof had reached that age and chose to take care of it on their own schedule.`
    : `We recently installed a brand new roof for one of your neighbors on ${street}. They didn't wait for a small problem to become a big one. Their roof had reached that age, and they chose to replace it on their own schedule.`;
}

function trustBullets(f: LetterFields, long: boolean): string[] {
  return long
    ? [
      'Angi Super Service Award winner 4 years in a row',
      `A perfect 5-star Google rating with ${f.reviewCount}+ reviews`,
      'BBB A+ rated and accredited since 2021',
      '500+ roofs completed across the Charlotte area',
      'A 15-year workmanship warranty backed by CertainTeed, a certification only 21 companies hold',
    ]
    : [
      'Angi Super Service Award, 4 years in a row',
      `5-star Google rating with ${f.reviewCount}+ reviews`,
      'BBB A+ rated',
      '500+ roofs completed in the Charlotte area',
      '15-year workmanship warranty backed by CertainTeed',
    ];
}

export interface RenderedLetter {
  /** Plain text, ready to paste. */
  text: string;
  /** Simple HTML for email / print. */
  html: string;
  subject?: string;
  previewText?: string;
}

const P = (s: string) => `<p>${esc(s)}</p>`;
const UL = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

export function renderLeaveBehind(f: LetterFields): RenderedLetter {
  const rep = f.repName || '[Rep Name]';
  const getting = f.gettingLines.map((l) => l.trim()).filter(Boolean);
  const lines: string[] = [
    'Hi Neighbor,',
    `My name is ${rep} with Best Roofing Now, a locally owned, father and son roofing company here in Charlotte.`,
    didntWait(f, 'now'),
    `Many homes in ${nb(f, false)} were built around ${yr(f)}, so a lot of roofs around here are at that same stage. Planning ahead lets you pick your timing, your colors, and your budget, without the stress of a surprise leak.`,
    'Why your neighbors trust us:',
    ...trustBullets(f, true).map((b) => `• ${b}`),
    ...(getting.length ? ['What your neighbor is getting:', ...getting.map((g) => `• ${g}`)] : []),
    'Curious what a new roof would cost?',
    `Try our free instant estimate tool at ${SITE}. It uses satellite measurements of your home to give you a quick price range in about 60 seconds. No phone call needed.`,
    'Doing your homework?',
    `Visit ${HUB}, a free guide to Charlotte roofing with local companies, costs, and tips for choosing a roofer.`,
    "When you're ready for a closer look, we offer a free drone roof inspection with a full photo report. If your roof has years left, we'll tell you. If it's getting close, we'll show you options with color previews on your own home. No pressure.",
    'Thank you for your patience with the noise and trucks. Our crew cleans up every day and runs a magnet sweep for nails when we finish. If anything lands in your yard, call me and we\'ll fix it right away.',
    'Schedule your free inspection:',
    `${rep}: ${f.repCell || '[Rep Cell]'}`,
    `Office: ${OFFICE_PHONE}`,
    SITE,
    'Thank you,',
    rep,
    'Best Roofing Now',
  ];
  const html = [
    P('Hi Neighbor,'), P(lines[1]), P(lines[2]), P(lines[3]),
    `<p><b>Why your neighbors trust us:</b></p>`, UL(trustBullets(f, true)),
    ...(getting.length ? [`<p><b>What your neighbor is getting:</b></p>`, UL(getting)] : []),
    `<p><b>Curious what a new roof would cost?</b><br>${esc(lines[lines.indexOf('Curious what a new roof would cost?') + 1])}</p>`,
    `<p><b>Doing your homework?</b><br>${esc(`Visit ${HUB}, a free guide to Charlotte roofing with local companies, costs, and tips for choosing a roofer.`)}</p>`,
    P(lines[lines.indexOf('Doing your homework?') + 2]), P(lines[lines.indexOf('Doing your homework?') + 3]),
    `<p><b>Schedule your free inspection:</b><br>${esc(rep)}: ${esc(f.repCell || '[Rep Cell]')}<br>Office: ${OFFICE_PHONE}<br>${SITE}</p>`,
    `<p>Thank you,<br>${esc(rep)}<br>Best Roofing Now</p>`,
  ].join('\n');
  return { text: lines.join('\n\n'), html };
}

export function renderEmail(f: LetterFields): RenderedLetter {
  const rep = f.repName || '[Rep Name]';
  const subjects = SUBJECT_LINES(f);
  const subject = subjects[Math.min(Math.max(f.subjectIndex, 0), subjects.length - 1)];
  const previewText = `Free drone inspection while we're in ${nb(f, true)}.`;
  const body = [
    'Hi Neighbor,',
    `I'm ${rep} with Best Roofing Now, a locally owned, father and son roofing company in Charlotte.`,
    f.insuranceJob
      ? `We're replacing a roof right now on ${f.streetName || 'your street'}. It was damaged in a storm, and the homeowner had it taken care of rather than wait for a leak.`
      : `We're replacing a roof right now on ${f.streetName || 'your street'}. The homeowner didn't wait for a leak. Their roof reached that age, so they took care of it on their own schedule.`,
    `Homes in ${nb(f, true)} were built around ${yr(f)}, so many roofs nearby are at that same point. Planning ahead means you choose the timing, colors, and budget instead of reacting to an emergency.`,
    'Why homeowners choose us:',
    ...trustBullets(f, false).map((b) => `• ${b}`),
    'Want a quick idea of cost? Our free instant estimate tool gives you a price range in about 60 seconds using satellite measurements. No call needed.',
    `Get My Instant Estimate: ${f.estimateUrl}`,
    `Researching roofers? ${HUB} is a free guide to Charlotte roofing with local companies, costs, and hiring tips.`,
    "Ready for a closer look? Book a free drone roof inspection with a photo report. If your roof has years left, we'll tell you. No pressure.",
    `Book My Free Inspection: ${f.bookingUrl}`,
    'Or just reply to this email or call me.',
    `Thanks,\n${rep}\nBest Roofing Now\n${f.repCell || '[Rep Cell]'} | Office: ${OFFICE_PHONE}\n${SITE}`,
    `Best Roofing Now LLC, ${f.officeAddress}\nYou're receiving this because you live near a Best Roofing Now project. [Unsubscribe]`,
  ];
  const btn = (label: string, url: string) => `<p><a href="${esc(url)}" style="display:inline-block;background:#b8322b;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(label)}</a></p>`;
  const html = [
    P(body[0]), P(body[1]), P(body[2]), P(body[3]),
    `<p><b>Why homeowners choose us:</b></p>`, UL(trustBullets(f, false)),
    P(body[body.indexOf('Want a quick idea of cost? Our free instant estimate tool gives you a price range in about 60 seconds using satellite measurements. No call needed.')]),
    btn('Get My Instant Estimate', f.estimateUrl),
    P(`Researching roofers? ${HUB} is a free guide to Charlotte roofing with local companies, costs, and hiring tips.`),
    P("Ready for a closer look? Book a free drone roof inspection with a photo report. If your roof has years left, we'll tell you. No pressure."),
    btn('Book My Free Inspection', f.bookingUrl),
    P('Or just reply to this email or call me.'),
    `<p>Thanks,<br>${esc(rep)}<br>Best Roofing Now<br>${esc(f.repCell || '[Rep Cell]')} | Office: ${OFFICE_PHONE}<br>${SITE}</p>`,
    `<p style="font-size:12px;color:#6b7280">Best Roofing Now LLC, ${esc(f.officeAddress)}<br>You're receiving this because you live near a Best Roofing Now project. <a href="{{unsubscribe_link}}">Unsubscribe</a></p>`,
  ].join('\n');
  return { text: body.join('\n\n'), html, subject, previewText };
}

export function renderMailer(f: LetterFields): RenderedLetter {
  const rep = f.repName || '[Rep Name]';
  const who = f.recipientName.trim() || 'Current Resident';
  const dear = who === 'Current Resident' ? 'Neighbor' : who;
  const lines = [
    f.date,
    [who, f.mailingAddress, f.mailingCityStateZip].filter((s) => s && s.trim()).join('\n'),
    `Dear ${dear},`,
    `My name is ${rep} with Best Roofing Now, a locally owned, father and son roofing company here in Charlotte.`,
    didntWait(f, 'recent'),
    `Homes in ${nb(f, true)} were built around ${yr(f)}, so your roof may be at a similar stage. Planning ahead gives you control over timing, colors, and budget, instead of making a rushed decision after a leak.`,
    'Why homeowners across Charlotte choose us:',
    ...trustBullets(f, true).map((b) => `• ${b}`),
    'Three easy ways to take the next step:',
    `• Get a quick price range: Use our free instant estimate tool at ${SITE}. It measures your roof by satellite and gives you a range in about 60 seconds.`,
    `• Do your research: Visit ${HUB}, a free guide to Charlotte roofing with local companies, costs, and tips for choosing a roofer.`,
    "• See your roof up close: Call for a free drone roof inspection with a full photo report. If your roof has years left, we'll tell you. If it's getting close, we'll show you options with color previews on your own home. No pressure.",
    "I'd be glad to answer any questions, even if you're just curious how much life your roof has left.",
    `Sincerely,\n\n\n${rep}\nBest Roofing Now\n${f.repCell || '[Rep Cell]'} | Office: ${OFFICE_PHONE}\n${SITE}`,
    `P.S. Mention this letter when you call and we'll put you on the schedule while our crews are still working in ${nb(f, true)}.`,
  ];
  const html = [
    P(f.date),
    `<p>${[who, f.mailingAddress, f.mailingCityStateZip].filter((s) => s && s.trim()).map(esc).join('<br>')}</p>`,
    P(`Dear ${dear},`), P(lines[3]), P(lines[4]), P(lines[5]),
    `<p><b>Why homeowners across Charlotte choose us:</b></p>`, UL(trustBullets(f, true)),
    `<p><b>Three easy ways to take the next step:</b></p>`,
    `<ul><li><b>Get a quick price range:</b> ${esc(`Use our free instant estimate tool at ${SITE}. It measures your roof by satellite and gives you a range in about 60 seconds.`)} <span data-qr="${esc(f.estimateUrl)}"></span></li>` +
    `<li><b>Do your research:</b> ${esc(`Visit ${HUB}, a free guide to Charlotte roofing with local companies, costs, and tips for choosing a roofer.`)}</li>` +
    `<li><b>See your roof up close:</b> ${esc("Call for a free drone roof inspection with a full photo report. If your roof has years left, we'll tell you. If it's getting close, we'll show you options with color previews on your own home. No pressure.")}</li></ul>`,
    P(lines[lines.length - 3]),
    `<p>Sincerely,</p><p style="height:48px"></p><p>${esc(rep)}<br>Best Roofing Now<br>${esc(f.repCell || '[Rep Cell]')} | Office: ${OFFICE_PHONE}<br>${SITE}</p>`,
    P(lines[lines.length - 1]),
  ].join('\n');
  return { text: lines.join('\n\n'), html };
}

export function renderLetter(kind: LetterKind, f: LetterFields): RenderedLetter {
  return kind === 'email' ? renderEmail(f) : kind === 'mailer' ? renderMailer(f) : renderLeaveBehind(f);
}

/** Anything still in [brackets] is a field the rep has not filled in. */
export function unfilledPlaceholders(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1]))).filter((p) => p !== 'Unsubscribe');
}
