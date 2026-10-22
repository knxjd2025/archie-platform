/**
 * Telling the Archie operators (server/integrations/operator-mail.ts). A person's report is emailed straight away — they took the
 * trouble to write it. A caught error is emailed the first time it is seen,
 * and only then: the hundredth occurrence is a number on the Bugs page and in
 * the morning digest, not another email.
 */
import { sendOperatorEmail } from '../integrations/operator-mail';

const appUrl = (): string => (process.env.APP_BASE_URL || '').replace(/\/+$/, '');

export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * A brand-new error type in a bad minute can be a dozen at once; past this, the
 * digest has them. Browser and server keep separate allowances, so a burst of
 * browser errors cannot use up the alerts a server failure needs.
 */
const MAX_ALERTS_PER_HOUR = 10;
let alertTimes: Record<string, number[]> = {};

function underAlertCap(bucket: string, now = Date.now()): boolean {
  const recent = (alertTimes[bucket] ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= MAX_ALERTS_PER_HOUR) { alertTimes = { ...alertTimes, [bucket]: recent }; return false; }
  alertTimes = { ...alertTimes, [bucket]: [...recent, now] };
  return true;
}

/** A line break in a subject would start a new email header. */
export const subjectLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').slice(0, 150);

async function sendToOperators(subject: string, html: string): Promise<void> {
  try {
    await sendOperatorEmail(subjectLine(subject), html);
  } catch (e) {
    console.error('[bugs] could not email the alert:', e instanceof Error ? e.message : e);
  }
}

export interface ReportAlert {
  id: number; message: string; details?: string | null; page?: string | null;
  url?: string | null; userEmail: string; hasScreenshot: boolean;
}

export function alertPersonReport(r: ReportAlert): Promise<void> {
  const html = `
    <p><b>${escapeHtml(r.userEmail)}</b> reported a bug${r.page ? ` on <b>${escapeHtml(r.page)}</b>` : ''}:</p>
    <blockquote style="border-left:3px solid #b5432f;margin:0;padding:4px 12px">${escapeHtml(r.message).replace(/\n/g, '<br>')}</blockquote>
    ${r.details ? `<p><b>What they were doing:</b> ${escapeHtml(r.details).replace(/\n/g, '<br>')}</p>` : ''}
    ${r.hasScreenshot ? '<p>They attached a screenshot.</p>' : ''}
    <p><a href="${appUrl()}/">Open the Bugs page</a> (Setup ▸ Bugs) — report #${r.id}.</p>`;
  return sendToOperators(`🐞 Bug report from ${r.userEmail}: ${r.message.slice(0, 60)}`, html);
}

export interface ErrorAlert {
  id: number; kind: string; where: string; message: string;
  page?: string | null; userEmail?: string | null;
  /** It had been marked fixed and has come back. */
  reopened?: boolean;
}

export function alertNewError(e: ErrorAlert): Promise<void> {
  if (!underAlertCap(e.kind)) return Promise.resolve();
  const side = e.kind === 'server_error' ? 'server' : 'browser';
  const html = `
    <p>${e.reopened
    ? `An error marked <b>fixed</b> just happened again in the ${side}, so it has been reopened.`
    : `A new error showed up in the ${side} — the first time this one has been seen.`}</p>
    <p><b>Where:</b> ${escapeHtml(e.where)}${e.page ? ` · page <b>${escapeHtml(e.page)}</b>` : ''}${e.userEmail ? ` · ${escapeHtml(e.userEmail)}` : ''}</p>
    <pre style="white-space:pre-wrap;background:#f5f5f5;padding:8px;border-radius:6px">${escapeHtml(e.message.slice(0, 1500))}</pre>
    <p>Repeats are counted on the Bugs page, not emailed. Error #${e.id}.</p>`;
  return sendToOperators(`${e.reopened ? '🔁 Came back' : '⚠️ New'} ${side} error: ${e.message.slice(0, 70)}`, html);
}

export interface DigestRow {
  id: number; kind: string; status: string; message: string; page: string | null;
  user_email: string | null; occurrences: number;
}

/** The morning summary. Returns null when there is nothing worth an email. */
export function buildDigest(rows: DigestRow[]): { subject: string; html: string } | null {
  const reports = rows.filter((r) => r.kind === 'report');
  const errors = rows.filter((r) => r.kind !== 'report').sort((a, b) => b.occurrences - a.occurrences);
  if (!reports.length && !errors.length) return null;
  const li = (r: DigestRow, extra: string) =>
    `<li>${escapeHtml(r.message.slice(0, 160))} <span style="color:#777">${extra}${r.page ? ` · ${escapeHtml(r.page)}` : ''}</span></li>`;
  const html = `
    <p>Open bugs from the last 24 hours.</p>
    ${reports.length ? `<h3>Reported by people (${reports.length})</h3><ul>${reports.map((r) => li(r, escapeHtml(r.user_email ?? ''))).join('')}</ul>` : ''}
    ${errors.length ? `<h3>Caught automatically (${errors.length})</h3><ul>${errors.slice(0, 25).map((r) => li(r, `${r.occurrences}× · ${r.kind === 'server_error' ? 'server' : 'browser'}`)).join('')}</ul>` : ''}
    <p><a href="${appUrl()}/">Setup ▸ Bugs</a> has the details. Mark one fixed there and it reopens if it comes back.</p>`;
  return { subject: `🐞 Bugs: ${reports.length} reported, ${errors.length} caught (last 24h)`, html };
}
