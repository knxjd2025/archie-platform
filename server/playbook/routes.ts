/**
 * Sales Playbook (shared/playbook.ts holds the library and the fill logic).
 * The server's part: what to fill a template with for this rep and this
 * customer, the office-wide settings (referral gift, review link), the
 * per-job stage checklists, and each rep's income goal plan with this week's
 * progress against it. Rep-scoped throughout — a rep only fills from, and
 * ticks, jobs in their own book.
 */
import type { Express, Request, Response } from 'express';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { followUps, jobChecklists, kpiEvents, leads, repGoals, settings, teamMembers } from '../../shared/schema';
import { requireAuth, requireRole } from '../auth/middleware';
import { isScoped, ownsLead, teamMemberIdByEmail, type SessionUser } from '../access/rep-scope';
import { visibleIdsFor } from '../access/team-scope';
import { logWrite } from '../writes/log';
import { ROLE_LABEL } from '../../shared/rbac';
import { streetOnly } from '../../shared/neighbor-letters';
import { GOAL_DEFAULTS, STAGE_CHECKLISTS, incomePlan, playbookDoc, pointsFor, stageForColumn, type FillContext, type GoalInputs } from '../../shared/playbook';
import { sendFailure } from '../lib/failure';
import { etDayStart, etPlusDays, etWeekStart, etWeekStartDate } from '../../shared/et-periods';

const SETTINGS_KEY = 'playbook';
export interface PlaybookSettings { referralGift: string; reviewLink: string }

async function loadSettings(): Promise<PlaybookSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY));
  const v = (row?.value ?? {}) as Partial<PlaybookSettings>;
  return { referralGift: v.referralGift || '', reviewLink: v.reviewLink || '' };
}

const isHttpUrl = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };

/** JobTread addresses usually arrive complete ("14509 Farmleigh Ave, Charlotte, NC 28273, USA"); only a bare street gets the city added. */
export function fullAddress(address: string | null, city: string | null, state: string | null, zip: string | null): string | null {
  const a = (address || '').replace(/,\s*(USA|United States)\s*$/i, '').trim();
  if (!a) return null;
  if (a.includes(',')) return a;
  const rest = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return rest ? `${a}, ${rest}` : a;
}

const roleLabel = (role: string | undefined | null) => (role && (ROLE_LABEL as Record<string, string>)[role]) || 'Sales';

