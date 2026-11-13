import { describe, it, expect } from 'vitest';
import { isSetPasswordPath, isExpiredLinkError, addedMemberMessage } from '../password-pages';
import { PASSWORD_LINK_EXPIRED } from '../../../../shared/password-messages';

describe('isSetPasswordPath', () => {
  it('matches /set-password with or without a trailing slash', () => {
    expect(isSetPasswordPath('/set-password')).toBe(true);
    expect(isSetPasswordPath('/set-password/')).toBe(true);
  });
  it('does not match other paths', () => {
    for (const p of ['/', '/login', '/set-password/x', '/set-passwords', '/x/set-password']) expect(isSetPasswordPath(p)).toBe(false);
  });
});

describe('isExpiredLinkError', () => {
  it('is true for the server\'s expired-link answer only', () => {
    expect(isExpiredLinkError(PASSWORD_LINK_EXPIRED)).toBe(true);
    expect(isExpiredLinkError('Use at least 10 characters.')).toBe(false);
    expect(isExpiredLinkError(null)).toBe(false);
  });
});

describe('addedMemberMessage', () => {
  it('says the email went out', () => {
    expect(addedMemberMessage({ name: 'Dana Fox', canLogin: true, welcomeEmailSent: true }))
      .toBe('Added Dana Fox. We emailed them a link to set a password.');
  });
  it('says plainly when the email was not sent, and what they can do instead', () => {
    const msg = addedMemberMessage({ name: 'Dana Fox', canLogin: true, welcomeEmailSent: false });
    expect(msg).toContain('not sent');
    expect(msg).toContain('Forgot password?');
    expect(msg).toContain('Google');
  });
  it('a member who cannot sign in gets no email and no warning', () => {
    expect(addedMemberMessage({ name: 'Dana Fox', canLogin: false, welcomeEmailSent: false })).toBe('Added Dana Fox.');
  });
  it('never uses an em dash', () => {
    for (const sent of [true, false]) expect(addedMemberMessage({ name: 'A', canLogin: true, welcomeEmailSent: sent })).not.toMatch(/—/);
  });
});
