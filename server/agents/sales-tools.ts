/**
 * The tools every team advisor shares: a user's own sales world — leads,
 * pipeline, follow-ups, KPIs, schedule, commission records — and the ability
 * to look inside any one project. Each tool is scoped through the same
 * helpers the screens use (scopedLeadWhere / ownsLead / visible ids), so an
 * advisor can never show a rep something the app itself would hide.
 *
 * Every tool returns `{ error }` instead of throwing so a flaky integration
 * never crashes a chat, and trims what it returns — tool output goes to the
 * model verbatim.
 */
import { and, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import {
  clientReports, followUps, inspectionSubmissions, jobCommissions, kpiEvents, leads,
  preConstructionChecklists, teamMembers,
} from '../../shared/schema';
import { ownsLead, scopedLeadWhere } from '../access/rep-scope';
import { fetchSchedule } from '../storage/reports';
import { JobTreadClient } from '../integrations/jobtread';
import { PRODUCTION_STAGES } from '../production/columns';
import { jobCommissionBlockers, type ChecksState } from '../../shared/job-commission';
import { figuresOf } from '../job-commissions/service';
import { num } from '../../shared/num';
import type { Tool } from './base-agent';
import { viewerOwnsRep, viewerSession, type AgentViewer } from './viewer';

const clamp = (v: unknown, def: number, max: number) => Math.min(Math.max(Number(v) || def, 1), max);
const trim = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : s ?? null);
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** A predicate on team-member ids for the viewer, or undefined when unrestricted. */
function memberScope(viewer: AgentViewer | undefined, col: any): SQL | undefined {
  if (!viewer || viewer.memberIds === null || viewer.memberIds === undefined) return undefined;
  return viewer.memberIds.length ? inArray(col, viewer.memberIds) : sql`false`;
}

/** Due flags the follow-up screens show — date-only comparison in the viewer's day. */
export function dueFlags(dueDate: string | null, today = new Date().toISOString().slice(0, 10)) {
  return { overdue: !!dueDate && dueDate < today, dueToday: dueDate === today };
}

/** Group counts per (member, type) into the per-rep rows the KPI screen shows. */
export function foldKpis(
  counts: Array<{ teamMemberId: number | null; repName: string | null; type: string; count: number }>,
  names: Map<number, string>,
) {
  const rows = new Map<string, Record<string, number | string | null>>();
  for (const c of counts) {
    const key = c.teamMemberId != null ? String(c.teamMemberId) : `rep:${c.repName || 'unattributed'}`;
    if (!rows.has(key)) rows.set(key, { rep: c.teamMemberId != null ? names.get(c.teamMemberId) || c.repName || 'Unknown' : c.repName || 'Unattributed', doorKnocks: 0, leadsContacted: 0, reportsCreated: 0, reportsPresented: 0, referralsReceived: 0, leadsGiven: 0 });
    const r = rows.get(key)!;
    const col = ({ door_knock: 'doorKnocks', lead_contacted: 'leadsContacted', report_created: 'reportsCreated', report_presented: 'reportsPresented', referral_received: 'referralsReceived', lead_given: 'leadsGiven' } as Record<string, string>)[c.type];
    if (col) r[col] = Number(r[col] || 0) + Number(c.count);
  }
  return Array.from(rows.values());
}

const LEAD_COLS = {
  externalId: leads.externalId, customer: leads.firstName, jobName: leads.jobName, jobNumber: leads.jobNumber,
  status: leads.status, stage: leads.stage, repName: leads.jtSalesRep, projectManager: leads.projectManager,
  projectedValue: leads.projectedValue, address: leads.address, city: leads.city, phone: leads.phone, email: leads.email,
  insuranceClaim: leads.insuranceClaim, scheduleStart: leads.scheduleStart, scheduleEnd: leads.scheduleEnd,
  closedOn: leads.closedOn, createdAt: leads.createdAt, serviceType: leads.serviceType,
};
const leadOut = (l: any) => ({
  ...l, projectedValue: l.projectedValue != null ? Number(l.projectedValue) : null,
  scheduleStart: day(l.scheduleStart), scheduleEnd: day(l.scheduleEnd), closedOn: day(l.closedOn), createdAt: day(l.createdAt),
});

