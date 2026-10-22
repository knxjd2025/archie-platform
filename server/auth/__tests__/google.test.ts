import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildGoogleAuthUrl, newOAuthState, newPkcePair, OAUTH_STATE_TTL_MS, parseOAuthState, profileFromUserinfo, verifyOAuthState,
} from '../google';

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_OAUTH_REDIRECT = 'http://localhost:3000/api/auth/google/callback';
});

describe('buildGoogleAuthUrl', () => {
  it('includes client id, redirect, email scope and hosted domain', () => {
    const url = buildGoogleAuthUrl();
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fgoogle%2Fcallback');
    expect(url).toContain('scope=');
    expect(decodeURIComponent(url)).toContain('email');
    expect(url).toContain('hd=bestroofingnow.com');
  });
});

describe('profileFromUserinfo', () => {
  it('accepts a verified address', () => {
    expect(profileFromUserinfo({ email: 'thomas@bestroofingnow.com', verified_email: true, name: 'Thomas', id: '123' }))
      .toEqual({ email: 'thomas@bestroofingnow.com', name: 'Thomas', sub: '123' });
  });
  it('refuses an address Google has not verified', () => {
    // The address is matched against the roster and is the only identity
    // check, so an unverified one must not sign anybody in.
    expect(() => profileFromUserinfo({ email: 'thomas@bestroofingnow.com', verified_email: false })).toThrow(/not verified/);
    expect(() => profileFromUserinfo({ email: 'thomas@bestroofingnow.com' })).toThrow(/not verified/);
  });
  it('refuses a profile with no address', () => {
    expect(() => profileFromUserinfo({ verified_email: true })).toThrow(/missing email/);
  });
});

describe('sign-in state (login CSRF)', () => {
  // The state used to be 'native' or nothing, so the callback finished any
  // sign-in it was handed — including one an attacker started with their own
  // Google account and sent to someone else to open.
  it('issues a fresh nonce each time, carrying the native flag', () => {
    const a = newOAuthState(false);
    const b = newOAuthState(true);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.state).toBe(`web.${a.nonce}`);
    expect(b.state).toBe(`native.${b.nonce}`);
    expect(parseOAuthState(b.state)).toEqual({ native: true, nonce: b.nonce });
  });

  it('accepts the state this browser was issued', () => {
    const { state, nonce } = newOAuthState(true);
    expect(verifyOAuthState(state, { nonce, at: Date.now() })).toEqual({ native: true, nonce });
  });

  it('refuses a state this browser never started', () => {
    const mine = newOAuthState(false);
    const theirs = newOAuthState(false);
    expect(verifyOAuthState(theirs.state, { nonce: mine.nonce, at: Date.now() })).toBeNull();
    expect(verifyOAuthState(theirs.state, undefined)).toBeNull();
  });

  it('refuses the old bare flags and anything malformed', () => {
    const { nonce } = newOAuthState(true);
    const pending = { nonce, at: Date.now() };
    for (const raw of ['native', '', undefined, ['native', nonce], `native.${nonce}x`, `admin.${nonce}`]) {
      expect(verifyOAuthState(raw, pending)).toBeNull();
    }
  });

  it('refuses a sign-in left unfinished too long', () => {
    const { state, nonce } = newOAuthState(false);
    const started = Date.now();
    expect(verifyOAuthState(state, { nonce, at: started }, started + OAUTH_STATE_TTL_MS - 1)).not.toBeNull();
    expect(verifyOAuthState(state, { nonce, at: started }, started + OAUTH_STATE_TTL_MS + 1)).toBeNull();
  });

  it('puts the state and an S256 PKCE challenge on the auth URL', async () => {
    const { state } = newOAuthState(false);
    const { verifier, challenge } = await newPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const url = new URL(buildGoogleAuthUrl(undefined, state, challenge));
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
