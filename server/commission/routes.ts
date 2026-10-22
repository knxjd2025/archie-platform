/**
 * Commission calculator, ported from the standalone BRN Commission Calculator
 * tool. A draft is computed and saved on creation; a manager's approval is the
 * durable payout record (mirrors reports/routes.ts's /present idempotency).
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { commissions, teamMembers } from '../../shared/schema';
import { requireAuth, requireRole } from '../auth/middleware';
import { isScoped, type SessionUser } from '../access/rep-scope';
import { visibleIdsFor } from '../access/team-scope';
import { atLeast, canSeeMoney } from '../../shared/rbac';
import { calculateCommission, type JobType, type LeadSource } from '../../shared/commission';
import { num, roundCents } from '../../shared/num';
import { sendFailure } from '../lib/failure';

const isLeadSource = (v: unknown): v is LeadSource => v === 'self' || v === 'company';
const isJobType = (v: unknown): v is JobType => v === 'retail' || v === 'insurance';
/** Non-negative dollar amount — a negative cost/revenue exists only to
 * inflate the profit/commission math before a manager ever sees the draft. */
const nonNegNum = (v: unknown): number => Math.max(0, num(v));
/** A dollar input at whole cents, so the figures stored are the ones the commission was worked out from. */
const nonNegMoney = (v: unknown): number => roundCents(nonNegNum(v));

/**
 * Commissions are money. Customer service outranks sales, so a plain
 * requireAuth let it list every rep's commission (its scope is 'all') and file
 * drafts; canSeeMoney is the explicit denylist that keeps money from leaking
 * sideways (shared/rbac.ts).
 */
function refuseWithoutCommissionAccess(user: SessionUser, res: Response): boolean {
  if (canSeeMoney(user.role, 'commissions')) return false;
  res.status(403).json({ error: 'Forbidden' });
  return true;
}

export function registerCommissionRoutes(app: Express) {
  app.post('/api/commissions', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (refuseWithoutCommissionAccess(user, res)) return;
      const jobName = String(req.body?.jobName || '').trim();
      let repName = String(req.body?.repName || '').trim();
      if (!jobName) return res.status(400).json({ error: 'Job name is required.' });
      if (!repName) return res.status(400).json({ error: 'Sales rep name is required.' });

      // A manager must be able to submit a draft on behalf of any rep, but a
      // rep submitting their own commission has no business attributing it
      // to someone else — force it to their own name.
      if (isScoped(user)) {
        const [me] = await db.select({ name: teamMembers.name }).from(teamMembers)
          .where(eq(teamMembers.email, user.email));
        if (me?.name) repName = me.name;
      }
      if (!isLeadSource(req.body?.leadSource)) return res.status(400).json({ error: "leadSource must be 'self' or 'company'." });
      if (!isJobType(req.body?.jobType)) return res.status(400).json({ error: "jobType must be 'retail' or 'insurance'." });

      // Overhead override is manager discretion (the original tool's "special
      // case" framing) — a rep filling out their own numbers can't bump their
      // own rate down.
      const canOverride = atLeast(user.role, 'manager');
      const manualOverheadPct = canOverride && req.body?.manualOverheadPct != null
        ? Math.min(100, nonNegNum(req.body.manualOverheadPct))
        : null;

      const revenue = nonNegMoney(req.body?.revenue);
      const material = nonNegMoney(req.body?.material);
      const labor = nonNegMoney(req.body?.labor);
      const other = nonNegMoney(req.body?.other);

      const { overheadPct, profit, commission } = calculateCommission({
        leadSource: req.body.leadSource, jobType: req.body.jobType,
        revenue, material, labor, other, manualOverheadPct,
      });

      const [repMatch] = await db.select({ id: teamMembers.id }).from(teamMembers)
        .where(eq(teamMembers.name, repName));

      const [row] = await db.insert(commissions).values({
        jobExternalId: String(req.body?.jobExternalId || '').trim() || null,
        jobName, repName,
        teamMemberId: repMatch?.id ?? null,
        leadSource: req.body.leadSource, jobType: req.body.jobType,
        overheadPct: String(overheadPct), overrideUsed: manualOverheadPct != null,
        revenue: String(revenue), material: String(material), labor: String(labor), other: String(other),
        profit: String(profit), commissionAmount: String(commission),
        createdBy: user.email,
      }).returning();

      res.json({ ok: true, commission: row });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/commissions');
    }
  });

  app.get('/api/commissions', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      if (refuseWithoutCommissionAccess(user, res)) return;
      const status = req.query.status === 'draft' || req.query.status === 'approved' ? req.query.status : undefined;

      const clauses: SQL[] = [];
      if (status) clauses.push(eq(commissions.status, status));

      if (isScoped(user)) {
        // 'self' (sales/production) or 'team' (manager) — same visibleIdsFor
        // helper `leads` already uses, so a Sales Leader sees their own reps'
        // commissions too, not just their own. `createdBy` stays as a fallback
        // for a commission whose teamMemberId never resolved (name mismatch).
        const visibleIds = await visibleIdsFor(user);
        const scopeClauses: SQL[] = [eq(commissions.createdBy, user.email)];
        if (visibleIds && visibleIds.length) scopeClauses.push(inArray(commissions.teamMemberId, visibleIds));
        clauses.push(or(...scopeClauses) as SQL);
      }

      const where = clauses.length ? and(...clauses) : undefined;
      const base = db.select().from(commissions);
      const rows = await (where ? base.where(where) : base).orderBy(desc(commissions.createdAt)).limit(200);
      res.json({ commissions: rows });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/commissions');
    }
  });

  app.post('/api/commissions/:id/approve', requireAuth, requireRole('manager'), async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const id = Number(req.params.id);

      // Conditional on status='draft' rather than read-then-write: two managers
      // clicking Approve on the same row within the same instant both passed a
      // separate read-then-check, and the second write silently overwrote the
      // first approver's approvedBy/approvedAt.
      const [updated] = await db.update(commissions)
        .set({ status: 'approved', approvedBy: user.email, approvedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(commissions.id, id), eq(commissions.status, 'draft')))
        .returning();
      if (updated) return res.json({ ok: true, commission: updated });

      const [row] = await db.select().from(commissions).where(eq(commissions.id, id));
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true, commission: row }); // already approved (by this call or a concurrent one)
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/commissions/:id/approve');
    }
  });
}
