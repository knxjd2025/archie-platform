/**
 * Scheduled jobs that run once per company, built to hold up with hundreds of
 * companies inside one serverless invocation (maxDuration 300s).
 *
 * The old loop (forEachLiveCompany) went through every company one at a time
 * in no particular order, with no overall deadline and no memory between
 * runs: when the invocation was killed, the companies late in the list got
 * nothing, and the same ones starved every time. Here a job is:
 *
 * - deterministic in order: companies tried least recently go first (never
 *   tried first of all), then by id, so a cut-off run rotates instead of
 *   starving the same companies;
 * - bounded: each company gets at most `perCompanyMs`, and no company starts
 *   unless it can finish inside the invocation's budget;
 * - resumable and idempotent: when a company's work for a period (say its
 *   local date) is finished, company_job_runs records it, and later runs in
 *   that period skip it. A run cut off part-way leaves the rest for the next
 *   invocation;
 * - time-zone correct: the period is worked out from the company's own time
 *   zone (its profile), without a query;
 * - parallel where safe: up to `concurrency` companies at once;
 * - exclusive: a run claims a company's row atomically before working on it
 *   (a lease in company_job_runs, migration 0010), so two overlapping
 *   invocations never run the same company at once. A lease lasts
 *   perCompanyMs plus a margin; a crashed run's lease expires and a later run
 *   takes over. Success is recorded only while the run still holds its lease,
 *   so a run that timed out (its work cannot be stopped from outside) or lost
 *   its lease can never mark the period done.
 *
 * A job's `run` must honour `deadline` and `signal` (aborted when the company
 * hits perCompanyMs) and be idempotent: a timed-out or crashed run is retried
 * by a later invocation once its lease has expired.
 *
 * Each company's work runs as that company (runAsCompany), so it can only see
 * its own rows. Listing companies and reading progress are the only system
 * reads.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { companies, companyJobRuns, type Company } from '../../shared/schema';
import { DEFAULT_TZ } from '../../shared/schedule-board';
import { LIVE_STATUSES, resolveCompanyProfile } from '../../shared/company';
import { runAsCompany, runAsSystem } from './context';

/** The company's own time zone, from its row (no query), falling back to the default. */
export function companyTimeZone(company: Company): string {
  try {
    const tz = resolveCompanyProfile(company).timeZone;
    if (tz) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  } catch { /* unknown zone: fall through */ }
  return DEFAULT_TZ;
}

/** Local date, hour and weekday (0 = Sunday) of an instant in a time zone. */
export function localParts(now: Date, timeZone: string): { date: string; hour: number; minutes: number; weekday: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour,
    minutes: hour * 60 + Number(p.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}

export interface CompanyJob<T> {
  /** Stable name: the key for this job's progress rows. */
  name: string;
  /**
   * The period this run would work on for the company (its local date, say),
   * or null when nothing is due for it now. Pure: no queries.
   */
  period: (company: Company, now: Date) => string | null;
  /**
   * The work for one company. Runs as the company. `deadline` is an epoch ms
   * it should finish by; `signal` is aborted when it runs out of time. Must be
   * idempotent (see the top of this file).
   */
  run: (args: { company: Company; period: string; now: Date; deadline: number; signal: AbortSignal }) => Promise<T>;
  /** Whether the period's work is finished. Default: yes. Unfinished work is picked up by the next run. */
  isComplete?: (value: T) => boolean;
  /** Hard cap on one company's work. */
  perCompanyMs: number;
  /** Companies worked on at once. */
  concurrency?: number;
}

export interface FanOutOptions {
  now?: Date;
  /** Stop starting companies that could not finish by then. Default 270s, inside maxDuration 300s. */
  budgetMs?: number;
  /** Run even for companies already done this period (a manual "force" run). */
  ignoreDone?: boolean;
  /** Only these companies (tests, and an admin running a job for their own company). */
  onlyCompanyIds?: string[];
}

export type CompanyOutcome<T> =
  | { companyId: string; status: 'done' | 'partial'; period: string; value: T }
  | { companyId: string; status: 'already_done' | 'not_reached' | 'in_progress'; period: string }
  | { companyId: string; status: 'not_due' }
  | { companyId: string; status: 'failed' | 'timed_out'; period: string; error: string };

export interface FanOutReport<T> {
  job: string;
  ok: boolean;
  /** Companies that still have work this period and were not finished in this run. */
  remaining: number;
  companies: CompanyOutcome<T>[];
}

export const DEFAULT_BUDGET_MS = 270_000;

class CompanyTimeout extends Error {
  constructor(ms: number) { super(`did not finish within ${Math.round(ms / 1000)}s`); }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CompanyTimeout(ms)), ms); });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

