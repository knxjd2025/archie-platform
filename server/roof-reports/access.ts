/**
 * Who may see and do what with a roof report (the written decisions are in
 * shared/roof-reports.ts, held by roof-report-roles.db.test.ts).
 *
 * The role is read from the signed-in session on the server, never from the
 * request. A report that is not yours, belongs to another company, is archived
 * or is not there is the same nothing: `roofReportFor` returns null for all of
 * them and the routes answer "not found", never "forbidden". Company isolation
 * is the database's: every query here runs as the company in context.
 */
import type { Request, Response, NextFunction } from 'express';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leads, roofReports, type RoofReport } from '../../shared/schema';
import type { TeamRole } from '../../shared/rbac';
import {
  NOT_FOUND, ROOF_REPORT_RULES, type RoofReportAction, type RoofReportDecision,
} from '../../shared/roof-reports';
import { ownsLead, scopedLeadWhere, type SessionUser } from '../access/rep-scope';
import { visibleIdsFor } from '../access/team-scope';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What this role may do, how far. An unknown role may do nothing. */
export function decisionFor(role: TeamRole, action: RoofReportAction): RoofReportDecision {
  if (typeof role !== 'string' || !Object.hasOwn(ROOF_REPORT_RULES, role)) return 'no';
  return ROOF_REPORT_RULES[role][action] ?? 'no';
}

/** False for crew (reports carry prices), and for any role nobody has decided. */
export function mayUseRoofReports(role: TeamRole): boolean {
  return decisionFor(role, 'see') !== 'no';
}

/** The person making the request, from the signed-in session only. Nothing in the body, address or headers is read. */
export function roofReportUser(req: Request): SessionUser | null {
  const user = req.session?.user;
  return user ? { email: user.email, name: user.name, role: user.role } : null;
}

/**
 * After the sign-in check: a role that may not use roof reports gets the same
 * 404 as a report that is not there.
 */
export function requireRoofReportUser(req: Request, res: Response, next: NextFunction): void {
  const user = roofReportUser(req);
  if (!user) {
    res.status(401).json({ message: 'Not authenticated' });
    return;
  }
  if (!mayUseRoofReports(user.role)) {
    res.status(404).json({ message: NOT_FOUND });
    return;
  }
  next();
}

/**
 * The rows of roof_reports this person may see.
 *   all-scope roles: every report of the company (row level security holds the company)
 *   otherwise: a report on a job the person's data scope covers (the same
 *   rule as ownsLead), or an address report made by someone they may see.
 * Archived reports are left out unless `archived` is asked for, and only a
 * role that sees everything gets them. No access at all is a false predicate,
 * never an absent one.
 */
export async function visibleRoofReportWhere(user: SessionUser, opts: { archived?: boolean } = {}): Promise<SQL> {
  const decision = decisionFor(user?.role, opts.archived ? 'see_archived' : 'see');
  if (decision === 'no') return sql`false`;
  const status = opts.archived ? eq(roofReports.status, 'archived') : ne(roofReports.status, 'archived');
  if (decision === 'all') return status;

  const jobs = await scopedLeadWhere(user);
  const people = await visibleIdsFor(user);
  const onMyJobs = and(
    isNotNull(roofReports.jobExternalId),
    sql`${roofReports.jobExternalId} IN (SELECT ${leads.externalId} FROM ${leads} WHERE ${jobs})`,
  ) as SQL;
  // null would mean "everyone"; a narrowed role never gets it, but if it ever
  // did the job rule above still holds and address reports stay with their makers.
  const madeByMe = people !== null && people.length
    ? and(isNull(roofReports.jobExternalId), inArray(roofReports.createdByMemberId, people)) as SQL
    : sql`false`;
  return and(status, or(onMyJobs, madeByMe)) as SQL;
}

/**
 * One report by id, for this person, or null: for a bad id, another company's
 * report, one the person may not see, an archived one and one that is not
 * there. Run it as the company (runAsCompany or a request's context).
 */
export async function roofReportFor(user: SessionUser, id: string): Promise<RoofReport | null> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const where = await visibleRoofReportWhere(user);
  const [row] = await db.select().from(roofReports).where(and(eq(roofReports.id, id), where)).limit(1);
  return row ?? null;
}

/** May this person attach a report to this job: it exists in their company and their scope covers it. */
export async function mayAttachJob(user: SessionUser, jobExternalId: string): Promise<boolean> {
  if (typeof jobExternalId !== 'string' || !jobExternalId) return false;
  if (decisionFor(user?.role, 'make') === 'no') return false;
  const [job] = await db.select({ id: leads.id }).from(leads).where(eq(leads.externalId, jobExternalId)).limit(1);
  if (!job) return false;
  return ownsLead(user, jobExternalId);
}
