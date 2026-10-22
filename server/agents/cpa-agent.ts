import { BaseAgent, AgentConfig } from './base-agent';
import { JobTreadClient } from '../integrations/jobtread';
import { getQuickBooksClient } from '../integrations/quickbooks';
import { getPlaidClient } from '../integrations/plaid-client';
import {
  listFinancialDocuments,
  readPdfDocument,
  getFinancialsSummary,
} from '../services/financial-documents';

export class CPAAgent extends BaseAgent {
  private jobtread: JobTreadClient;

  constructor(config: AgentConfig) {
    super(config);
    this.jobtread = new JobTreadClient();
  }

  protected registerTools(): void {
    // Tool: List financial documents
    this.registerTool({
      name: 'list_financial_documents',
      description: 'List available financial documents (bank statements, W2s, 1099s, tax filings) from the Financials folder',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Filter by folder name (e.g., "Bank Statements US BANK", "First Bank", "Federal Taxes", "State Taxes")',
          },
          type: {
            type: 'string',
            description: 'Filter by document type',
            enum: ['bank_statement', 'tax_filing', 'w2', '1099', 'other'],
          },
          year: {
            type: 'string',
            description: 'Filter by year (e.g., "2025")',
          },
        },
      },
      execute: async (params) => {
        const docs = listFinancialDocuments({
          folder: params.folder,
          type: params.type,
          year: params.year,
        });
        return {
          count: docs.length,
          documents: docs.map(d => ({
            name: d.name,
            folder: d.folder,
            date: d.date,
            type: d.type,
          })),
        };
      },
    });

    // Tool: Analyze bank statement
    this.registerTool({
      name: 'analyze_bank_statement',
      description: 'Read and analyze a specific bank statement PDF to extract transactions, balances, and financial data',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Which bank folder ("Bank Statements US BANK" or "First Bank")',
          },
          date: {
            type: 'string',
            description: 'Statement date to look for (e.g., "2025-12" for December 2025)',
          },
        },
        required: ['folder'],
      },
      execute: async (params) => {
        const docs = listFinancialDocuments({
          folder: params.folder,
          type: 'bank_statement',
        });

        let target = docs[docs.length - 1]; // Default to most recent
        if (params.date) {
          const match = docs.find(d => d.date?.startsWith(params.date));
          if (match) target = match;
        }

        if (!target) {
          return { error: 'No bank statement found matching criteria' };
        }

        try {
          const text = await readPdfDocument(target.path);
          return {
            document: target.name,
            date: target.date,
            contentPreview: text.slice(0, 3000),
            fullLength: text.length,
          };
        } catch (e: any) {
          return { error: `Failed to read PDF: ${e.message}`, document: target.name };
        }
      },
    });

    // Tool: Read any financial document
    this.registerTool({
      name: 'read_document',
      description: 'Read and extract text from any PDF document in the Financials folder (bank statements, tax filings, W2s, 1099s)',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Folder name (e.g., "Federal Taxes", "State Taxes", "Bank Statements US BANK", "First Bank")',
          },
          filename: {
            type: 'string',
            description: 'Exact or partial filename to search for',
          },
        },
        required: ['folder', 'filename'],
      },
      execute: async (params) => {
        const docs = listFinancialDocuments({ folder: params.folder });
        const target = docs.find(d =>
          d.name.toLowerCase().includes(params.filename.toLowerCase())
        );

        if (!target) {
          return {
            error: `No document found matching "${params.filename}" in ${params.folder}`,
            available: docs.map(d => d.name),
          };
        }

        if (target.name.endsWith('.zip')) {
          return {
            document: target.name,
            note: 'ZIP files cannot be read directly. Extract the ZIP to access individual documents.',
          };
        }

        try {
          const text = await readPdfDocument(target.path);
          return {
            document: target.name,
            folder: target.folder,
            date: target.date,
            type: target.type,
            content: text.slice(0, 4000),
            fullLength: text.length,
            truncated: text.length > 4000,
          };
        } catch (e: any) {
          return { error: `Failed to read PDF: ${e.message}`, document: target.name };
        }
      },
    });

    // Tool: Get payroll summary
    this.registerTool({
      name: 'get_payroll_summary',
      description: 'Analyze W2 and payroll tax documents to summarize employee compensation and tax withholdings',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year to analyze (e.g., "2025")',
          },
        },
        required: ['year'],
      },
      execute: async (params) => {
        const w2s = listFinancialDocuments({ type: 'w2', year: params.year });
        const taxFilings = listFinancialDocuments({ type: 'tax_filing', year: params.year });

        const w3Docs = taxFilings.filter(d => d.name.includes('w3'));
        const form940 = taxFilings.filter(d => d.name.includes('940') && !d.name.includes('941'));
        const form941 = taxFilings.filter(d => d.name.includes('941') && !d.name.includes('941b'));

        const results: any = {
          year: params.year,
          w2Files: w2s.map(d => d.name),
          w3Files: w3Docs.map(d => d.name),
          form940: form940.map(d => d.name),
          form941Quarterly: form941.map(d => ({ name: d.name, date: d.date })),
        };

        // Try to read the W3 summary if available
        if (w3Docs.length > 0) {
          try {
            const text = await readPdfDocument(w3Docs[0].path);
            results.w3Summary = text.slice(0, 2000);
          } catch (e) {
            results.w3Note = 'Could not parse W3 PDF';
          }
        }

        return results;
      },
    });

    // Tool: Reconcile accounts (enhanced with Plaid + QBO, PDF fallback)
    this.registerTool({
      name: 'reconcile_accounts',
      description: 'Compare bank transactions (Plaid or PDF statements) with JobTread invoices and QBO records to identify discrepancies',
      parameters: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            description: 'Month to reconcile (e.g., "2025-12")',
          },
          bank: {
            type: 'string',
            description: 'Which bank to reconcile',
            enum: ['US Bank', 'First Bank'],
          },
        },
        required: ['month'],
      },
      execute: async (params) => {
        const result: any = {
          period: params.month,
          bank: params.bank || 'US Bank',
          sources: [],
        };

        // 1. Try Plaid transactions first (preferred — structured data)
        try {
          const plaid = getPlaidClient();
          const [year, monthStr] = params.month.split('-');
          const startDate = `${params.month}-01`;
          const lastDay = new Date(parseInt(year), parseInt(monthStr), 0).getDate();
          const endDate = `${params.month}-${lastDay}`;

          await plaid.syncTransactions();
          const transactions = await plaid.getTransactions({ startDate, endDate });
          const deposits = transactions.filter((t: any) => t.amount < 0); // Plaid: negative = income
          const expenses = transactions.filter((t: any) => t.amount > 0);

          result.plaidTransactions = {
            totalTransactions: transactions.length,
            deposits: deposits.length,
            totalDeposits: Math.abs(deposits.reduce((s: number, t: any) => s + t.amount, 0)),
            expenses: expenses.length,
            totalExpenses: expenses.reduce((s: number, t: any) => s + t.amount, 0),
          };
          result.sources.push('Plaid');
        } catch {
          // Plaid not available — fall back to PDF statement
          const folder = params.bank === 'First Bank' ? 'First Bank' : 'Bank Statements US BANK';
          const statements = listFinancialDocuments({ folder, type: 'bank_statement' });
          const statement = statements.find(d => d.date?.startsWith(params.month));

          if (statement) {
            try {
              const text = await readPdfDocument(statement.path);
              result.pdfStatement = {
                name: statement.name,
                date: statement.date,
                contentPreview: text.slice(0, 2000),
              };
              result.sources.push('PDF Statement');
            } catch {
              result.pdfStatement = { note: 'Could not parse statement PDF' };
            }
          } else {
            result.pdfStatement = { note: 'No PDF statement found for this period' };
          }
        }

        // 2. JobTread invoices
        try {
          const invoiceData = await this.jobtread.getInvoices({ limit: 100 });
          result.jobtreadInvoices = {
            count: invoiceData.invoices?.length || 0,
          };
          result.sources.push('JobTread');
        } catch {
          result.jobtreadInvoices = { note: 'JobTread data unavailable' };
        }

        // 3. QBO expenses for cross-reference
        try {
          const qbo = getQuickBooksClient();
          const [year, monthStr] = params.month.split('-');
          const startDate = `${params.month}-01`;
          const lastDay = new Date(parseInt(year), parseInt(monthStr), 0).getDate();
          const endDate = `${params.month}-${lastDay}`;
          const expenses = await qbo.getExpenses({ startDate, endDate });
          result.qboExpenses = { source: 'QuickBooks Online', ...expenses };
          result.sources.push('QuickBooks');
        } catch {
          result.qboExpenses = { note: 'QBO not connected' };
        }

        result.reconciliationNote = result.sources.length >= 2
          ? `Cross-referencing data from: ${result.sources.join(', ')}`
          : 'Limited data sources available — connect Plaid and QuickBooks for full reconciliation';

        return result;
      },
    });

    // Tool: Get financial overview
    this.registerTool({
      name: 'get_financial_overview',
      description: 'Get a high-level overview of all available financial data including document counts, date ranges, and summary',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const summary = getFinancialsSummary();

        let jobtreadSummary;
        try {
          const jobs = await this.jobtread.getJobs({});
          const invoices = await this.jobtread.getOutstandingInvoices();
          jobtreadSummary = {
            totalJobs: jobs.total,
            outstandingInvoices: invoices.invoices?.length || 0,
            totalOutstanding: invoices.totalDue || 0,
          };
        } catch (e) {
          jobtreadSummary = { note: 'JobTread data unavailable' };
        }

        return {
          financialDocuments: summary,
          jobtread: jobtreadSummary,
        };
      },
    });

    // Tool: Get bank transactions from Plaid (cached)
    this.registerTool({
      name: 'get_bank_transactions',
      description: 'Get bank transactions from linked bank accounts via Plaid. Reads from locally cached data for fast queries.',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD)',
          },
          endDate: {
            type: 'string',
            description: 'End date (YYYY-MM-DD)',
          },
          accountId: {
            type: 'string',
            description: 'Filter by specific account ID',
          },
        },
      },
      execute: async (params) => {
        try {
          const plaid = getPlaidClient();
          // First sync to ensure we have latest data
          await plaid.syncTransactions();
          const transactions = await plaid.getTransactions({
            startDate: params.startDate,
            endDate: params.endDate,
            accountId: params.accountId,
          });
          return {
            source: 'Plaid (cached)',
            count: transactions.length,
            transactions: transactions.slice(0, 50).map((t: any) => ({
              date: t.date,
              name: t.name,
              merchantName: t.merchantName,
              amount: t.amount,
              category: t.category,
              pending: t.pending,
              accountId: t.accountId,
            })),
            truncated: transactions.length > 50,
            totalAmount: transactions.reduce((sum: number, t: any) => sum + (t.amount || 0), 0),
          };
        } catch (error: any) {
          return { error: 'Unable to fetch bank transactions from Plaid', message: error.message };
        }
      },
    });

    // Tool: Get real-time bank balances (Plaid)
    this.registerTool({
      name: 'get_real_time_balances',
      description: 'Get real-time bank account balances from all linked banks via Plaid',
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
            source: 'Plaid (real-time)',
            banks: banks.map((b: any) => b.institutionName),
            accounts: balances.map((a: any) => ({
              name: a.name,
              institution: a.institutionName,
              type: a.subtype || a.type,
              current: a.balances?.current,
              available: a.balances?.available,
            })),
            totalCash: balances.reduce((sum: number, a: any) => sum + (a.balances?.current || 0), 0),
            retrievedAt: new Date().toISOString(),
          };
        } catch (error: any) {
          return { error: 'Unable to fetch balances from Plaid', message: error.message };
        }
      },
    });

    // Tool: Get QBO expenses
    this.registerTool({
      name: 'get_qbo_expenses',
      description: 'Get expense records from QuickBooks Online for a date range',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD)',
          },
          endDate: {
            type: 'string',
            description: 'End date (YYYY-MM-DD)',
          },
        },
      },
      execute: async (params) => {
        try {
          const qbo = getQuickBooksClient();
          const expenses = await qbo.getExpenses({
            startDate: params.startDate,
            endDate: params.endDate,
          });
          return { source: 'QuickBooks Online', ...expenses };
        } catch (error: any) {
          return { error: 'Unable to fetch expenses from QuickBooks', message: error.message };
        }
      },
    });

    // Tool: Get QBO chart of accounts
    this.registerTool({
      name: 'get_qbo_chart_of_accounts',
      description: 'Get the full Chart of Accounts from QuickBooks Online',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          const qbo = getQuickBooksClient();
          const accounts = await qbo.getChartOfAccounts();
          return { source: 'QuickBooks Online', ...accounts };
        } catch (error: any) {
          return { error: 'Unable to fetch chart of accounts from QuickBooks', message: error.message };
        }
      },
    });
  }
}