export function registerPlaybookRoutes(app: Express) {
  /** Everything a template can be filled with: the rep, the office, and (optionally) one customer. */
  app.get('/api/playbook/context', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [me] = await db.select({ name: teamMembers.name, phone: teamMembers.phone, role: teamMembers.role, email: teamMembers.email }).from(teamMembers).where(eq(teamMembers.email, user.email));
      const office = await loadSettings();
      const ctx: FillContext & { customerExternalId?: string | null; customerLabel?: string | null; insuranceJob?: boolean; stage?: string | null } = {
        repName: me?.name || user.name,
        repCell: me?.phone || null,
        repEmail: me?.email || user.email,
        repTitle: roleLabel(me?.role || user.role),
        referralGift: office.referralGift || null,
        reviewLink: office.reviewLink || null,
      };
      const externalId = String(req.query.externalId || '').trim();
      if (externalId) {
        const [lead] = await db.select().from(leads).where(eq(leads.externalId, externalId));
        if (lead?.externalId && (await ownsLead(user, lead.externalId))) {
          const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.jobName || null;
          const cityState = [lead.city, lead.state].filter(Boolean).join(', ');
          ctx.customerExternalId = lead.externalId;
          ctx.customerLabel = name;
          ctx.customerName = name;
          ctx.customerAddress = fullAddress(lead.address, lead.city, lead.state, lead.zip);
          ctx.street = streetOnly(lead.address) || null;
          ctx.cityState = cityState || null;
          ctx.insuranceJob = !!lead.insuranceClaim;
          ctx.stage = lead.stage;
        }
      }
      res.json({ ...ctx, canEditSettings: user.role === 'admin' });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/playbook/context');
    }
  });

  app.put('/api/playbook/settings', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const cur = await loadSettings();
      const next: PlaybookSettings = {
        referralGift: req.body?.referralGift !== undefined ? String(req.body.referralGift).trim().slice(0, 120) : cur.referralGift,
        reviewLink: req.body?.reviewLink !== undefined ? String(req.body.reviewLink).trim() : cur.reviewLink,
      };
      if (next.reviewLink && !isHttpUrl(next.reviewLink)) return res.status(400).json({ error: 'The review link must be a full http(s) URL.' });
      await db.insert(settings).values({ key: SETTINGS_KEY, value: next, updatedAt: new Date() })
        .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
      res.json({ ok: true, ...next });
    } catch (error: any) {
      return sendFailure(res, error, 'PUT /api/playbook/settings');
    }
  });

  /** A rep used a template (copied, printed or emailed) — an audit line so the office sees the activity. */
  app.post('/api/playbook/used', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const docId = String(req.body?.docId || '');
      if (!playbookDoc(docId)) return res.status(400).json({ error: 'Unknown playbook document.' });
      const how = String(req.body?.how || 'copied').slice(0, 20);
      const externalId = req.body?.externalId ? String(req.body.externalId) : null;
      if (externalId && !(await ownsLead(user, externalId))) return res.status(404).json({ error: 'not found' });
      await logWrite({ actor: user.email, system: 'app', action: 'playbook_template', targetId: externalId, summary: `${docId} ${how}`, ok: true, error: null });
      res.json({ ok: true });
    } catch (error: any) {
      return sendFailure(res, error, 'POST /api/playbook/used');
    }
  });

  /* ---------------- Stage checklists on the job ---------------- */

  app.get('/api/clients/:externalId/checklists', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const [lead] = await db.select({ externalId: leads.externalId, stage: leads.stage }).from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead?.externalId || !(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      const rows = await db.select().from(jobChecklists).where(eq(jobChecklists.jobExternalId, lead.externalId));
      const current = stageForColumn(lead.stage);
      res.json({
        stage: lead.stage,
        currentChecklist: current?.key ?? null,
        checklists: STAGE_CHECKLISTS.map((c) => ({ key: c.key, items: rows.find((r) => r.checklistKey === c.key)?.items ?? {} })),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/clients/:externalId/checklists');
    }
  });

  /** Tick or untick one item. Ticking an item that schedules follow-ups creates them once (never twice). */
  app.put('/api/clients/:externalId/checklists/:key/items/:item', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const checklist = STAGE_CHECKLISTS.find((c) => c.key === req.params.key);
      const item = checklist?.items.find((i) => i.key === req.params.item);
      if (!checklist || !item) return res.status(404).json({ error: 'Unknown checklist item.' });
      const [lead] = await db.select({ externalId: leads.externalId, firstName: leads.firstName, lastName: leads.lastName, jobName: leads.jobName }).from(leads).where(eq(leads.externalId, req.params.externalId));
      if (!lead?.externalId || !(await ownsLead(user, lead.externalId))) return res.status(404).json({ error: 'not found' });
      const done = req.body?.done !== false;
      const result = await tickChecklistItem({ ...lead, externalId: lead.externalId }, checklist.key, item.key, done, user);
      res.json({ ok: true, items: result.items, followUpsCreated: result.created });
    } catch (error: any) {
      return sendFailure(res, error, 'PUT /api/clients/:externalId/checklists/:key/items/:item');
    }
  });

  /* ---------------- Goals: income plan + this week's progress ---------------- */

  app.get('/api/goals/me', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const myId = await teamMemberIdByEmail(user.email);
      const [row] = myId ? await db.select().from(repGoals).where(eq(repGoals.teamMemberId, myId)) : [];
      const inputs: GoalInputs = row
        ? { incomeGoal: row.incomeGoal, avgCommission: row.avgCommission, closeRate: row.closeRate, sellingMonths: row.sellingMonths }
        : GOAL_DEFAULTS;
      const plan = incomePlan(inputs);
      const progress = await progressFor(user, myId);
      res.json({ inputs, plan, progress, saved: !!row });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/goals/me');
    }
  });

  app.put('/api/goals/me', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const myId = await teamMemberIdByEmail(user.email);
      if (!myId) return res.status(400).json({ error: 'Your login is not linked to a team member yet — ask an admin to add you on the Team page.' });
      const num = (v: unknown, min: number, max: number, dflt: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : dflt; };
      const inputs: GoalInputs = {
        incomeGoal: num(req.body?.incomeGoal, 1000, 10_000_000, GOAL_DEFAULTS.incomeGoal),
        avgCommission: num(req.body?.avgCommission, 50, 100_000, GOAL_DEFAULTS.avgCommission),
        closeRate: num(req.body?.closeRate, 1, 100, GOAL_DEFAULTS.closeRate),
        sellingMonths: num(req.body?.sellingMonths, 1, 12, GOAL_DEFAULTS.sellingMonths),
      };
      await db.insert(repGoals).values({ teamMemberId: myId, ...inputs, updatedAt: new Date() })
        .onConflictDoUpdate({ target: repGoals.teamMemberId, set: { ...inputs, updatedAt: new Date() } });
      res.json({ inputs, plan: incomePlan(inputs), saved: true });
    } catch (error: any) {
      return sendFailure(res, error, 'PUT /api/goals/me');
    }
  });
}

export interface ChecklistLead { externalId: string; firstName: string | null; lastName: string | null; jobName: string | null }

