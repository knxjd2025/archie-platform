import { defineConfig } from 'drizzle-kit';

// Generates the baseline SQL from shared/schema.ts. Hand-written SQL that
// drizzle-kit cannot express (row level security, roles, helper functions)
// lives in migrations/ next to the generated files.
export default defineConfig({
  dialect: 'postgresql',
  schema: './shared/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL || '' },
});
