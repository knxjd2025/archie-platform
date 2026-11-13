import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, passwordProblem } from '../password';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('roofs-are-cool-99');
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
    expect(await verifyPassword('roofs-are-cool-99', stored)).toBe(true);
    expect(await verifyPassword('roofs-are-cool-98', stored)).toBe(false);
  });

  it('two hashes of the same password differ', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('rejects null, empty and garbled stored values without throwing', async () => {
    for (const bad of [null, undefined, '', 'nope', 'scrypt$x$y', 'scrypt$16384$8$1$!!$!!', 'bcrypt$16384$8$1$AAAA$AAAA']) {
      expect(await verifyPassword('whatever-password', bad)).toBe(false);
    }
  });

  it('passwordProblem names the two failures and passes a good password', () => {
    expect(passwordProblem('short')).toBe('Use at least 10 characters.');
    expect(passwordProblem('x'.repeat(201))).toBe('That password is too long.');
    expect(passwordProblem('roofs-are-cool-99')).toBeNull();
    expect(passwordProblem(undefined)).toBe('Use at least 10 characters.');
  });
});
