/**
 * How many proxies stand in front of the app (server/lib/trusted-proxy.ts):
 * the one number that decides which address a request is counted under.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { trustedProxyHops } from '../trusted-proxy';

describe('trustedProxyHops', () => {
  it('is one hop, the host\'s own proxy, when nothing is set', () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ ARCHIE_TRUSTED_PROXY_HOPS: '' })).toBe(1);
  });
  it('reads a whole number from 0 to 5 from ARCHIE_TRUSTED_PROXY_HOPS', () => {
    for (const n of [0, 1, 2, 3, 5]) expect(trustedProxyHops({ ARCHIE_TRUSTED_PROXY_HOPS: String(n) })).toBe(n);
    expect(trustedProxyHops({ ARCHIE_TRUSTED_PROXY_HOPS: ' 2 ' })).toBe(2);
  });
  it('ignores anything else and keeps one hop, so a typo never makes the address anyone says it is', () => {
    for (const bad of ['-1', '6', '99', '1.5', 'two', 'true', '1e1', '0x1']) expect(trustedProxyHops({ ARCHIE_TRUSTED_PROXY_HOPS: bad }), bad).toBe(1);
  });
  it('is what both entry points hand to Express, and neither writes a number of its own', () => {
    const root = path.resolve(__dirname, '../../..');
    for (const f of ['server/index.ts', 'api/index.ts']) {
      const text = readFileSync(path.join(root, f), 'utf8');
      expect(text, f).toMatch(/app\.set\('trust proxy', trustedProxyHops\(\)\)/);
      expect(text, f).not.toMatch(/app\.set\('trust proxy', \d/);
    }
  });
});
