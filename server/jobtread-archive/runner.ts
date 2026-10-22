/**
 * Copies everything in JobTread into jobtread_archive, a chunk at a time.
 *
 * A server request is capped at five minutes and JobTread is slow, so a run
 * works until its deadline, saves its place in jobtread_archive_steps, and the
 * next run (the cron, or an admin pressing "Run now") carries on from there.
 * Read-only against JobTread: nothing here writes to it.
 *
 * Order: the org-wide lists first (jobs, custom fields, documents, payments),
 * then every job's detail (full custom fields, contacts, files, comments,
 * daily logs, tasks), then every document's line items. The per-job and
 * per-document steps walk the archive itself, so they cover every job and
 * document the lists found.
 */
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db';
import { jobtreadArchive, jobtreadArchiveSteps, type JobtreadArchiveStepRow } from '../../shared/schema';
import { JobTreadClient } from '../integrations/jobtread';
import {
  PAGED_STEPS, JOB_PARTS, documentLinesQuery, readDocumentLines,
  type ArchiveRow, type Page,
} from './queries';

export const STEP_ORDER = [...PAGED_STEPS.map((s) => s.name), 'jobDetail', 'documentLines'];

/** A paged list that fails this many times in a row is parked as an error. */
const MAX_LIST_FAILURES = 5;
/** A per-job part that fails this many times in one run is skipped for the rest of it. */
const MAX_PART_FAILURES_PER_RUN = 3;
const MAX_KEPT_ERRORS = 50;
/** Safety cap on pages within one job's connection. */
const MAX_PAGES_PER_CONN = 50;
const RECORDS_PER_BATCH = 20;

type Pave = (query: Record<string, unknown>) => Promise<any>;

export interface RunResult { finished: boolean; steps: string[]; rowsWritten: number; stoppedBy: 'done' | 'deadline' }

async function saveRows(rows: ArchiveRow[]): Promise<number> {
  if (!rows.length) return 0;
  // One statement per 200 rows keeps the parameter count well inside Postgres's limit.
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(jobtreadArchive)
      .values(rows.slice(i, i + 200).map((r) => ({ ...r, fetchedAt: new Date() })))
      .onConflictDoUpdate({
        target: [jobtreadArchive.companyId, jobtreadArchive.entityType, jobtreadArchive.jtId],
        set: { data: sql`excluded.data`, jobId: sql`coalesce(excluded.job_id, ${jobtreadArchive.jobId})`, fetchedAt: sql`now()` },
      });
  }
  return rows.length;
}

async function loadStep(step: string): Promise<JobtreadArchiveStepRow> {
  await db.insert(jobtreadArchiveSteps).values({ step }).onConflictDoNothing();
  const [row] = await db.select().from(jobtreadArchiveSteps).where(eq(jobtreadArchiveSteps.step, step));
  return row;
}

async function patchStep(step: string, set: Partial<typeof jobtreadArchiveSteps.$inferInsert>): Promise<void> {
  await db.update(jobtreadArchiveSteps).set({ ...set, updatedAt: new Date() }).where(eq(jobtreadArchiveSteps.step, step));
}

export function withError(errors: JobtreadArchiveStepRow['errors'], where: string, e: unknown): JobtreadArchiveStepRow['errors'] {
  const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  return [...errors, { at: new Date().toISOString(), where, message }].slice(-MAX_KEPT_ERRORS);
}

const bump = (counts: Record<string, number>, key: string, by: number) => ({ ...counts, [key]: (counts[key] || 0) + by });

// ---------------------------------------------------------------- paged lists