/** Tick or untick one item on a job's stage checklist; returns the stored items and how many follow-ups it created. */
export async function tickChecklistItem(
  lead: ChecklistLead, checklistKey: string, itemKey: string, done: boolean, user: Pick<SessionUser, 'email' | 'name'>,
): Promise<{ items: Record<string, { by: string; at: string; followUpIds?: number[] }>; created: number }> {
  const checklist = STAGE_CHECKLISTS.find((c) => c.key === checklistKey);
  const item = checklist?.items.find((i) => i.key === itemKey);
  if (!checklist || !item) throw new Error(`Unknown checklist item ${checklistKey}/${itemKey}`);
  const where = and(eq(jobChecklists.jobExternalId, lead.externalId), eq(jobChecklists.checklistKey, checklistKey));

  // This used to read the whole items blob, change one key and write the
  // whole blob back, so two reps ticking different boxes at once lost one
  // tick, and a double-tap on an item with follow-ups created them twice
  // (both requests saw no followUpIds yet). Now every write touches only
  // its own key in one statement, and the lock below makes the
  // "already has follow-ups?" check and the inserts happen once per item.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`job_checklist:${lead.externalId}:${checklistKey}`}))`);
    if (!done) {
      const [row] = await tx.update(jobChecklists)
        .set({ items: sql`${jobChecklists.items} - ${item.key}::text`, updatedBy: user.email, updatedAt: new Date() })
        .where(where).returning({ items: jobChecklists.items });
      return { items: row?.items ?? {}, created: 0 };
    }
    const [existing] = await tx.select({ items: jobChecklists.items }).from(jobChecklists).where(where);
    const prior = existing?.items?.[item.key];
    let followUpIds = prior?.followUpIds;
    let created = 0;
    if (item.followUps?.length && !prior?.followUpIds?.length) {
      const myId = await teamMemberIdByEmail(user.email);
      const clientName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.jobName || null;
      // Due dates count Charlotte days: on Vercel (UTC) "today" flipped to
      // tomorrow at 8pm, so an evening tick came due a day late.
      const rows = await tx.insert(followUps).values(item.followUps.map((f) => ({
        jobExternalId: lead.externalId, clientName, note: f.note, dueDate: etPlusDays(f.days), assignedTo: myId, createdBy: user.email,
      }))).returning({ id: followUps.id });
      followUpIds = rows.map((r) => r.id);
      created = rows.length;
    }
    const entry: { by: string; at: string; followUpIds?: number[] } = { by: user.name || user.email, at: new Date().toISOString(), ...(followUpIds ? { followUpIds } : {}) };
    const patch = sql`${JSON.stringify({ [item.key]: entry })}::jsonb`;
    const [row] = await tx.insert(jobChecklists)
      .values({ jobExternalId: lead.externalId, checklistKey: checklistKey, items: { [item.key]: entry }, updatedBy: user.email })
      .onConflictDoUpdate({
        target: [jobChecklists.jobExternalId, jobChecklists.checklistKey],
        set: { items: sql`${jobChecklists.items} || ${patch}`, updatedBy: user.email, updatedAt: new Date() },
      })
      .returning({ items: jobChecklists.items });
    return { items: row.items, created };
  });
}

/** This week's and today's activity for the points game and the weekly tracker, from the KPI events already recorded. */
async function progressFor(user: SessionUser, myId: number | null) {
  // Charlotte's day and Monday-to-Sunday week, not the server's: on Vercel
  // (UTC) the new day started at 8pm Eastern, so an evening's doors were
  // credited to tomorrow, and the week rolled over on Sunday evening.
  const now = new Date();
  const today = etDayStart(now);
  const weekStart = etWeekStart(now);
  // A rep sees their own numbers; a leader/admin sees their visible team rolled up.
  const ids = isScoped(user) ? await visibleIdsFor(user) : null;
  const scope = ids ? (ids.length ? inArray(kpiEvents.teamMemberId, ids) : sql`false`) : undefined;
  const tally = async (since: Date) => {
    const rows = await db.select({ type: kpiEvents.type, count: sql<number>`count(*)::int` }).from(kpiEvents)
      .where(scope ? and(gte(kpiEvents.occurredAt, since), scope) : gte(kpiEvents.occurredAt, since)).groupBy(kpiEvents.type);
    const n = (t: string) => rows.find((r) => r.type === t)?.count ?? 0;
    return { doors: n('door_knock'), contacted: n('lead_contacted'), presented: n('report_presented'), referrals: n('referral_received') };
  };
  const [week, day] = await Promise.all([tally(weekStart), tally(today)]);
  // Sales closed: jobs in this rep's book that reached a production stage this week (JobTread's closed_on).
  const [me] = myId ? await db.select({ rep: teamMembers.jobtreadSalesRep }).from(teamMembers).where(eq(teamMembers.id, myId)) : [];
  const closedWhere = [gte(leads.closedOn, weekStart)];
  if (isScoped(user)) closedWhere.push(me?.rep ? eq(leads.jtSalesRep, me.rep) : sql`false`);
  const [closed] = await db.select({ count: sql<number>`count(*)::int` }).from(leads).where(and(...closedWhere));
  const closedToday = closed.count ? (await db.select({ count: sql<number>`count(*)::int` }).from(leads).where(and(...closedWhere, gte(leads.closedOn, today))))[0].count : 0;
  return {
    weekStart: etWeekStartDate(now),
    week: { ...week, closed: closed.count, points: pointsFor({ ...week, closed: closed.count }) },
    today: { ...day, closed: closedToday, points: pointsFor({ ...day, closed: closedToday }) },
  };
}
