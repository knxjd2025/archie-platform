import { atLeast, type TeamRole } from '../../shared/rbac';

export type ArchieToolName =
  | 'get_leads'
  | 'get_pipeline'
  | 'get_receivables'
  | 'get_payables'
  | 'get_schedule'
  | 'get_calendar'
  | 'get_lead_kpis'
  | 'get_watchlist'
  | 'search_email'
  | 'search_drive'
  | 'read_drive_file'
  | 'recall_past_days'
  | 'jobtread_query'
  | 'jobtread_schema';

// Minimum role for each Archie tool. Mirrors the cockpit section minimums in
// shared/rbac.ts (leads/pipeline=sales, ar=manager, ap=admin), with lead KPIs +
// the flagged-items watchlist treated as manager-level oversight.
//
// The two calendar tools are NOT interchangeable, and the split is the whole
// point of their differing minimums:
//   get_calendar reads the caller's OWN calendar live via delegation, so it is
//     self-scoping by construction — everyone gets it.
//   get_schedule reads the `appointments` mirror, which holds EVERY synced
//     mailbox with no per-user filter. It is therefore a team-wide view and is
//     manager+. It previously sat at 'production', which let any rep read the
//     owner's and the office's calendars, personal entries included.
// search_email/search_drive/read_drive_file likewise read only the caller's OWN
// Gmail/Drive (delegation impersonates the caller, so a rep cannot reach another
// person's mailbox). Email is sales+ so reps can chase their own threads; Drive
// stays manager+ because shared company folders surface there.
export const ARCHIE_TOOL_MIN_ROLE: Record<ArchieToolName, TeamRole> = {
  // Everyone can recall their OWN past-day summaries (scoped to the caller).
  recall_past_days: 'production',
  get_calendar: 'production',
  get_leads: 'sales',
  get_pipeline: 'sales',
  search_email: 'sales',
  get_schedule: 'manager',
  get_receivables: 'manager',
  get_lead_kpis: 'manager',
  get_watchlist: 'manager',
  search_drive: 'manager',
  read_drive_file: 'manager',
  get_payables: 'admin',
  // Raw JobTread access reads ANYTHING in the org — including payables, margins
  // and other companies' jobs — so it cannot be rep-scoped and is admin-only,
  // matching the strictest existing boundary (get_payables).
  jobtread_query: 'admin',
  jobtread_schema: 'admin',
};

export function isArchieToolAllowed(role: TeamRole, tool: ArchieToolName): boolean {
  return atLeast(role, ARCHIE_TOOL_MIN_ROLE[tool]);
}

export function archieToolsForRole(role: TeamRole): ArchieToolName[] {
  return (Object.keys(ARCHIE_TOOL_MIN_ROLE) as ArchieToolName[])
    .filter((t) => isArchieToolAllowed(role, t));
}
