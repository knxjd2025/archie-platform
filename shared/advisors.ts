import { atLeast, type TeamRole } from './rbac';

/**
 * Minimum team role required to use each AI advisor.
 *
 * The five team advisors (Sales Manager, Customer Service, COO, Project
 * Coordinator, Estimator) are there to help whoever is doing the work, so the
 * sales team gets all of them. Their tools are scoped to the person asking —
 * a rep asking the Sales Manager about KPIs sees their own numbers, a leader
 * sees their team's, an admin sees everyone's. Marketing is manager+; the
 * exec, finance and legal advisors are admin-only.
 */
export const ADVISOR_MIN_ROLE: Record<string, TeamRole> = {
  project_coordinator: 'production', // production help — everyone
  sales_manager: 'sales',
  customer_service: 'sales',
  estimator: 'sales',
  coo: 'sales',
  cmo: 'manager',
  ceo: 'admin',
  cfo: 'admin',
  cpa: 'admin',
  tax_accountant: 'admin',
  tax_lawyer: 'admin',
};

/** One line under each advisor's name so a rep knows who to ask for what. */
export const ADVISOR_FOCUS: Record<string, string> = {
  sales_manager: 'Your pipeline, follow-ups, KPIs and commissions — a coach who can see your book.',
  customer_service: 'Customer communication — status updates, tough conversations, what to say next.',
  coo: 'Operations — jobs in production, what is stuck, schedule and crew flow.',
  project_coordinator: 'One job at a time — where it stands, what is next, keeping the homeowner informed.',
  estimator: 'Scope and price — inspection findings, options, what goes in the proposal.',
  cmo: 'Lead generation and marketing — sources, response time, reviews, campaigns.',
  ceo: 'The whole business — strategy, priorities, what needs the owner\'s attention.',
  cfo: 'Cash, revenue, receivables and job profitability.',
  cpa: 'The books — bank activity, reconciliation, payroll records.',
  tax_accountant: 'Federal and NC tax filings, estimates and deductions.',
  tax_lawyer: 'Tax compliance, worker classification and audit readiness.',
};

/** Unknown/unlisted advisors are treated as admin-only (fail closed). */
export function advisorMinRole(role: string): TeamRole {
  return ADVISOR_MIN_ROLE[role] ?? 'admin';
}

export function canUseAdvisor(userRole: TeamRole, advisorRole: string): boolean {
  return atLeast(userRole, advisorMinRole(advisorRole));
}

export function advisorsForRole(userRole: TeamRole): string[] {
  return Object.keys(ADVISOR_MIN_ROLE).filter((a) => canUseAdvisor(userRole, a));
}
