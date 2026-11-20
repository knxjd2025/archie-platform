/**
 * The Sales Playbook: every checklist, script, letter, email and training
 * guide in Archie's own sales library, with the placeholders each template
 * uses and the logic that fills them from the rep, the customer and the office.
 */
import library from './playbook/library.json';
import type { CompanyProfile } from './company';

export type PlaybookGroup = 'start' | 'doors' | 'mailbox' | 'table' | 'job' | 'fans' | 'partners' | 'scoreboard';
export type PlaybookKind = 'checklist' | 'guide' | 'script' | 'letter' | 'email' | 'reference';

export interface PlaybookDoc {
  id: string;
  title: string;
  group: PlaybookGroup;
  kind: PlaybookKind;
  audience: string | null;
  /** Which job stage the template belongs to, when it belongs to one. */
  stage: string | null;
  tags: string[];
  summary: string;
  body: string;
  placeholders: string[];
  videos: string[];
  source: string;
}

/** The sections, in the order a job happens: find it, win it, build it, grow from it. */
export const PLAYBOOK_GROUPS: { key: PlaybookGroup; label: string; blurb: string }[] = [
  { key: 'start', label: 'Start here', blurb: 'New to the playbook? Two short reads show how the whole thing fits together.' },
  { key: 'doors', label: 'Knock knock', blurb: 'Doors, phones and fresh leads: what to say first, and how to get invited in.' },
  { key: 'mailbox', label: 'In the mailbox', blurb: 'Door hangers and letters for the homes you could not catch. Filled in and ready to print.' },
  { key: 'table', label: 'At the kitchen table', blurb: 'The ROOFTOP Visit, answers for every worry, and friendly notes for people still deciding.' },
  { key: 'job', label: 'From yes to paid', blurb: 'Every checklist, customer email and neighbor notice, in the order the job happens.' },
  { key: 'fans', label: 'Fans for life', blurb: 'Reviews, referrals and check-ins that turn one happy customer into the next three.' },
  { key: 'partners', label: 'Friends in the business', blurb: 'Insurance agents, real estate agents, churches, landlords and commercial owners.' },
  { key: 'scoreboard', label: 'Keeping score', blurb: 'Your Earnings Plan, the Daily Scorecard, and how to spend your best hours.' },
];

export const PLAYBOOK: PlaybookDoc[] = (library as { docs: PlaybookDoc[] }).docs;

export function playbookDoc(id: string): PlaybookDoc | undefined {
  return PLAYBOOK.find((d) => d.id === id);
}

/** What the app knows and can fill in for a template. */
export interface FillContext {
  repName?: string | null;
  repCell?: string | null;
  repEmail?: string | null;
  repTitle?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  /** Street name without the house number, e.g. "Elm Street". */
  street?: string | null;
  cityState?: string | null;
  neighborhood?: string | null;
  companyName?: string | null;
  /** Name for letterheads and footers, e.g. "Acme Roofing LLC". */
  companyLegalName?: string | null;
  /** "City, ST" of the office, for letter footers. */
  companyCityState?: string | null;
  /** Absolute logo URL from the company's profile. */
  companyLogoUrl?: string | null;
  /** The company's brand colors (#rrggbb) for the printed and emailed document. */
  brandColor?: string | null;
  accentColor?: string | null;
  companyWebsite?: string | null;
  officePhone?: string | null;
  credentials?: string | null;
  warrantyLength?: string | null;
  referralGift?: string | null;
  reviewLink?: string | null;
  date?: string | null;
}

/**
 * What a template can say about the company, from its profile. Only what the
 * company entered: a placeholder it has no value for (credentials, warranty)
 * stays in brackets for the rep, never filled with someone else's claim.
 */
export function companyFillFrom(p: CompanyProfile): Pick<FillContext,
  'companyName' | 'companyLegalName' | 'companyCityState' | 'companyLogoUrl' | 'brandColor' | 'accentColor' | 'companyWebsite' | 'officePhone' | 'warrantyLength' | 'credentials' | 'reviewLink'> {
  return {
    companyName: p.displayName || null,
    companyLegalName: p.legalName || null,
    companyCityState: p.cityState || null,
    companyLogoUrl: p.logoUrl || null,
    brandColor: p.colors.primary,
    accentColor: p.colors.accent,
    companyWebsite: p.websiteLabel || null,
    officePhone: p.phone || null,
    warrantyLength: p.workmanshipWarranty || (p.workmanshipYears ? `${p.workmanshipYears}-year workmanship` : null),
    credentials: p.credentials.length ? p.credentials.join(', ') : null,
    reviewLink: p.reviewUrl || null,
  };
}

