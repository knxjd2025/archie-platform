import { BaseAgent, AgentConfig } from './base-agent';
import { db } from '../db';
import { dailyMetrics, leads, communicationLog } from '../../shared/schema';
import { eq, desc, gte, sql, and } from 'drizzle-orm';
import { JobTreadClient } from '../integrations/jobtread';
import { GoHighLevelClient } from '../integrations/gohighlevel';
import { getQuickBooksClient } from '../integrations/quickbooks';
import { getPlaidClient } from '../integrations/plaid-client';
import { calculateCommissionTool, listCommissionsTool } from './team-agents';

export class CFOAgent extends BaseAgent {
  private jobtread: JobTreadClient;
  private ghl: GoHighLevelClient;

  constructor(config: AgentConfig) {
    super(config);
    this.jobtread = new JobTreadClient();
    this.ghl = new GoHighLevelClient();
  }

  protected registerTools(): void {
    // Tool: Get revenue report
    this.registerTool({
      name: 'get_revenue_report',
      description: 'Get revenue report for a specified period',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Time period for the report',
            enum: ['today', 'week', 'month', 'quarter', 'year'],
          },
        },
        required: ['period'],
      },
      execute: async (params) => {
        return this.getRevenueReport(params.period);
      },
    });

    // Tool: Get outstanding invoices
    this.registerTool({
      name: 'get_outstanding_invoices',
      description: 'Get list of unpaid invoices with amounts due',
      parameters: {
        type: 'object',
        properties: {
          includeOverdue: {
            type: 'boolean',
            description: 'Only show overdue invoices',
          },
        },
      },
      execute: async (params) => {
        return this.getOutstandingInvoices(params.includeOverdue);
      },
    });

    // Tool: Send payment reminder
    this.registerTool({
      name: 'send_payment_reminder',
      description: 'Send a payment reminder for an outstanding invoice',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: {
            type: 'string',
            description: 'The JobTread invoice ID',
          },
          method: {
            type: 'string',
            description: 'Reminder method',
            enum: ['email', 'sms', 'both'],
          },
        },
        required: ['invoiceId'],
      },
      execute: async (params) => {
        return this.sendPaymentReminder(params.invoiceId, params.method || 'email');
      },
    });

    // Tool: Get job profitability
    this.registerTool({
      name: 'get_job_profitability',
      description: 'Calculate the profitability of a specific job',
      parameters: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'The JobTread job ID',
          },
        },
        required: ['jobId'],
      },
      execute: async (params) => {
        return this.getJobProfitability(params.jobId);
      },
    });

    // Tool: Get cash flow summary
    this.registerTool({
      name: 'get_cash_flow_summary',
      description: 'Get a summary of cash flow including receivables and payables',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        return this.getCashFlowSummary();
      },
    });

    // Tool: Get expense report (QuickBooks Online)
    this.registerTool({
      name: 'get_expense_report',
      description: 'Get a breakdown of expenses by category from QuickBooks Online',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Time period',
            enum: ['week', 'month', 'quarter'],
          },
        },
        required: ['period'],
      },
      execute: async (params) => {
        return this.getExpenseReport(params.period);
      },
    });

    // Tool: Get profit and loss (QuickBooks Online)
    this.registerTool({
      name: 'get_profit_and_loss',
      description: 'Get a Profit & Loss report from QuickBooks Online for a date range',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD). Defaults to beginning of current month.',
          },
          endDate: {
            type: 'string',
            description: 'End date (YYYY-MM-DD). Defaults to today.',
          },
        },
      },
      execute: async (params) => {
        try {
          const qbo = getQuickBooksClient();
          const report = await qbo.getProfitAndLoss(params.startDate, params.endDate);
          return report;
        } catch (error: any) {
          return { error: 'Unable to fetch P&L from QuickBooks', message: error.message };
        }
      },
    });

    // Tool: Get balance sheet (QuickBooks Online)
    this.registerTool({
      name: 'get_balance_sheet',
      description: 'Get the Balance Sheet from QuickBooks Online as of a specific date',
      parameters: {
        type: 'object',
        properties: {
          asOfDate: {
            type: 'string',
            description: 'Balance sheet date (YYYY-MM-DD). Defaults to today.',
          },
        },
      },
      execute: async (params) => {
        try {
          const qbo = getQuickBooksClient();
          const report = await qbo.getBalanceSheet(params.asOfDate);
          return report;
        } catch (error: any) {
          return { error: 'Unable to fetch balance sheet from QuickBooks', message: error.message };
        }
      },
    });

    // Tool: Get real-time bank balances (Plaid)
    this.registerTool({
      name: 'get_real_time_balances',
      description: 'Get real-time bank account balances from linked bank accounts via Plaid',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          const plaid = getPlaidClient();
          const balances = await plaid.getBalances();
          const banks = await plaid.getLinkedBanks();
          return {
            banks: banks.map((b: any) => b.institutionName),
            accounts: balances,
            retrievedAt: new Date().toISOString(),
          };
        } catch (error: any) {
          return { error: 'Unable to fetch bank balances from Plaid', message: error.message };
        }
      },
    });

    // Tool: Get cash position (Plaid balances + QBO receivables/payables)
    this.registerTool({
      name: 'get_cash_position',
      description: 'Get a comprehensive cash position combining real-time bank balances (Plaid), outstanding receivables (JobTread), and QuickBooks data',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        return this.getCashPosition();
      },
    });

    // Tool: Create invoice
    this.registerTool({
      name: 'create_invoice',
      description: 'Create a new invoice for a completed job or milestone',
      parameters: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'The JobTread job ID',
          },
          amount: {
            type: 'number',
            description: 'Invoice amount in dollars',
          },
          description: {
            type: 'string',
            description: 'Description of work invoiced',
          },
          dueInDays: {
            type: 'number',
            description: 'Days until due (default: 30)',
          },
        },
        required: ['jobId', 'amount'],
      },
      execute: async (params) => {
        return this.createInvoice(
          params.jobId,
          params.amount,
          params.description,
          params.dueInDays || 30
        );
      },
    });

    this.registerTool(calculateCommissionTool());
    this.registerTool(listCommissionsTool());
  }

  // Get revenue report for a period
  private async getRevenueReport(period: string) {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'today':
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate = new Date(now);
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30);
    }

    try {
      // Try to get from JobTread
      const report = await this.jobtread.getRevenueReport({
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
      });

      return {
        period,
        startDate: startDate.toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0],
        totalRevenue: report.totalRevenue,
        invoicesSent: report.invoicesSent,
        invoicesPaid: report.invoicesPaid,
        collectionRate: report.invoicesSent > 0
          ? ((report.invoicesPaid / report.invoicesSent) * 100).toFixed(1) + '%'
          : 'N/A',
        breakdown: report.breakdown,
      };
    } catch (error) {
      // Fallback to local metrics
      const metrics = await db
        .select()
        .from(dailyMetrics)
        .where(gte(dailyMetrics.date, startDate))
        .orderBy(desc(dailyMetrics.date));

      const totalRevenue = metrics.reduce(
        (sum, m) => sum + parseFloat(m.revenue?.toString() || '0'),
        0
      );

      return {
        period,
        startDate: startDate.toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0],
        totalRevenue,
        source: 'local_metrics',
        daysWithData: metrics.length,
      };
    }
  }

  // Get outstanding invoices
  private async getOutstandingInvoices(overdueOnly: boolean = false) {
    try {
      const result = await this.jobtread.getOutstandingInvoices();

      let invoices = result.invoices;
      if (overdueOnly) {
        const now = new Date();
        invoices = invoices.filter(inv => {
          if (!inv.dueDate) return false;
          return new Date(inv.dueDate) < now;
        });
      }

      // Sort by amount due (highest first)
      invoices.sort((a, b) => b.amountDue - a.amountDue);

      return {
        totalOutstanding: result.totalDue,
        overdueAmount: invoices
          .filter(inv => inv.dueDate && new Date(inv.dueDate) < new Date())
          .reduce((sum, inv) => sum + inv.amountDue, 0),
        count: invoices.length,
        invoices: invoices.slice(0, 10).map(inv => ({
          id: inv.id,
          number: inv.number,
          amount: inv.amount,
          amountDue: inv.amountDue,
          dueDate: inv.dueDate,
          status: inv.status,
          isOverdue: inv.dueDate ? new Date(inv.dueDate) < new Date() : false,
          daysPastDue: inv.dueDate
            ? Math.max(0, Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)))
            : 0,
        })),
      };
    } catch (error: any) {
      return {
        error: 'Unable to fetch invoices from JobTread',
        message: error.message,
      };
    }
  }

  // Send payment reminder
  private async sendPaymentReminder(invoiceId: string, method: string = 'email') {
    try {
      // Get invoice details
      const invoiceData = await this.jobtread.getInvoices({ limit: 100 });
      const invoice = invoiceData.invoices.find(i => i.id === invoiceId);

      if (!invoice) {
        return { success: false, error: 'Invoice not found' };
      }

      // Use JobTread's built-in reminder
      await this.jobtread.sendInvoiceReminder(invoiceId);

      // Log the action
      await this.logDecision(
        `Sending payment reminder for invoice ${invoice.number || invoiceId}`,
        `Sent via ${method}`,
        `Amount due: $${invoice.amountDue}`,
      );

      return {
        success: true,
        message: `Payment reminder sent for invoice ${invoice.number || invoiceId}`,
        amountDue: invoice.amountDue,
        method,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Get job profitability
  private async getJobProfitability(jobId: string) {
    try {
      const profitability = await this.jobtread.getJobProfitability(jobId);
      const jobResult = await this.jobtread.getJob(jobId);

      if (!jobResult.job) {
        return {
          error: 'Job not found',
          jobId,
        };
      }

      return {
        jobId,
        jobName: jobResult.job.name,
        revenue: profitability.revenue,
        costs: profitability.costs,
        grossProfit: profitability.profit,
        margin: `${(profitability.margin * 100).toFixed(1)}%`,
        status: jobResult.job.status,
        analysis: profitability.margin > 0.3
          ? 'Healthy margin - above 30% target'
          : profitability.margin > 0.2
            ? 'Acceptable margin - monitor costs'
            : 'Low margin - review for cost overruns',
      };
    } catch (error: any) {
      return {
        error: 'Unable to calculate job profitability',
        message: error.message,
      };
    }
  }

  // Get cash flow summary (enhanced with Plaid balances)
  private async getCashFlowSummary() {
    try {
      // Get outstanding invoices (receivables)
      const invoices = await this.jobtread.getOutstandingInvoices();

      // Get active jobs (potential future revenue)
      const activeJobs = await this.jobtread.getJobs({ status: 'in_progress' });
      const estimatedPipelineValue = activeJobs.jobs.reduce(
        (sum, job) => sum + (job.estimatedValue || 0),
        0
      );

      // Try to get real-time bank balances from Plaid
      let bankBalances: any = null;
      try {
        const plaid = getPlaidClient();
        const balances = await plaid.getBalances();
        const totalCash = balances.reduce((sum: number, acct: any) => {
          return sum + (acct.balances?.current || 0);
        }, 0);
        bankBalances = {
          totalCash,
          accountCount: balances.length,
          source: 'Plaid (real-time)',
        };
      } catch {
        // Plaid not connected — continue without bank balances
      }

      return {
        bankBalances,
        receivables: {
          total: invoices.totalDue,
          count: invoices.invoices.length,
        },
        pipeline: {
          activeJobs: activeJobs.total,
          estimatedValue: estimatedPipelineValue,
        },
        healthIndicators: {
          daysOfReceivables: invoices.totalDue > 0
            ? Math.round((invoices.totalDue / (estimatedPipelineValue || 1)) * 30)
            : 0,
          cashCoverageRatio: bankBalances?.totalCash && invoices.totalDue > 0
            ? (bankBalances.totalCash / invoices.totalDue).toFixed(2)
            : null,
          recommendation: invoices.totalDue > estimatedPipelineValue * 0.5
            ? 'High receivables ratio - prioritize collections'
            : 'Cash flow looks healthy',
        },
      };
    } catch (error: any) {
      return {
        error: 'Unable to generate cash flow summary',
        message: error.message,
      };
    }
  }

  // Get expense report from QuickBooks Online
  private async getExpenseReport(period: string) {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      default:
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30);
    }

    const start = startDate.toISOString().split('T')[0];
    const end = now.toISOString().split('T')[0];

    try {
      const qbo = getQuickBooksClient();
      const expenses = await qbo.getExpensesByCategory(start, end);
      return {
        period,
        startDate: start,
        endDate: end,
        source: 'QuickBooks Online',
        ...expenses,
      };
    } catch (error: any) {
      // Fallback to JobTread cost data
      try {
        const activeJobs = await this.jobtread.getJobs({ status: 'in_progress' });
        return {
          period,
          startDate: start,
          endDate: end,
          source: 'JobTread (QBO unavailable)',
          note: 'QuickBooks not connected — showing job cost estimates from JobTread',
          categories: [
            { name: 'Materials', estimate: 'Available via JobTread job costs' },
            { name: 'Labor', estimate: 'Available via JobTread time tracking' },
            { name: 'Subcontractors', estimate: 'Available via JobTread vendor bills' },
          ],
          activeJobCount: activeJobs.total,
          recommendation: 'Connect QuickBooks Online for detailed expense tracking by category',
        };
      } catch {
        return {
          period,
          error: 'Unable to fetch expense data',
          message: error.message,
          recommendation: 'Connect QuickBooks Online at /api/auth/quickbooks',
        };
      }
    }
  }

  // Get comprehensive cash position combining Plaid + JobTread + QBO
  private async getCashPosition() {
    const results: any = {
      retrievedAt: new Date().toISOString(),
      bankBalances: null,
      receivables: null,
      qboSummary: null,
    };

    // 1. Real-time bank balances from Plaid
    try {
      const plaid = getPlaidClient();
      const balances = await plaid.getBalances();
      const totalCash = balances.reduce((sum: number, acct: any) => {
        return sum + (acct.balances?.current || 0);
      }, 0);
      results.bankBalances = {
        accounts: balances.map((acct: any) => ({
          name: acct.name,
          institution: acct.institutionName,
          type: acct.subtype || acct.type,
          current: acct.balances?.current,
          available: acct.balances?.available,
        })),
        totalCash,
        source: 'Plaid (real-time)',
      };
    } catch (error: any) {
      results.bankBalances = { error: 'Plaid not connected', message: error.message };
    }

    // 2. Receivables from JobTread
    try {
      const invoices = await this.jobtread.getOutstandingInvoices();
      results.receivables = {
        totalOutstanding: invoices.totalDue,
        invoiceCount: invoices.invoices.length,
        overdueAmount: invoices.invoices
          .filter(inv => inv.dueDate && new Date(inv.dueDate) < new Date())
          .reduce((sum, inv) => sum + inv.amountDue, 0),
        source: 'JobTread',
      };
    } catch (error: any) {
      results.receivables = { error: 'JobTread unavailable', message: error.message };
    }

    // 3. QBO balance sheet snapshot
    try {
      const qbo = getQuickBooksClient();
      const balanceSheet = await qbo.getBalanceSheet();
      results.qboSummary = {
        source: 'QuickBooks Online',
        data: balanceSheet,
      };
    } catch (error: any) {
      results.qboSummary = { error: 'QBO not connected', message: error.message };
    }

    // Summary
    const cashOnHand = results.bankBalances?.totalCash || 0;
    const receivables = results.receivables?.totalOutstanding || 0;
    const overdueAR = results.receivables?.overdueAmount || 0;

    results.summary = {
      cashOnHand,
      totalReceivables: receivables,
      overdueReceivables: overdueAR,
      totalLiquidity: cashOnHand + receivables,
      healthAssessment: cashOnHand > 0 && overdueAR > cashOnHand * 0.5
        ? 'WARNING: Overdue receivables exceed 50% of cash on hand — prioritize collections'
        : cashOnHand > 0
          ? 'Cash position looks healthy'
          : 'Unable to determine cash position — connect bank accounts via Plaid',
    };

    return results;
  }

  // Create a new invoice
  private async createInvoice(
    jobId: string,
    amount: number,
    description?: string,
    dueInDays: number = 30
  ) {
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + dueInDays);

      const result = await this.jobtread.createInvoice({
        jobId,
        amount,
        dueDate: dueDate.toISOString(),
        items: description ? [{
          description,
          quantity: 1,
          unitPrice: amount,
        }] : undefined,
      });

      if (!result.success || !result.invoice) {
        return {
          success: false,
          error: result.error || 'Failed to create invoice',
        };
      }

      await this.logDecision(
        `Created invoice for job ${jobId}`,
        `Amount: $${amount}, Due: ${dueDate.toISOString().split('T')[0]}`,
        description,
      );

      return {
        success: true,
        invoiceId: result.invoice.id,
        amount,
        dueDate: dueDate.toISOString().split('T')[0],
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Automated task: Send reminders for overdue invoices
  async sendOverdueReminders(): Promise<{
    sent: number;
    failed: number;
    details: string[];
  }> {
    const details: string[] = [];
    let sent = 0;
    let failed = 0;

    try {
      const outstanding = await this.getOutstandingInvoices(true);

      if ('error' in outstanding) {
        return { sent: 0, failed: 0, details: [outstanding.error || 'Unknown error'] };
      }

      for (const invoice of outstanding.invoices) {
        if (invoice.daysPastDue >= 7) { // Only remind if 7+ days overdue
          const result = await this.sendPaymentReminder(invoice.id, 'email');

          if (result.success) {
            sent++;
            details.push(`Sent reminder for invoice ${invoice.number}: $${invoice.amountDue}`);
          } else {
            failed++;
            details.push(`Failed to send reminder for invoice ${invoice.number}: ${result.error}`);
          }
        }
      }
    } catch (error: any) {
      details.push(`Error: ${error.message}`);
    }

    return { sent, failed, details };
  }
}
