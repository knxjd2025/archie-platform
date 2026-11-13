/**
 * Set-password emails (welcome and reset) go out through the company's GHL
 * email, so they sit in the team member's GHL conversation. Admins and
 * managers can read GHL conversations inside Archie, and a link there would
 * let them choose a teammate's password. Every place Archie shows GHL
 * conversation content to people or to AI drops these messages (or, for a
 * conversation's last-message snippet, shows a neutral one instead).
 *
 * Pure: no I/O, so each surface can call it at its edge.
 */

/** Shown in place of a last-message snippet that is a set-password email. */
export const PASSWORD_LINK_SNIPPET = 'Sign-in email';

const RESET_SUBJECT = 'reset your archie password';
const WELCOME_SUBJECT_PREFIX = 'set up your archie login for ';

/** Distinctive lines of the email body (password-mail.ts), for text-only snippets where the link is gone. */
const BODY_LINES = [
  'choose a password to sign in.',
  'someone asked to reset the password for your archie login.',
];

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", num: '#', sol: '/', equals: '=', colon: ':', nbsp: ' ' };

function decodeOnce(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, '/');
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
}

/** Undo HTML escaping and URL encoding (a few rounds, for double encoding such as a click-tracking redirect). */
function normalize(s: string): string {
  let out = s;
  for (let i = 0; i < 4; i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out.toLowerCase().replace(/\s+/g, ' ');
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

function hasLink(s: string): boolean {
  return /set-password ?# ?t ?=/.test(s);
}

function isPasswordSubject(s: string): boolean {
  const t = s.trim();
  return t === RESET_SUBJECT || t.startsWith(WELCOME_SUBJECT_PREFIX);
}

/** True for a set-password email: it carries the link, or has one of the two subjects. */
export function isPasswordLinkMessage(m: { subject?: unknown; body?: unknown }): boolean {
  const subject = normalize(text(m.subject));
  const body = normalize(text(m.body));
  return hasLink(subject) || hasLink(body) || isPasswordSubject(subject);
}

/** A GHL message object (fields vary by endpoint and message type). */
export function isPasswordLinkGhlMessage(m: any): boolean {
  if (!m || typeof m !== 'object') return false;
  const subject = text(m.subject) || text(m.meta?.email?.subject);
  const body = [m.body, m.message, m.html, m.text].map(text).join('\n');
  return isPasswordLinkMessage({ subject, body });
}

/** A message list with every set-password email removed. */
export function withoutPasswordLinkMessages<T>(list: T[]): T[] {
  return Array.isArray(list) ? list.filter((m) => !isPasswordLinkGhlMessage(m)) : list;
}

/**
 * A GHL messages response with the set-password emails removed. GHL answers
 * `{ messages: [...] }` or `{ messages: { messages: [...], lastMessageId, nextPage } }`;
 * both are handled and the rest of the response is kept.
 */
export function withoutPasswordLinkMessagesIn<T>(res: T): T {
  const r: any = res;
  if (!r || typeof r !== 'object') return res;
  if (Array.isArray(r.messages)) return { ...r, messages: withoutPasswordLinkMessages(r.messages) };
  if (r.messages && Array.isArray(r.messages.messages)) {
    return { ...r, messages: { ...r.messages, messages: withoutPasswordLinkMessages(r.messages.messages) } };
  }
  return res;
}

/**
 * A last-message snippet, or the neutral PASSWORD_LINK_SNIPPET when it is a
 * set-password email. Snippets are often plain text without the link, so the
 * email's own opening lines count too, and so does the subject when there is one.
 */
export function redactPasswordLinkSnippet(snippet: string, subject?: string): string {
  const s = normalize(text(snippet));
  if (isPasswordLinkMessage({ subject, body: snippet }) || isPasswordSubject(s) || BODY_LINES.some((l) => s.includes(l))) {
    return PASSWORD_LINK_SNIPPET;
  }
  return snippet;
}

/** A GHL conversation object with its last-message snippet redacted when it is a set-password email. */
export function redactGhlConversation<T extends Record<string, any>>(c: T): T {
  if (!c || typeof c !== 'object') return c;
  const body = text(c.lastMessageBody);
  const subject = text(c.lastMessageSubject) || undefined;
  if (redactPasswordLinkSnippet(body, subject) === body) return c;
  return { ...c, lastMessageBody: PASSWORD_LINK_SNIPPET, ...(subject ? { lastMessageSubject: PASSWORD_LINK_SNIPPET } : {}) };
}
