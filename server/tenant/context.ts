/**
 * Which company the current piece of work is for.
 *
 * Every database connection the app checks out is told this (server/db.ts), and
 * the database's row level security only shows that company's rows. With no
 * company set, queries see nothing and inserts fail, so forgetting to set it
 * fails closed. See docs/archie/01-multi-company.md.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  /** The company this work is for, or null for cross-company system work. */
  companyId: string | null;
  /** True only inside runAsSystem: the database lets this work see every company. */
  system: boolean;
  /** Why system access was needed, for logs. */
  reason?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The context in effect right now, or undefined when nothing has set one. */
export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

/** The current company id, or null when there is none (or this is system work). */
export function currentCompanyId(): string | null {
  return storage.getStore()?.companyId ?? null;
}

/** The current company id; throws when there is none. For code that must have one. */
export function requireCompanyId(): string {
  const id = currentCompanyId();
  if (!id) throw new Error('No company in context: this work must run for a company (runAsCompany).');
  return id;
}

/**
 * Run fn as work for one company. Nested calls replace the outer context for
 * their duration.
 *
 * Always async, and fn's result is awaited inside the context. That matters:
 * a drizzle query is a lazy builder that only runs when awaited, so returning
 * `db.select()...` from fn and awaiting it outside would run the query with no
 * company. Awaiting it here runs it as the company.
 */
export function runAsCompany<T>(companyId: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (!UUID_RE.test(companyId)) return Promise.reject(new Error(`runAsCompany: not a company id: ${String(companyId)}`));
  return storage.run({ companyId, system: false }, async () => await fn());
}

/**
 * Run fn with access to every company's rows. Only for the few lookups that
 * come before knowing the company: sign-in by email, a public link's token, a
 * webhook's GHL location, a cron listing companies. Keep the work inside as
 * small as possible and switch to runAsCompany as soon as the company is known.
 */
export function runAsSystem<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (!reason) return Promise.reject(new Error('runAsSystem needs a reason'));
  // Awaited inside the context for the same reason as runAsCompany.
  return storage.run({ companyId: null, system: true, reason }, async () => await fn());
}

/**
 * Bind a callback to the context in effect now, for code that hands work to an
 * event emitter or timer that would otherwise lose it.
 */
export function bindTenant<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ctx = storage.getStore();
  if (!ctx) return fn;
  return (...args: A) => storage.run(ctx, () => fn(...args));
}

/** Enter a context for the rest of the current async flow (used by request middleware). */
export function enterCompany(companyId: string): void {
  if (!UUID_RE.test(companyId)) throw new Error(`enterCompany: not a company id: ${String(companyId)}`);
  storage.enterWith({ companyId, system: false });
}

export const isCompanyId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
