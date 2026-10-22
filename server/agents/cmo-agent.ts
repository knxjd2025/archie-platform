import { BaseAgent, AgentConfig, Tool } from './base-agent';
import { db } from '../db';
import { leads, communicationLog, dailyMetrics } from '../../shared/schema';
import { eq, desc, and, gte, sql } from 'drizzle-orm';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { JobTreadClient } from '../integrations/jobtread';
import { leadScope, viewerCanSeeLead } from './sales-tools';

/** Most leads get_lead_pipeline returns in one call. */
const PIPELINE_MAX_LIMIT = 50;

// Charlotte NC service area counties
const SERVICE_AREA_COUNTIES = [
  'mecklenburg',
  'union',
  'cabarrus',
  'gaston',
  'lincoln',
  'iredell',
  'rowan',
  'stanly',
  'anson',
  'york', // SC but close
  'lancaster', // SC but close
];

const SERVICE_AREA_ZIPS = [
  // Charlotte and surrounding
  '28201', '28202', '28203', '28204', '28205', '28206', '28207', '28208', '28209', '28210',
  '28211', '28212', '28213', '28214', '28215', '28216', '28217', '28218', '28219', '28220',
  '28221', '28222', '28223', '28224', '28226', '28227', '28228', '28229', '28230', '28231',
  '28232', '28233', '28234', '28235', '28236', '28237', '28241', '28242', '28243', '28244',
  '28246', '28247', '28250', '28253', '28254', '28255', '28256', '28258', '28260', '28262',
  '28263', '28265', '28266', '28269', '28270', '28271', '28272', '28273', '28274', '28275',
  '28277', '28278', '28280', '28281', '28282', '28284', '28285', '28287', '28288', '28289',
  '28290', '28296', '28297', '28299',
  // Surrounding areas
  '28012', '28016', '28018', '28025', '28027', '28031', '28032', '28034', '28036', '28052',
  '28054', '28056', '28070', '28078', '28079', '28083', '28098', '28101', '28103', '28104',
  '28105', '28106', '28107', '28110', '28112', '28120', '28123', '28124', '28125', '28126',
  '28127', '28128', '28129', '28130', '28134', '28144', '28146', '28147', '28150', '28152',
  '28159', '28160', '28163', '28164', '28166', '28167', '28168', '28169', '28173', '28174',
];

export class CMOAgent extends BaseAgent {
  private ghl: GoHighLevelClient;
  private jobtread: JobTreadClient;

  constructor(config: AgentConfig) {
    super(config);
    this.ghl = new GoHighLevelClient();
    this.jobtread = new JobTreadClient();
  }