/** The viewer's own book. Anonymous (test) viewers get a FALSE predicate, never the company. */
export async function leadScope(viewer: AgentViewer | undefined): Promise<SQL> {
  const su = viewerSession(viewer);
  if (!su) return viewer?.repNames === null ? sql`true` : sql`false`;
  return scopedLeadWhere(su);
}

/**
 * May this viewer see (and act on) one lead row? The per-row twin of
 * leadScope, for tools that take a lead id. No viewer at all is a no.
 */
export async function viewerCanSeeLead(
  viewer: AgentViewer | undefined,
  lead: { externalId: string | null; jtSalesRep: string | null },
): Promise<boolean> {
  const su = viewerSession(viewer);
  if (su) return ownsLead(su, lead.externalId);
  if (!viewer) return false;
  return viewer.repNames === null || viewerOwnsRep(viewer, lead.jtSalesRep);
}

export function myLeadsTool(viewer?: AgentViewer): Tool {
  return {
    name: 'get_my_leads',
    description: "The leads and jobs in this person's book (their own, or their team's for a leader; everyone's for admin) with status, pipeline stage, projected value, rep, schedule. Filter by status (new|contacted|qualified|proposal_sent|negotiation|won|lost), stage (JobTread pipeline stage), inProduction (jobs on the production board), or search text (customer / job name / address).",
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Lead status filter (optional)' },
        stage: { type: 'string', description: 'Exact pipeline stage, e.g. "Estimating" or "Roof Construction" (optional)' },
        inProduction: { type: 'boolean', description: 'Only jobs currently in a production stage' },
        search: { type: 'string', description: 'Customer name, job name, or address text (optional)' },
        limit: { type: 'number', description: 'Max rows (default 20, max 50)' },
      },
    },
    execute: async (p) => {
      try {
        const clauses: SQL[] = [await leadScope(viewer), isNotNull(leads.externalId)];
        if (p.status) clauses.push(eq(leads.status, String(p.status) as any));
        if (p.stage) clauses.push(eq(leads.stage, String(p.stage)));
        if (p.inProduction) clauses.push(inArray(leads.stage, Array.from(PRODUCTION_STAGES)));
        if (p.search) {
          const q = `%${String(p.search).trim()}%`;
          clauses.push(or(ilike(leads.firstName, q), ilike(leads.jobName, q), ilike(leads.address, q)) as SQL);
        }
        const rows = await db.select(LEAD_COLS).from(leads).where(and(...clauses)).orderBy(desc(leads.createdAt)).limit(clamp(p.limit, 20, 50));
        return { count: rows.length, leads: rows.map(leadOut) };
      } catch (e: any) { return { error: e.message }; }
    },
  };
}

export function pipelineSummaryTool(viewer?: AgentViewer): Tool {
  return {
    name: 'get_pipeline_summary',
    description: "A count and projected-value roll-up of this person's book by lead status and by pipeline stage — the shape of their pipeline right now, including how much is sold and in production.",
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const scope = and(await leadScope(viewer), isNotNull(leads.externalId)) as SQL;
        const [byStatus, byStage] = await Promise.all([
          db.select({ status: leads.status, count: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${leads.projectedValue}),0)::float` }).from(leads).where(scope).groupBy(leads.status),
          db.select({ stage: leads.stage, count: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${leads.projectedValue}),0)::float` }).from(leads).where(scope).groupBy(leads.stage),
        ]);
        const production = byStage.filter((s) => s.stage && PRODUCTION_STAGES.has(s.stage));
        return {
          byStatus, byStage: byStage.sort((a, b) => b.count - a.count),
          inProduction: { jobs: production.reduce((n, s) => n + s.count, 0), value: production.reduce((n, s) => n + s.value, 0) },
          total: { jobs: byStatus.reduce((n, s) => n + s.count, 0), value: byStatus.reduce((n, s) => n + s.value, 0) },
        };
      } catch (e: any) { return { error: e.message }; }
    },
  };
}

