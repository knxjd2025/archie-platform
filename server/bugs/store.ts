/**
 * Where bug reports and caught errors are kept.
 *
 * Rows belong to the company the error happened for. An error with no company
 * (before sign-in) is written as system work with no company, so the catcher
 * never fails just because there was no one signed in.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { currentTenant, runAsSystem } from '../tenant/context';
import { fingerprintFor } from './fingerprint';

/**
 * The table now comes from the migrations (the app's database role cannot
 * create tables). Kept so callers need not change.
 */
export function ensureBugTable(): Promise<void> {
  return Promise.resolve();
}

export const clip = (s: unknown, max: number): string | null => {
  if (s === null || s === undefined) return null;
  const text = String(s);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export interface PersonReport {
  message: string;
  details?: string | null;
  page?: string | null;
  url?: string | null;
  userEmail: string;
  userAgent?: string | null;
  context?: Record<string, unknown>;
  screenshot?: string | null;
}

/** A person pressed "Report a bug". Always its own row. */
export async function recordPersonReport(r: PersonReport): Promise<number> {
  await ensureBugTable();
  const result = await db.execute(sql`
    INSERT INTO bug_reports (kind, message, details, page, url, user_email, user_agent, context, screenshot)
    VALUES ('report', ${r.message}, ${r.details ?? null}, ${r.page ?? null}, ${r.url ?? null}, ${r.userEmail},
            ${r.userAgent ?? null}, ${JSON.stringify(r.context ?? {})}::jsonb, ${r.screenshot ?? null})
    RETURNING id`);
  return Number((result.rows[0] as { id: number }).id);
}

export interface CaughtError {
  kind: 'client_error' | 'server_error';
  /** What failed: a route name, or a browser source such as "render". */
  where: string;
  message: string;
  stack?: string | null;
  page?: string | null;
  url?: string | null;
  userEmail?: string | null;
  userAgent?: string | null;
  context?: Record<string, unknown>;
}

export interface CaughtResult {
  id: number; occurrences: number; firstTime: boolean;
  /** It had been marked fixed, and it just happened again. */
  reopened: boolean;
}

/**
 * The app caught an error by itself. Grouped by fingerprint; one marked
 * fixed that happens again is reopened, because then it was not fixed.
 */
export async function recordCaughtError(e: CaughtError): Promise<CaughtResult> {
  await ensureBugTable();
  const fingerprint = fingerprintFor(e.kind, e.where, e.message, e.stack);
  const context = JSON.stringify({ ...(e.context ?? {}), where: e.where });
  // `prev` reads the row as it was before this statement, so a reopen is visible.
  // No company (an error before sign-in, or in system work): record it with no
  // company, as system work, so the insert is allowed.
  const ctx = currentTenant();
  const run = <T,>(fn: () => Promise<T>): Promise<T> => (ctx?.companyId ? fn() : runAsSystem('record error with no company', fn));
  const result = await run(() => db.execute(sql`
    WITH prev AS (SELECT status FROM bug_reports WHERE fingerprint = ${fingerprint} AND company_id IS NOT DISTINCT FROM archie_current_company())
    INSERT INTO bug_reports (kind, fingerprint, message, details, page, url, user_email, user_agent, context)
    VALUES (${e.kind}, ${fingerprint}, ${clip(e.message, 2000)}, ${clip(e.stack, 8000)}, ${e.page ?? null},
            ${e.url ?? null}, ${e.userEmail ?? null}, ${e.userAgent ?? null}, ${context}::jsonb)
    ON CONFLICT (company_id, fingerprint) WHERE fingerprint IS NOT NULL DO UPDATE SET
      occurrences = bug_reports.occurrences + 1,
      last_seen = NOW(),
      details = EXCLUDED.details,
      page = COALESCE(EXCLUDED.page, bug_reports.page),
      url = COALESCE(EXCLUDED.url, bug_reports.url),
      user_email = COALESCE(EXCLUDED.user_email, bug_reports.user_email),
      user_agent = COALESCE(EXCLUDED.user_agent, bug_reports.user_agent),
      context = EXCLUDED.context,
      status = CASE WHEN bug_reports.status = 'fixed' THEN 'new' ELSE bug_reports.status END
    RETURNING id, occurrences, (SELECT status FROM prev) AS prev_status`));
  const row = result.rows[0] as { id: number; occurrences: number; prev_status: string | null };
  const occurrences = Number(row.occurrences);
  return { id: Number(row.id), occurrences, firstTime: occurrences === 1, reopened: row.prev_status === 'fixed' };
}
