// Everee REST API client for payroll data
// Docs: https://developer.everee.com

import { fetchWithTimeout } from '../lib/fetch-timeout';
import { assertEnvCredentials } from '../tenant/per-company';

const EVEREE_BASE_URL = process.env.EVEREE_ENVIRONMENT === 'production'
  ? 'https://api.everee.com'
  : 'https://api.gusto-demo.com'; // Use sandbox by default

export interface EvereeWorker {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  type: 'employee' | 'contractor';
  status: string;
  startDate?: string;
  terminationDate?: string;
  department?: string;
  jobTitle?: string;
}

export interface EvereePayStatement {
  id: string;
  workerId: string;
  workerName: string;
  payDate: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  grossPay: number;
  netPay: number;
  totalHours?: number;
  deductions: Array<{ type: string; amount: number }>;
  taxes: Array<{ type: string; amount: number; employerPortion?: number }>;
}

export interface EvereePayrollRun {
  id: string;
  payDate: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  status: string;
  totalGross: number;
  totalNet: number;
  totalTaxes: number;
  totalEmployerTaxes: number;
  workerCount: number;
}

export interface EvereeTaxWithholding {
  taxType: string;
  description: string;
  totalWithheld: number;
  employerPortion: number;
  period: string;
}

export class EvereeClient {
  private apiKey: string;
  private baseUrl: string;
  private available: boolean;

