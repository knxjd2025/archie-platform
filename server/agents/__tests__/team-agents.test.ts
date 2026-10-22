import { describe, it, expect, beforeAll } from 'vitest';
import {
  SalesManagerAgent,
  CustomerServiceAgent,
  COOAgent,
  ProjectCoordinatorAgent,
  EstimatorAgent,
} from '../team-agents';
import { TEAM_ADVISORS } from '../team-advisors';
import type { AgentConfig } from '../base-agent';
import type { AgentViewer } from '../viewer';

// team-agent roles default to the 'open' provider (see DEFAULT_PROVIDER_FOR_ROLE
// in base-agent.ts), so construction needs a fal key rather than an Anthropic one.
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY ||= 'test-key';
  process.env.FAL_AI_API_KEY ||= 'test-key';
});

const cfg = (role: string, viewer?: AgentViewer): AgentConfig => ({ id: 99, name: 'X', role, title: 'T', persona: 'p', systemPrompt: 's', viewer });
const tools = (a: any): string[] => Array.from(a.tools.keys());
const BOOK = ['search_knowledge_base', 'get_my_leads', 'get_pipeline_summary', 'get_project', 'get_my_schedule'];

const REP: AgentViewer = { repNames: ['riley carter'], memberIds: [2], emails: ['b@acme.test'], email: 'b@acme.test', name: 'Riley', role: 'sales', teamMemberId: 2 };
const CS: AgentViewer = { ...REP, role: 'customer_service' };
const LEADER: AgentViewer = { ...REP, role: 'manager' };
const ADMIN: AgentViewer = { repNames: null, memberIds: null, emails: null, email: 'p@acme.test', name: 'Pat', role: 'admin', teamMemberId: 1 };

describe('team advisors — each has the shared book plus its own specialty', () => {
  it('Sales Manager: book + KPIs + follow-ups + pay', () => {
    const t = tools(new SalesManagerAgent(cfg('sales_manager', REP)));
    expect(t).toEqual(expect.arrayContaining([...BOOK, 'get_follow_ups', 'create_follow_up', 'get_my_kpis', 'lookup_job', 'calculate_commission', 'list_commissions', 'get_job_commissions']));
  });
  it('Customer Service: book + follow-ups, no money tools', () => {
    const t = tools(new CustomerServiceAgent(cfg('customer_service', REP)));
    expect(t).toEqual(expect.arrayContaining([...BOOK, 'get_follow_ups', 'create_follow_up', 'lookup_job']));
    for (const m of ['calculate_commission', 'list_commissions', 'get_job_commissions', 'get_my_kpis']) expect(t).not.toContain(m);
  });
  it('COO: book + KPIs + follow-ups', () => {
    const t = tools(new COOAgent(cfg('coo', REP)));
    expect(t).toEqual(expect.arrayContaining([...BOOK, 'get_follow_ups', 'create_follow_up', 'get_my_kpis', 'get_job_commissions']));
  });
  it('Project Coordinator: book + follow-ups only', () => {
    const t = tools(new ProjectCoordinatorAgent(cfg('project_coordinator', REP)));
    expect(t).toEqual(expect.arrayContaining([...BOOK, 'get_follow_ups', 'create_follow_up', 'lookup_job']));
    expect(t).not.toContain('get_my_kpis');
  });
  it('Estimator: book, reads follow-ups but does not create them', () => {
    const t = tools(new EstimatorAgent(cfg('estimator', REP)));
    expect(t).toEqual(expect.arrayContaining([...BOOK, 'get_follow_ups', 'lookup_job']));
    expect(t).not.toContain('create_follow_up');
    expect(t).not.toContain('calculate_commission');
  });
});

describe('rank gates on top of scoping', () => {
  it('company-wide KPIs and receivables need a leader or above', () => {
    expect(tools(new SalesManagerAgent(cfg('sales_manager', REP)))).not.toContain('get_company_lead_kpis');
    expect(tools(new SalesManagerAgent(cfg('sales_manager', LEADER)))).toContain('get_company_lead_kpis');
    expect(tools(new COOAgent(cfg('coo', REP)))).not.toContain('get_outstanding_invoices');
    expect(tools(new COOAgent(cfg('coo', ADMIN)))).toContain('get_outstanding_invoices');
    expect(tools(new CustomerServiceAgent(cfg('customer_service', REP)))).not.toContain('get_outstanding_invoices');
  });
  it('a customer-service user never gets money tools, even from the Sales Manager', () => {
    const t = tools(new SalesManagerAgent(cfg('sales_manager', CS)));
    for (const m of ['calculate_commission', 'list_commissions', 'get_job_commissions']) expect(t).not.toContain(m);
  });
  it('an anonymous viewer (no role) keeps the full set, as before', () => {
    expect(tools(new SalesManagerAgent(cfg('sales_manager')))).toEqual(expect.arrayContaining(['get_company_lead_kpis', 'list_commissions']));
  });
});

describe('advisor definitions match what the classes register', () => {
  const classes: Record<string, any> = { sales_manager: SalesManagerAgent, customer_service: CustomerServiceAgent, coo: COOAgent, project_coordinator: ProjectCoordinatorAgent, estimator: EstimatorAgent };
  for (const def of TEAM_ADVISORS) {
    it(`${def.name} (${def.role}) lists exactly its registered tools`, () => {
      const t = tools(new classes[def.role](cfg(def.role, ADMIN)));
      expect(new Set(def.tools)).toEqual(new Set(t));
    });
    it(`${def.name}'s prompt names only tools it has`, () => {
      const mentioned = Array.from(def.systemPrompt.matchAll(/\b(get_[a-z_]+|create_[a-z_]+|list_[a-z_]+|calculate_[a-z_]+|lookup_[a-z_]+|search_[a-z_]+)\b/g)).map((m) => m[1]);
      for (const name of mentioned) expect(def.tools, `${def.role} mentions ${name}`).toContain(name);
    });
  }
});
