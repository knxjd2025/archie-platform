/**
 * The three neighbor letters a rep sends while a roof goes up nearby:
 * a door-knock leave-behind, a neighbor email, and a mailed letter. Filled
 * from the job (street), the rep (name, cell), the approved proposal (what
 * the neighbor is getting) and the company's own profile (name, phone,
 * website, the claims it has entered about itself). Pure — used by the server
 * for prefill and by the client for the live preview and print, so both
 * always agree.
 *
 * Rules carried over from the templates: never the customer's name or house
 * number; the email keeps its CAN-SPAM footer; the mailer says "recently"
 * because it may land after the job is done. And the company's rule: no
 * claim the company has not entered. A trust line, the estimate tool or the
 * booking link that is not set is left out, not invented.
 */
import type { CompanyProfile } from './company';

export type LetterKind = 'leave_behind' | 'email' | 'mailer';

export const LETTER_KINDS: Array<{ kind: LetterKind; label: string; use: string }> = [
  { kind: 'leave_behind', label: 'Door-knock leave-behind', use: 'Leave at neighbor doors while the roof is going on.' },
  { kind: 'email', label: 'Neighbor email', use: 'Send from GHL so the unsubscribe link works. Shorter — people skim email.' },
  { kind: 'mailer', label: 'Mailed letter', use: 'Mail within 1–2 weeks of the install, including homes you could not reach.' },
];

/** The company the letters are from (letterCompanyFrom). */
export interface LetterCompany {
  /** Name in sentences. Empty shows "[Company Name]" for the rep to fill. */
  name: string;
  /** Name in the email's mailing footer. */
  legalName: string;
  /** e.g. "roofing". */
  trade: string;
  /** Office phone, or '' to leave the office line out. */
  phone: string;
  /** Website without the scheme, or ''. */
  website: string;
  /** Where the company is, for "here in …", or ''. */
  area: string;
  /** Claims the company has entered about itself (reviews, credentials, warranty). Empty leaves the section out. */
  trustLines: string[];
  /** Brand color (#rrggbb) for the email's buttons. */
  color: string;
}

export const EMPTY_LETTER_COMPANY: LetterCompany = { name: '', legalName: '', trade: '', phone: '', website: '', area: '', trustLines: [], color: '#1F3A5F' };

/** The letters' view of a company profile: only what the company entered. */
export function letterCompanyFrom(p: Pick<CompanyProfile, 'displayName' | 'legalName' | 'trade' | 'phone' | 'websiteLabel' | 'city' | 'trustStats' | 'credentials' | 'workmanshipWarranty' | 'colors'>): LetterCompany {
  return {
    name: p.displayName,
    legalName: p.legalName || p.displayName,
    trade: p.trade,
    phone: p.phone,
    website: p.websiteLabel,
    area: p.city,
    trustLines: [...p.trustStats, ...p.credentials, p.workmanshipWarranty].map((t) => (t || '').trim()).filter(Boolean).slice(0, 5),
    color: p.colors.primary,
  };
}