  constructor() {
    this.apiKey = process.env.EVEREE_API_KEY || '';
    this.baseUrl = EVEREE_BASE_URL;
    this.available = !!this.apiKey;

    if (!this.available) {
      console.warn('EVEREE_API_KEY not set - Everee integration will be limited');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    assertEnvCredentials('Everee');
    if (!this.available) {
      throw new Error('Everee not configured - set EVEREE_API_KEY');
    }

    const url = `${this.baseUrl}${endpoint}`;
    // Bounded: an Everee call that hangs would otherwise hold the payroll
    // screen (and the serverless function) open until Vercel killed it.
    const response = await fetchWithTimeout(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Everee API Error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  // ===== Workers =====

  async getWorkers(params?: {
    type?: 'employee' | 'contractor';
  }): Promise<EvereeWorker[]> {
    try {
      const data = await this.request<any>('/v1/workers');
      let workers: EvereeWorker[] = (data.workers || data || []).map((w: any) => ({
        id: w.id || w.uuid,
        firstName: w.first_name || w.firstName || '',
        lastName: w.last_name || w.lastName || '',
        email: w.email,
        type: w.worker_type === '1099' || w.type === 'contractor' ? 'contractor' : 'employee',
        status: w.status || 'active',
        startDate: w.start_date || w.startDate,
        terminationDate: w.termination_date || w.terminationDate,
        department: w.department,
        jobTitle: w.job_title || w.jobTitle,
      }));

      if (params?.type) {
        workers = workers.filter((w) => w.type === params.type);
      }

      return workers;
    } catch (error: any) {
      if (!this.available) return [];
      throw error;
    }
  }

  async getWorker(workerId: string): Promise<EvereeWorker> {
    const data = await this.request<any>(`/v1/workers/${workerId}`);
    const w = data.worker || data;
    return {
      id: w.id || w.uuid,
      firstName: w.first_name || w.firstName || '',
      lastName: w.last_name || w.lastName || '',
      email: w.email,
      type: w.worker_type === '1099' || w.type === 'contractor' ? 'contractor' : 'employee',
      status: w.status || 'active',
      startDate: w.start_date || w.startDate,
      terminationDate: w.termination_date || w.terminationDate,
      department: w.department,
      jobTitle: w.job_title || w.jobTitle,
    };
  }

  // ===== Pay Statements =====

  async getPayStatements(
    workerId: string,
    params?: { startDate?: string; endDate?: string }
  ): Promise<EvereePayStatement[]> {
    let endpoint = `/v1/workers/${workerId}/pay-statements`;
    const queryParams: string[] = [];
    if (params?.startDate) queryParams.push(`start_date=${params.startDate}`);
    if (params?.endDate) queryParams.push(`end_date=${params.endDate}`);
    if (queryParams.length) endpoint += `?${queryParams.join('&')}`;

    const data = await this.request<any>(endpoint);
    return (data.pay_statements || data || []).map((ps: any) => ({
      id: ps.id || ps.uuid,
      workerId,
      workerName: `${ps.worker_first_name || ''} ${ps.worker_last_name || ''}`.trim(),
      payDate: ps.pay_date || ps.payDate,
      payPeriodStart: ps.pay_period_start || ps.payPeriodStart,
      payPeriodEnd: ps.pay_period_end || ps.payPeriodEnd,
      grossPay: Number(ps.gross_pay || ps.grossPay || 0),
      netPay: Number(ps.net_pay || ps.netPay || 0),
      totalHours: ps.total_hours ? Number(ps.total_hours) : undefined,
      deductions: (ps.deductions || []).map((d: any) => ({
        type: d.type || d.name || 'Unknown',
        amount: Number(d.amount || 0),
      })),
      taxes: (ps.taxes || []).map((t: any) => ({
        type: t.type || t.name || 'Unknown',
        amount: Number(t.employee_amount || t.amount || 0),
        employerPortion: t.employer_amount ? Number(t.employer_amount) : undefined,
      })),
    }));
  }

  // ===== Payroll Runs =====

  async getPayrollRuns(params?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<EvereePayrollRun[]> {
    let endpoint = '/v1/payroll-runs';
    const queryParams: string[] = [];
    if (params?.startDate) queryParams.push(`start_date=${params.startDate}`);
    if (params?.endDate) queryParams.push(`end_date=${params.endDate}`);
    if (params?.limit) queryParams.push(`limit=${params.limit}`);
    if (queryParams.length) endpoint += `?${queryParams.join('&')}`;

    const data = await this.request<any>(endpoint);
    return (data.payroll_runs || data || []).map((pr: any) => ({
      id: pr.id || pr.uuid,
      payDate: pr.pay_date || pr.payDate,
      payPeriodStart: pr.pay_period_start || pr.payPeriodStart,
      payPeriodEnd: pr.pay_period_end || pr.payPeriodEnd,
      status: pr.status || 'processed',
      totalGross: Number(pr.total_gross || pr.totalGross || 0),
      totalNet: Number(pr.total_net || pr.totalNet || 0),
      totalTaxes: Number(pr.total_taxes || pr.totalTaxes || 0),
      totalEmployerTaxes: Number(pr.total_employer_taxes || pr.totalEmployerTaxes || 0),
      workerCount: Number(pr.worker_count || pr.workerCount || 0),
    }));
  }

  async getPayrollRunDetails(
    runId: string
  ): Promise<EvereePayrollRun & { workers: EvereePayStatement[] }> {
    const data = await this.request<any>(`/v1/payroll-runs/${runId}`);
    const pr = data.payroll_run || data;

    return {
      id: pr.id || pr.uuid,
      payDate: pr.pay_date || pr.payDate,
      payPeriodStart: pr.pay_period_start || pr.payPeriodStart,
      payPeriodEnd: pr.pay_period_end || pr.payPeriodEnd,
      status: pr.status || 'processed',
      totalGross: Number(pr.total_gross || pr.totalGross || 0),
      totalNet: Number(pr.total_net || pr.totalNet || 0),
      totalTaxes: Number(pr.total_taxes || pr.totalTaxes || 0),
      totalEmployerTaxes: Number(pr.total_employer_taxes || pr.totalEmployerTaxes || 0),
      workerCount: Number(pr.worker_count || pr.workerCount || 0),
      workers: (pr.pay_statements || pr.workers || []).map((ps: any) => ({
        id: ps.id || ps.uuid,
        workerId: ps.worker_id || ps.workerId,
        workerName: `${ps.worker_first_name || ''} ${ps.worker_last_name || ''}`.trim(),
        payDate: pr.pay_date || pr.payDate,
        payPeriodStart: pr.pay_period_start || pr.payPeriodStart,
        payPeriodEnd: pr.pay_period_end || pr.payPeriodEnd,
        grossPay: Number(ps.gross_pay || ps.grossPay || 0),
        netPay: Number(ps.net_pay || ps.netPay || 0),
        totalHours: ps.total_hours ? Number(ps.total_hours) : undefined,
        deductions: ps.deductions || [],
        taxes: ps.taxes || [],
      })),
    };
  }

  // ===== Tax Withholdings Summary =====

  async getTaxWithholdings(params?: {
    year?: string;
  }): Promise<EvereeTaxWithholding[]> {
    // Aggregate tax withholdings from payroll runs for the specified year
    const year = params?.year || new Date().getFullYear().toString();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    try {
      const runs = await this.getPayrollRuns({ startDate, endDate });

      // Aggregate totals
      const totals = {
        federalIncomeTax: 0,
        socialSecurity: 0,
        socialSecurityEmployer: 0,
        medicare: 0,
        medicareEmployer: 0,
        stateIncomeTax: 0,
        stateSUTA: 0,
        federalFUTA: 0,
      };

      for (const run of runs) {
        totals.federalIncomeTax += run.totalTaxes * 0.3; // Approximate split
        totals.socialSecurity += run.totalGross * 0.062;
        totals.socialSecurityEmployer += run.totalGross * 0.062;
        totals.medicare += run.totalGross * 0.0145;
        totals.medicareEmployer += run.totalGross * 0.0145;
        totals.stateIncomeTax += run.totalTaxes * 0.15;
        totals.federalFUTA += Math.min(run.totalGross, 7000 * run.workerCount) * 0.006;
      }

      return [
        { taxType: 'Federal Income Tax', description: 'Employee federal income tax withheld', totalWithheld: Math.round(totals.federalIncomeTax * 100) / 100, employerPortion: 0, period: year },
        { taxType: 'Social Security (Employee)', description: 'Employee OASDI 6.2%', totalWithheld: Math.round(totals.socialSecurity * 100) / 100, employerPortion: 0, period: year },
        { taxType: 'Social Security (Employer)', description: 'Employer OASDI 6.2%', totalWithheld: 0, employerPortion: Math.round(totals.socialSecurityEmployer * 100) / 100, period: year },
        { taxType: 'Medicare (Employee)', description: 'Employee Medicare 1.45%', totalWithheld: Math.round(totals.medicare * 100) / 100, employerPortion: 0, period: year },
        { taxType: 'Medicare (Employer)', description: 'Employer Medicare 1.45%', totalWithheld: 0, employerPortion: Math.round(totals.medicareEmployer * 100) / 100, period: year },
        { taxType: 'NC State Income Tax', description: 'North Carolina SIT withheld', totalWithheld: Math.round(totals.stateIncomeTax * 100) / 100, employerPortion: 0, period: year },
        { taxType: 'FUTA', description: 'Federal Unemployment Tax', totalWithheld: 0, employerPortion: Math.round(totals.federalFUTA * 100) / 100, period: year },
      ];
    } catch (error: any) {
      if (!this.available) return [];
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<{ ok: boolean; error?: string; workerCount?: number }> {
    if (!this.available) {
      return { ok: false, error: 'Everee API key not configured' };
    }

    try {
      const workers = await this.getWorkers();
      return { ok: true, workerCount: workers.length };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
}

// Singleton
let evereeInstance: EvereeClient | null = null;
export function getEvereeClient(): EvereeClient {
  if (!evereeInstance) {
    evereeInstance = new EvereeClient();
  }
  return evereeInstance;
}
