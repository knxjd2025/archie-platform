import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// Whoever the test signs in as is an active roster member in that role, so
// session revalidation passes and the money gate is what decides.
let role = 'customer_service';
vi.mock('../../storage/team', () => ({
  getTeamMemberByEmail: async (email: string) => ({ email, name: 'Test', role, active: true, canLogin: true }),
}));
// The gate must refuse before any query runs; a db that throws proves it.
vi.mock('../../db', () => ({
  db: new Proxy({}, { get: () => { throw new Error('the money gate let the request reach the database'); } }),
}));

vi.mock('../../tenant/companies', async () => ({ getCurrentCompany: async () => (await import('../../__tests__/helpers/tenant')).liveTestCompany() }));

import { registerCommissionRoutes } from '../routes';
import { fakeSession } from '../../__tests__/helpers/tenant';
import { clearSessionRevalidationCache } from '../../auth/middleware';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(fakeSession(() => ({ email: 'cs@example.com', name: 'Test', role })));
  registerCommissionRoutes(app);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });
beforeEach(() => { clearSessionRevalidationCache(); role = 'customer_service'; });

describe('commissions are money', () => {
  it('refuses customer service the commission list', async () => {
    // Customer service has scope 'all', so the list returned every rep's
    // commission to it. canSeeMoney keeps money from leaking sideways.
    const r = await fetch(`${base}/api/commissions`);
    expect(r.status).toBe(403);
  });

  it('refuses customer service filing a commission draft', async () => {
    const r = await fetch(`${base}/api/commissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobName: 'Job', repName: 'Rep', leadSource: 'self', jobType: 'retail', revenue: 1000 }),
    });
    expect(r.status).toBe(403);
  });

  it('refuses customer service approving one', async () => {
    const r = await fetch(`${base}/api/commissions/1/approve`, { method: 'POST' });
    expect(r.status).toBe(403);
  });
});

describe('overdue AR on the dashboard', () => {
  it('is gated on money as well as scope', () => {
    // isScoped alone let customer service (scope 'all') read the company's
    // overdue receivables total.
    const src = readFileSync(join(__dirname, '../../dashboard/routes.ts'), 'utf8');
    expect(src).toContain("if (!isScoped(user) && canSeeMoney(user.role, 'ar'))");
  });
});
