import { BaseAgent, AgentConfig } from './base-agent';
import { db } from '../db';
import { leads, agentTasks, agentDecisions, dailyMetrics, agents } from '../../shared/schema';
import { eq, desc, gte, sql, and } from 'drizzle-orm';
import { JobTreadClient } from '../integrations/jobtread';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { calculateCommissionTool, listCommissionsTool } from './team-agents';

export class CEOAgent extends BaseAgent {
  private jobtread: JobTreadClient;
  private ghl: GoHighLevelClient;

  constructor(config: AgentConfig) {
    super(config);
    this.jobtread = new JobTreadClient();
    this.ghl = new GoHighLevelClient();
  }

  protected registerTools(): void {
    // Tool: Get daily business metrics
    this.registerTool({
      name: 'get_daily_metrics',
      description: 'Get comprehensive business metrics for today including revenue, leads, jobs, and reviews',
      parameters: {
        type: 'object',
        properties: {
          includeComparison: {
            type: 'boolean',
            description: 'Include comparison to yesterday and last week',
          },
        },
      },
      execute: async (params) => {
        return this.getDailyMetrics(params.includeComparison);
      },
    });

    // Tool: Get agent activity summary
    this.registerTool({
      name: 'get_agent_activity',
      description: 'Get recent decisions and actions taken by all AI agents',
      parameters: {
        type: 'object',
        properties: {
          hours: {
            type: 'number',
            description: 'Look back period in hours (default: 24)',
          },
          agentRole: {
            type: 'string',
            description: 'Filter by specific agent role (optional)',
            enum: ['cmo', 'cfo', 'coo', 'sales_manager', 'customer_service'],
          },
        },
      },
      execute: async (params) => {
        return this.getAgentActivity(params.hours || 24, params.agentRole);
      },
    });

    // Tool: Get lead summary
    this.registerTool({
      name: 'get_lead_summary',
      description: 'Get a summary of leads by status with key metrics',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        return this.getLeadSummary();
      },
    });

