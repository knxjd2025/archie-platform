/**
 * Email to the people who run Archie itself (not to a company): bug reports
 * and new errors, and the morning bug digest. These never go through a
 * company's GHL, so a company's contacts never fill up with Archie alerts.
 *
 * Sent with Resend (https://resend.com) when RESEND_API_KEY, ARCHIE_OPS_EMAIL
 * (one or more addresses, comma separated) and ARCHIE_MAIL_FROM (a sender on
 * a verified Resend domain, e.g. "Archie <alerts@archie.app>") are set.
 * Without them the alert is only logged; the Bugs page still has everything.
 */
export function operatorMailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.ARCHIE_OPS_EMAIL && process.env.ARCHIE_MAIL_FROM);
}

/** Returns true when the email was accepted, false when operator mail is not set up. */
export async function sendOperatorEmail(subject: string, html: string): Promise<boolean> {
  if (!operatorMailConfigured()) {
    console.warn('[operator-mail] not configured; skipped:', subject);
    return false;
  }
  const to = String(process.env.ARCHIE_OPS_EMAIL).split(',').map((s) => s.trim()).filter(Boolean);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ARCHIE_MAIL_FROM, to, subject: subject.replace(/[\r\n]+/g, ' '), html }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}
