import { and, desc, isNotNull } from 'drizzle-orm';
import { BaseAgent, type Tool } from './base-agent';
import { JobTreadClient } from '../integrations/jobtread';
import { db } from '../db';
import { commissions, leads } from '../../shared/schema';
import { calculateCommission } from '../../shared/commission';
import { atLeast, canSeeMoney } from '../../shared/rbac';
import { viewerOwnsRep, type AgentViewer } from './viewer';
import {
  createFollowUpTool, followUpsTool, jobCommissionsTool, myKpisTool, myLeadsTool, myScheduleTool,
  leadScope, pipelineSummaryTool, projectTool,
} from './sales-tools';

export { viewerOwnsRep, type AgentViewer } from './viewer';

/**
 * The five team advisors — Sales Manager, Customer Service, COO, Project
 * Coordinator, Estimator. Each is a distinct specialist: its prompt (see
 * ./team-advisors.ts) and its tool set are built around one job, and every
 * tool is scoped to the person asking (./viewer.ts, ./sales-tools.ts), so a
 * rep sees their own book, a leader their team's, an admin everything.
 *
 * Persona/systemPrompt come from the `agents` row via AgentConfig; BaseAgent
 * supplies chat + the knowledge-base tool. JobTread tools use only the
 * proven-working queries and return { error } instead of throwing, so a flaky
 * integration never crashes a chat.
 *
 * NOTE: the JobTreadClient is created inside registerTools() (not as a class
 * field) because BaseAgent's constructor calls registerTools() during super(),
 * before subclass field initializers would run.
 */

export function lookupJobTool(jt: JobTreadClient, viewer?: AgentViewer): Tool {
  return {
    name: 'lookup_job',
    description:
      'Search JobTread live by customer name, address, or job name. Returns status, projected value, and address. Prefer get_my_leads (faster, richer) and use this when the app has not synced a brand-new job yet.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text (customer, address, or job name)' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
    execute: async (p) => {
      try {
        const jobs = await jt.searchJobs(p.query, p.limit || 5);
        // JobTread search is org-wide by construction, so the scope has to be
        // applied to the results: keep only jobs attributed to a rep this
        // viewer may see.
        const visible = jobs.filter((j) => viewerOwnsRep(viewer, j.salesRep));
        return visible.length || jobs.length === 0
          ? { jobs: visible }
          : { jobs: [], note: 'No matching jobs assigned to you.' };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  };
}

/** Company-wide win rate / pipeline value from JobTread. Aggregate, so leaders and up only. */
function leadKpisTool(jt: JobTreadClient): Tool {
  return {
    name: 'get_company_lead_kpis',
    description:
      'COMPANY-WIDE lead KPIs from JobTread: win rate, pipeline value, counts by status, recent leads. For one person\'s own activity numbers use get_my_kpis.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Time period', enum: ['month', 'year'] },
      },
    },
    execute: async (p) => {
      try {
        return await jt.getLeadKpis({ period: p.period === 'year' ? 'year' : 'month' });
      } catch (e: any) {
        return { error: e.message };
      }
    },
  };
}

/**
 * Lowercased job names this viewer may see, or null when unrestricted.
 * JobTread invoices carry the job's NAME (getInvoices maps job.name into
 * jobId), so that is the key receivables are scoped on.
 */
async function visibleJobNames(viewer: AgentViewer | undefined): Promise<Set<string> | null> {
  if (viewer?.repNames === null) return null;
  const rows = await db
    .selectDistinct({ jobName: leads.jobName })
    .from(leads)
    .where(and(await leadScope(viewer), isNotNull(leads.jobName)));
  return new Set(rows.map((r) => String(r.jobName).trim().toLowerCase()));
}

/** Keep the invoices on jobs in `names` (null = all) and re-total what is due. */
export function scopeInvoices<T extends { jobId: string; amountDue: number }>(
  invoices: T[],
  names: Set<string> | null,
): { invoices: T[]; totalDue: number } {
  const kept = names === null ? invoices : invoices.filter((i) => names.has(String(i.jobId || '').trim().toLowerCase()));
  return { invoices: kept, totalDue: kept.reduce((s, i) => s + (Number(i.amountDue) || 0), 0) };
}

function outstandingInvoicesTool(jt: JobTreadClient, viewer?: AgentViewer): Tool {
  return {
    name: 'get_outstanding_invoices',
    description: "Unpaid customer invoices (accounts receivable) on the jobs this person can see — their team's for a leader, everyone's for admin — with amounts due and the total outstanding.",
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        // JobTread returns the whole company's receivables. A sales leader is
        // the gate here, and was getting every team's customers and balances;
        // scope to the jobs in their book, as every other tool here is.
        const [all, names] = await Promise.all([jt.getOutstandingInvoices(), visibleJobNames(viewer)]);
        return scopeInvoices(all.invoices, names);
      } catch (e: any) {
        return { error: e.message };
      }
    },
  };
}

