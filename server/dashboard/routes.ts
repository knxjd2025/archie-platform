import { visibleCalendarsFor } from '../calendar/access';
import { listTeamMembers } from '../storage/team';
import type { Express, Request, Response } from 'express';
import { and, or, eq, inArray, isNotNull, ilike, lt, gt, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { leads, invoices, deals } from '../../shared/schema';
import { requireAuth } from '../auth/middleware';
import { repLeadWhere, repJobNames, repClientIdentifiers, isScoped, type SessionUser } from '../access/rep-scope';
import { PRODUCTION_STAGES } from '../production/columns';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { normalizeGhlConversation, filterConversationsForRep } from '../conversations/routes';
import { fetchSchedule } from '../storage/reports';
import { visibleEmailsFor } from '../access/team-scope';
import { matchAppointment } from '../storage/appointment-link';
import { sendFailure } from '../lib/failure';
import { canSeeMoney } from '../../shared/rbac';

const countWhere = async (where: SQL | undefined): Promise<number> => {
  const base = db.select({ c: sql<number>`count(*)` }).from(leads);
  const [{ c }] = await (where ? base.where(where) : base);
  return Number(c);
};
const merge = (...cs: (SQL | undefined)[]): SQL | undefined => {
  const f = cs.filter(Boolean) as SQL[];
  return f.length === 0 ? undefined : f.length === 1 ? f[0] : (and(...f) as SQL);
};

export function registerDashboardRoutes(app: Express) {
  // Role-aware "what needs attention" summary. Rep-scoped.
  app.get('/api/dashboard/summary', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const scope = await repLeadWhere(user); // undefined for admin/manager

      const [newLeads, inProduction, wonCount] = await Promise.all([
        countWhere(merge(scope, eq(leads.status, 'new' as any))),
        countWhere(merge(scope, inArray(leads.stage, Array.from(PRODUCTION_STAGES)))),
        countWhere(merge(scope, eq(leads.status, 'won' as any))),
      ]);

      const recentBase = db
        .select({ externalId: leads.externalId, name: leads.firstName, stage: leads.stage, status: leads.status, createdAt: leads.createdAt })
        .from(leads);
      const recentLeads = await (scope ? recentBase.where(scope) : recentBase).orderBy(desc(leads.createdAt)).limit(6);

      // Approved documents for owned jobs.
      const jobNames = await repJobNames(user); // null = all
      const approvedClause = or(isNotNull(deals.signedAt), eq(deals.status, 'approved')) as SQL;
      let approvedDocs = 0;
      if (!(jobNames && jobNames.length === 0)) {
        const dw = jobNames && jobNames.length ? (and(approvedClause, inArray(deals.jobRef, jobNames)) as SQL) : approvedClause;
        const [{ c }] = await db.select({ c: sql<number>`count(*)` }).from(deals).where(dw);
        approvedDocs = Number(c);
      }

      // Next few appointments, scoped to the calendars this person may see.
      const upcoming = (await fetchSchedule({ mailboxes: await visibleEmailsFor(user) }).catch(() => [])).slice(0, 5);

      // Overdue receivables (company-level; managers/admins only). Unscoped is
      // not enough on its own: customer service sees every customer but must
      // not see money, and it was getting the company's overdue AR total.
      let overdueAR: { count: number; total: number } | null = null;
      if (!isScoped(user) && canSeeMoney(user.role, 'ar')) {
        const today = new Date().toISOString().slice(0, 10);
        const [row] = await db
          .select({ c: sql<number>`count(*)`, t: sql<number>`coalesce(sum(${invoices.balance}),0)` })
          .from(invoices)
          .where(and(eq(invoices.kind, 'ar' as any), gt(invoices.balance, '0'), lt(invoices.dueDate, today)));
        overdueAR = { count: Number(row?.c || 0), total: Number(row?.t || 0) };
      }

      res.json({
        newLeads,
        inProduction,
        wonCount,
        approvedDocs,
        overdueAR,
        upcoming,
        recentLeads: recentLeads.map((r) => ({
          externalId: r.externalId, name: r.name, stage: r.stage, status: r.status,
          createdAt: r.createdAt ? r.createdAt.toISOString() : null,
        })),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/dashboard/summary');
    }
  });

  // Upcoming schedule (inspections / installs) for the next ~2 weeks, scoped to
  // the calendars this person may see: their own, their team's if they lead
  // one, everyone's for a director or admin. Appointment rows carry
  // calendarSource = the mailbox they were synced from, so this is filterable
  // — it simply never was, which let any rep read the owner's calendar.
  app.get('/api/schedule', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      // ?days= extends the window past the 14-day default (capped at 90 —
      // this reads live-synced appointment rows, not a paginated archive).
      const requestedDays = Number(req.query.days);
      const days = Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), 90) : 14;
      const to = new Date(Date.now() + days * 86400000).toISOString();
      const mailboxes = await visibleCalendarsFor(user);
      const items = await fetchSchedule({ to, mailboxes }).catch(() => []);
      const people = await listTeamMembers().catch(() => [] as Array<{ email: string; name: string }>);
      const nameOf = new Map<string, string>();
      for (const p of people) nameOf.set(String(p.email).toLowerCase(), p.name);
      const linked = await withClientLinks(items, user);
      res.json({
        appointments: linked.map((a: any) => ({ ...a, person: a.mailbox ? (nameOf.get(String(a.mailbox).toLowerCase()) || a.mailbox) : null })),
        calendars: mailboxes === null ? 'all' : mailboxes,
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/schedule');
    }
  });

  // Global client search (by name, job, phone, address). Rep-scoped.
  app.get('/api/search', requireAuth, async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return res.json({ results: [] });
      const user = req.session.user! as SessionUser;
      const scope = await repLeadWhere(user);
      const like = `%${q}%`;
      const match = or(
        ilike(leads.firstName, like), ilike(leads.jobName, like),
        ilike(leads.phone, like), ilike(leads.address, like), ilike(leads.city, like),
      ) as SQL;
      const where = merge(scope, match)!;
      const rows = await db
        .select({ externalId: leads.externalId, name: leads.firstName, jobName: leads.jobName, stage: leads.stage, address: leads.address, city: leads.city })
        .from(leads)
        .where(where)
        .orderBy(desc(leads.createdAt))
        .limit(15);
      res.json({
        results: rows.map((r) => ({
          externalId: r.externalId, name: r.name || r.jobName || 'Unknown', stage: r.stage,
          location: [r.city, r.address].filter(Boolean)[0] || null,
        })),
      });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/search');
    }
  });

  // Lightweight badge counts for the nav.
  app.get('/api/notifications', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.session.user! as SessionUser;
      const scope = await repLeadWhere(user);
      const newLeads = await countWhere(merge(scope, eq(leads.status, 'new' as any)));

      // Unread GoHighLevel messages (rep-scoped, best-effort). Fail-soft to 0.
      let unreadMessages = 0;
      try {
        const r: any = await new GoHighLevelClient().getConversations();
        let items = (r.conversations || []).map(normalizeGhlConversation);
        if (isScoped(user)) {
          const ids = await repClientIdentifiers(user);
          items = filterConversationsForRep(items, { names: ids?.names || [], jobNames: ids?.jobNames || [] });
        }
        unreadMessages = items.reduce((s: number, i: any) => s + (i.unread || 0), 0);
      } catch { /* GHL unavailable → no badge */ }

      res.json({ newLeads, unreadMessages });
    } catch (error: any) {
      return sendFailure(res, error, 'GET /api/notifications');
    }
  });
}

