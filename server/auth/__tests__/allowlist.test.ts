import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAllowedLoginEmail, isBlockedLoginEmail, memberCanLogin } from '../allowlist';

const LIST = 'james@acme.test,admin@acme.test';

describe('isAllowedLoginEmail', () => {
  it('allows listed emails, case-insensitively', () => {
    expect(isAllowedLoginEmail('james@acme.test', LIST)).toBe(true);
    expect(isAllowedLoginEmail('Admin@Acme.test', LIST)).toBe(true);
  });
  it('rejects unlisted emails', () => {
    expect(isAllowedLoginEmail('banning@acme.test', LIST)).toBe(false);
    expect(isAllowedLoginEmail('random@gmail.com', LIST)).toBe(false);
  });
  it('trims whitespace in the list', () => {
    expect(isAllowedLoginEmail('james@acme.test', ' james@acme.test , x@y.com ')).toBe(true);
  });
  it('rejects empty email', () => {
    expect(isAllowedLoginEmail('', LIST)).toBe(false);
  });
  it('trims whitespace in the email itself', () => {
    expect(isAllowedLoginEmail('  james@acme.test  ', 'james@acme.test,admin@acme.test')).toBe(true);
  });

  describe('default allowlist fallback', () => {
    let savedEnv: string | undefined;

    beforeEach(() => {
      savedEnv = process.env.LOGIN_ALLOWLIST;
    });

    afterEach(() => {
      if (savedEnv !== undefined) {
        process.env.LOGIN_ALLOWLIST = savedEnv;
      } else {
        delete process.env.LOGIN_ALLOWLIST;
      }
    });

    it('names nobody by default (the gate only applies when LOGIN_ALLOWLIST is set)', () => {
      delete process.env.LOGIN_ALLOWLIST;
      expect(isAllowedLoginEmail('owner@acme.test')).toBe(false);
    });

    it('uses env var override over default', () => {
      process.env.LOGIN_ALLOWLIST = 'only@foo.com';
      expect(isAllowedLoginEmail('only@foo.com')).toBe(true);
      expect(isAllowedLoginEmail('james@acme.test')).toBe(false);
      expect(isAllowedLoginEmail('admin@acme.test')).toBe(false);
    });
  });
});

describe('memberCanLogin', () => {
  it('allows an active member with login enabled — any role', () => {
    for (const role of ['admin', 'manager', 'sales', 'production'] as const) {
      expect(memberCanLogin({ active: true, canLogin: true, role } as any)).toBe(true);
    }
  });

  it('denies a member whose login is turned off', () => {
    expect(memberCanLogin({ active: true, canLogin: false })).toBe(false);
  });

  it('denies an inactive (off-boarded) member even if login was enabled', () => {
    expect(memberCanLogin({ active: false, canLogin: true })).toBe(false);
  });

  it('denies when there is no roster row', () => {
    expect(memberCanLogin(undefined)).toBe(false);
    expect(memberCanLogin(null)).toBe(false);
  });

  it('treats null/undefined flags as off (fail closed)', () => {
    expect(memberCanLogin({})).toBe(false);
    expect(memberCanLogin({ active: null, canLogin: null })).toBe(false);
  });
});

describe('isBlockedLoginEmail', () => {
  it('blocks nobody by default', () => {
    expect(isBlockedLoginEmail('fred@acme.test', '')).toBe(false);
    expect(isBlockedLoginEmail('', '')).toBe(false);
  });
  it('blocks what LOGIN_BLOCKLIST lists, case-insensitively', () => {
    expect(isBlockedLoginEmail('  Fred@Acme.test ', 'fred@acme.test')).toBe(true);
    expect(isBlockedLoginEmail('dana@acme.test', 'fred@acme.test')).toBe(false);
  });
});
