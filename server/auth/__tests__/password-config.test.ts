import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { passwordLinks } from '../../../shared/schema';

/** The set-password feature's wiring outside the routes. */
describe('password sign-in wiring', () => {
  it('Vercel serves the app for /set-password, with or without a trailing slash, like /login', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
    const toIndex = (vercel.rewrites as Array<{ source: string; destination: string }>)
      .filter((r) => r.destination === '/index.html').map((r) => r.source);
    expect(toIndex).toContain('/login');
    expect(toIndex).toContain('/set-password');
    expect(toIndex).toContain('/set-password/');
  });

  it('schema.ts declares the purpose check migration 0004 created, so drizzle-kit keeps it', () => {
    const checks = getTableConfig(passwordLinks).checks.map((c) => c.name);
    expect(checks).toContain('password_links_purpose_check');
    const snapshot = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'migrations/meta/0004_snapshot.json'), 'utf8'));
    expect(snapshot.tables['public.password_links'].checkConstraints).toHaveProperty('password_links_purpose_check');
  });
});
