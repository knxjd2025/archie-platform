import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAllowedLoginEmail, isBlockedLoginEmail, memberCanLogin } from '../allowlist';

const LIST = 'james@bestroofingnow.com,admin@bestroofingnow.com';

describe('isAllowedLoginEmail', () => {
  it('allows listed emails, case-insensitively', () => {
    expect(isAllowedLoginEmail('james@bestroofingnow.com', LIST)).toBe(true);
    expect(isAllowedLoginEmail('Admin@BestRoofingNow.com', LIST)).toBe(true);
  });
  it('rejects unlisted emails', () => {
    expect(isAllowedLoginEmail('banning@bestroofingnow.com', LIST)).toBe(false);
    expect(isAllowedLoginEmail('random@gmail.com', LIST)).toBe(false);
  });
  it('trims whitespace in the list', () => {
    expect(isAllowedLoginEmail('james@bestroofingnow.com', ' james@bestroofingnow.com , x@y.com ')).toBe(true);
  });
  it('rejects empty email', () => {
    expect(isAllowedLoginEmail('', LIST)).toBe(false);
  });
  it('trims whitespace in the email itself', () => {
    expect(isAllowedLoginEmail('  james@bestroofingnow.com  ', 'james@bestroofingnow.com,admin@bestroofingnow.com')).toBe(true);
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

    it('uses default allowlist when no env var and no csv arg', () => {
      delete process.env.LOGIN_ALLOWLIST;
      expect(isAllowedLoginEmail('james@bestroofingnow.com')).toBe(true);
      expect(isAllowedLoginEmail('admin@bestroofingnow.com')).toBe(true);
      expect(isAllowedLoginEmail('nobody@x.com')).toBe(false);
    });

    it('uses env var override over default', () => {
      process.env.LOGIN_ALLOWLIST = 'only@foo.com';
      expect(isAllowedLoginEmail('only@foo.com')).toBe(true);
      expect(isAllowedLoginEmail('james@bestroofingnow.com')).toBe(false);
      expect(isAllowedLoginEmail('admin@bestroofingnow.com')).toBe(false);
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
  it('blocks fred@bestroofingnow.com always, case-insensitively, and nobody else by default', () => {
    expect(isBlockedLoginEmail('fred@bestroofingnow.com', '')).toBe(true);
    expect(isBlockedLoginEmail('  Fred@BestRoofingNow.com ', '')).toBe(true);
    expect(isBlockedLoginEmail('james@bestroofingnow.com', '')).toBe(false);
    expect(isBlockedLoginEmail('', '')).toBe(false);
  });
  it('LOGIN_BLOCKLIST adds to the default, never replaces it', () => {
    expect(isBlockedLoginEmail('x@bestroofingnow.com', 'x@bestroofingnow.com')).toBe(true);
    expect(isBlockedLoginEmail('fred@bestroofingnow.com', 'x@bestroofingnow.com')).toBe(true);
  });
});
