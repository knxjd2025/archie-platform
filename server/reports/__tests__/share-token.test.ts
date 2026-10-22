import { describe, it, expect } from 'vitest';
import { isShareToken } from '../share-token';
import { newShareToken } from '../generate-local';

// /r/:token is public; anything that cannot be a token is answered without a
// database read. The check must accept every token the app actually issues.
describe('isShareToken', () => {
  it('accepts what newShareToken issues', () => {
    for (let i = 0; i < 50; i++) expect(isShareToken(newShareToken())).toBe(true);
  });
  it('refuses anything else', () => {
    for (const bad of ['', 'abc', 'A'.repeat(32), 'g'.repeat(32), '0'.repeat(31), '0'.repeat(33),
      "0123456789abcdef0123456789abcde'", '../../etc/passwd', undefined, 42]) {
      expect(isShareToken(bad)).toBe(false);
    }
  });
});
