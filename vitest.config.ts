import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv();

// Production runs in UTC twice over: the Vercel process (which decides how pg
// serialises a Date parameter) and the Supabase session (which decides what
// NOW() and defaultNow() store in a naive timestamp column). A developer
// machine is usually neither — a local Postgres installed here defaults its
// session to America/New_York — and the mismatch made a nudge written seconds
// earlier by defaultNow() read back four hours old. Pin both so DB tests see
// what production sees. The session option is only sent to a local server; a
// pooler may refuse startup options it does not know.
const dbUrl = process.env.DATABASE_URL ?? '';
const localDb = /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl);
const testEnv: Record<string, string> = { TZ: 'UTC' };
if (localDb) testEnv.PGOPTIONS = '-c TimeZone=UTC';

export default defineConfig({
  test: {
    // client/ is included so pure helpers there (formatting, parsing) are
    // covered too — without it a client test file silently never runs.
    include: [
      'scripts/**/__tests__/**/*.test.ts',
      'server/**/__tests__/**/*.test.ts',
      'shared/**/__tests__/**/*.test.ts',
      'client/**/__tests__/**/*.test.ts',
    ],
    environment: 'node',
    env: testEnv,
  },
});