async function runPagedStep(name: string, pave: Pave, org: string, deadline: number): Promise<number> {
  const def = PAGED_STEPS.find((s) => s.name === name)!;
  let row = await loadStep(name);
  let written = 0;
  if (row.status === 'pending') { await patchStep(name, { status: 'running', startedAt: new Date() }); row = { ...row, status: 'running' }; }

  let cursor = row.cursor;
  let counts = row.counts;
  while (Date.now() < deadline) {
    let page: Page;
    try {
      page = def.read(await pave(def.query(org, cursor)));
    } catch (e) {
      const failures = (counts.failures || 0) + 1;
      counts = { ...counts, failures };
      await patchStep(name, {
        counts, errors: withError(row.errors, name, e),
        ...(failures >= MAX_LIST_FAILURES ? { status: 'error', finishedAt: new Date() } : {}),
      });
      return written;
    }
    written += await saveRows(page.rows);
    counts = { ...bump(counts, 'records', page.rows.length), failures: 0 };
    cursor = page.nextPage;
    if (!cursor) {
      await patchStep(name, { status: 'done', cursor: null, counts, finishedAt: new Date() });
      return written;
    }
    await patchStep(name, { cursor, counts });
  }
  return written;
}

// ---------------------------------------------------------------- walking the archive

/**
 * Thrown when the run's deadline passes partway through one record. The walk
 * leaves that record's cursor where it was, so the next run redoes the record
 * whole instead of saving half of it as done.
 */
export class DeadlineReached extends Error {
  constructor() { super('archive run deadline reached'); }
}

/**
 * Pull every page of one connection, however many there are — checking the
 * deadline before each page. Checking only between records let one job with
 * many pages of comments or files carry a run well past its budget and into
 * the 300s limit.
 */
export async function allPages(
  pave: Pave, query: (page: string | null) => Record<string, unknown>, read: (r: any) => Page, deadline: number,
): Promise<ArchiveRow[]> {
  const rows: ArchiveRow[] = [];
  let page: string | null = null;
  for (let i = 0; i < MAX_PAGES_PER_CONN; i++) {
    if (Date.now() >= deadline) throw new DeadlineReached();
    const p = read(await pave(query(page)));
    rows.push(...p.rows);
    page = p.nextPage;
    if (!page) break;
  }
  return rows;
}

async function nextArchived(entityType: string, after: string | null) {
  return db.select({ jtId: jobtreadArchive.jtId, jobId: jobtreadArchive.jobId })
    .from(jobtreadArchive)
    .where(after ? and(eq(jobtreadArchive.entityType, entityType), gt(jobtreadArchive.jtId, after)) : eq(jobtreadArchive.entityType, entityType))
    .orderBy(asc(jobtreadArchive.jtId))
    .limit(RECORDS_PER_BATCH);
}

/**
 * Walk archived records of one type, pulling something for each. Only starts
 * once the list it walks is complete, or it would finish before the list does.
 */
/** Per-run failure tracking for the parts of a walk step. */
export interface PartTracker { ok: (where: string) => boolean; fail: (where: string, e: unknown) => void }

async function runWalkStep(
  name: string, entityType: string, dependsOn: string[], deadline: number,
  perRecord: (rec: { jtId: string; jobId: string | null }, parts: PartTracker) => Promise<number>,
): Promise<number> {
  const deps = await db.select().from(jobtreadArchiveSteps);
  const ready = dependsOn.every((d) => ['done', 'error'].includes(deps.find((r) => r.step === d)?.status || ''));
  if (!ready) return 0;

  let row = await loadStep(name);
  if (row.status === 'pending') { await patchStep(name, { status: 'running', startedAt: new Date() }); row = { ...row, status: 'running' }; }
  let { cursor, counts, errors } = row;
  let written = 0;
  const partFailures = new Map<string, number>();
  // A part that keeps failing (a field JobTread rejects, say) is skipped for
  // the rest of this run instead of costing a request per record.
  const parts: PartTracker = {
    ok: (where) => (partFailures.get(where) || 0) < MAX_PART_FAILURES_PER_RUN,
    fail: (where, e) => {
      partFailures.set(where, (partFailures.get(where) || 0) + 1);
      errors = withError(errors, where, e);
      counts = bump(counts, `${where}:errors`, 1);
    },
  };

  while (Date.now() < deadline) {
    const batch = await nextArchived(entityType, cursor);
    if (!batch.length) {
      await patchStep(name, { status: 'done', cursor, counts, errors, finishedAt: new Date() });
      return written;
    }
    for (const rec of batch) {
      if (Date.now() >= deadline) break;
      let n: number;
      try {
        n = await perRecord(rec, parts);
      } catch (e) {
        if (!(e instanceof DeadlineReached)) throw e;
        break; // this record is redone next run; save the cursor before it
      }
      written += n;
      counts = bump(bump(counts, 'records', 1), 'rows', n);
      cursor = rec.jtId;
    }
    await patchStep(name, { cursor, counts, errors });
  }
  return written;
}

