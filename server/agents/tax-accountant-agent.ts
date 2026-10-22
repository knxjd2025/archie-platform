import { BaseAgent, AgentConfig } from './base-agent';
import { getEvereeClient } from '../integrations/everee';
import { getQuickBooksClient } from '../integrations/quickbooks';
import { currentProfile } from '../tenant/context';
import {
  listFinancialDocuments,
  readPdfDocument,
  getFinancialsSummary,
} from '../services/financial-documents';

export class TaxAccountantAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super(config);
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
            description: 'Filter by folder name (e.g., "Federal Taxes", "State Taxes")',
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

    // Tool: Read any financial document
    this.registerTool({
      name: 'read_document',
      description: 'Read and extract text from any PDF document in the Financials folder',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Folder name (e.g., "Federal Taxes", "State Taxes", or a bank statement folder)',
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

    // Tool: Get tax filings
    this.registerTool({
      name: 'get_tax_filings',
      description: 'List and summarize filed tax returns including federal 941, 940, W3, and state filings',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year (e.g., "2025")',
          },
          level: {
            type: 'string',
            description: 'Federal or state filings',
            enum: ['federal', 'state', 'all'],
          },
        },
        required: ['year'],
      },
      execute: async (params) => {
        const level = params.level || 'all';
        const filings = listFinancialDocuments({ type: 'tax_filing', year: params.year });

        const federal = filings.filter(d =>
          d.folder === 'Federal Taxes' || d.name.includes('federal')
        );
        const state = filings.filter(d =>
          d.folder.includes('State Taxes') || d.name.includes('northcarolina')
        );

        const result: any = { year: params.year };

        if (level === 'federal' || level === 'all') {
          result.federal = {
            form941: federal.filter(d => d.name.includes('941') && !d.name.includes('941b')).map(d => ({
              name: d.name,
              date: d.date,
              quarter: d.name.match(/Q(\d)/)?.[1] || 'annual',
            })),
            form941b: federal.filter(d => d.name.includes('941b')).map(d => ({
              name: d.name,
              quarter: d.name.match(/Q(\d)/)?.[1],
            })),
            form940: federal.filter(d => d.name.includes('940') && !d.name.includes('941')).map(d => d.name),
            w3: federal.filter(d => d.name.includes('w3')).map(d => d.name),
          };
        }

        if (level === 'state' || level === 'all') {
          result.state = {
            state: currentProfile().state || 'not set in the company profile',
            sit: state.filter(d => d.name.includes('sit') || d.name.includes('nc-')).map(d => ({
              name: d.name,
              date: d.date,
            })),
            suta: state.filter(d => d.name.includes('suta')).map(d => ({
              name: d.name,
              date: d.date,
            })),
            w2: state.filter(d => d.name.includes('w2')).map(d => d.name),
            annualReconciliation: state.filter(d =>
              d.name.includes('annual') || d.name.includes('nc-3')
            ).map(d => d.name),
          };
        }

        return result;
      },
    });

    // Tool: Analyze 1099s
    this.registerTool({
      name: 'analyze_1099s',
      description: 'Parse and analyze 1099-NEC documents for contractor payments and reporting',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year (e.g., "2025")',
          },
        },
        required: ['year'],
      },
      execute: async (params) => {
        const docs = listFinancialDocuments({ type: '1099', year: params.year });

        const result: any = {
          year: params.year,
          documentsFound: docs.length,
          files: docs.map(d => ({
            name: d.name,
            folder: d.folder,
            date: d.date,
          })),
        };

        // Try to read the first 1099 file if it's a PDF (not ZIP)
        const pdfDocs = docs.filter(d => d.name.endsWith('.pdf'));
        if (pdfDocs.length > 0) {
          try {
            const text = await readPdfDocument(pdfDocs[0].path);
            result.sampleContent = text.slice(0, 2000);
          } catch (e) {
            result.parseNote = 'Could not extract 1099 PDF content';
          }
        }

        if (docs.some(d => d.name.endsWith('.zip'))) {
          result.note = 'Some 1099 documents are in ZIP format and need to be extracted first';
        }

        return result;
      },
    });

    // Tool: Calculate quarterly estimates (enhanced with Everee + QBO)
    this.registerTool({
      name: 'calculate_quarterly_estimates',
      description: 'Estimate quarterly tax liability using Everee payroll data, QBO financials, and prior filings',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year to estimate for',
          },
          quarter: {
            type: 'number',
            description: 'Quarter number (1-4)',
          },
        },
        required: ['year', 'quarter'],
      },
      execute: async (params) => {
        // Get prior year 941s for comparison
        const priorYear = String(parseInt(params.year) - 1);
        const priorFilings = listFinancialDocuments({
          type: 'tax_filing',
          year: priorYear,
        });

        const prior941s = priorFilings.filter(d =>
          d.name.includes('941') && !d.name.includes('941b')
        );

        // Get current year filings to see what's been filed
        const currentFilings = listFinancialDocuments({
          type: 'tax_filing',
          year: params.year,
        });

        const current941s = currentFilings.filter(d =>
          d.name.includes('941') && !d.name.includes('941b')
        );

        // Try to read the most recent 941 for actual numbers
        let recentData = null;
        const latestFiling = [...current941s, ...prior941s].pop();
        if (latestFiling) {
          try {
            const text = await readPdfDocument(latestFiling.path);
            recentData = text.slice(0, 2000);
          } catch (e) {
            // PDF parsing failed
          }
        }

        // Get Everee withholding data for current year
        let evereeWithholdings = null;
        try {
          const everee = getEvereeClient();
          evereeWithholdings = await everee.getTaxWithholdings(params.year);
        } catch {
          // Everee not connected
        }

        // Get QBO P&L for the quarter
        let qboPnL = null;
        try {
          const qbo = getQuickBooksClient();
          const quarterStart = getQuarterStartDate(params.year, params.quarter);
          const quarterEnd = getQuarterEndDate(params.year, params.quarter);
          qboPnL = await qbo.getProfitAndLoss(quarterStart, quarterEnd);
        } catch {
          // QBO not connected
        }

        return {
          year: params.year,
          quarter: params.quarter,
          priorYearFilings: prior941s.map(d => d.name),
          currentYearFilings: current941s.map(d => d.name),
          quartsFiled: current941s.length,
          recentFilingData: recentData,
          evereeWithholdings: evereeWithholdings
            ? { source: 'Everee', ...evereeWithholdings }
            : { note: 'Everee not connected — using PDF filings only' },
          qboProfitLoss: qboPnL
            ? { source: 'QuickBooks Online', ...qboPnL }
            : { note: 'QBO not connected' },
          deadlines: getQuarterlyDeadlines(params.year, params.quarter),
        };
      },
    });

    // Tool: Get deduction opportunities
    this.registerTool({
      name: 'get_deduction_opportunities',
      description: 'Identify potential tax deductions from expense categories and business activities',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year',
          },
        },
        required: ['year'],
      },
      execute: async (params) => {
        const summary = getFinancialsSummary();

        // Try to get QBO expense categories for real data
        let qboCategories = null;
        try {
          const qbo = getQuickBooksClient();
          const now = new Date();
          const startDate = `${params.year}-01-01`;
          const endDate = `${params.year}-12-31`;
          qboCategories = await qbo.getExpensesByCategory(startDate, endDate);
        } catch {
          // QBO not connected
        }

        return {
          year: params.year,
          availableData: summary,
          qboExpenseCategories: qboCategories,
          commonDeductions: [
            { category: 'Vehicle/Mileage', description: 'Business miles for job site visits, material runs', irsRate: '$0.70/mile (2025)' },
            { category: 'Materials & Supplies', description: 'Roofing materials, tools, safety equipment', source: 'JobTread job costs' },
            { category: 'Subcontractor Payments', description: '1099-NEC payments to subcontractors', source: '1099 filings' },
            { category: 'Insurance', description: 'General liability, workers comp, vehicle insurance', source: 'Bank statements' },
            { category: 'Office & Admin', description: 'Software subscriptions, office supplies, phone', source: 'Bank statements' },
            { category: 'Marketing', description: 'Advertising, website, lead generation services', source: 'Bank statements' },
            { category: 'Payroll Taxes', description: 'Employer portion of FICA, FUTA, SUTA', source: '941/940 filings' },
            { category: 'Equipment Depreciation', description: 'Section 179 or MACRS for equipment, trucks', source: 'Fixed asset register' },
          ],
          recommendation: qboCategories
            ? 'QuickBooks expense data available — cross-reference categories with deductible items above.'
            : 'Review bank statements for recurring business expenses that may be categorized as deductions. Cross-reference with JobTread job costs for materials and subcontractor payments.',
        };
      },
    });

    // Tool: Get payroll data from Everee
    this.registerTool({
      name: 'get_payroll_data',
      description: 'Get payroll run history and details from Everee',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date for payroll runs (YYYY-MM-DD)',
          },
          endDate: {
            type: 'string',
            description: 'End date for payroll runs (YYYY-MM-DD)',
          },
        },
      },
      execute: async (params) => {
        try {
          const everee = getEvereeClient();
          const runs = await everee.getPayrollRuns({
            startDate: params.startDate,
            endDate: params.endDate,
          });
          return { source: 'Everee', ...runs };
        } catch (error: any) {
          return { error: 'Unable to fetch payroll data from Everee', message: error.message };
        }
      },
    });

    // Tool: Get worker pay details from Everee
    this.registerTool({
      name: 'get_worker_pay_details',
      description: 'Get detailed pay statements for a specific worker from Everee, including deductions and tax withholdings',
      parameters: {
        type: 'object',
        properties: {
          workerId: {
            type: 'string',
            description: 'Everee worker ID',
          },
          startDate: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD)',
          },
          endDate: {
            type: 'string',
            description: 'End date (YYYY-MM-DD)',
          },
        },
        required: ['workerId'],
      },
      execute: async (params) => {
        try {
          const everee = getEvereeClient();
          const statements = await everee.getPayStatements(params.workerId, {
            startDate: params.startDate,
            endDate: params.endDate,
          });
          return { source: 'Everee', ...statements };
        } catch (error: any) {
          return { error: 'Unable to fetch pay details from Everee', message: error.message };
        }
      },
    });

    // Tool: Get tax withholdings summary from Everee
    this.registerTool({
      name: 'get_tax_withholdings_summary',
      description: 'Get a summary of all federal and state tax withholdings from Everee payroll data',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year (e.g., "2025")',
          },
        },
        required: ['year'],
      },
      execute: async (params) => {
        try {
          const everee = getEvereeClient();
          const withholdings = await everee.getTaxWithholdings(params.year);
          return { source: 'Everee', year: params.year, ...withholdings };
        } catch (error: any) {
          return { error: 'Unable to fetch tax withholdings from Everee', message: error.message };
        }
      },
    });

    // Tool: Get expense categories from QuickBooks
    this.registerTool({
      name: 'get_expense_categories',
      description: 'Get expenses grouped by category from QuickBooks Online for tax deduction analysis',
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
          const expenses = await qbo.getExpensesByCategory(params.startDate, params.endDate);
          return { source: 'QuickBooks Online', ...expenses };
        } catch (error: any) {
          return { error: 'Unable to fetch expense categories from QuickBooks', message: error.message };
        }
      },
    });
  }
}

function getQuarterlyDeadlines(year: string, quarter: number) {
  const deadlines: Record<number, string> = {
    1: `April 30, ${year}`,
    2: `July 31, ${year}`,
    3: `October 31, ${year}`,
    4: `January 31, ${parseInt(year) + 1}`,
  };

  return {
    form941Due: deadlines[quarter] || 'Unknown',
    estimatedTaxDue: deadlines[quarter] || 'Unknown',
    ncWithholdingDue: deadlines[quarter] || 'Unknown',
  };
}

function getQuarterStartDate(year: string, quarter: number): string {
  const months: Record<number, string> = { 1: '01', 2: '04', 3: '07', 4: '10' };
  return `${year}-${months[quarter] || '01'}-01`;
}

function getQuarterEndDate(year: string, quarter: number): string {
  const ends: Record<number, string> = {
    1: `${year}-03-31`,
    2: `${year}-06-30`,
    3: `${year}-09-30`,
    4: `${year}-12-31`,
  };
  return ends[quarter] || `${year}-12-31`;
}
