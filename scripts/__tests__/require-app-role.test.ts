/**
 * Operator scripts refuse to run as anyone but archie_app, and say which URL
 * to use instead.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { requireAppRole } from '../lib/require-app-role';

const fakePool = (role: string) => ({ query: async () => ({ rows: [{ role }] }) });

describe('requireAppRole', () => {
  it('accepts archie_app', async () => {
    await expect(requireAppRole(fakePool('archie_app'))).resolves.toBeUndefined();
  });
  it('refuses the owner, naming the URL to use', async () => {
    await expect(requireAppRole(fakePool('postgres'))).rejects.toThrow(/app's DATABASE_URL \(user archie_app\).*"postgres"/s);
  });
});

const ownerUrl = process.env.ARCHIE_TEST_OWNER_URL || '';
describe.skipIf(!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(ownerUrl))('operator scripts with the owner URL', () => {
  for (const script of ['scripts/seed-companies.ts', 'scripts/create-company.ts']) {
    it(`${script} stops with a clear message`, () => {
      const args = script.includes('create') ? ['--slug', 'x', '--name', 'X', '--admin-email', 'x@example.test', '--admin-name', 'X'] : [];
      let out = '';
      let code = 0;
      try {
        execFileSync('npx', ['tsx', script, ...args], { env: { ...process.env, DATABASE_URL: ownerUrl }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e: any) {
        code = e.status;
        out = `${e.stdout}${e.stderr}`;
      }
      expect(code).toBe(1);
      expect(out).toMatch(/must use the app's DATABASE_URL \(user archie_app\)/);
    }, 60_000);
  }
});