async function jobDetail(pave: Pave, rec: { jtId: string }, parts: PartTracker, deadline: number): Promise<number> {
  const rows: ArchiveRow[] = [];
  for (const part of JOB_PARTS) {
    const where = `job.${part.name}`;
    if (!parts.ok(where)) continue;
    try {
      rows.push(...await allPages(pave, (page) => part.query(rec.jtId, page), (r) => part.read(r, rec.jtId), deadline));
    } catch (e) {
      if (e instanceof DeadlineReached) throw e; // out of time, not a failing part
      parts.fail(where, e);
    }
  }
  return saveRows(rows);
}

async function documentLines(pave: Pave, rec: { jtId: string; jobId: string | null }, parts: PartTracker, deadline: number): Promise<number> {
  if (!parts.ok('document.lines')) return 0;
  try {
    return await saveRows(await allPages(pave, (page) => documentLinesQuery(rec.jtId, page), (r) => readDocumentLines(r, rec.jtId, rec.jobId), deadline));
  } catch (e) {
    if (e instanceof DeadlineReached) throw e;
    parts.fail('document.lines', e);
    return 0;
  }
}

// ---------------------------------------------------------------- one run

/** Work through the steps until everything is done or the deadline passes. */
export async function runArchiveChunk(budgetMs: number): Promise<RunResult> {
  const deadline = Date.now() + budgetMs;
  const client = new JobTreadClient();
  const pave: Pave = (q) => client.paveQuery<any>(q);
  const org = await client.getOrganizationId();

  let rowsWritten = 0;
  const touched: string[] = [];
  for (const name of STEP_ORDER) {
    if (Date.now() >= deadline) break;
    const row = await loadStep(name);
    if (row.status === 'done' || row.status === 'error') continue;
    touched.push(name);
    if (name === 'jobDetail') {
      rowsWritten += await runWalkStep(name, 'job', ['jobs'], deadline, (rec, parts) => jobDetail(pave, rec, parts, deadline));
    } else if (name === 'documentLines') {
      rowsWritten += await runWalkStep(name, 'document', PAGED_STEPS.filter((s) => s.name.startsWith('documents:')).map((s) => s.name), deadline,
        (rec, parts) => documentLines(pave, rec, parts, deadline));
    } else {
      rowsWritten += await runPagedStep(name, pave, org, deadline);
    }
  }
  const all = await db.select({ status: jobtreadArchiveSteps.status }).from(jobtreadArchiveSteps);
  const finished = all.length >= STEP_ORDER.length && all.every((s) => s.status === 'done' || s.status === 'error');
  return { finished, steps: touched, rowsWritten, stoppedBy: finished ? 'done' : 'deadline' };
}

/** Where the archive stands: each step, and how many of each record are stored. */
export async function archiveStatus() {
  const [steps, totals] = await Promise.all([
    db.select().from(jobtreadArchiveSteps),
    db.select({ entityType: jobtreadArchive.entityType, n: sql<number>`count(*)::int` }).from(jobtreadArchive).groupBy(jobtreadArchive.entityType),
  ]);
  const byName = new Map(steps.map((s) => [s.step, s]));
  return {
    steps: STEP_ORDER.map((name) => byName.get(name) ?? { step: name, status: 'pending', cursor: null, counts: {}, errors: [], startedAt: null, finishedAt: null, updatedAt: null }),
    totals: Object.fromEntries(totals.map((t) => [t.entityType, Number(t.n)])),
    finished: STEP_ORDER.every((name) => ['done', 'error'].includes(byName.get(name)?.status || '')),
  };
}

/** Run a step again from the start (after a query is fixed, say). Rows already stored stay. */
export async function resetStep(step: string): Promise<boolean> {
  if (!STEP_ORDER.includes(step)) return false;
  await loadStep(step);
  await patchStep(step, { status: 'pending', cursor: null, counts: {}, errors: [], startedAt: null, finishedAt: null });
  return true;
}