/**
 * Attach the client each appointment is about, so the schedule can open the
 * record, call, or text without a search.
 *
 * Matched only against leads the caller may SEE — the candidate list is
 * already rep-scoped, so an appointment on a shared calendar never yields a
 * tappable link to another rep's customer. Unmatched appointments (most
 * internal meetings) simply come back with client: null.
 */
async function withClientLinks(items: any[], user: SessionUser): Promise<any[]> {
  if (!items.length) return items;
  const where = await repLeadWhere(user);
  const base = db
    .select({
      externalId: leads.externalId, jobName: leads.jobName,
      firstName: leads.firstName, lastName: leads.lastName,
      address: leads.address, phone: leads.phone, email: leads.email,
    })
    .from(leads);
  // externalId is nullable in the schema but is the join key here, so drop
  // rows without one rather than widening the matcher's contract.
  const candidates = ((where ? await base.where(where) : await base) as any[])
    .filter((c) => !!c.externalId) as Array<{
      externalId: string; jobName: string | null; firstName: string | null;
      lastName: string | null; address: string | null; phone: string | null; email: string | null;
    }>;

  return items.map((a) => {
    const m = matchAppointment({ title: a.title, address: a.address }, candidates);
    if (!m) return { ...a, client: null };
    const lead = candidates.find((c) => c.externalId === m.externalId)!;
    const name = [lead.firstName, lead.lastName]
      .filter((x) => x && String(x).toLowerCase() !== 'null')
      .join(' ')
      .trim();
    return {
      ...a,
      client: {
        externalId: lead.externalId,
        name: name || lead.jobName || 'Customer',
        jobName: lead.jobName,
        phone: lead.phone,
        email: lead.email,
        matchedVia: m.via,
      },
    };
  });
}
