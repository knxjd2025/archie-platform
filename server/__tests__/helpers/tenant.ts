/**
 * Test helpers for company isolation (docs/archie/01-multi-company.md).
 *
 * Route tests that forge a session: give it a companyId and run the request as
 * that company, the way server/tenant/middleware.ts does in the real app.
 * Database tests: make a real company and run the test body as it.
 */
import type { Request, Response, NextFunction } from 'express';
import { runAsCompany } from '../../tenant/context';

/** A fixed company id for tests that never touch the companies table. */
export const TEST_COMPANY_ID = '0e5f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
export const OTHER_COMPANY_ID = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

/** What tests mock getCurrentCompany with: a live company. */
export const liveTestCompany = (id = TEST_COMPANY_ID) => ({ id, slug: 'test-co', name: 'Test Co', trade: 'roofing', status: 'active', branding: {}, settings: {} });

/**
 * Express middleware for route tests: sets req.session from `user()` (adding
 * the company) and runs the rest of the request as that company.
 */
export function fakeSession(user: () => Record<string, unknown> | undefined, companyId = TEST_COMPANY_ID) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = user();
    (req as any).session = { user: u && { companyId, ...u }, destroy: (cb: () => void) => cb() };
    if (u) runAsCompany(companyId, next);
    else next();
  };
}

/**
 * A real company row for database tests, made once per test file. Needs the
 * test database (scripts/test-db.sh). Imported lazily so files that only use
 * the constants above do not load the database.
 */
export async function makeTestCompany(label: string): Promise<string> {
  const { createCompany } = await import('../../tenant/companies');
  const slug = `test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const company = await createCompany({ slug, name: `Test ${label}`, status: 'active' });
  return company.id;
}

/** Run fn as the given company. */
export const asCompany = <T,>(companyId: string, fn: () => T | PromiseLike<T>): Promise<T> => runAsCompany(companyId, fn);

/**
 * Wrap test bodies and hooks to run as a company known only once the test
 * starts: `const as = inCompany(() => companyId); it('...', as(async () => {...}))`.
 */
export const inCompany = (getId: () => string) =>
  // No parameters on the returned function: vitest reads a test function's
  // first parameter as a fixture request.
  <R,>(fn: () => R | PromiseLike<R>) => (): Promise<R> => runAsCompany(getId(), fn);