    this.registerTool({
      name: 'get_jobtread_lead_kpis',
      description: 'Get JobTread lead KPIs for this month or year, including totals, status mix, win rate, projected value, and recent leads.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Which JobTread reporting window to analyze.',
            enum: ['month', 'year'],
          },
          limit: {
            type: 'number',
            description: 'How many recent JobTread leads to include in the response.',
          },
        },
      },
      execute: async (params) => {
        return this.getJobTreadLeadKpis(params.period || 'month', params.limit || 10);
      },
    });

    // Tool: Get outstanding items needing attention
    this.registerTool({
      name: 'get_attention_items',
      description: 'Get items that need human attention or decision',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        return this.getAttentionItems();
      },
    });

    // Tool: Send directive to another agent
    this.registerTool({
      name: 'send_team_directive',
      description: 'Send an instruction or task to another agent on the team',
      parameters: {
        type: 'object',
        properties: {
          agentRole: {
            type: 'string',
            description: 'The role of the agent to send the directive to',
            enum: ['cmo', 'cfo', 'coo', 'sales_manager', 'customer_service'],
          },
          directive: {
            type: 'string',
            description: 'The instruction or task to assign',
          },
          priority: {
            type: 'string',
            description: 'Priority level',
            enum: ['low', 'normal', 'high', 'urgent'],
          },
        },
        required: ['agentRole', 'directive'],
      },
      execute: async (params) => {
        return this.sendTeamDirective(params.agentRole, params.directive, params.priority || 'normal');
      },
    });

    // Tool: Get job status overview
    this.registerTool({
      name: 'get_job_overview',
      description: 'Get overview of active jobs and their status',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of jobs to return',
          },
        },
      },
      execute: async (params) => {
        return this.getJobOverview(params.limit || 10);
      },
    });

    this.registerTool(calculateCommissionTool());
    this.registerTool(listCommissionsTool());
  }

  // Generate the daily business briefing
  async generateDailyBriefing(): Promise<string> {
    const { response } = await this.chat(`
Please generate my daily briefing for Best Roofing Now. Include:
1. Today's key metrics (use get_daily_metrics with comparison)
2. Recent agent activity (use get_agent_activity)
3. JobTread lead KPIs for this month (use get_jobtread_lead_kpis)
4. Internal lead pipeline status (use get_lead_summary)
5. Any items needing my attention (use get_attention_items)
6. Active jobs overview (use get_job_overview)

Format this as a clear, executive-level briefing that I can read in 2 minutes.
Highlight anything that needs immediate attention with ⚠️.
Use emojis sparingly for visual organization.
End with 2-3 recommended priorities for the day.
    `);

    return response;
  }

  // Get comprehensive daily metrics
  private async getDailyMetrics(includeComparison: boolean = false) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get today's metrics from database
    const [todayMetrics] = await db
      .select()
      .from(dailyMetrics)
      .where(gte(dailyMetrics.date, today))
      .limit(1);

    // Get lead counts for today
    const todayLeads = await db
      .select({
        total: sql<number>`count(*)`,
        qualified: sql<number>`count(*) filter (where ${leads.status} = 'qualified')`,
        converted: sql<number>`count(*) filter (where ${leads.status} = 'won')`,
      })
      .from(leads)
      .where(gte(leads.createdAt, today));

    // Try to get data from JobTread
    let jobsData = { active: 0, completed: 0, revenue: 0 };
    try {
      const activeJobs = await this.jobtread.getJobs({ status: 'in_progress' });
      const completedToday = await this.jobtread.getJobs({ status: 'completed' });
      jobsData = {
        active: activeJobs.total,
        completed: completedToday.jobs.filter(j =>
          j.updatedAt && new Date(j.updatedAt) >= today
        ).length,
        revenue: completedToday.jobs
          .filter(j => j.updatedAt && new Date(j.updatedAt) >= today)
          .reduce((sum, j) => sum + (j.actualValue || 0), 0),
      };
    } catch (error) {
      console.error('JobTread fetch error:', error);
    }

    const result: any = {
      date: today.toISOString().split('T')[0],
      leads: {
        new: todayLeads[0]?.total || 0,
        qualified: todayLeads[0]?.qualified || 0,
        converted: todayLeads[0]?.converted || 0,
      },
      jobs: jobsData,
      revenue: jobsData.revenue,
    };

    if (includeComparison) {
      // Get yesterday's data
      const [yesterdayMetrics] = await db
        .select()
        .from(dailyMetrics)
        .where(and(
          gte(dailyMetrics.date, yesterday),
          sql`${dailyMetrics.date} < ${today}`
        ))
        .limit(1);

      result.comparison = {
        yesterday: {
          leads: yesterdayMetrics?.newLeads || 0,
          revenue: parseFloat(yesterdayMetrics?.revenue?.toString() || '0'),
        },
        trend: {
          leads: result.leads.new - (yesterdayMetrics?.newLeads || 0),
          revenue: result.revenue - parseFloat(yesterdayMetrics?.revenue?.toString() || '0'),
        },
      };
    }

    return result;
  }

  // Get recent agent activity
  private async getAgentActivity(hours: number = 24, agentRole?: string) {
    const since = new Date();
    since.setHours(since.getHours() - hours);

    let query = db
      .select({
        id: agentDecisions.id,
        agentId: agentDecisions.agentId,
        context: agentDecisions.context,
        decision: agentDecisions.decision,
        reasoning: agentDecisions.reasoning,
        createdAt: agentDecisions.createdAt,
      })
      .from(agentDecisions)
      .where(gte(agentDecisions.createdAt, since))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(20);

    const decisions = await query;

    // Get agent names for context
    const agentList = await db.select().from(agents);
    const agentMap = new Map(agentList.map(a => [a.id, a]));

    return {
      period: `Last ${hours} hours`,
      totalDecisions: decisions.length,
      decisions: decisions.map(d => ({
        agent: agentMap.get(d.agentId)?.name || 'Unknown',
        role: agentMap.get(d.agentId)?.role,
        action: d.context,
        decision: d.decision,
        time: d.createdAt,
      })),
    };
  }

  // Get lead pipeline summary
  private async getLeadSummary() {
    const statusCounts = await db
      .select({
        status: leads.status,
        count: sql<number>`count(*)`,
        avgScore: sql<number>`avg(${leads.score})`,
      })
      .from(leads)
      .groupBy(leads.status);

    const recentLeads = await db
      .select()
      .from(leads)
      .orderBy(desc(leads.createdAt))
      .limit(5);

    return {
      byStatus: statusCounts.reduce((acc, s) => {
        acc[s.status || 'new'] = {
          count: Number(s.count),
          avgScore: s.avgScore ? Number(s.avgScore).toFixed(1) : null,
        };
        return acc;
      }, {} as Record<string, { count: number; avgScore: string | null }>),
      totalLeads: statusCounts.reduce((sum, s) => sum + Number(s.count), 0),
      recentLeads: recentLeads.map(l => ({
        name: `${l.firstName || ''} ${l.lastName || ''}`.trim() || 'Unknown',
        status: l.status,
        score: l.score,
        serviceType: l.serviceType,
        createdAt: l.createdAt,
      })),
    };
  }

  private async getJobTreadLeadKpis(period: 'month' | 'year' = 'month', limit: number = 10) {
    try {
      return await this.jobtread.getLeadKpis({ period, limit });
    } catch (error: any) {
      return {
        error: 'Unable to fetch JobTread lead KPIs',
        details: error.message,
      };
    }
  }

  // Get items needing attention
  private async getAttentionItems() {
    const items: Array<{
      type: string;
      priority: string;
      description: string;
      action: string;
    }> = [];

    // Check for high-score leads not yet contacted
    const hotLeads = await db
      .select()
      .from(leads)
      .where(and(
        eq(leads.status, 'qualified'),
        gte(leads.score, 8),
        sql`${leads.lastContactedAt} IS NULL`
      ))
      .limit(5);

    for (const lead of hotLeads) {
      items.push({
        type: 'hot_lead',
        priority: 'high',
        description: `High-value lead (score ${lead.score}/10): ${lead.firstName} ${lead.lastName} - ${lead.serviceType}`,
        action: 'Needs immediate follow-up call',
      });
    }

    // Check for overdue invoices via JobTread
    try {
      const invoices = await this.jobtread.getOutstandingInvoices();
      if (invoices.totalDue > 5000) {
        items.push({
          type: 'overdue_invoices',
          priority: 'medium',
          description: `$${invoices.totalDue.toLocaleString()} in outstanding invoices`,
          action: 'CFO should send payment reminders',
        });
      }
    } catch (error) {
      // JobTread not configured
    }

    // Check for failed agent tasks
    const failedTasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.status, 'failed'))
      .orderBy(desc(agentTasks.createdAt))
      .limit(3);

    for (const task of failedTasks) {
      items.push({
        type: 'failed_task',
        priority: 'low',
        description: `Agent task failed: ${task.type}`,
        action: task.error || 'Review and retry',
      });
    }

    return {
      totalItems: items.length,
      byPriority: {
        high: items.filter(i => i.priority === 'high').length,
        medium: items.filter(i => i.priority === 'medium').length,
        low: items.filter(i => i.priority === 'low').length,
      },
      items,
    };
  }

  // Send directive to another agent
  private async sendTeamDirective(
    agentRole: string,
    directive: string,
    priority: string
  ) {
    // Create a task for the target agent
    const [targetAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.role, agentRole as any));

    if (!targetAgent) {
      return {
        success: false,
        error: `No agent found for role: ${agentRole}`,
      };
    }

    const [task] = await db
      .insert(agentTasks)
      .values({
        agentId: targetAgent.id,
        type: 'ceo_directive',
        payload: {
          directive,
          priority,
          fromAgent: this.config.name,
        },
        status: 'pending',
      })
      .returning();

    // Log the decision
    await this.logDecision(
      `Sending directive to ${targetAgent.name}`,
      directive,
      `Priority: ${priority}`,
    );

    return {
      success: true,
      taskId: task.id,
      message: `Directive sent to ${targetAgent.name}: "${directive}"`,
    };
  }

  // Get job overview
  private async getJobOverview(limit: number = 10) {
    try {
      const activeJobs = await this.jobtread.getJobs({ status: 'in_progress', limit });

      return {
        totalActive: activeJobs.total,
        jobs: activeJobs.jobs.map(j => ({
          id: j.id,
          name: j.name,
          customer: j.customer ? `${j.customer.firstName} ${j.customer.lastName}` : 'Unknown',
          status: j.status,
          value: j.estimatedValue,
          address: j.address ? `${j.address.city}, ${j.address.state}` : 'N/A',
        })),
      };
    } catch (error) {
      return {
        error: 'Unable to fetch jobs from JobTread',
        totalActive: 0,
        jobs: [],
      };
    }
  }
}
