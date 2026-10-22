import { describe, it, expect } from 'vitest';
import { handleKey, phoneKey, sha256 } from '../routes';

describe('iMessage helpers', () => {
  it('keys phones and Apple IDs the same way the bridge does', () => {
    expect(phoneKey('+1 (704) 555-0100')).toBe('7045550100');
    expect(handleKey('+17045550100')).toBe('7045550100');
    expect(handleKey('Pat@Example.com')).toBe('pat@example.com');
  });
  it('a token with underscores in its secret still parses (dot separator)', () => {
    const t = `brn_im.${Buffer.from('james@bestroofingnow.com').toString('base64url')}.ab_cd-ef_gh`;
    const m = /^brn_im\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(t)!;
    expect(Buffer.from(m[1], 'base64url').toString()).toBe('james@bestroofingnow.com');
    expect(sha256('x')).toHaveLength(64);
  });
});