  protected registerTools(): void {
    // Tool: Get lead pipeline
    this.registerTool({
      name: 'get_lead_pipeline',
      description: 'Get current leads grouped by status with counts and recent activity',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by specific status (optional)',
            enum: ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'disqualified'],
          },
          limit: {
            type: 'number',
            description: 'Maximum number of leads to return per status',
          },
        },
      },
      execute: async (params) => {
        const limit = Math.min(Math.max(Number(params.limit) || 10, 1), PIPELINE_MAX_LIMIT);
        return this.getLeadPipeline(params.status, limit);
      },
    });

    // Tool: Qualify a lead
    this.registerTool({
      name: 'qualify_lead',
      description: 'Score and qualify a lead based on their information. Returns qualification score (1-10) and recommendation.',
      parameters: {
        type: 'object',
        properties: {
          leadId: {
            type: 'number',
            description: 'The ID of the lead to qualify',
          },
        },
        required: ['leadId'],
      },
      execute: async (params) => {
        const denied = await this.denyUnlessVisible(params.leadId);
        if (denied) return denied;
        return this.qualifyLead(Number(params.leadId));
      },
    });

    // Tool: Send SMS to lead
    this.registerTool({
      name: 'send_sms_to_lead',
      description: 'Send an SMS message to a lead via GoHighLevel',
      parameters: {
        type: 'object',
        properties: {
          leadId: {
            type: 'number',
            description: 'The ID of the lead',
          },
          message: {
            type: 'string',
            description: 'The SMS message to send',
          },
        },
        required: ['leadId', 'message'],
      },
      execute: async (params) => {
        const denied = await this.denyUnlessVisible(params.leadId);
        if (denied) return denied;
        return this.sendSmsToLead(Number(params.leadId), params.message);
      },
    });

    // Tool: Create follow-up task
    this.registerTool({
      name: 'create_followup_task',
      description: 'Create a follow-up task in JobTread for a lead',
      parameters: {
        type: 'object',
        properties: {
          leadId: {
            type: 'number',
            description: 'The ID of the lead',
          },
          title: {
            type: 'string',
            description: 'Task title',
          },
          description: {
            type: 'string',
            description: 'Task description',
          },
          dueInHours: {
            type: 'number',
            description: 'Hours from now when task is due',
          },
        },
        required: ['leadId', 'title'],
      },
      execute: async (params) => {
        const denied = await this.denyUnlessVisible(params.leadId);
        if (denied) return denied;
        return this.createFollowupTask(Number(params.leadId), params.title, params.description, params.dueInHours || 1);
      },
    });

    // Tool: Get today's marketing metrics
    this.registerTool({
      name: 'get_marketing_metrics',
      description: 'Get marketing performance metrics for today or a date range',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Number of days to look back (default: 1 for today)',
          },
        },
      },
      execute: async (params) => {
        return this.getMarketingMetrics(params.days || 1);
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

    // Tool: Draft review request
    this.registerTool({
      name: 'draft_review_request',
      description: 'Draft a personalized review request message for a completed job',
      parameters: {
        type: 'object',
        properties: {
          customerName: {
            type: 'string',
            description: 'Customer first name',
          },
          jobType: {
            type: 'string',
            description: 'Type of roofing work completed',
          },
        },
        required: ['customerName', 'jobType'],
      },
      execute: async (params) => {
        return this.draftReviewRequest(params.customerName, params.jobType);
      },
    });
  }

  /**
   * The chat tools take a raw lead id from the model. They used to act on any
   * id at all, so a rep talking to the CMO advisor could read, re-score or
   * text a lead in someone else's book (or any lead, by guessing ids). The
   * webhook paths (handleNewLead) call qualifyLead directly and stay unscoped:
   * they are the system handling a brand-new lead, not a person asking.
   * Returns an { error } for the model when the lead is out of scope.
   */
  private async denyUnlessVisible(rawId: unknown): Promise<{ error: string } | null> {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return { error: 'leadId must be a lead id number.' };
    const [lead] = await db
      .select({ externalId: leads.externalId, jtSalesRep: leads.jtSalesRep })
      .from(leads)
      .where(eq(leads.id, id));
    // Same answer for "missing" and "not yours", so ids can't be probed.
    if (!lead || !(await viewerCanSeeLead(this.config.viewer, lead))) {
      return { error: 'No lead with that id in your book.' };
    }
    return null;
  }

  // Get lead pipeline data — only the leads this viewer may see, like the
  // pipeline screens. It used to list and count the whole company's leads,
  // contact details included, for whoever asked.
  private async getLeadPipeline(status?: string, limit: number = 10) {
    const scope = await leadScope(this.config.viewer);
    const leadsData = await db
      .select()
      .from(leads)
      .where(status ? and(scope, eq(leads.status, status as any)) : scope)
      .orderBy(desc(leads.createdAt))
      .limit(limit);

    // Group by status
    const pipeline: Record<string, any[]> = {};
    for (const lead of leadsData) {
      const s = lead.status || 'new';
      if (!pipeline[s]) pipeline[s] = [];
      pipeline[s].push({
        id: lead.id,
        name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Unknown',
        phone: lead.phone,
        email: lead.email,
        serviceType: lead.serviceType,
        score: lead.score,
        createdAt: lead.createdAt,
      });
    }

    // Get counts
    const counts = await db
      .select({
        status: leads.status,
        count: sql<number>`count(*)`,
      })
      .from(leads)
      .where(scope)
      .groupBy(leads.status);

    return {
      pipeline,
      counts: counts.reduce((acc, c) => {
        acc[c.status || 'new'] = Number(c.count);
        return acc;
      }, {} as Record<string, number>),
      totalLeads: leadsData.length,
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

  // Qualify a lead with scoring
  async qualifyLead(leadId: number): Promise<{
    score: number;
    qualified: boolean;
    reason: string;
    recommendation: string;
  }> {
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));

    if (!lead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    let score = 0;
    const factors: string[] = [];

    // Check if in service area (by zip or city)
    const zip = lead.zip?.trim();
    const city = lead.city?.toLowerCase().trim();
    const inServiceArea = (zip && SERVICE_AREA_ZIPS.includes(zip)) ||
                          city === 'charlotte' ||
                          SERVICE_AREA_COUNTIES.some(c => city?.includes(c));

    if (inServiceArea) {
      score += 3;
      factors.push('In Charlotte service area (+3)');
    } else if (zip || city) {
      factors.push('Outside primary service area (+0)');
    }

    // Check contact info completeness
    if (lead.phone) {
      score += 2;
      factors.push('Phone number provided (+2)');
    }
    if (lead.email) {
      score += 1;
      factors.push('Email provided (+1)');
    }

    // Check service type (some are higher value)
    const serviceType = lead.serviceType?.toLowerCase();
    if (serviceType?.includes('replacement') || serviceType?.includes('new')) {
      score += 3;
      factors.push('Full roof replacement - high value (+3)');
    } else if (serviceType?.includes('repair')) {
      score += 2;
      factors.push('Roof repair (+2)');
    } else if (serviceType?.includes('inspection')) {
      score += 1;
      factors.push('Inspection request (+1)');
    }

    // Check property type
    if (lead.propertyType?.toLowerCase() === 'commercial') {
      score += 2;
      factors.push('Commercial property - higher value (+2)');
    } else if (lead.propertyType?.toLowerCase() === 'residential') {
      score += 1;
      factors.push('Residential property (+1)');
    }

    // Cap at 10
    score = Math.min(score, 10);

    const qualified = score >= 6;
    const reason = factors.join('; ');

    let recommendation: string;
    if (score >= 8) {
      recommendation = 'HIGH PRIORITY: Contact immediately. This is a qualified lead with strong buying signals.';
    } else if (score >= 6) {
      recommendation = 'QUALIFIED: Good lead. Send initial contact and schedule follow-up within 1 hour.';
    } else if (score >= 4) {
      recommendation = 'NURTURE: Potential lead but needs more information. Add to nurture sequence.';
    } else {
      recommendation = 'LOW PRIORITY: Missing key information or outside service area. Send polite response.';
    }

    // Update lead in database
    await db
      .update(leads)
      .set({
        score,
        status: qualified ? 'qualified' : 'disqualified',
        qualifiedAt: new Date(),
        qualifiedBy: this.config.id,
        qualificationReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    // Log the decision
    await this.logDecision(
      `Qualifying lead ${leadId}: ${lead.firstName} ${lead.lastName}`,
      qualified ? `QUALIFIED with score ${score}/10` : `DISQUALIFIED with score ${score}/10`,
      reason,
      score / 10
    );

    return { score, qualified, reason, recommendation };
  }

  // Send SMS to a lead
  private async sendSmsToLead(leadId: number, message: string) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));

    if (!lead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    if (!lead.phone) {
      throw new Error('Lead has no phone number');
    }

    // Send via GoHighLevel
    const result = await this.ghl.sendSms(lead.phone, message, lead.externalId ?? undefined);

    // Log the communication
    await db.insert(communicationLog).values({
      leadId,
      agentId: this.config.id,
      channel: 'sms',
      direction: 'outbound',
      content: message,
      externalId: result.messageId,
      status: result.success ? 'sent' : 'failed',
    });

    // Update lead's last contacted time
    await db
      .update(leads)
      .set({
        lastContactedAt: new Date(),
        status: lead.status === 'new' ? 'contacted' : lead.status,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    return {
      success: result.success,
      messageId: result.messageId,
      message: `SMS sent to ${lead.phone}`,
    };
  }

  // Create follow-up task in JobTread
  private async createFollowupTask(
    leadId: number,
    title: string,
    description?: string,
    dueInHours: number = 1
  ) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));

    if (!lead) {
      throw new Error(`Lead not found: ${leadId}`);
    }

    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + dueInHours);

    const result = await this.jobtread.createTask({
      title: `${title} - ${lead.firstName} ${lead.lastName}`,
      description: description || `Follow up with lead: ${lead.phone || lead.email}`,
      dueDate: dueDate.toISOString(),
      contactId: lead.externalId ?? undefined,
    });

    return {
      success: result.success,
      taskId: result.taskId,
      dueDate: dueDate.toISOString(),
      message: `Task created: ${title}`,
    };
  }

  // Get marketing metrics
  private async getMarketingMetrics(days: number = 1) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await db
      .select()
      .from(dailyMetrics)
      .where(gte(dailyMetrics.date, startDate))
      .orderBy(desc(dailyMetrics.date));

    // Get lead counts for the period
    const leadCounts = await db
      .select({
        status: leads.status,
        count: sql<number>`count(*)`,
      })
      .from(leads)
      .where(gte(leads.createdAt, startDate))
      .groupBy(leads.status);

    // Calculate totals
    const totals = {
      newLeads: 0,
      qualifiedLeads: 0,
      convertedLeads: 0,
      totalRevenue: 0,
    };

    for (const m of metrics) {
      totals.newLeads += m.newLeads || 0;
      totals.qualifiedLeads += m.qualifiedLeads || 0;
      totals.convertedLeads += m.convertedLeads || 0;
      totals.totalRevenue += parseFloat(m.revenue?.toString() || '0');
    }

    const conversionRate = totals.newLeads > 0
      ? ((totals.convertedLeads / totals.newLeads) * 100).toFixed(1)
      : '0';

    return {
      period: `Last ${days} day(s)`,
      totals,
      conversionRate: `${conversionRate}%`,
      leadsByStatus: leadCounts.reduce((acc, c) => {
        acc[c.status || 'new'] = Number(c.count);
        return acc;
      }, {} as Record<string, number>),
      dailyBreakdown: metrics,
    };
  }

  // Draft a review request message
  private async draftReviewRequest(customerName: string, jobType: string) {
    const message = `Hi ${customerName}! Thank you for choosing Best Roofing Now for your ${jobType}. We hope you're completely satisfied with our work! If you have a moment, we'd really appreciate a review on Google - it helps other Charlotte homeowners find quality roofing services. Here's the link: [GOOGLE_REVIEW_LINK] Thank you! - The Best Roofing Now Team`;

    return {
      message,
      channels: ['sms', 'email'],
      note: 'Replace [GOOGLE_REVIEW_LINK] with actual Google Business Profile review link',
    };
  }

  // Handle new lead workflow (called from webhook)
  async handleNewLead(leadData: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    serviceType?: string;
    propertyType?: string;
    source: string;
    externalId?: string;
  }): Promise<{
    leadId: number;
    qualified: boolean;
    score: number;
    actionsTaken: string[];
  }> {
    const actionsTaken: string[] = [];

    // 1. Create lead in database
    const [lead] = await db
      .insert(leads)
      .values({
        ...leadData,
        status: 'new',
      })
      .returning();

    actionsTaken.push(`Created lead record (ID: ${lead.id})`);

    // 2. Qualify the lead
    const qualification = await this.qualifyLead(lead.id);
    actionsTaken.push(`Qualified lead: Score ${qualification.score}/10 - ${qualification.qualified ? 'QUALIFIED' : 'NOT QUALIFIED'}`);

    // 3. If qualified, send immediate response
    if (qualification.qualified && lead.phone) {
      const serviceDesc = lead.serviceType || 'roofing service';
      const smsMessage = `Hi ${lead.firstName || 'there'}! Thanks for contacting Best Roofing Now! We received your request for ${serviceDesc}. A team member will call you within the hour. Questions? Reply to this text or call us at (704) 555-ROOF. - Best Roofing Now`;

      try {
        await this.sendSmsToLead(lead.id, smsMessage);
        actionsTaken.push('Sent immediate SMS response');
      } catch (error: any) {
        actionsTaken.push(`SMS failed: ${error.message}`);
      }

      // Create follow-up task
      try {
        await this.createFollowupTask(
          lead.id,
          'Call new qualified lead',
          `QUALIFIED LEAD (Score: ${qualification.score}/10)\n\n${qualification.reason}\n\nRecommendation: ${qualification.recommendation}`,
          1
        );
        actionsTaken.push('Created 1-hour follow-up task in JobTread');
      } catch (error: any) {
        actionsTaken.push(`Task creation failed: ${error.message}`);
      }
    } else if (!qualification.qualified && lead.phone) {
      // Send polite response for non-qualified leads
      let message: string;
      if (!lead.zip || !SERVICE_AREA_ZIPS.includes(lead.zip)) {
        message = `Hi ${lead.firstName || 'there'}! Thanks for reaching out to Best Roofing Now. Unfortunately, we primarily serve the Charlotte, NC metro area. We recommend searching for a local roofer in your area. Best of luck with your project!`;
      } else {
        message = `Hi ${lead.firstName || 'there'}! Thanks for contacting Best Roofing Now. We've received your inquiry and will review it shortly. If you have an urgent roofing emergency, please call us directly at (704) 555-ROOF.`;
      }

      try {
        await this.sendSmsToLead(lead.id, message);
        actionsTaken.push('Sent acknowledgment SMS');
      } catch (error: any) {
        actionsTaken.push(`SMS failed: ${error.message}`);
      }
    }

    return {
      leadId: lead.id,
      qualified: qualification.qualified,
      score: qualification.score,
      actionsTaken,
    };
  }
}
