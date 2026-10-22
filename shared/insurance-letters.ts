/**
 * Everything Best Roofing Now writes to a carrier, in one place.
 *
 * The set follows the company's own Master Insurance Claims Process, so each
 * letter matches a point in the claim where somebody actually sends something:
 * the estimate package after the adjuster meeting, a chase when the carrier
 * goes quiet, a supplement before or after the build, a re-inspection request
 * on a denial, lab results from a VRA sample, and finally the depreciation
 * release once the roof is on.
 *
 * Pure, like the neighbor letters: the server prefills from it and sends what
 * it builds, the client previews and prints the same thing, so what is on
 * screen is what the carrier gets.
 *
 * Two rules from the process document are wired into the wording. Never
 * promise a coverage outcome — these letters state what was observed, sent or
 * completed, and ask. And a claim decision is only ever referred to as the
 * carrier's written decision, never a verbal one.
 */

/** The shape a letter goes out as: a printed page, or a short covering email. */
export type LetterFormat = 'letter' | 'email';

export const LETTER_FORMATS: Array<{ kind: LetterFormat; label: string; use: string }> = [
  { kind: 'letter', label: 'Letter to the carrier', use: 'Print on letterhead, or send it as the email body with the paperwork attached.' },
  { kind: 'email', label: 'Short covering email', use: 'A few lines for the adjuster, with the letter and paperwork attached.' },
];

export type InsuranceLetterKind =
  | 'estimate_package'
  | 'status_follow_up'
  | 'supplement'
  | 'reinspection'
  | 'lab_results'
  | 'depreciation';

export interface InsuranceLetterDef {
  kind: InsuranceLetterKind;
  label: string;
  /** When in the claim this one gets sent. */
  use: string;
  subject: string;
  /** Pre-filled "Enclosed:" list — the paperwork this letter normally travels with. */
  enclosures: string[];
  /** Label for the date this letter turns on, or null when it doesn't use one. */
  dateLabel: string | null;
  /** Label for the money figure, or null when the letter carries no figure. */
  amountLabel: string | null;
  /** Label for the itemised list in the body, or null when it has none. */
  itemsLabel: string | null;
}

export const INSURANCE_LETTERS: readonly InsuranceLetterDef[] = [
  {
    kind: 'estimate_package',
    label: 'Estimate package',
    use: 'After the adjuster meeting: the estimate and reports go to the carrier, homeowner copied.',
    subject: 'Estimate package',
    enclosures: ['Xactimate estimate', 'Inspection report', 'Storm report', 'Measurement report'],
    dateLabel: 'Adjuster meeting date',
    amountLabel: 'Estimate total',
    itemsLabel: null,
  },
  {
    kind: 'status_follow_up',
    label: 'Status follow-up',
    use: 'The day after sending, and any time the carrier goes quiet.',
    subject: 'Status request',
    enclosures: [],
    dateLabel: 'Sent to the carrier on',
    amountLabel: null,
    itemsLabel: 'What we sent',
  },
  {
    kind: 'supplement',
    label: 'Supplement request',
    use: 'Items missing from the approved scope, or what the tear-off uncovered.',
    subject: 'Supplement request',
    enclosures: ['Supplement estimate', 'Photos of the items claimed'],
    dateLabel: 'Documented on',
    amountLabel: 'Supplement total',
    itemsLabel: 'Items claimed',
  },
  {
    kind: 'reinspection',
    label: 'Re-inspection request',
    use: 'Within 48 hours of a written denial or a repair-only decision.',
    subject: 'Re-inspection request',
    enclosures: ['Inspection report', 'Photos of the documented damage'],
    dateLabel: "Carrier's written decision dated",
    amountLabel: null,
    itemsLabel: 'What we documented',
  },
  {
    kind: 'lab_results',
    label: 'Lab test results (VRA)',
    use: 'When the NTS report comes back on a shingle sample.',
    subject: 'Laboratory test results',
    enclosures: ['Laboratory test report'],
    dateLabel: 'Sample taken on',
    amountLabel: null,
    itemsLabel: 'What the report found',
  },
  {
    kind: 'depreciation',
    label: 'Depreciation release',
    use: 'Once the roof is on: asks for the holdback, with the invoice and certificate of completion.',
    subject: 'Depreciation release request',
    enclosures: ['Certificate of completion', 'Final invoice', 'Photos of the completed work'],
    dateLabel: 'Completed on',
    amountLabel: 'Amount requested',
    itemsLabel: null,
  },
];

