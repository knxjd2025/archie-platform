/**
 * Small pure helpers for the set-password page and the Team page's add and
 * edit messages, kept here so they can be tested without a browser.
 */
import { PASSWORD_LINK_EXPIRED } from '../../../shared/password-messages';

/** The emailed set-password link's path, with or without a trailing slash. */
export const isSetPasswordPath = (pathname: string): boolean => /^\/set-password\/?$/.test(pathname);

/** True when the set-password route said the link is used, expired or unknown. */
export const isExpiredLinkError = (error: string | null | undefined): boolean => error === PASSWORD_LINK_EXPIRED;

/** What the Team page says after adding someone, from the add response. */
export function addedMemberMessage(r: { name: string; canLogin: boolean; welcomeEmailSent?: boolean }): string {
  if (!r.canLogin) return `Added ${r.name}.`;
  if (r.welcomeEmailSent) return `Added ${r.name}. We emailed them a link to set a password.`;
  return `Added ${r.name}, but the welcome email was not sent. Once email is working they can use "Forgot password?" on the sign-in page, or they can sign in with Google.`;
}

/** What the Team page says after an edit turned someone's login on, from the edit response. */
export function loginTurnedOnMessage(r: { name: string; welcomeEmailSent: boolean }): string {
  if (r.welcomeEmailSent) return `Login turned on for ${r.name}. We emailed them a link to set a password.`;
  return `Login turned on for ${r.name}, but the welcome email was not sent. Once email is working they can use "Forgot password?" on the sign-in page, or they can sign in with Google.`;
}
