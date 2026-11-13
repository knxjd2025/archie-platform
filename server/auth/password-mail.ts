/**
 * The email that carries a one-time set-password link: the welcome sent when
 * someone is added to the team, and the reset sent from "Forgot password?".
 * Sent through the company's own email (sendCompanyEmail: its GHL
 * sub-account), so it must be called inside that company's context. The person
 * is added as a contact there if they are not one yet.
 */
import { sendCompanyEmail } from '../integrations/company-mail';
import { GhlNotConnectedError, hasGhlConnection } from '../integrations/ghl/connection';

export interface PasswordLinkEmail {
  to: string;
  name: string;
  companyName: string;
  purpose: 'welcome' | 'reset';
  url: string;
}

/** The sign-in page, where "Forgot password?" lives. */
const signInUrl = () => `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/login`;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** True when the current company could actually send a password email (its email is connected, and there is a base URL for the link). */
export async function passwordMailConfigured(): Promise<boolean> {
  return Boolean(process.env.APP_BASE_URL) && await hasGhlConnection();
}

/**
 * Returns true when the email was accepted. False (and a log line) when the
 * company's email is not connected or APP_BASE_URL is missing, since the link
 * would be relative. Throws when the send is refused; callers decide whether
 * to surface that.
 */
export async function sendPasswordLinkEmail(input: PasswordLinkEmail): Promise<boolean> {
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
<p style="color:#666;font-size:13px">This link works once and expires in 1 hour.${welcome ? ` If it has expired, use "Forgot password?" on the <a href="${esc(signInUrl())}" style="color:#666">sign-in page</a> to get a new one.` : ''}</p>
</div>`;
  try {
    await sendCompanyEmail({ to: input.to, toName: input.name, subject: subject.replace(/[\r\n]+/g, ' '), html });
  } catch (err) {
    if (!(err instanceof GhlNotConnectedError)) throw err;
    console.warn('[password-mail] this company has no email connection; skipped');
    return false;
  }
  return true;
}
