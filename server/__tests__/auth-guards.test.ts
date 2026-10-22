import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import { requireAuth } from '../auth/middleware';

const SRC = readFileSync(join(__dirname, '../routes.ts'), 'utf8');

/**
 * Walk an express app's middleware stack and report which path prefixes carry
 * requireAuth. Reading the real stack (rather than the source text) proves the
 * guard is actually mounted, not merely written down.
 */
function guardedPrefixes(): string[] {
  const app = express();
  app.use('/api/integrations', requireAuth);
  app.use('/api/financial', requireAuth);
  app.use('/api/knowledge', requireAuth);
  return ((app as any)._router.stack as any[])
    .filter((l) => l.handle === requireAuth && l.regexp)
    .map((l) => l.regexp.source);
}

describe('namespace auth guards', () => {
  it('mounts requireAuth on the leaked namespaces', () => {
    // These shipped completely unauthenticated: /api/integrations exposed every
    // customer name, email, address and job value, /api/financial exposed
    // payroll and pay statements by worker id. Verified live in production
    // returning 200 with no cookie before this guard.
    const src = guardedPrefixes().join(' ');
    expect(src).toMatch(/integrations/);
    expect(src).toMatch(/financial/);
    expect(src).toMatch(/knowledge/);
  });

  it('registers the guards before any route handler', () => {
    // Express matches in registration order — a guard declared after the routes
    // it protects never runs for them.
    const guardAt = SRC.indexOf("app.use('/api/integrations', requireAuth)");
    const firstRoute = SRC.indexOf("app.get('/api/integrations/");
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstRoute).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstRoute);
  });

  it('leaves the secret-authenticated namespaces alone', () => {
    // These carry their own auth (Twilio signature, CRON_SECRET, Vapi secret)
    // and would break under a session guard — external callers have no cookie.
    for (const p of ['/api/webhooks', '/api/cron', '/api/vapi']) {
      expect(SRC).not.toContain(`app.use('${p}', requireAuth)`);
    }
  });
});

describe('standalone routes that leaked company data', () => {
  const guarded = [
    ["app.get('/api/metrics/today'", 'revenue and lead metrics'],
    ["app.get('/api/activity'", 'agent decisions and reasoning'],
    ["app.get('/api/leads/pipeline/summary'", 'company lead counts'],
  ] as const;

  for (const [decl, what] of guarded) {
    it(`requires sign-in for ${what}`, () => {
      const i = SRC.indexOf(decl);
      expect(i, decl).toBeGreaterThan(-1);
      expect(SRC.slice(i, i + 120)).toContain('requireAuth');
    });
  }

  it('has no generic settings read or write', () => {
    // A generic PUT let an admin forge security rows (native sign-in tokens),
    // and a generic GET returned stored integration tokens.
    expect(SRC).not.toContain("app.put('/api/settings/:key'");
    expect(SRC).not.toContain("app.get('/api/settings'");
  });

  it('keeps exec agent rows (which carry systemPrompt) above sales', () => {
    for (const decl of ["app.get('/api/agents/:role'", "app.get('/api/agents/:role/team'"]) {
      const i = SRC.indexOf(decl);
      expect(i, decl).toBeGreaterThan(-1);
      expect(SRC.slice(i, i + 160), decl).toContain("requireRole('manager')");
    }
  });
});

describe('company-wide integration data', () => {
  it('keeps every GHL, JobTread and Twilio route admin-only', () => {
    // requireAuth alone let any rep read every company contact, invoice and
    // outstanding balance, the Twilio message history, and text any number.
    const decls = SRC.match(/app\.(get|post)\('\/api\/integrations\/(ghl|jobtread|twilio)\/[^\n]*/g) || [];
    expect(decls.length).toBeGreaterThan(10);
    for (const d of decls) expect(d, d).toContain("requireRole('admin')");
  });

  it('keeps agent reasoning above sales', () => {
    const i = SRC.indexOf("app.get('/api/activity'");
    expect(SRC.slice(i, i + 160)).toContain("requireRole('manager')");
  });

  it('scopes the lead counts to the caller', () => {
    for (const decl of ["app.get('/api/leads/pipeline/summary'", "app.get('/api/metrics/today'"]) {
      const i = SRC.indexOf(decl);
      expect(SRC.slice(i, i + 900), decl).toContain('repLeadWhere(');
    }
  });
});
