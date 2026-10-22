import { BaseAgent, AgentConfig } from './base-agent';
import { getEvereeClient } from '../integrations/everee';
import { currentProfile } from '../tenant/context';
import {
  listFinancialDocuments,
  readPdfDocument,
  getFinancialsSummary,
} from '../services/financial-documents';

export class TaxLawyerAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super(config);
  }

  protected registerTools(): void {
    // Tool: List financial documents
    this.registerTool({
      name: 'list_financial_documents',
      description: 'List available financial documents from the Financials folder',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Filter by folder name',
          },
          type: {
            type: 'string',
            description: 'Filter by document type',
            enum: ['bank_statement', 'tax_filing', 'w2', '1099', 'other'],
          },
          year: {
            type: 'string',
            description: 'Filter by year',
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

    // Tool: Review compliance
    this.registerTool({
      name: 'review_compliance',
      description: 'Check tax filing compliance against federal and state deadlines and requirements for a given year',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year to review (e.g., "2025")',
          },
        },
        required: ['year'],
      },
      execute: async (params) => {
        const allFilings = listFinancialDocuments({ type: 'tax_filing', year: params.year });
        const w2s = listFinancialDocuments({ type: 'w2', year: params.year });
        const necs = listFinancialDocuments({ type: '1099', year: params.year });

        const federal = allFilings.filter(d => d.folder === 'Federal Taxes' || d.name.includes('federal'));
        const state = allFilings.filter(d => d.folder.includes('State') || d.name.includes('northcarolina'));

        const year = parseInt(params.year);
        const issues: string[] = [];
        const compliant: string[] = [];

        // Check federal quarterly 941s
        for (let q = 1; q <= 4; q++) {
          const filed = federal.some(d => d.name.includes(`Q${q}_${params.year}`) && d.name.includes('941') && !d.name.includes('941b'));
          if (filed) {
            compliant.push(`Federal 941 Q${q} ${params.year}: Filed`);
          } else {
            issues.push(`Federal 941 Q${q} ${params.year}: NOT FOUND - may be missing`);
          }
        }

        // Check annual 940
        const has940 = federal.some(d => d.name.includes('940') && !d.name.includes('941'));
        if (has940) {
          compliant.push(`Federal 940 ${params.year}: Filed`);
        } else {
          issues.push(`Federal 940 ${params.year}: NOT FOUND`);
        }

        // Check W3
        const hasW3 = federal.some(d => d.name.includes('w3'));
        if (hasW3) {
          compliant.push(`W-3 Transmittal ${params.year}: Filed`);
        } else {
          issues.push(`W-3 Transmittal ${params.year}: NOT FOUND`);
        }

        // Check W2s
        if (w2s.length > 0) {
          compliant.push(`W-2s ${params.year}: ${w2s.length} file(s) found`);
        } else {
          issues.push(`W-2s ${params.year}: NOT FOUND`);
        }

        // Check 1099-NECs
        if (necs.length > 0) {
          compliant.push(`1099-NECs ${params.year}: ${necs.length} file(s) found`);
        } else {
          issues.push(`1099-NECs ${params.year}: NOT FOUND - check if subcontractors were paid`);
        }

        // Check state quarterly filings (the company's state, from its profile)
        const st = currentProfile().state || 'State';
        for (let q = 1; q <= 4; q++) {
          const hasSIT = state.some(d => d.name.includes(`Q${q}_${params.year}`) && d.name.includes('sit'));
          const hasSUTA = state.some(d => d.name.includes(`Q${q}_${params.year}`) && d.name.includes('suta'));

          if (hasSIT) compliant.push(`${st} SIT Q${q}: Filed`);
          else issues.push(`${st} State Income Tax Q${q}: NOT FOUND`);

          if (hasSUTA) compliant.push(`${st} SUTA Q${q}: Filed`);
          else issues.push(`${st} Unemployment (SUTA) Q${q}: NOT FOUND`);
        }

        return {
          year: params.year,
          overallStatus: issues.length === 0 ? 'COMPLIANT' : `${issues.length} ISSUE(S) FOUND`,
          compliantItems: compliant,
          issues,
          recommendations: issues.length > 0
            ? ['Review missing filings with tax accountant', 'Verify if filings exist but are not in the Financials folder', 'Check filing deadlines to determine if late penalties may apply']
            : ['All filings appear to be present', 'Consider annual compliance review with tax professional'],
        };
      },
    });

    // Tool: Assess contractor risk (enhanced with Everee worker data)
    this.registerTool({
      name: 'assess_contractor_risk',
      description: 'Review 1099 vs W2 worker classification using Everee payroll data and financial documents to assess misclassification risk',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year to review',
          },
        },
        required: ['year'],
      },
      execute: async (params) => {
        const necs = listFinancialDocuments({ type: '1099', year: params.year });
        const w2s = listFinancialDocuments({ type: 'w2', year: params.year });

        // Get Everee worker data for real classification info
        let evereeWorkers = null;
        try {
          const everee = getEvereeClient();
          const employees = await everee.getWorkers({ type: 'employee' });
          const contractors = await everee.getWorkers({ type: 'contractor' });
          evereeWorkers = {
            source: 'Everee',
            employees: employees,
            contractors: contractors,
          };
        } catch {
          // Everee not connected
        }

        return {
          year: params.year,
          filingDocuments: {
            w2Employees: w2s.length > 0 ? `${w2s.length} W-2 file(s) found` : 'No W-2s found',
            contractors1099: necs.length > 0 ? `${necs.length} 1099-NEC file(s) found` : 'No 1099-NECs found',
          },
          evereeWorkerData: evereeWorkers || { note: 'Everee not connected — using document filings only' },
          riskFactors: [
            {
              factor: 'Behavioral Control',
              question: 'Does the company control how the worker performs the job?',
              risk: 'If yes, worker may be an employee, not a contractor',
            },
            {
              factor: 'Financial Control',
              question: 'Does the worker have unreimbursed business expenses?',
              risk: 'Employees typically have expenses reimbursed',
            },
            {
              factor: 'Relationship Type',
              question: 'Is there a written contract? Employee benefits provided?',
              risk: 'Written contracts and lack of benefits suggest contractor status',
            },
            {
              factor: 'Industry Standard',
              question: 'In roofing, are subcontractors common for similar work?',
              risk: 'Industry practice supports contractor classification for subs',
            },
          ],
          irsGuidance: 'IRS uses a 20-factor test for worker classification. Key: Control over how work is done determines status.',
          penalties: {
            misclassification: 'Employer portion of FICA (7.65%) + interest + penalties',
            willful: 'Up to $50 per unfiled W-2, plus 100% of unpaid FICA',
            state: 'State penalties may also apply; check your state revenue and employment departments',
          },
          recommendation: 'For roofing subcontractors: Ensure each has their own insurance, tools, and serves multiple clients. Keep signed subcontractor agreements on file.',
        };
      },
    });

    // Tool: Get audit readiness
    this.registerTool({
      name: 'get_audit_readiness',
      description: 'Score the business audit preparedness based on available documentation',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'string',
            description: 'Tax year to assess',
          },
        },
        required: ['year'],
      },
      execute: async (params) => {
        const summary = getFinancialsSummary();
        const filings = listFinancialDocuments({ type: 'tax_filing', year: params.year });
        const statements = listFinancialDocuments({ type: 'bank_statement', year: params.year });
        const w2s = listFinancialDocuments({ type: 'w2', year: params.year });
        const necs = listFinancialDocuments({ type: '1099', year: params.year });

        let score = 0;
        const maxScore = 10;
        const checklist: { item: string; status: 'pass' | 'fail' | 'partial'; points: number }[] = [];

        // Bank statements (2 points)
        if (statements.length >= 12) {
          score += 2;
          checklist.push({ item: 'Complete bank statements for the year', status: 'pass', points: 2 });
        } else if (statements.length > 0) {
          score += 1;
          checklist.push({ item: `Bank statements: ${statements.length}/12 months`, status: 'partial', points: 1 });
        } else {
          checklist.push({ item: 'Bank statements', status: 'fail', points: 0 });
        }

        // Federal quarterly filings (2 points)
        const q941Count = filings.filter(d => d.name.includes('941') && !d.name.includes('941b')).length;
        if (q941Count >= 4) {
          score += 2;
          checklist.push({ item: 'All quarterly 941s filed', status: 'pass', points: 2 });
        } else {
          score += q941Count > 0 ? 1 : 0;
          checklist.push({ item: `Quarterly 941s: ${q941Count}/4`, status: q941Count > 0 ? 'partial' : 'fail', points: q941Count > 0 ? 1 : 0 });
        }

        // Annual filings (2 points)
        const has940 = filings.some(d => d.name.includes('940') && !d.name.includes('941'));
        const hasW3 = filings.some(d => d.name.includes('w3'));
        if (has940 && hasW3) {
          score += 2;
          checklist.push({ item: 'Annual 940 and W-3 filed', status: 'pass', points: 2 });
        } else {
          score += (has940 ? 1 : 0);
          checklist.push({ item: `Annual filings: 940=${has940 ? 'yes' : 'no'}, W-3=${hasW3 ? 'yes' : 'no'}`, status: 'partial', points: has940 ? 1 : 0 });
        }

        // W2s and 1099s (2 points)
        if (w2s.length > 0 && necs.length > 0) {
          score += 2;
          checklist.push({ item: 'W-2s and 1099-NECs available', status: 'pass', points: 2 });
        } else if (w2s.length > 0 || necs.length > 0) {
          score += 1;
          checklist.push({ item: `W-2s: ${w2s.length > 0 ? 'yes' : 'no'}, 1099s: ${necs.length > 0 ? 'yes' : 'no'}`, status: 'partial', points: 1 });
        } else {
          checklist.push({ item: 'W-2s and 1099-NECs', status: 'fail', points: 0 });
        }

        // State filings (2 points)
        const stateFilings = filings.filter(d => d.folder.includes('State') || d.name.includes('northcarolina'));
        const st = currentProfile().state ? `${currentProfile().state} state` : 'State';
        if (stateFilings.length >= 4) {
          score += 2;
          checklist.push({ item: `${st} filings present`, status: 'pass', points: 2 });
        } else if (stateFilings.length > 0) {
          score += 1;
          checklist.push({ item: `${st} filings: ${stateFilings.length} found`, status: 'partial', points: 1 });
        } else {
          checklist.push({ item: `${st} filings`, status: 'fail', points: 0 });
        }

        const rating = score >= 9 ? 'Excellent' : score >= 7 ? 'Good' : score >= 5 ? 'Fair' : 'Needs Attention';

        return {
          year: params.year,
          score: `${score}/${maxScore}`,
          rating,
          checklist,
          missingItems: checklist.filter(c => c.status !== 'pass').map(c => c.item),
          retentionNote: 'IRS recommends keeping tax records for at least 3 years from filing date. Employment tax records should be kept for at least 4 years.',
        };
      },
    });

    // Tool: Review state filings
    this.registerTool({
      name: 'review_state_filings',
      description: "Review the company's state tax filings (state income tax withholding and unemployment insurance) for compliance",
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
        const stateFilings = listFinancialDocuments({ year: params.year });
        const ncFilings = stateFilings.filter(d =>
          d.folder.includes('State Taxes') || d.name.includes('northcarolina')
        );

        const sit = ncFilings.filter(d => d.name.includes('sit') || d.name.includes('nc-'));
        const suta = ncFilings.filter(d => d.name.includes('suta'));
        const w2State = ncFilings.filter(d => d.name.includes('w2'));
        const annual = ncFilings.filter(d => d.name.includes('annual') || d.name.includes('nc-3'));

        // Try to read the most recent filing
        let recentContent = null;
        const latest = [...sit, ...suta].pop();
        if (latest) {
          try {
            recentContent = (await readPdfDocument(latest.path)).slice(0, 2000);
          } catch (e) {
            // PDF parsing failed
          }
        }

        // The state's filing rules are built in for North Carolina only; for any
        // other state, say so rather than quote NC forms as if they applied.
        const state = currentProfile().state;
        const isNC = state === 'NC';
        return {
          year: params.year,
          state: state || 'not set in the company profile',
          filings: {
            stateIncomeTax: sit.map(d => ({ name: d.name, date: d.date })),
            unemployment: suta.map(d => ({ name: d.name, date: d.date })),
            stateW2: w2State.map(d => d.name),
            annualReconciliation: annual.map(d => d.name),
          },
          requirements: isNC
            ? {
              ncSIT: 'NC-5 or NC-5Q filed quarterly for state income tax withholding',
              ncSUTA: 'NCUI 101 filed quarterly for unemployment insurance',
              ncAnnual: 'NC-3 annual withholding reconciliation due by January 31',
              ncW2: 'State W-2 copies filed with NC Department of Revenue',
            }
            : { note: `State-specific forms and deadlines are built in for North Carolina only. Check ${state || "the company's state"} revenue department (withholding) and employment security agency (unemployment insurance) for its forms and due dates.` },
          recentFilingContent: recentContent,
          ...(isNC ? {
            ncResources: {
              sit: 'NC Department of Revenue - ncdor.gov',
              suta: 'NC Division of Employment Security - des.nc.gov',
            },
          } : {}),
        };
      },
    });

    // Tool: Get worker classifications from Everee
    this.registerTool({
      name: 'get_worker_classifications',
      description: 'Get a list of all workers and their classifications (employee vs contractor) from Everee payroll system',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Filter by worker type',
            enum: ['employee', 'contractor', 'all'],
          },
        },
      },
      execute: async (params) => {
        try {
          const everee = getEvereeClient();
          const filterType = params.type === 'all' ? undefined : params.type as 'employee' | 'contractor' | undefined;
          const workers = await everee.getWorkers(filterType ? { type: filterType } : undefined);
          return { source: 'Everee', ...workers };
        } catch (error: any) {
          return { error: 'Unable to fetch worker data from Everee', message: error.message };
        }
      },
    });

    // Tool: Get worker payment history from Everee
    this.registerTool({
      name: 'get_worker_payment_history',
      description: 'Get payment history for a specific worker from Everee, useful for verifying 1099/W2 amounts and classification consistency',
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
          const [workerDetails, payStatements] = await Promise.all([
            everee.getWorker(params.workerId),
            everee.getPayStatements(params.workerId, {
              startDate: params.startDate,
              endDate: params.endDate,
            }),
          ]);
          return {
            source: 'Everee',
            worker: workerDetails,
            payStatements,
          };
        } catch (error: any) {
          return { error: 'Unable to fetch worker payment history from Everee', message: error.message };
        }
      },
    });
  }
}