export function calculateCommissionTool(): Tool {
  return {
    name: 'calculate_commission',
    description:
      "Calculate a sales rep's commission for a job: overhead is taken off revenue first (rate depends on lead source and job type), then material/labor/other costs, then commission is 50% of what's left (never negative). Standard rates: self-generated retail 10%, self-generated insurance 12%, company-provided retail 15%, company-provided insurance 17%.",
    parameters: {
      type: 'object',
      properties: {
        leadSource: { type: 'string', description: 'Who generated the lead', enum: ['self', 'company'] },
        jobType: { type: 'string', description: 'Retail sale or insurance claim', enum: ['retail', 'insurance'] },
        revenue: { type: 'number', description: 'Total job revenue' },
        material: { type: 'number', description: 'Material cost (default 0)' },
        labor: { type: 'number', description: 'Labor cost (default 0)' },
        other: { type: 'number', description: 'Other job expenses (default 0)' },
        manualOverheadPct: { type: 'number', description: 'Manager-approved override of the standard overhead % (special cases only)' },
      },
      required: ['leadSource', 'jobType', 'revenue'],
    },
    execute: async (p) => calculateCommission({
      leadSource: p.leadSource, jobType: p.jobType, revenue: p.revenue,
      material: p.material, labor: p.labor, other: p.other, manualOverheadPct: p.manualOverheadPct,
    }),
  };
}

export function listCommissionsTool(viewer?: AgentViewer): Tool {
  return {
    name: 'list_commissions',
    description: 'Commission calculator drafts and approvals (job, rep, revenue, profit, commission amount, draft/approved). Optionally filter to one rep by name. For the per-job records the system opens on a sale use get_job_commissions.',
    parameters: {
      type: 'object',
      properties: {
        repName: { type: 'string', description: 'Filter to this sales rep (optional)' },
        limit: { type: 'number', description: 'Max rows (default 20, max 50)' },
      },
    },
    execute: async (p) => {
      const rows = await db.select().from(commissions).orderBy(desc(commissions.createdAt)).limit(Math.min(p.limit || 20, 50));
      // Scope BEFORE the name filter, so asking for another rep by name cannot
      // reach past the viewer's own team.
      const scoped = rows.filter((r) => viewerOwnsRep(viewer, r.repName));
      const filtered = p.repName
        ? scoped.filter((r) => r.repName.toLowerCase().includes(String(p.repName).toLowerCase()))
        : scoped;
      return { commissions: filtered };
    },
  };
}

/** Rank-gated helpers. An anonymous viewer (unit tests) counts as unrestricted. */
const money = (v?: AgentViewer) => !v?.role || canSeeMoney(v.role, 'commissions');
const leaderPlus = (v?: AgentViewer) => !v?.role || atLeast(v.role, 'manager');

/** The book every team advisor can read: leads, pipeline, one project, follow-ups, schedule. */
function registerBook(agent: BaseAgent & { registerTool(t: Tool): void }, viewer: AgentViewer | undefined, opts: { followUps?: boolean; createFollowUp?: boolean; money?: boolean } = {}) {
  agent.registerTool(myLeadsTool(viewer));
  agent.registerTool(pipelineSummaryTool(viewer));
  agent.registerTool(projectTool(viewer, { money: !!opts.money && money(viewer) }));
  if (opts.followUps !== false) agent.registerTool(followUpsTool(viewer));
  if (opts.createFollowUp !== false) agent.registerTool(createFollowUpTool(viewer));
  agent.registerTool(myScheduleTool(viewer));
}

class TeamAgent extends BaseAgent {
  // registerTool is protected on BaseAgent; the helper above needs it.
  public registerTool(tool: Tool): void { super.registerTool(tool); }
  protected registerTools(): void { /* per role below */ }
}

/** Sales coach: the rep's pipeline, activity, follow-ups and pay. */
export class SalesManagerAgent extends TeamAgent {
  protected registerTools(): void {
    const jt = new JobTreadClient();
    const viewer = this.config.viewer;
    registerBook(this, viewer, { money: true });
    this.registerTool(myKpisTool(viewer));
    this.registerTool(lookupJobTool(jt, viewer));
    if (leaderPlus(viewer)) this.registerTool(leadKpisTool(jt));
    if (money(viewer)) {
      this.registerTool(calculateCommissionTool());
      this.registerTool(listCommissionsTool(viewer));
      this.registerTool(jobCommissionsTool(viewer));
    }
  }
}

/** Customer communication: what's going on with a customer and what to say. No money. */
export class CustomerServiceAgent extends TeamAgent {
  protected registerTools(): void {
    const jt = new JobTreadClient();
    const viewer = this.config.viewer;
    registerBook(this, viewer, { money: false });
    this.registerTool(lookupJobTool(jt, viewer));
    if (leaderPlus(viewer)) this.registerTool(outstandingInvoicesTool(jt, viewer));
  }
}

/** Operations: production flow, what's stuck, schedule, the team's throughput. */
export class COOAgent extends TeamAgent {
  protected registerTools(): void {
    const jt = new JobTreadClient();
    const viewer = this.config.viewer;
    registerBook(this, viewer, { money: true });
    this.registerTool(myKpisTool(viewer));
    this.registerTool(lookupJobTool(jt, viewer));
    if (leaderPlus(viewer)) {
      this.registerTool(leadKpisTool(jt));
      this.registerTool(outstandingInvoicesTool(jt, viewer));
    }
    if (money(viewer)) this.registerTool(jobCommissionsTool(viewer));
  }
}

/** One job at a time: where it stands, what's next, keeping the homeowner informed. */
export class ProjectCoordinatorAgent extends TeamAgent {
  protected registerTools(): void {
    const jt = new JobTreadClient();
    const viewer = this.config.viewer;
    registerBook(this, viewer, { money: false });
    this.registerTool(lookupJobTool(jt, viewer));
  }
}

/** Scope and price: inspection findings, reports, options. */
export class EstimatorAgent extends TeamAgent {
  protected registerTools(): void {
    const jt = new JobTreadClient();
    const viewer = this.config.viewer;
    registerBook(this, viewer, { money: false, createFollowUp: false });
    this.registerTool(lookupJobTool(jt, viewer));
  }
}