export function followUpsTool(viewer?: AgentViewer): Tool {
  return {
    name: 'get_follow_ups',
    description: "This person's follow-ups (assigned to them or created by them; a leader also sees their reps'; admin sees all) with due date, overdue / due-today flags and the client. Default: open ones only.",
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'open (default) | done | all', enum: ['open', 'done', 'all'] },
        jobExternalId: { type: 'string', description: 'Only follow-ups on this job (optional)' },
        limit: { type: 'number', description: 'Max rows (default 30, max 100)' },
      },
    },
    execute: async (p) => {
      try {
        const clauses: SQL[] = [];
        const ids = memberScope(viewer, followUps.assignedTo);
        if (ids) {
          const emails = viewer?.emails && viewer.emails.length ? inArray(sql`lower(${followUps.createdBy})`, viewer.emails) : sql`false`;
          clauses.push(or(ids, emails) as SQL);
        }
        if (p.jobExternalId) clauses.push(eq(followUps.jobExternalId, String(p.jobExternalId)));
        if (p.scope === 'done') clauses.push(eq(followUps.done, true));
        else if (p.scope !== 'all') clauses.push(eq(followUps.done, false));
        const base = db.select({
          id: followUps.id, jobExternalId: followUps.jobExternalId, clientName: followUps.clientName, note: followUps.note,
          dueDate: followUps.dueDate, assignee: teamMembers.name, createdBy: followUps.createdBy, done: followUps.done, createdAt: followUps.createdAt,
        }).from(followUps).leftJoin(teamMembers, eq(followUps.assignedTo, teamMembers.id));
        const rows = await (clauses.length ? base.where(and(...clauses)) : base)
          .orderBy(sql`${followUps.dueDate} asc nulls last`, desc(followUps.createdAt)).limit(clamp(p.limit, 30, 100));
        return { count: rows.length, followUps: rows.map((r) => ({ ...r, createdAt: day(r.createdAt), note: trim(r.note, 300), ...dueFlags(r.dueDate) })) };
      } catch (e: any) { return { error: e.message }; }
    },
  };
}

export function createFollowUpTool(viewer?: AgentViewer): Tool {
  return {
    name: 'create_follow_up',
    description: "Create a follow-up reminder for this person (it lands on their Follow-ups list and, when tied to a job, is noted on the job in JobTread). Use when they ask you to remind them, or agree to a next step you suggested. Always confirm the note and due date back to them.",
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'What to do, in one line' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD (optional)' },
        jobExternalId: { type: 'string', description: 'The JobTread job id this is about (optional — get it from get_my_leads / get_project)' },
        clientName: { type: 'string', description: 'Client name for the list (optional)' },
      },
      required: ['note'],
    },
    execute: async (p) => {
      try {
        const su = viewerSession(viewer);
        if (!su) return { error: 'No signed-in user to create this for.' };
        const note = String(p.note || '').trim();
        if (!note) return { error: 'A note is required.' };
        const jobExternalId = p.jobExternalId ? String(p.jobExternalId) : null;
        if (jobExternalId && !(await ownsLead(su, jobExternalId))) return { error: 'That job is not in your book.' };
        const dueDate = p.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(p.dueDate)) ? String(p.dueDate) : null;
        const [row] = await db.insert(followUps).values({
          jobExternalId, clientName: p.clientName ? String(p.clientName).slice(0, 200) : null,
          note: note.slice(0, 1000), dueDate, assignedTo: viewer?.teamMemberId ?? null, createdBy: su.email,
        }).returning();
        if (jobExternalId) {
          try { await new JobTreadClient().addJobComment(jobExternalId, `📌 Follow-up${dueDate ? ` (due ${dueDate})` : ''}: ${note}`, su.name); } catch { /* best-effort mirror */ }
        }
        return { ok: true, followUp: { id: row.id, note: row.note, dueDate: row.dueDate, clientName: row.clientName, jobExternalId: row.jobExternalId } };
      } catch (e: any) { return { error: e.message }; }
    },
  };
}

