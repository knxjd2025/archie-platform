import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildVoiceToken, safeIdentity } from '../voice-token';

const base = {
  accountSid: 'AC00000000000000000000000000000000',
  apiKeySid: 'SK00000000000000000000000000000000',
  apiKeySecret: 'shhh',
  identity: 'office',
};

describe('safeIdentity', () => {
  it('keeps what is already safe', () => {
    expect(safeIdentity('office')).toBe('office');
    expect(safeIdentity('cs')).toBe('cs');
  });
  it('makes an email or a name safe for a URL and for TwiML', () => {
    expect(safeIdentity('admin@bestroofingnow.com')).toBe('admin-bestroofingnow.com');
    expect(safeIdentity('Office Admin')).toBe('office-admin');
    expect(safeIdentity('a/b?c')).toBe('a-b-c');
  });
  it('never returns leading or trailing junk', () => {
    expect(safeIdentity('  --Office--  ')).toBe('office');
  });
});

describe('buildVoiceToken', () => {
  it('signs a token Twilio will accept', () => {
    const { token, identity } = buildVoiceToken(base);
    expect(identity).toBe('office');
    const decoded: any = jwt.verify(token, base.apiKeySecret);
    expect(decoded.iss).toBe(base.apiKeySid);
    expect(decoded.sub).toBe(base.accountSid);
    expect(decoded.grants.identity).toBe('office');
  });

  it('carries the header Twilio requires', () => {
    const { token } = buildVoiceToken(base);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    // Twilio rejects a token without this and says nothing useful about why.
    expect(header.cty).toBe('twilio-fpa;v=1');
    expect(header.alg).toBe('HS256');
  });

  it('allows incoming calls, or the browser can never ring', () => {
    const decoded: any = jwt.verify(buildVoiceToken(base).token, base.apiKeySecret);
    expect(decoded.grants.voice.incoming.allow).toBe(true);
  });

  it('names the TwiML app only when there is one', () => {
    const withApp: any = jwt.verify(buildVoiceToken({ ...base, outgoingApplicationSid: 'APabc' }).token, base.apiKeySecret);
    expect(withApp.grants.voice.outgoing.application_sid).toBe('APabc');
    const without: any = jwt.verify(buildVoiceToken(base).token, base.apiKeySecret);
    expect(without.grants.voice.outgoing).toBeUndefined();
  });

  it('expires, and never for longer than Twilio allows', () => {
    const hour: any = jwt.verify(buildVoiceToken(base).token, base.apiKeySecret);
    expect(hour.exp - hour.iat).toBe(3600);
    const capped: any = jwt.verify(buildVoiceToken({ ...base, ttlSeconds: 999999 }).token, base.apiKeySecret);
    expect(capped.exp - capped.iat).toBe(86400);
    const floored: any = jwt.verify(buildVoiceToken({ ...base, ttlSeconds: 1 }).token, base.apiKeySecret);
    expect(floored.exp - floored.iat).toBe(60);
  });

  it('refuses rather than minting something unusable', () => {
    expect(() => buildVoiceToken({ ...base, identity: '   ' })).toThrow(/identity/i);
    expect(() => buildVoiceToken({ ...base, apiKeySecret: '' })).toThrow(/API key/i);
  });
});