const BY_KIND = new Map(INSURANCE_LETTERS.map((l) => [l.kind, l]));
export const letterDef = (kind: InsuranceLetterKind): InsuranceLetterDef => BY_KIND.get(kind) ?? INSURANCE_LETTERS[0];
export const isInsuranceLetterKind = (v: unknown): v is InsuranceLetterKind => typeof v === 'string' && BY_KIND.has(v as InsuranceLetterKind);

export interface ClaimLetterFields {
  /** Letter date, YYYY-MM-DD. */
  date: string;
  carrier: string;
  adjusterName: string;
  claimNumber: string;
  policyNumber: string;
  insuredName: string;
  propertyAddress: string;
  /** YYYY-MM-DD, or '' when the claim has no date of loss on file. */
  dateOfLoss: string;

  /** The date this letter turns on — what it means depends on the kind (see dateLabel). */
  eventDate: string;
  /** The figure this letter carries, if it carries one (see amountLabel). */
  amount: number;
  /** The body's itemised list (see itemsLabel). */
  items: string[];
  /** A paragraph in the sender's own words, added before the sign-off. */
  note: string;
  /** What is travelling with it. */
  enclosures: string[];

  // --- Depreciation only: the arithmetic behind what is being asked for. ---
  /**
   * Skip the RCV/ACV arithmetic and state one figure the sender typed. For the
   * jobs where the carrier's numbers aren't in the app and typing the breakdown
   * in just to have it recomputed is busywork.
   */
  manualTotal: boolean;
  /** The final invoice total, stated in the letter when it's filled in. */
  invoiceTotal: number;
  /** Approved replacement cost value of the scope. */
  rcv: number;
  /** Supplements the carrier approved that are NOT already inside the RCV above. */
  supplements: number;
  /** Actual cash value already paid on the claim. */
  acv: number;
  /** The homeowner's deductible. Stated only so the carrier can see it was collected. */
  deductible: number;
  /** Whether the deductible has actually been collected — the letter says so only when true. */
  deductibleCollected: boolean;
  /** Who the check should be made out to — normally the insured. */
  payableTo: string;

  senderName: string;
  senderTitle: string;
  senderPhone: string;
  senderEmail: string;
  companyName: string;
  officeAddress: string;
  companyPhone: string;
}

/**
 * Does this file on the job look like the final invoice? Used to preselect the
 * right document rather than making someone hunt through a job's files for it.
 * Deliberately narrow: a false positive here attaches the wrong money to a
 * letter asking an insurer for money.
 */
export function looksLikeFinalInvoice(name: string, type?: string | null): boolean {
  const n = String(name || '').toLowerCase();
  if (type && !/pdf/i.test(type) && !n.endsWith('.pdf')) return false;
  if (/estimate|proposal|quote|bid|receipt|statement/.test(n)) return false;
  return /invoice|final\s*bill/.test(n);
}