export function myKpisTool(viewer?: AgentViewer): Tool {
  return {
    name: 'get_my_kpis',
    description: "Sales-activity KPIs for this person (a leader gets each of their reps; admin gets everyone): doors knocked, leads contacted, reports created, reports presented, referrals received, leads given. Pick today, the last 7 days, or the last 30 days.",
    parameters: { type: 'object', properties: { range: { type: 'string', description: 'today | week | month (default week)', enum: ['today', 'week', 'month'] } } },
    execute: async (p) => {
      try {
        const now = new Date();
        const since = p.range === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
          : p.range === 'month' ? new Date(now.getTime() - 30 * 86400000) : new Date(now.getTime() - 7 * 86400000);
        const clauses: SQL[] = [gte(kpiEvents.occurredAt, since)];
        const scope = memberScope(viewer, kpiEvents.teamMemberId);
        if (scope) clauses.push(scope);
        const counts = await db.select({ teamMemberId: kpiEvents.teamMemberId, repName: kpiEvents.repName, type: kpiEvents.type, count: sql<number>`count(*)::int` })
          .from(kpiEvents).where(and(...clauses)).groupBy(kpiEvents.teamMemberId, kpiEvents.repName, kpiEvents.type);
        const ids = Array.from(new Set(counts.map((c) => c.teamMemberId).filter((x): x is number => x != null)));
        const names = new Map<number, string>();
        if (ids.length) for (const m of await db.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers).where(inArray(teamMembers.id, ids))) names.set(m.id, m.name);
        const reps = foldKpis(counts, names);
        if (!reps.length && viewer?.name) reps.push({ rep: viewer.name, doorKnocks: 0, leadsContacted: 0, reportsCreated: 0, reportsPresented: 0, referralsReceived: 0, leadsGiven: 0 });
        return { range: p.range || 'week', since: day(since), reps };
      } catch (e: any) { return { error: e.message }; }
    },
  };
}

export function myScheduleTool(viewer?: AgentViewer): Tool {
  return {
    name: 'get_my_schedule',
    description: "Upcoming appointments and inspections on the calendars this person can see (their own; a leader's team; everything for admin). Defaults to the next 7 days.",
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead (default 7, max 60)' } } },
    execute: async (p) => {
      try {
        const days = clamp(p.days, 7, 60);
        const mailboxes = viewer ? (viewer.emails === undefined ? [] : viewer.emails) : null;
        const items = await fetchSchedule({ to: new Date(Date.now() + days * 86400000).toISOString(), mailboxes });
        return { days, count: items.length, appointments: items.slice(0, 40) };
      } catch (e: any) { return { error: e.message }; }
    },
  };
}

