/**
 * Access control has TWO independent axes. Conflating them is what let a rep
 * read the owner's calendar: rank alone cannot express "this leader sees these
 * three reps and nobody else".
 *
 *   CAPABILITY (rank)  — what KIND of thing you may see (AR, payables, settings)
 *   SCOPE              — WHOSE records you see (self / your team / everyone)
 *
 * A role needs both. Customer service is the clearest case: it sees every
 * customer (scope 'all') but no money at all (low rank). A pure ladder cannot
 * describe that.
 *
 * Naming note: the stored value for a sales leader is 'manager'. It predates
 * the org chart and is load-bearing in the database enum and in every existing
 * atLeast('manager') call, so it stays; ROLE_LABEL renders it "Sales Leader"
 * everywhere a human sees it.
 */
export type TeamRole =
  | 'admin'
  | 'sales_director'
  | 'manager' // Sales Leader — see note above
  | 'customer_service'
  | 'sales'
  | 'production';

export const ROLE_RANK: Record<TeamRole, number> = {
  admin: 5,
  sales_director: 4,
  manager: 3,
  customer_service: 2,
  sales: 1,
  production: 0,
};

/** What a human sees. Never render the raw role value. */
export const ROLE_LABEL: Record<TeamRole, string> = {
  admin: 'Admin',
  sales_director: 'Sales Director',
  manager: 'Sales Leader',
  customer_service: 'Customer Service',
  sales: 'Sales Rep',
  production: 'Production',
};

export function atLeast(role: TeamRole, min: TeamRole): boolean {
  return (ROLE_RANK[role] ?? -1) >= ROLE_RANK[min];
}

// ============================================================
// Axis 2: data scope
// ============================================================

/**
 * Whose records a role may read.
 *   self — only records they own
 *   team — their own plus their direct reports' (needs the reportsTo graph)
 *   all  — every record in the company
 */
export type DataScope = 'self' | 'team' | 'all';

const ROLE_SCOPE: Record<TeamRole, DataScope> = {
  admin: 'all',
  sales_director: 'all',
  // A sales leader sees their own reps in full. Other teams appear only as
  // aggregate totals, which is a separate concern from record-level access —
  // see teamTotalsVisible().
  manager: 'team',
  // Customer service exists to help whoever calls, so it must reach every
  // customer — but capability rank keeps money out of reach.
  customer_service: 'all',
  sales: 'self',
  production: 'self',
};

export function dataScope(role: TeamRole): DataScope {
  return ROLE_SCOPE[role] ?? 'self';
}

/** True when the role sees only a subset — i.e. queries MUST be filtered. */
export function isNarrowed(role: TeamRole): boolean {
  return dataScope(role) !== 'all';
}

/**
 * May this role see other teams' aggregate numbers (leaderboards, company
 * KPIs) without seeing their records? Sales leaders can, which is what makes a
 * leaderboard meaningful without exposing another team's clients.
 */
export function teamTotalsVisible(role: TeamRole): boolean {
  return atLeast(role, 'manager');
}

// ============================================================
// Capabilities
// ============================================================

export type Section =
  | 'overview' | 'leads' | 'pipeline' | 'ar' | 'ap'
  | 'calendar' | 'bids' | 'team' | 'digests' | 'settings'
  | 'customers' | 'commissions' | 'payroll';

const SECTION_MIN: Record<Section, TeamRole> = {
  overview: 'production',
  calendar: 'production',
  // Customer service needs the customer-facing surfaces...
  customers: 'customer_service',
  leads: 'sales',
  pipeline: 'sales',
  bids: 'sales',
  commissions: 'sales', // own only, unless scope widens
  // ...but nothing below is reachable at its rank.
  ar: 'manager',
  ap: 'admin',
  payroll: 'admin',
  team: 'admin',
  digests: 'admin',
  settings: 'admin',
};

export const SECTIONS = SECTION_MIN;

export function canSee(role: TeamRole, section: Section): boolean {
  return atLeast(role, SECTION_MIN[section]);
}

/**
 * Money is the one capability that must never leak sideways. Customer service
 * outranks sales but must not read AR, commissions, or payroll, so this is an
 * explicit denylist rather than a rank comparison.
 */
const MONEY_SECTIONS: Section[] = ['ar', 'ap', 'payroll', 'commissions'];

export function canSeeMoney(role: TeamRole, section: Section): boolean {
  if (role === 'customer_service') return false;
  return canSee(role, section);
}

export const ALL_ROLES: TeamRole[] = [
  'admin', 'sales_director', 'manager', 'customer_service', 'sales', 'production',
];

export function isMoneySection(section: Section): boolean {
  return MONEY_SECTIONS.includes(section);
}