async function liveCompaniesInOrder(job: string, only?: string[]) {
  return runAsSystem(`fan-out ${job}: list companies`, async () => {
    const where = only?.length
      ? and(inArray(companies.status, [...LIVE_STATUSES]), inArray(companies.id, only))
      : inArray(companies.status, [...LIVE_STATUSES]);
    const rows = await db.select({ company: companies, run: companyJobRuns })
      .from(companies)
      .leftJoin(companyJobRuns, and(eq(companyJobRuns.companyId, companies.id), eq(companyJobRuns.job, job)))
      .where(where)
      .orderBy(sql`${companyJobRuns.attemptedAt} asc nulls first`, companies.id);
    return rows;
  });
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** Record progress, as the company. */
async function mark(companyId: string, job: string, set: Partial<typeof companyJobRuns.$inferInsert>) {
  await runAsCompany(companyId, () => db.insert(companyJobRuns)
    .values({ companyId, job, ...set })
    .onConflictDoUpdate({ target: [companyJobRuns.companyId, companyJobRuns.job], set }), { loadProfile: false });
}

/** How long a claim lasts: the per-company cap plus a margin (at most 30s). */
export function leaseMs(perCompanyMs: number): number {
  return perCompanyMs + Math.min(perCompanyMs, 30_000);
}

type Claim = { token: string } | { skipped: 'already_done' | 'in_progress' };

/**
 * Take this company's job for this run, in one statement, as the company:
 * succeeds only when no unexpired lease is held (and, unless forced, the
 * period is not done). Also stamps attempted_at for the rotation order.
 */
async function claim(companyId: string, job: string, period: string, ignoreDone: boolean, ms: number): Promise<Claim> {
  const token = randomUUID();
  return runAsCompany(companyId, async () => {
    const r = await db.execute(sql`
      insert into company_job_runs (job, attempted_at, lease_token, lease_until)
      values (${job}, now(), ${token}, now() + ${ms} * interval '1 millisecond')
      on conflict (company_id, job) do update
         set attempted_at = excluded.attempted_at, lease_token = excluded.lease_token, lease_until = excluded.lease_until
       where (company_job_runs.lease_until is null or company_job_runs.lease_until <= now())
         and (${ignoreDone}::boolean or company_job_runs.done_period is distinct from ${period})
      returning lease_token`);
    if (r.rows.length) return { token };
    const [row] = await db.select({ donePeriod: companyJobRuns.donePeriod }).from(companyJobRuns).where(eq(companyJobRuns.job, job));
    return { skipped: !ignoreDone && row?.donePeriod === period ? 'already_done' : 'in_progress' };
  }, { loadProfile: false });
}

/**
 * Change this run's row only while it still holds a valid lease. Returns
 * whether it did. `release` drops the lease (finished or failed); a timed-out
 * run keeps it, so nobody starts the company while its work may still run.
 */
async function updateHeld(companyId: string, job: string, token: string, set: Partial<typeof companyJobRuns.$inferInsert>, release: boolean): Promise<boolean> {
  return runAsCompany(companyId, async () => {
    const rows = await db.update(companyJobRuns)
      .set({ ...set, ...(release ? { leaseToken: null, leaseUntil: null } : {}) })
      .where(and(eq(companyJobRuns.job, job), eq(companyJobRuns.leaseToken, token), sql`${companyJobRuns.leaseUntil} > now()`))
      .returning({ job: companyJobRuns.job });
    return rows.length > 0;
  }, { loadProfile: false });
}

/** Record that a company's work for a period is done, outside a run (e.g. seeding at creation). */
export async function markCompanyJobDone(companyId: string, job: string, period: string): Promise<void> {
  const at = new Date();
  await mark(companyId, job, { donePeriod: period, doneAt: at, attemptedAt: at, lastError: null });
}

/** Run a job across every live company. See the top of this file. */
export async function runCompanyJob<T>(job: CompanyJob<T>, opts: FanOutOptions = {}): Promise<FanOutReport<T>> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budgetEnd = started + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const rows = await liveCompaniesInOrder(job.name, opts.onlyCompanyIds);

  // Work out what is due without touching the database again.
  const outcomes: CompanyOutcome<T>[] = [];
  const queue: Array<{ company: Company; period: string; index: number }> = [];
  for (const { company, run } of rows) {
    const index = outcomes.length;
    let period: string | null;
    try { period = job.period(company, now); } catch (err) {
      outcomes.push({ companyId: company.id, status: 'failed', period: '', error: errorText(err) });
      continue;
    }
    if (period === null) { outcomes.push({ companyId: company.id, status: 'not_due' }); continue; }
    if (!opts.ignoreDone && run?.donePeriod === period) {
      outcomes.push({ companyId: company.id, status: 'already_done', period });
      continue;
    }
    outcomes.push({ companyId: company.id, status: 'not_reached', period });
    queue.push({ company, period, index });
  }

  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const item = queue[next++];
      // Never start a company that could not finish inside the invocation.
      if (Date.now() + job.perCompanyMs > budgetEnd) continue;
      const { company, period, index } = item;
      let token: string | null = null;
      const controller = new AbortController();
      try {
        // Claimed now, before the work (which also marks it tried, so if this
        // invocation is killed the company moves to the back of the queue).
        const claimed = await claim(company.id, job.name, period, !!opts.ignoreDone, leaseMs(job.perCompanyMs));
        if ('skipped' in claimed) {
          outcomes[index] = { companyId: company.id, status: claimed.skipped, period };
          continue;
        }
        token = claimed.token;
        const deadline = Date.now() + job.perCompanyMs;
        const value = await withTimeout(
          runAsCompany(company.id, () => job.run({ company, period, now, deadline, signal: controller.signal })),
          job.perCompanyMs,
        );
        const complete = job.isComplete ? job.isComplete(value) : true;
        const recorded = await updateHeld(company.id, job.name, token,
          complete ? { donePeriod: period, doneAt: new Date(), lastError: null } : { lastError: null }, true);
        if (!recorded) throw new Error('lost its claim before finishing: not recorded as done');
        outcomes[index] = { companyId: company.id, status: complete ? 'done' : 'partial', period, value };
      } catch (err) {
        const timedOut = err instanceof CompanyTimeout;
        if (timedOut) controller.abort(err);
        console.error(`[fan-out] ${job.name} ${timedOut ? 'timed out' : 'failed'} for company ${company.slug}:`, errorText(err));
        // A timed-out run keeps its lease until it expires: its work may still be running.
        if (token) await updateHeld(company.id, job.name, token, { lastError: errorText(err) }, !timedOut).catch(() => {});
        else await mark(company.id, job.name, { lastError: errorText(err) }).catch(() => {});
        outcomes[index] = { companyId: company.id, status: timedOut ? 'timed_out' : 'failed', period, error: errorText(err) };
      }
    }
  };
  const n = Math.max(1, Math.min(job.concurrency ?? 1, queue.length || 1));
  await Promise.all(Array.from({ length: n }, worker));

  // in_progress: another run holds the company; it is not this run's failure.
  const remaining = outcomes.filter((o) => o.status !== 'done' && o.status !== 'already_done' && o.status !== 'not_due').length;
  return {
    job: job.name,
    ok: outcomes.every((o) => o.status !== 'failed' && o.status !== 'timed_out'),
    remaining,
    companies: outcomes,
  };
}