export const usd = (n: number): string =>
  (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/** en-US long date from YYYY-MM-DD, with the date read as a calendar day, not an instant. */
export function longDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || '';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Recoverable depreciation: the approved replacement cost (plus any approved
 * supplement not already in it) less the actual cash value already paid. The
 * deductible is the homeowner's to pay and is never part of what the carrier
 * still owes, so it does not appear here.
 */
export function depreciationDue(f: { rcv: number; supplements: number; acv: number }): number {
  return Math.max(0, Math.round(((Number(f.rcv) || 0) + (Number(f.supplements) || 0) - (Number(f.acv) || 0)) * 100) / 100);
}

/** What has to be filled in before this letter can go to a carrier. */
export function missingLetterFields(kind: InsuranceLetterKind, f: ClaimLetterFields): string[] {
  const def = letterDef(kind);
  const out: string[] = [];
  if (!f.carrier.trim()) out.push('Carrier');
  if (!f.claimNumber.trim()) out.push('Claim number');
  if (!f.insuredName.trim()) out.push('Insured name');
  if (!f.propertyAddress.trim()) out.push('Property address');
  if (!f.senderName.trim()) out.push('Your name');

  if (kind === 'depreciation') {
    if (!f.eventDate.trim()) out.push('Completion date');
    if (!(f.amount > 0)) out.push('Amount requested');
  }
  if (kind === 'supplement' && !(f.amount > 0)) out.push(def.amountLabel!);
  if ((kind === 'status_follow_up' || kind === 'reinspection') && !f.eventDate.trim()) out.push(def.dateLabel!);
  return out;
}

/**
 * Worth a second look before sending, but not wrong enough to block: the
 * number asked for doesn't match the figures above it, or the figures the
 * arithmetic needs were never entered.
 */
export function letterWarnings(kind: InsuranceLetterKind, f: ClaimLetterFields): string[] {
  const out: string[] = [];
  if (kind !== 'depreciation' || f.manualTotal) return out;
  const computed = depreciationDue(f);
  if (!(f.rcv > 0)) out.push('No approved RCV on the claim — the breakdown will show $0.00 for it.');
  if (!(f.acv > 0)) out.push('No ACV payment recorded — the letter will read as though the carrier has paid nothing yet.');
  if (f.amount > 0 && computed > 0 && Math.abs(f.amount - computed) >= 0.01) {
    out.push(`You're asking for ${usd(f.amount)} but the figures come to ${usd(computed)}.`);
  }
  return out;
}

/**
 * A photo to show in the letter. `src` is whatever the destination understands:
 * an http URL in the on-screen preview and the printed page, a `cid:` reference
 * in an email, where the bytes travel with the message.
 */
export interface LetterImage { src: string; caption?: string }

const esc = (s: string): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface MoneyLine { label: string; amount: number; negative?: boolean }

/** A letter body is a few of these; the text and HTML renderers both read them. */
type Block =
  | { t: 'p'; text: string }
  | { t: 'list'; title?: string; items: string[] }
  | { t: 'money'; rows: MoneyLine[]; total: MoneyLine };

const para = (text: string): Block => ({ t: 'p', text });

/** Empty when the sender typed the total in — the letter then states that figure alone. */
function depreciationRows(f: ClaimLetterFields): MoneyLine[] {
  if (f.manualTotal) return [];
  const rows: MoneyLine[] = [{ label: 'Replacement cost value (approved scope)', amount: f.rcv }];
  if (f.supplements > 0) rows.push({ label: 'Approved supplements', amount: f.supplements });
  rows.push({ label: 'Less actual cash value already paid', amount: f.acv, negative: true });
  return rows;
}

/** The body of each letter. Everything in it is a fact the sender entered. */
function bodyOf(kind: InsuranceLetterKind, f: ClaimLetterFields): Block[] {
  const def = letterDef(kind);
  const items = f.items.filter((i) => i.trim());
  const blocks: Block[] = [];

  switch (kind) {
    case 'estimate_package':
      blocks.push(para(
        `Enclosed is our estimate and supporting documentation for the above claim`
        + `${f.eventDate ? `, following the adjuster's inspection on ${longDate(f.eventDate)}` : ''}.`,
      ));
      if (f.amount > 0) blocks.push(para(`Our estimate totals ${usd(f.amount)}.`));
      blocks.push(para('Please confirm receipt and let me know your timeline for review. Anything further you need to complete the review, tell me and I will get it to you the same day.'));
      break;

    case 'status_follow_up':
      blocks.push(para(
        `We sent ${items.length ? 'the following' : 'our documentation'} for the above claim`
        + `${f.eventDate ? ` on ${longDate(f.eventDate)}` : ''}, and I am writing to confirm it was received.`,
      ));
      if (items.length) blocks.push({ t: 'list', items });
      blocks.push(para('Could you let me know where the file stands and when we can expect a decision? If anything is outstanding on our side, I will get it over today.'));
      break;

    case 'supplement':
      blocks.push(para(
        `We are submitting a supplement on the above claim for the items below`
        + `${f.eventDate ? `, documented on ${longDate(f.eventDate)}` : ''}.`,
      ));
      if (items.length) blocks.push({ t: 'list', title: 'Items claimed', items });
      if (f.amount > 0) blocks.push(para(`The supplement totals ${usd(f.amount)}.`));
      blocks.push(para('The supporting documentation and photographs are enclosed. Please let me know if anything further is needed to review it.'));
      break;

    case 'reinspection':
      blocks.push(para(
        `We received the carrier's written decision on the above claim`
        + `${f.eventDate ? ` dated ${longDate(f.eventDate)}` : ''}. We are requesting a re-inspection of the roof.`,
      ));
      if (items.length) blocks.push({ t: 'list', title: 'What we documented', items });
      blocks.push(para('Our representative and inspector will both be on site and will make the roof accessible at your convenience. Please let me know a date and time that suits the adjuster.'));
      break;

    case 'lab_results':
      blocks.push(para(
        `A shingle sample taken from the above property`
        + `${f.eventDate ? ` on ${longDate(f.eventDate)}` : ''} was submitted for laboratory testing. The report is enclosed.`,
      ));
      if (items.length) blocks.push({ t: 'list', title: 'What the report found', items });
      blocks.push(para('We are submitting it for the file and asking that the claim be reviewed with this evidence. I am happy to arrange a call with the lab if that would help.'));
      break;

    case 'depreciation':
      blocks.push(para(
        `The roofing work approved under this claim was completed on ${longDate(f.eventDate)} at the property address above. `
        + `The work was carried out in accordance with the approved scope of loss, and the final invoice`
        + `${f.invoiceTotal > 0 ? `, totalling ${usd(f.invoiceTotal)},` : ''} is enclosed.`,
      ));
      blocks.push(para('We are writing to request release of the recoverable depreciation held on this claim:'));
      blocks.push({ t: 'money', rows: depreciationRows(f), total: { label: 'Recoverable depreciation now due', amount: f.amount } });
      if (f.deductible > 0 && f.deductibleCollected) {
        blocks.push(para(`The homeowner's deductible of ${usd(f.deductible)} has been collected in full.`));
      }
      break;
  }

  if (f.note.trim()) blocks.push(para(f.note.trim()));
  if (f.enclosures.filter((e) => e.trim()).length) {
    blocks.push({ t: 'list', title: 'Enclosed', items: f.enclosures.filter((e) => e.trim()) });
  }
  if (kind === 'depreciation') {
    blocks.push(para(
      `Please issue payment${f.payableTo.trim() ? ` to ${f.payableTo.trim()}` : ''} and let me know if anything further is needed to release these funds.`,
    ));
  }
  void def;
  return blocks;
}

/** The subject line, and what a printed letter gets filed under. */
export function letterSubject(kind: InsuranceLetterKind, f: ClaimLetterFields): string {
  const bits = [letterDef(kind).subject];
  if (f.claimNumber.trim()) bits.push(`claim ${f.claimNumber.trim()}`);
  if (f.insuredName.trim()) bits.push(f.insuredName.trim());
  return bits.join(' — ');
}

const REF_ROWS = (f: ClaimLetterFields): Array<[string, string]> => ([
  ['Insured', f.insuredName],
  ['Property address', f.propertyAddress],
  ['Claim number', f.claimNumber],
  ['Policy number', f.policyNumber],
  ['Date of loss', f.dateOfLoss ? longDate(f.dateOfLoss) : ''],
] as Array<[string, string]>).filter(([, v]) => !!String(v || '').trim());

const signOff = (f: ClaimLetterFields): string[] => [
  f.senderName.trim(),
  [f.senderTitle.trim(), f.companyName.trim()].filter(Boolean).join(', '),
  [f.senderPhone.trim(), f.senderEmail.trim()].filter(Boolean).join(' · '),
].filter(Boolean);

/** The letter as plain text — what gets copied, and the basis for the HTML. */
export function letterText(kind: InsuranceLetterKind, f: ClaimLetterFields): string {
  const p: string[] = [];
  p.push(longDate(f.date));
  p.push('');
  p.push([f.carrier.trim(), 'Claims Department', f.adjusterName.trim() ? `Attn: ${f.adjusterName.trim()}` : ''].filter(Boolean).join('\n'));
  p.push('');
  p.push(`RE: ${REF_ROWS(f).map(([k, v]) => `${k}: ${v}`).join('\n    ')}`);
  p.push('');
  p.push(f.adjusterName.trim() ? `Dear ${f.adjusterName.trim()},` : 'To whom it may concern,');
  p.push('');

  for (const b of bodyOf(kind, f)) {
    if (b.t === 'p') { p.push(b.text); p.push(''); continue; }
    if (b.t === 'list') {
      if (b.title) p.push(`${b.title}:`);
      for (const i of b.items) p.push(`  · ${i}`);
      p.push('');
      continue;
    }
    for (const l of b.rows) p.push(`    ${l.label.padEnd(44, ' ')} ${(l.negative ? '-' : ' ') + usd(l.amount)}`);
    p.push(`    ${b.total.label.padEnd(44, ' ')}  ${usd(b.total.amount)}`);
    p.push('');
  }

  p.push('Sincerely,');
  p.push('');
  p.push(signOff(f).join('\n'));
  return p.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** The completed-work photos, under the letter, sized to print two to a row. */
function photoBlock(images: LetterImage[], title: string): string {
  if (!images.length) return '';
  const cells = images.map((img) => [
    '<td style="padding:0 8px 8px 0;vertical-align:top;width:50%">',
    `<img src="${esc(img.src)}" alt="${esc(img.caption || title)}" style="width:100%;max-width:280px;border:1px solid #ddd">`,
    img.caption ? `<div style="font:9.5pt Arial,sans-serif;color:#666;padding-top:2px">${esc(img.caption)}</div>` : '',
    '</td>',
  ].join(''));
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells.slice(i, i + 2).join('')}</tr>`);
  return `<p><b>${esc(title)}</b></p><table style="border-collapse:collapse;width:100%">${rows.join('')}</table>`;
}

/** The same letter as HTML — for the on-screen preview, the printed page and the email body. */
export function letterHtml(kind: InsuranceLetterKind, f: ClaimLetterFields, images: LetterImage[] = []): string {
  const rows = REF_ROWS(f)
    .map(([k, v]) => `<tr><td style="padding:1px 14px 1px 0;color:#555;white-space:nowrap">${esc(k)}</td><td style="padding:1px 0"><b>${esc(v)}</b></td></tr>`)
    .join('');

  const body = bodyOf(kind, f).map((b) => {
    if (b.t === 'p') return `<p>${esc(b.text)}</p>`;
    if (b.t === 'list') {
      return `${b.title ? `<p>${esc(b.title)}:</p>` : ''}<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    }
    // A rule under nothing reads as a mistake, so the total is only ruled off
    // when there are figures above it.
    const rule = b.rows.length ? 'border-top:1px solid #999;' : '';
    const money = [
      ...b.rows.map((l) => `<tr><td style="padding:3px 0">${esc(l.label)}</td><td style="padding:3px 0;text-align:right;white-space:nowrap">${l.negative ? '−' : ''}${usd(l.amount)}</td></tr>`),
      `<tr><td style="padding:6px 0 0;${rule}"><b>${esc(b.total.label)}</b></td><td style="padding:6px 0 0;${rule}text-align:right;white-space:nowrap"><b>${usd(b.total.amount)}</b></td></tr>`,
    ].join('');
    return `<table style="border-collapse:collapse;width:100%;max-width:26em;margin:0 0 14px">${money}</table>`;
  }).join('\n');

  return [
    `<p>${esc(longDate(f.date))}</p>`,
    `<p>${[f.carrier, 'Claims Department', f.adjusterName.trim() ? `Attn: ${f.adjusterName.trim()}` : ''].filter(Boolean).map(esc).join('<br>')}</p>`,
    `<table style="border-collapse:collapse;margin:0 0 14px"><tr><td style="padding:1px 8px 1px 0;vertical-align:top;color:#555"><b>RE:</b></td><td><table style="border-collapse:collapse">${rows}</table></td></tr></table>`,
    `<p>${f.adjusterName.trim() ? `Dear ${esc(f.adjusterName.trim())},` : 'To whom it may concern,'}</p>`,
    body,
    photoBlock(images, kind === 'depreciation' ? 'Photos of the completed work' : 'Photographs'),
    '<p>Sincerely,</p>',
    `<p>${signOff(f).map(esc).join('<br>')}</p>`,
  ].filter(Boolean).join('\n');
}