/** The company's mailing address on one line, for the email footer, or '' when it has none. */
export function officeAddressOf(p: Pick<CompanyProfile, 'address' | 'city' | 'state' | 'zip'>): string {
  return [p.address, p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export interface LetterFields {
  repName: string;
  repCell: string;
  /** Street only — never the house number. */
  streetName: string;
  /** Neighborhood name, or "this area" / "your area". */
  neighborhood: string;
  /** Year homes were built, or "the same time". */
  yearBuilt: string;
  /** "What your neighbor is getting" — up to three lines; empty = section omitted. */
  gettingLines: string[];
  /** A storm/insurance job changes the "didn't wait" paragraph so it stays true. */
  insuranceJob: boolean;
  /** Mailer only. */
  date: string;
  recipientName: string;
  mailingAddress: string;
  mailingCityStateZip: string;
  /** Email only: which subject line. */
  subjectIndex: number;
  /** The company's estimate-tool link, or '' to leave that offer out. */
  estimateUrl: string;
  /** The company's booking link, or '' to leave the button out. */
  bookingUrl: string;
  /** Company mailing address for the email footer. */
  officeAddress: string;
  /** Who the letters are from. */
  company: LetterCompany;
}

/** "550 Manning Dr, Springfield, IL 62701, USA" → "Manning Dr". Never the number. */
export function streetOnly(address: string | null | undefined): string {
  const first = String(address || '').split(',')[0].trim();
  return first.replace(/^\s*\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+/, '').replace(/\s+(apt|unit|ste|suite|#)\s*\S*$/i, '').trim();
}

export const SUBJECT_LINES = (f: Pick<LetterFields, 'streetName'>) => [
  `A new roof is going up on ${f.streetName || 'your street'}`,
  `Your neighbor on ${f.streetName || 'your street'} just planned ahead`,
  'Is your roof the same age as your neighbor\'s?',
];

export function defaultFields(over: Partial<LetterFields> = {}): LetterFields {
  return {
    repName: '', repCell: '', streetName: '', neighborhood: 'this area', yearBuilt: 'the same time',
    gettingLines: [], insuranceJob: false,
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    recipientName: 'Current Resident', mailingAddress: '', mailingCityStateZip: '',
    subjectIndex: 0, estimateUrl: '', bookingUrl: '', officeAddress: '',
    ...over,
    company: { ...EMPTY_LETTER_COMPANY, ...(over.company ?? {}) },
  };
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nb = (f: LetterFields, your: boolean) => f.neighborhood.trim() || (your ? 'your area' : 'this area');
const yr = (f: LetterFields) => f.yearBuilt.trim() || 'the same time';
const co = (f: LetterFields) => f.company.name.trim() || '[Company Name]';
const legal = (f: LetterFields) => f.company.legalName.trim() || co(f);
const linkLabel = (url: string) => url.replace(/^https?:\/\//i, '').replace(/\/$/, '');

/** "My name is … with Acme Roofing, a roofing company here in Springfield." — only what the company entered. */
function intro(f: LetterFields, rep: string, lead: 'My name is' | "I'm"): string {
  const where = f.company.area.trim();
  const trade = f.company.trade.trim() || 'roofing';
  return `${lead} ${rep} with ${co(f)}${where ? `, a ${trade} company here in ${where}` : ''}.`;
}

/** The sign-off lines under the rep's name: company, then whichever contact details exist. */
function signoff(f: LetterFields, rep: string): string[] {
  return [
    rep,
    co(f),
    [f.repCell || '[Rep Cell]', f.company.phone ? `Office: ${f.company.phone}` : ''].filter(Boolean).join(' | '),
    f.company.website,
  ].filter(Boolean);
}

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
  const trust = f.company.trustLines;
  const estimate = f.estimateUrl.trim();
  const closer = "When you're ready for a closer look, we'll inspect your roof and give you a photo report. If your roof has years left, we'll tell you. If it's getting close, we'll show you your options. No pressure.";
  const thanks = "Thank you for your patience with the noise and trucks. If anything lands in your yard, call me and we'll take care of it right away.";
  const lines: string[] = [
    'Hi Neighbor,',
    intro(f, rep, 'My name is'),
    didntWait(f, 'now'),
    `Many homes in ${nb(f, false)} were built around ${yr(f)}, so a lot of roofs around here are at that same stage. Planning ahead lets you pick your timing, your colors, and your budget, without the stress of a surprise leak.`,
    ...(trust.length ? ['Why your neighbors trust us:', ...trust.map((b) => `• ${b}`)] : []),
    ...(getting.length ? ['What your neighbor is getting:', ...getting.map((g) => `• ${g}`)] : []),
    ...(estimate ? ['Curious what a new roof would cost?', `Get a quick price range online at ${linkLabel(estimate)}. No phone call needed.`] : []),
    closer,
    thanks,
    'Schedule your inspection:',
    `${rep}: ${f.repCell || '[Rep Cell]'}`,
    ...(f.company.phone ? [`Office: ${f.company.phone}`] : []),
    ...(f.company.website ? [f.company.website] : []),
    'Thank you,',
    rep,
    co(f),
  ];
  const html = [
    P('Hi Neighbor,'), P(intro(f, rep, 'My name is')), P(didntWait(f, 'now')), P(lines[3]),
    ...(trust.length ? [`<p><b>Why your neighbors trust us:</b></p>`, UL(trust)] : []),
    ...(getting.length ? [`<p><b>What your neighbor is getting:</b></p>`, UL(getting)] : []),
    ...(estimate ? [`<p><b>Curious what a new roof would cost?</b><br>${esc(`Get a quick price range online at ${linkLabel(estimate)}. No phone call needed.`)}</p>`] : []),
    P(closer), P(thanks),
    `<p><b>Schedule your inspection:</b><br>${[`${esc(rep)}: ${esc(f.repCell || '[Rep Cell]')}`, f.company.phone ? `Office: ${esc(f.company.phone)}` : '', esc(f.company.website)].filter(Boolean).join('<br>')}</p>`,
    `<p>Thank you,<br>${esc(rep)}<br>${esc(co(f))}</p>`,
  ].join('\n');
  return { text: lines.join('\n\n'), html };
}

export function renderEmail(f: LetterFields): RenderedLetter {
  const rep = f.repName || '[Rep Name]';
  const subjects = SUBJECT_LINES(f);
  const subject = subjects[Math.min(Math.max(f.subjectIndex, 0), subjects.length - 1)];
  const previewText = `A new roof is going up in ${nb(f, true)}.`;
  const trust = f.company.trustLines;
  const estimate = f.estimateUrl.trim();
  const booking = f.bookingUrl.trim();
  const now = f.insuranceJob
    ? `We're replacing a roof right now on ${f.streetName || 'your street'}. It was damaged in a storm, and the homeowner had it taken care of rather than wait for a leak.`
    : `We're replacing a roof right now on ${f.streetName || 'your street'}. The homeowner didn't wait for a leak. Their roof reached that age, so they took care of it on their own schedule.`;
  const age = `Homes in ${nb(f, true)} were built around ${yr(f)}, so many roofs nearby are at that same point. Planning ahead means you choose the timing, colors, and budget instead of reacting to an emergency.`;
  const estimateLine = 'Want a quick idea of cost? Get a price range online. No call needed.';
  const closer = "Ready for a closer look? We'll inspect your roof and send you a photo report. If your roof has years left, we'll tell you. No pressure.";
  const sign = signoff(f, rep);
  const footer = `${legal(f)}${f.officeAddress ? `, ${f.officeAddress}` : ', [Mailing Address]'}`;
  const body = [
    'Hi Neighbor,',
    intro(f, rep, "I'm"),
    now,
    age,
    ...(trust.length ? ['Why homeowners choose us:', ...trust.map((b) => `• ${b}`)] : []),
    ...(estimate ? [estimateLine, `Get My Price Range: ${estimate}`] : []),
    closer,
    ...(booking ? [`Book My Inspection: ${booking}`] : []),
    'Or just reply to this email or call me.',
    `Thanks,\n${sign.join('\n')}`,
    `${footer}\nYou're receiving this because you live near a ${co(f)} project. [Unsubscribe]`,
  ];
  const btn = (label: string, url: string) => `<p><a href="${esc(url)}" style="display:inline-block;background:${/^#[0-9a-f]{6}$/i.test(f.company.color) ? f.company.color : '#1F3A5F'};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(label)}</a></p>`;
  const html = [
    P('Hi Neighbor,'), P(intro(f, rep, "I'm")), P(now), P(age),
    ...(trust.length ? [`<p><b>Why homeowners choose us:</b></p>`, UL(trust)] : []),
    ...(estimate ? [P(estimateLine), btn('Get My Price Range', estimate)] : []),
    P(closer),
    ...(booking ? [btn('Book My Inspection', booking)] : []),
    P('Or just reply to this email or call me.'),
    `<p>Thanks,<br>${sign.map(esc).join('<br>')}</p>`,
    `<p style="font-size:12px;color:#6b7280">${esc(footer)}<br>You're receiving this because you live near a ${esc(co(f))} project. <a href="{{unsubscribe_link}}">Unsubscribe</a></p>`,
  ].join('\n');
  return { text: body.join('\n\n'), html, subject, previewText };
}

export function renderMailer(f: LetterFields): RenderedLetter {
  const rep = f.repName || '[Rep Name]';
  const who = f.recipientName.trim() || 'Current Resident';
  const dear = who === 'Current Resident' ? 'Neighbor' : who;
  const trust = f.company.trustLines;
  const estimate = f.estimateUrl.trim();
  const sign = signoff(f, rep);
  const stepEstimate = estimate ? `Get a quick price range: Go to ${linkLabel(estimate)} for a price range online.` : '';
  const stepLook = "See your roof up close: Call for a roof inspection with a full photo report. If your roof has years left, we'll tell you. If it's getting close, we'll show you your options. No pressure.";
  const area = f.company.area.trim();
  const lines = [
    f.date,
    [who, f.mailingAddress, f.mailingCityStateZip].filter((s) => s && s.trim()).join('\n'),
    `Dear ${dear},`,
    intro(f, rep, 'My name is'),
    didntWait(f, 'recent'),
    `Homes in ${nb(f, true)} were built around ${yr(f)}, so your roof may be at a similar stage. Planning ahead gives you control over timing, colors, and budget, instead of making a rushed decision after a leak.`,
    ...(trust.length ? [`Why homeowners${area ? ` across ${area}` : ''} choose us:`, ...trust.map((b) => `• ${b}`)] : []),
    'Easy ways to take the next step:',
    ...(stepEstimate ? [`• ${stepEstimate}`] : []),
    `• ${stepLook}`,
    "I'd be glad to answer any questions, even if you're just curious how much life your roof has left.",
    `Sincerely,\n\n\n${sign.join('\n')}`,
    `P.S. Mention this letter when you call and we'll put you on the schedule while our crews are still working in ${nb(f, true)}.`,
  ];
  const [estLabel, ...estRest] = stepEstimate.split(': ');
  const [lookLabel, ...lookRest] = stepLook.split(': ');
  const html = [
    P(f.date),
    `<p>${[who, f.mailingAddress, f.mailingCityStateZip].filter((s) => s && s.trim()).map(esc).join('<br>')}</p>`,
    P(`Dear ${dear},`), P(lines[3]), P(lines[4]), P(lines[5]),
    ...(trust.length ? [`<p><b>Why homeowners${area ? ` across ${esc(area)}` : ''} choose us:</b></p>`, UL(trust)] : []),
    `<p><b>Easy ways to take the next step:</b></p>`,
    `<ul>${stepEstimate ? `<li><b>${esc(estLabel)}:</b> ${esc(estRest.join(': '))} <span data-qr="${esc(estimate)}"></span></li>` : ''}` +
    `<li><b>${esc(lookLabel)}:</b> ${esc(lookRest.join(': '))}</li></ul>`,
    P(lines[lines.length - 3]),
    `<p>Sincerely,</p><p style="height:48px"></p><p>${sign.map(esc).join('<br>')}</p>`,
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
