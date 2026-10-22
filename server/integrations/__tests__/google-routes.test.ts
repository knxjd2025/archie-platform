import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import { registerGoogleRoutes, callerMailbox } from '../google-routes';
import { requireAuth } from '../../auth/middleware';

const ROUTES_SRC = readFileSync(join(__dirname, '../../routes.ts'), 'utf8');

interface Registered { path: string; methods: string[]; handlers: unknown[] }

function registeredRoutes(): Registered[] {
  const app = express();
  registerGoogleRoutes(app);
  return ((app as any)._router.stack as any[])
    .filter((l) => l.route)
    .map((l) => ({
      path: l.route.path,
      methods: Object.keys(l.route.methods),
      handlers: l.route.stack.map((s: any) => s.handle),
    }));
}

describe('Google Workspace routes', () => {
  it('requires authentication on every route', () => {
    // The routes these replaced had no requireAuth at all. Auth in this app is
    // applied per route — there is no global guard — so a new route added here
    // without it is silently public.
    const routes = registeredRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.handlers, `${r.methods} ${r.path}`).toContain(requireAuth);
    }
  });

  it('serves the panel the Integrations screen asks for', () => {
    const paths = registeredRoutes().map((r) => r.path);
    expect(paths).toContain('/api/integrations/google/status');
    expect(paths).toContain('/api/integrations/google/calendar/events');
    expect(paths).toContain('/api/integrations/google/drive/files');
  });

  it('exposes no write or send route', () => {
    // The deleted set included an unauthenticated POST /api/integrations/gmail/send,
    // which could send mail as whichever mailbox last populated the shared token.
    for (const r of registeredRoutes()) {
      expect(r.methods, r.path).toEqual(['get']);
    }
  });
});

describe('callerMailbox', () => {
  it('reads the session user, which is where this app puts it', () => {
    // Shipped broken once: it read req.user, a passport convention this app
    // never sets (no passport in the request path). Every route authenticated
    // correctly and then reported "No mailbox on this account" to real users.
    expect(callerMailbox({ session: { user: { email: 'thomas@bestroofingnow.com' } } }))
      .toBe('thomas@bestroofingnow.com');
  });

  it('ignores req.user entirely', () => {
    expect(callerMailbox({ user: { email: 'ghost@bestroofingnow.com' } })).toBeNull();
  });

  it('returns null rather than throwing on a session-less request', () => {
    // A null mailbox is refused by every route; undefined would reach the
    // delegation call and impersonate nothing.
    for (const req of [{}, { session: {} }, { session: { user: {} } }, null, undefined]) {
      expect(callerMailbox(req)).toBeNull();
    }
  });
});

describe('legacy shared-token routes are gone', () => {
  it('drops the unauthenticated OAuth entry points', () => {
    // GET /api/auth/google had no auth and wrote a PROCESS-GLOBAL token that
    // every other legacy route then read. Under Fluid Compute instances are
    // reused between requests, so that token outlived the request that set it.
    expect(ROUTES_SRC).not.toContain("'/api/auth/google'");
    expect(ROUTES_SRC).not.toContain("'/api/auth/google/callback'");
  });

  it('removes the process-global mailbox token', () => {
    expect(ROUTES_SRC).not.toContain('gmailTokens');
    expect(ROUTES_SRC).not.toContain('setGoogleTokens');
  });

  it('leaves no /api/integrations/gmail route behind', () => {
    expect(ROUTES_SRC).not.toMatch(/['"]\/api\/integrations\/gmail/);
  });

  it('keeps the real login flow, which is a different thing entirely', () => {
    // Sign-in lives in server/auth/* on /api/auth/login/google and is unaffected
    // — it requests only openid/email/profile and persists no tokens.
    const auth = readFileSync(join(__dirname, '../../auth/routes.ts'), 'utf8');
    expect(auth).toContain('/api/auth/login/google');
  });
});
