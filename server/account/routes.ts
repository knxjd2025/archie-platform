/**
 * "My account" — one screen answering "what am I actually responsible for right
 * now": the jobs I own, the signed documents on them, and what's been said in
 * the last 30 days.
 *
 * Everything here is scoped to the signed-in person by OWNERSHIP, not by role.
 * A sales rep and the owner both see their own book; managers and admins can
 * switch to the whole company explicitly, which is a different question than
 * "what's mine".
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq, inArray, isNotNull, isNull, notInArray, or, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leads, deals, clientReports } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { ownedLeadWhere, type SessionUser } from '../access/rep-scope';
import { atLeast, type TeamRole } from '../../shared/rbac';
import { sendFailure } from '../lib/failure';

/** How far back the account view looks. Matches the messages window. */
export const WINDOW_DAYS = 30;

/** Stages that mean the job is finished — an "active" list is the point. */
export const DONE_STAGES = ['Closed', 'Lost', 'Complete'];

/**
 * Is this job still active? Mirrors the SQL predicate below. A job with NO stage
 * set counts as active — dropping it would quietly hide new leads that haven't
 * been staged yet, which is exactly the client an account view exists to surface.
 */
export function isActiveStage(stage: string | null | undefined): boolean {
  return stage == null || !DONE_STAGES.includes(stage);
}

export interface AccountScope {
  requested: string;
  /** 'mine' | 'all' — 'all' only ever granted to manager+. */
  effective: 'mine' | 'all';
  /** Set when 'all' was asked for but not allowed. */
  denied?: boolean;
}

/**
 * Resolve the requested scope against the user's role. Kept pure so the
 * permission rule is testable without a database.
 */
export function resolveScope(requested: unknown, role: string): AccountScope {
  const want = String(requested || 'mine').trim().toLowerCase();
  if (want !== 'all') return { requested: want, effective: 'mine' };
  if (atLeast(role as TeamRole, 'manager')) return { requested: want, effective: 'all' };
  // A rep asking for everyone's book gets their own, and is told so rather than
  // being shown a silently different answer.
  return { requested: want, effective: 'mine', denied: true };
}

export function registerAccountRoutes(app: Express) {
  app.get('/api/account/summary', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const scope = resolveScope(req.query.scope, user.role);

      // 'all' means no ownership filter; 'mine' restricts to what this person owns.
      const ownership: SQL | undefined = scope.effective === 'all' ? undefined : await ownedLeadWhere(user);
      // notInArray, not a raw sql`NOT IN ${array}` — drizzle binds a JS array as a
      // single parameter there, which is not a value list. A NULL stage is also
      // NOT NULL-safe in SQL (NULL NOT IN (...) is NULL, i.e. excluded), so a job
      // with no stage set has to be allowed back in explicitly.
      const active = or(isNull(leads.stage), notInArray(leads.stage, DONE_STAGES)) as SQL;
      const where = ownership ? (and(ownership, active) as SQL) : active;

      const jobs = await db
        .select({
          externalId: leads.externalId,
          jobName: leads.jobName,
          firstName: leads.firstName,
          lastName: leads.lastName,
          address: leads.address,
          city: leads.city,
          stage: leads.stage,
          jobNumber: leads.jobNumber,
          rep: leads.jtSalesRep,
          phone: leads.phone,
          email: leads.email,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(where)
        .orderBy(desc(leads.createdAt))
        .limit(300);

      const jobNames = jobs.map((j) => j.jobName).filter((n): n is string => !!n);
      const jobIds = jobs.map((j) => j.externalId).filter((n): n is string => !!n);

      // Signed/approved customer documents on those jobs. With no jobs there is
      // nothing to match, and an unbounded query would return the whole company.
      const documents = jobNames.length
        ? await db
            .select({
              id: deals.id, customer: deals.customer, jobRef: deals.jobRef, type: deals.type,
              amount: deals.amount, status: deals.status, issueDate: deals.issueDate, signedAt: deals.signedAt,
            })
            .from(deals)
            .where(and(
              or(isNotNull(deals.signedAt), eq(deals.status, 'approved')) as SQL,
              inArray(deals.jobRef, jobNames),
            ) as SQL)
            .orderBy(desc(deals.signedAt), desc(deals.issueDate))
            .limit(200)
        : [];

      // Roof reports generated on those jobs — part of "docs" from a rep's view.
      const reports = jobIds.length
        ? await db
            .select({
              reportId: clientReports.reportId, jobExternalId: clientReports.jobExternalId,
              reportType: clientReports.reportType, title: clientReports.title,
              reportUrl: clientReports.reportUrl, createdAt: clientReports.createdAt,
            })
            .from(clientReports)
            .where(and(eq(clientReports.status, 'succeeded'), inArray(clientReports.jobExternalId, jobIds)) as SQL)
            .orderBy(desc(clientReports.createdAt))
            .limit(100)
        : [];

      const byStage: Record<string, number> = {};
      for (const j of jobs) byStage[j.stage || 'No stage'] = (byStage[j.stage || 'No stage'] || 0) + 1;

      res.json({
        user: { name: user.name, email: user.email, role: user.role },
        scope: { effective: scope.effective, denied: scope.denied ?? false, canSeeAll: atLeast(user.role as TeamRole, 'manager') },
        windowDays: WINDOW_DAYS,
        jobs: jobs.map((j) => ({
          ...j,
          customer: `${j.firstName || ''} ${j.lastName || ''}`.trim() || j.jobName || 'Customer',
        })),
        documents: documents.map((d) => ({ ...d, amount: d.amount != null ? Number(d.amount) : null })),
        reports,
        stats: { jobs: jobs.length, documents: documents.length, reports: reports.length, byStage },
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/account/summary', 500, 'could not load your account');
    }
  });
}
