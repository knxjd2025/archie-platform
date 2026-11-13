/**
 * The email that carries a one-time set-password link: the welcome sent when
 * someone is added to the team, and the reset sent from "Forgot password?".
 * Sent with Resend, like operator-mail.ts, but to one person.
 */
export interface PasswordLinkEmail {
  to: string;
  name: string;
  companyName: string;
  purpose: 'welcome' | 'reset';
  url: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** True when a password email could actually be sent (mail keys and a base URL for the link). */
export function passwordMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ARCHIE_MAIL_FROM && process.env.APP_BASE_URL);
}

/**
 * Returns true when the email was accepted. False (and a log line) when mail
 * is not set up or APP_BASE_URL is missing, since the link would be relative.
 * Throws when Resend refuses it; callers decide whether to surface that.
 */
export async function sendPasswordLinkEmail(input: PasswordLinkEmail): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || !process.env.ARCHIE_MAIL_FROM) {
    console.warn('[password-mail] mail not configured; skipped');
    return false;
  }
  if (!process.env.APP_BASE_URL) {
    console.warn('[password-mail] APP_BASE_URL is not set; not sending a link that would not open');
    return false;
  }
  const first = esc(input.name.trim().split(/\s+/)[0] || 'there');
  const company = esc(input.companyName);
  const welcome = input.purpose === 'welcome';
  const subject = welcome ? `Set up your Archie login for ${input.companyName}` : 'Reset your Archie password';
  const line = welcome
    ? `You have been added to ${company} on Archie. Choose a password to sign in.`
    : 'Someone asked to reset the password for your Archie login. Choose a new one below.';
  const button = welcome ? 'Set my password' : 'Reset my password';
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
<p>Hi ${first},</p>
<p>${line}</p>
<p><a href="${esc(input.url)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${button}</a></p>
<p style="color:#666;font-size:13px">This link works once and expires in 1 hour.</p>
</div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ARCHIE_MAIL_FROM, to: [input.to], subject: subject.replace(/[\r\n]+/g, ' '), html }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}