function firstName(full?: string | null): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts[0] || null;
}

/** Maps a placeholder's text to the context value that fills it. Order matters: first match wins. */
const FILL_RULES: { test: RegExp; value: (c: FillContext) => string | null | undefined }[] = [
  { test: /^(homeowner|customer|customer’s|customer's|homeowner’s)\s*(first)\s*name$/i, value: (c) => firstName(c.customerName) },
  { test: /^(homeowner|customer|customer’s|customer's|homeowner’s|their|landlord|neighbor's|neighbor’s|recipient's)\s*name$/i, value: (c) => c.customerName },
  { test: /^homeowner$/i, value: (c) => c.customerName },
  { test: /^(customer|property)\s*address$/i, value: (c) => c.customerAddress },
  { test: /^address(\(es\))?$/i, value: (c) => c.customerAddress },
  { test: /^repeat address$/i, value: (c) => c.customerAddress },
  { test: /^(your\s*name|name|rep\s*name)$/i, value: (c) => c.repName },
  { test: /^(your\s*)?(cell\s*(phone)?\s*#?|phone(\s*number)?|insert\s*phone|rep\s*cell)$/i, value: (c) => c.repCell || c.officePhone },
  { test: /^(your\s*phone\s*number)$/i, value: (c) => c.repCell || c.officePhone },
  { test: /^office\s*phone$/i, value: (c) => c.officePhone },
  { test: /^(insert\s*your\s*)?(your\s*)?e-?mail(\s*address)?$/i, value: (c) => c.repEmail },
  { test: /^rep\s*email$/i, value: (c) => c.repEmail },
  { test: /^(your\s*job\s*)?title$/i, value: (c) => c.repTitle },
  { test: /^(your\s*)?company\s*name$/i, value: (c) => c.companyName },
  { test: /^name\s*of\s*(your\s*)?company$/i, value: (c) => c.companyName },
  { test: /^company\s*website$/i, value: (c) => c.companyWebsite },
  { test: /^email\s*signature$/i, value: (c) => signatureBlock(c) },
  { test: /^your\s*contact\s*information$/i, value: (c) => signatureBlock(c) },
  { test: /^(name\s*of\s*)?street(\s*name)?(\s*of\s*your\s*project)?$/i, value: (c) => c.street },
  { test: /^street\s*name\s*of\s*your\s*project,\s*city$/i, value: (c) => [c.street, c.cityState].filter(Boolean).join(', ') || null },
  { test: /^city,\s*state$/i, value: (c) => c.cityState },
  { test: /^(neighborhood|neighborhood\/area|neighborhood or street|name of neighborhood\/area|neighborhood\/subdivision\/city|area|specific area\/subdivision( you’re working)?)$/i, value: (c) => c.neighborhood || c.street },
  { test: /^date$/i, value: (c) => c.date },
  { test: /^insert\s*warranty\s*length$/i, value: (c) => c.warrantyLength },
  { test: /^insert\s*credentials$/i, value: (c) => c.credentials },
  { test: /^referral\s*gift$/i, value: (c) => c.referralGift },
  { test: /^(direct link to where you want a review|insert link to where you want the review.*)$/i, value: (c) => c.reviewLink },
];

export function signatureBlock(c: FillContext): string {
  const company = c.companyName || null;
  return [c.repName, c.repTitle ? [c.repTitle, company].filter(Boolean).join(', ') : company, c.repCell ? `Cell: ${c.repCell}` : null, c.officePhone ? `Office: ${c.officePhone}` : null, c.repEmail, c.companyWebsite]
    .filter(Boolean)
    .join('\n');
}

export interface FillResult {
  text: string;
  /** Placeholders the app filled, with the value used. */
  filled: { placeholder: string; value: string }[];
  /** Placeholders the rep still has to complete by hand (storm dates, objections, day counts…). */
  remaining: string[];
}

/** Fill every placeholder the context can answer; leave the rest for the rep, in brackets, so nothing goes out half-baked unnoticed. */
export function fillTemplate(body: string, ctx: FillContext): FillResult {
  const c: FillContext = { date: todayLong(), ...stripNulls(ctx) };
  const filled = new Map<string, string>();
  const remaining = new Set<string>();
  const text = body.replace(/\[([^\]\n]{1,80})\]/g, (whole, inner: string) => {
    const key = inner.trim();
    const rule = FILL_RULES.find((r) => r.test.test(key));
    const value = rule ? rule.value(c) : null;
    if (value) {
      filled.set(key, value);
      return value;
    }
    remaining.add(key);
    return whole;
  });
  return { text, filled: Array.from(filled, ([placeholder, value]) => ({ placeholder, value })), remaining: Array.from(remaining) };
}

function stripNulls<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') (out as any)[k] = v;
  return out;
}

export function todayLong(d = new Date()): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Notes for the rep inside a template ("NOTE: send this a month after the
 * job") are for the rep's eyes. They are taken out of anything that is sent
 * or copied to a customer. A note runs from its label to the next blank line.
 */
export function stripRepNotes(text: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^\s*(NOTE|TIP|PRO TIP|IMPORTANT|REMEMBER|REMINDER|OPTIONAL|WARNING|DISCLAIMER)\b[^:\n]{0,40}:/i.test(line)) { skipping = true; continue; }
    if (skipping) { if (line.trim()) continue; skipping = false; }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

/** Subject line for an email template: the "Subject:" line if the template has one, else the title. */
export function subjectOf(doc: Pick<PlaybookDoc, 'title' | 'body'>, text = doc.body): { subject: string; body: string } {
  text = stripRepNotes(text);
  const m = text.match(/^\s*(?:email\s*)?subject(?:\s*line)?\s*:\s*(.+)$/im);
  if (!m) return { subject: doc.title, body: text };
  const subject = m[1].replace(/^[“"]|[”"]$/g, '').trim();
  return { subject, body: text.replace(m[0], '').replace(/^\n+/, '') };
}

/* ------------------------------------------------------------------ */
/* Job-stage checklists                                                */
/* ------------------------------------------------------------------ */

export interface ChecklistItem {
  key: string;
  label: string;
  /** Playbook document that does this step (opens prefilled for the customer). */
  doc?: string;
  /** Ticking this creates follow-ups: days after today. */
  followUps?: { days: number; note: string }[];
}

export interface StageChecklist {
  key: string;
  title: string;
  /** JobTread production columns that make this the current stage. */
  columns: string[];
  when: string;
  items: ChecklistItem[];
}

export const STAGE_CHECKLISTS: StageChecklist[] = [
  {
    key: 'new_customer', title: 'New Customer', when: 'As soon as the contract is signed',
    columns: ['Buyer Approved', 'Insurance Approved', 'Permitting'],
    items: [
      { key: 'referral_gift', label: 'Make sure the customer knows about the referral gift', doc: 'referral-quick-card' },
      { key: 'welcome_email', label: 'Send the New Customer Welcome Email', doc: 'email-new-customer-welcome' },
      { key: 'insurance_agent', label: 'Send the insurance agent introduction email (insurance jobs)', doc: 'email-insurance-agent-1-4' },
      { key: 'neighbor_list', label: 'Build the Neighbor Ring: the homes around the property', doc: 'neighbor-ring-notice' },
      { key: 'before_build_letters', label: 'Drop the Roof Work Coming Soon Notice at the homes nearby', doc: 'roof-work-coming-soon-notice' },
      { key: 'welcome_call', label: 'Call the customer: confirm what happens next and who to call' },
      { key: 'social_post', label: 'Post the new project (with permission) on social media' },
    ],
  },
  {
    key: 'job_scheduled', title: 'Job Scheduled', when: 'Install date is set',
    columns: ['Schedule'],
    items: [
      { key: 'scheduled_email', label: 'Send the Install Date Notice Email', doc: 'email-install-date-notice' },
      { key: 'install_notice_mail', label: 'Mail the Install Notice Letter for Neighbors', doc: 'install-notice-neighbor-letter' },
      { key: 'confirm_details', label: 'Confirm color, materials, dumpster placement and vehicles moved' },
      { key: 'reminder_call', label: 'Reminder call the day before install' },
    ],
  },
  {
    key: 'day_of_install', title: 'Day of Installation', when: 'The crew is on site',
    columns: ['Pre-Construction', 'Roof Construction', 'Other Construction Work'],
    items: [
      { key: 'on_site', label: 'Be on site at the start to meet the customer and crew' },
      { key: '12_pack', label: 'Knock the Neighbor Ring with the Neighbor Ring Notice', doc: 'neighbor-ring-notice' },
      { key: 'canvass_street', label: 'Canvass the street while the crew works', doc: 'canvassing-openers' },
      { key: 'photos', label: 'Take before, during and after photos for the customer and social media' },
      { key: 'end_of_day', label: 'End-of-day walkthrough with the customer' },
    ],
  },
  {
    key: 'install_complete', title: 'Installation Complete', when: 'Roof is on, final payment pending',
    columns: ['Complete'],
    items: [
      { key: 'complete_email', label: 'Send the Install Complete Email', doc: 'email-install-complete' },
      { key: 'final_walk', label: 'Final walkthrough and cleanup check with the customer' },
      { key: 'collect_payment', label: 'Collect the final payment' },
      { key: 'neighbor_mail', label: 'Mail the Job Complete Letter for Neighbors to the streets nearby', doc: 'job-complete-neighbor-letter' },
    ],
  },
  {
    key: 'paid_in_full', title: 'Paid in Full', when: 'Money is in',
    columns: ['PIF File Warranties', 'Closed'],
    items: [
      { key: 'job_complete_email', label: 'Send the Job Complete Thank You Email', doc: 'email-job-complete' },
      { key: 'review_request', label: 'Ask for the Google review', doc: 'review-request-messages' },
      { key: 'thank_you_letter', label: 'Mail the Job Complete Thank You Letter', doc: 'thank-you-letter' },
      { key: 'referral_emails', label: 'Line up the three check-in and referral emails', doc: 'email-referral-30', followUps: [
        { days: 30, note: 'Send the 30 Day Check-In and Referral Email (Playbook, Fans for life)' },
        { days: 60, note: 'Send the 60 Day Insurance Questions and Referral Email (Playbook, Fans for life)' },
        { days: 90, note: 'Send the 90 Day Roof Care and Referral Email (Playbook, Fans for life)' },
      ] },
      { key: 'insurance_agent_thanks', label: 'Thank the insurance agent and ask for the next referral (insurance jobs)', doc: 'email-insurance-agent-1-4' },
      { key: 'warranty', label: 'Warranty registered and sent to the customer' },
    ],
  },
];

export function stageForColumn(column: string | null | undefined): StageChecklist | undefined {
  if (!column) return undefined;
  return STAGE_CHECKLISTS.find((s) => s.columns.some((c) => c.toLowerCase() === column.toLowerCase()));
}

/* ------------------------------------------------------------------ */
/* Goals: the earnings plan and the Daily Scorecard                     */
/* ------------------------------------------------------------------ */

export interface GoalInputs {
  incomeGoal: number;
  avgCommission: number;
  /** Percentage, 0–100. */
  closeRate: number;
  /** Months of active selling in a year. */
  sellingMonths: number;
}

export const GOAL_DEFAULTS: GoalInputs = { incomeGoal: 100000, avgCommission: 1500, closeRate: 40, sellingMonths: 9 };

/** The Earnings Plan math: an income goal worked back to sales, appointments and doors a week. */
export function incomePlan(g: GoalInputs) {
  const salesPerYear = g.avgCommission > 0 ? g.incomeGoal / g.avgCommission : 0;
  const salesPerMonth = g.sellingMonths > 0 ? salesPerYear / g.sellingMonths : 0;
  const salesPerWeek = salesPerMonth / 4;
  const apptsPerWeek = g.closeRate > 0 ? salesPerWeek / (g.closeRate / 100) : 0;
  const doorsPerWeek = apptsPerWeek * 10;
  const doorsPerDay = doorsPerWeek / 5;
  const letters = doorsPerWeek / 3;
  const coldCalls = doorsPerWeek / 5;
  const referralAsks = doorsPerWeek / 50;
  const agentIntros = doorsPerWeek / 25;
  const networking = doorsPerWeek / 50;
  const r = (n: number) => Math.ceil(n * 10) / 10;
  return {
    salesPerYear: r(salesPerYear), salesPerMonth: r(salesPerMonth), salesPerWeek: r(salesPerWeek),
    apptsPerWeek: r(apptsPerWeek), doorsPerWeek: Math.ceil(doorsPerWeek), doorsPerDay: Math.ceil(doorsPerDay),
    lettersPerWeek: Math.ceil(letters), coldCallsPerWeek: Math.ceil(coldCalls), referralAsksPerWeek: Math.ceil(referralAsks),
    agentIntrosPerWeek: Math.ceil(agentIntros), networkingPerWeek: Math.ceil(networking),
    touchesPerWeek: Math.ceil(doorsPerWeek + letters + coldCalls + referralAsks + agentIntros + networking),
  };
}

/** Daily Scorecard scoring: sale 10, appointment run 5, appointment set 5, new lead 1. */
export const POINT_VALUES = { closed: 10, presented: 5, contacted: 5, door: 1 } as const;
export const DAILY_POINT_GOAL = 10;

export function pointsFor(counts: { doors?: number; contacted?: number; presented?: number; closed?: number }): number {
  return (counts.doors ?? 0) * POINT_VALUES.door + (counts.contacted ?? 0) * POINT_VALUES.contacted + (counts.presented ?? 0) * POINT_VALUES.presented + (counts.closed ?? 0) * POINT_VALUES.closed;
}