export function jobCommissionsTool(viewer?: AgentViewer): Tool {
  return {
    name: 'get_job_commissions',
    description: "The per-job commission records the system opens when a job is sold (this person's own; a leader's reps'; all for admin): revenue, costs, overhead rate, profit, commission, status (open / approved / paid) and what each is still waiting on before it can be approved.",
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'open | approved | paid (optional)', enum: ['open', 'approved', 'paid'] },
        jobExternalId: { type: 'string', description: 'One job (optional)' },
        limit: { type: 'number', description: 'Max rows (default 20, max 50)' },
      },
    },
    execute: async (p) => {
      try {
        const clauses: SQL[] = [];
        const ids = memberScope(viewer, jobCommissions.teamMemberId);
        if (ids) {
          const byName = viewer?.repNames && viewer.repNames.length ? inArray(sql`lower(${jobCommissions.repName})`, viewer.repNames) : sql`false`;
          clauses.push(or(ids, byName) as SQL);
        }
        if (p.status) clauses.push(eq(jobCommissions.status, p.status));
        if (p.jobExternalId) clauses.push(eq(jobCommissions.jobExternalId, String(p.jobExternalId)));
        const base = db.select().from(jobCommissions);
        const rows = await (clauses.length ? base.where(and(...clauses)) : base).orderBy(desc(jobCommissions.updatedAt)).limit(clamp(p.limit, 20, 50));
        return { count: rows.length, commissions: rows.map((r) => ({
          jobExternalId: r.jobExternalId, job: r.jobName, rep: r.repName, status: r.status, leadSource: r.leadSource, jobType: r.jobType,
          overheadPct: r.overheadPct != null ? num(r.overheadPct) : null, revenue: num(r.revenue), material: num(r.material), labor: num(r.labor), other: num(r.other),
          profit: r.profit != null ? num(r.profit) : null, commission: r.commissionAmount != null ? num(r.commissionAmount) : null,
          checked: Object.keys((r.checks as ChecksState) || {}), waitingOn: r.status === 'open' ? jobCommissionBlockers({ ...figuresOf(r), checks: r.checks as ChecksState }) : [],
          approvedAt: day(r.approvedAt), paidAt: day(r.paidAt),
        })) };
      } catch (e: any) { return { error: e.message }; }
    },
  };
}

/**
 * Everything the app knows about one job, in one call: the lead, follow-ups,
 * inspections, reports, pre-construction checklist, the commission record
 * (when this person may see money), and live JobTread estimates, daily logs
 * and notes. This is how an advisor "looks inside a project".
 */