/** The covering email: a few lines, with the letter and paperwork attached. */
export function emailText(kind: InsuranceLetterKind, f: ClaimLetterFields): string {
  const what = letterDef(kind).subject.toLowerCase();
  const enclosed = f.enclosures.filter((e) => e.trim()).map((e) => e.toLowerCase());
  const p: string[] = [];
  p.push(f.adjusterName.trim() ? `Hi ${f.adjusterName.trim().split(/\s+/)[0]},` : 'Hello,');
  p.push('');
  p.push(
    `${f.insuredName.trim() || 'The insured'} at ${f.propertyAddress || 'the insured property'}`
    + `${f.claimNumber.trim() ? `, claim ${f.claimNumber.trim()}` : ''}.`,
  );
  p.push('');

  if (kind === 'depreciation') {
    p.push(`The roof was completed on ${longDate(f.eventDate)} and we're requesting release of the recoverable depreciation of ${usd(f.amount)}.`);
  } else if (kind === 'status_follow_up') {
    p.push(`Following up on what we sent${f.eventDate ? ` on ${longDate(f.eventDate)}` : ''} — could you let me know where the claim stands?`);
  } else if (kind === 'supplement') {
    p.push(`We're submitting a supplement${f.amount > 0 ? ` of ${usd(f.amount)}` : ''} on this claim.`);
  } else if (kind === 'reinspection') {
    p.push(`We're requesting a re-inspection following the written decision${f.eventDate ? ` dated ${longDate(f.eventDate)}` : ''}.`);
  } else if (kind === 'lab_results') {
    p.push('The laboratory report on the shingle sample from this property is attached.');
  } else {
    p.push(`Our estimate${f.amount > 0 ? ` of ${usd(f.amount)}` : ''} and the supporting reports are attached.`);
  }
  p.push('');
  p.push(`The ${what} letter${enclosed.length ? `, ${enclosed.join(', ')}` : ''} ${enclosed.length ? 'are' : 'is'} attached.`);
  p.push('');
  p.push('Anything else you need from us, just let me know.');
  p.push('');
  p.push('Thank you,');
  p.push(signOff(f).join('\n'));
  return p.join('\n');
}

export function emailHtml(kind: InsuranceLetterKind, f: ClaimLetterFields): string {
  return emailText(kind, f)
    .split('\n\n')
    .map((block) => `<p>${block.split('\n').map(esc).join('<br>')}</p>`)
    .join('\n');
}

export function buildInsuranceLetter(
  kind: InsuranceLetterKind, f: ClaimLetterFields, format: LetterFormat, images: LetterImage[] = [],
): { subject: string; text: string; html: string } {
  return format === 'email'
    ? { subject: letterSubject(kind, f), text: emailText(kind, f), html: emailHtml(kind, f) }
    : { subject: letterSubject(kind, f), text: letterText(kind, f), html: letterHtml(kind, f, images) };
}