export function projectTool(viewer?: AgentViewer, opts: { money?: boolean } = {}): Tool {
  return {
    name: 'get_project',
    description: "Look inside one project. Pass the JobTread job id (externalId from get_my_leads) or a search (customer name / job name / address). Returns the job's status and stage, contact, rep, projected value, open follow-ups, inspection submissions, roof reports / proposals, pre-construction checklist, commission record when applicable, and the latest JobTread estimates, daily logs, and notes. If the search matches several jobs you get the candidates back — ask which one.",
    parameters: {
      type: 'object',
      properties: {
        externalId: { type: 'string', description: 'JobTread job id (preferred)' },
        search: { type: 'string', description: 'Customer name, job name, or address (when you do not have the id)' },
      },
    },
    execute: async (p) => {
      try {
        const su = viewerSession(viewer);
        let lead: any = null;
        if (p.externalId) {
          [lead] = await db.select(LEAD_COLS).from(leads).where(eq(leads.externalId, String(p.externalId)));
          if (!lead) return { error: 'No job with that id.' };
          if (su && !(await ownsLead(su, lead.externalId))) return { error: 'That job is not in your book.' };
          if (!su && viewer?.repNames !== null && !viewerOwnsRep(viewer, lead.repName)) return { error: 'That job is not in your book.' };
        } else if (p.search) {
          const q = `%${String(p.search).trim()}%`;
          const rows = await db.select(LEAD_COLS).from(leads)
            .where(and(await leadScope(viewer), isNotNull(leads.externalId), or(ilike(leads.firstName, q), ilike(leads.jobName, q), ilike(leads.address, q)) as SQL))
            .orderBy(desc(leads.createdAt)).limit(6);
          if (!rows.length) return { error: 'No job in your book matches that.' };
          if (rows.length > 1) return { ambiguous: true, candidates: rows.map((r) => ({ externalId: r.externalId, customer: r.customer, jobName: r.jobName, address: r.address, stage: r.stage })) };
          lead = rows[0];
        } else {
          return { error: 'Pass externalId or search.' };
        }

        const id = lead.externalId as string;
        const jt = new JobTreadClient();
        const settled = await Promise.allSettled([
          db.select({ id: followUps.id, note: followUps.note, dueDate: followUps.dueDate, done: followUps.done, assignee: teamMembers.name })
            .from(followUps).leftJoin(teamMembers, eq(followUps.assignedTo, teamMembers.id)).where(eq(followUps.jobExternalId, id)).orderBy(desc(followUps.createdAt)).limit(10),
          db.select({ id: inspectionSubmissions.id, type: inspectionSubmissions.inspectionType, status: inspectionSubmissions.status, recommendation: inspectionSubmissions.recommendation, inspector: inspectionSubmissions.inspectorName, updatedAt: inspectionSubmissions.updatedAt })
            .from(inspectionSubmissions).where(eq(inspectionSubmissions.jobExternalId, id)).orderBy(desc(inspectionSubmissions.createdAt)).limit(5),
          db.select({ reportId: clientReports.reportId, title: clientReports.title, type: clientReports.reportType, status: clientReports.status, presentedAt: clientReports.presentedAt, proposalStatus: clientReports.jobtreadDocStatus, createdAt: clientReports.createdAt })
            .from(clientReports).where(eq(clientReports.jobExternalId, id)).orderBy(desc(clientReports.createdAt)).limit(6),
          db.select({ status: preConstructionChecklists.status, submittedAt: preConstructionChecklists.submittedAt }).from(preConstructionChecklists).where(eq(preConstructionChecklists.jobExternalId, id)).orderBy(desc(preConstructionChecklists.createdAt)).limit(1),
          opts.money ? db.select().from(jobCommissions).where(eq(jobCommissions.jobExternalId, id)) : Promise.resolve([]),
          jt.getJobEstimates(id, 5),
          jt.getJobDailyLogs(id, 5),
          jt.getJobComments(id, 8),
          lead.insuranceClaim ? jt.getJobInsurance(id) : Promise.resolve(null),
        ]);
        const val = <T,>(i: number, fallback: T): T => (settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<T>).value : fallback);
        const fu = val<any[]>(0, []); const insp = val<any[]>(1, []); const reps = val<any[]>(2, []); const precon = val<any[]>(3, []);
        const jc = val<any[]>(4, []); const est = val<any>(5, { estimates: [] }); const logs = val<any>(6, { logs: [] }); const notes = val<any>(7, { comments: [] }); const ins = val<any>(8, null);
        const c = jc[0];
        return {
          job: leadOut(lead),
          followUps: fu.map((f) => ({ ...f, note: trim(f.note, 200), ...dueFlags(f.dueDate) })),
          inspections: insp.map((i) => ({ ...i, updatedAt: day(i.updatedAt) })),
          reports: reps.map((r) => ({ ...r, presentedAt: day(r.presentedAt), createdAt: day(r.createdAt) })),
          preConstructionChecklist: precon[0] ? { status: precon[0].status, submittedAt: day(precon[0].submittedAt) } : null,
          commission: c ? {
            status: c.status, leadSource: c.leadSource, jobType: c.jobType, revenue: num(c.revenue), material: num(c.material), labor: num(c.labor),
            profit: c.profit != null ? num(c.profit) : null, commission: c.commissionAmount != null ? num(c.commissionAmount) : null,
            waitingOn: c.status === 'open' ? jobCommissionBlockers({ ...figuresOf(c), checks: c.checks as ChecksState }) : [],
          } : (opts.money ? null : undefined),
          jobtread: {
            estimates: (est.estimates || []).map((e: any) => ({ name: e.name, number: e.number, status: e.status, price: e.price, issueDate: e.issueDate })),
            dailyLogs: (logs.logs || []).map((l: any) => ({ date: l.date, notes: trim(l.notes, 300), weather: l.weather, author: l.author })),
            notes: (notes.comments || []).map((n: any) => ({ date: day(n.createdAt), author: n.author, message: trim(n.message, 300) })),
            insurance: ins,
          },
          errors: settled.map((s, i) => (s.status === 'rejected' ? `${['followUps', 'inspections', 'reports', 'precon', 'commission', 'estimates', 'dailyLogs', 'notes', 'insurance'][i]}: ${(s as PromiseRejectedResult).reason?.message || 'failed'}` : null)).filter(Boolean),
        };
      } catch (e: any) { return { error: e.message }; }
    },
  };
}
