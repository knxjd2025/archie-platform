import { describe, it, expect } from 'vitest';
import { archieToolsForRole, isArchieToolAllowed } from '../archie-tools';

describe('archie tool role gate', () => {
  // recall_past_days (a person's own saved chat summaries) and get_calendar
  // (their own live Google Calendar) are open to everyone — both are scoped to
  // the caller by construction.
  it('production sees only their own calendar + their own chat recall', () => {
    expect(new Set(archieToolsForRole('production'))).toEqual(
      new Set(['get_calendar', 'recall_past_days']),
    );
  });
  it('sales adds leads + pipeline + their own inbox (no money)', () => {
    expect(new Set(archieToolsForRole('sales'))).toEqual(
      new Set(['get_leads', 'get_pipeline', 'search_email', 'get_calendar', 'recall_past_days']),
    );
  });
  it('manager adds the team schedule + receivables + KPIs + drive (no payables)', () => {
    const t = new Set(archieToolsForRole('manager'));
    expect(t.has('get_schedule')).toBe(true);
    expect(t.has('get_receivables')).toBe(true);
    expect(t.has('get_lead_kpis')).toBe(true);
    expect(t.has('search_email')).toBe(true);
    expect(t.has('search_drive')).toBe(true);
    expect(t.has('read_drive_file')).toBe(true);
    expect(t.has('get_payables')).toBe(false);
  });
  it('admin gets everything including payables', () => {
    expect(archieToolsForRole('admin')).toContain('get_payables');
    expect(archieToolsForRole('admin').length).toBe(13);
  });
  it('isArchieToolAllowed enforces minimums', () => {
    expect(isArchieToolAllowed('sales', 'get_payables')).toBe(false);
    expect(isArchieToolAllowed('admin', 'get_payables')).toBe(true);
    expect(isArchieToolAllowed('production', 'get_leads')).toBe(false);
    expect(isArchieToolAllowed('sales', 'get_receivables')).toBe(false);
    expect(isArchieToolAllowed('manager', 'get_receivables')).toBe(true);
    // A rep may search their OWN inbox — delegation impersonates the caller, so
    // search_email cannot reach anyone else's mail. Drive stays manager+
    // because shared company folders surface there.
    expect(isArchieToolAllowed('sales', 'search_email')).toBe(true);
    expect(isArchieToolAllowed('production', 'search_email')).toBe(false);
    expect(isArchieToolAllowed('sales', 'search_drive')).toBe(false);
    expect(isArchieToolAllowed('manager', 'read_drive_file')).toBe(true);
    expect(isArchieToolAllowed('production', 'recall_past_days')).toBe(true);
    // get_schedule reads the appointments mirror — every synced mailbox in one
    // table, with no per-user filter — so it is a team-wide view, not a
    // personal one. Reps get get_calendar (their own, live) instead.
    expect(isArchieToolAllowed('sales', 'get_schedule')).toBe(false);
    expect(isArchieToolAllowed('manager', 'get_schedule')).toBe(true);
    expect(isArchieToolAllowed('production', 'get_calendar')).toBe(true);
    // Raw JobTread access reads everything (payables, margins, every job), so
    // it must stay admin-only — it can't be rep-scoped.
    expect(isArchieToolAllowed('manager', 'jobtread_query')).toBe(false);
    expect(isArchieToolAllowed('admin', 'jobtread_query')).toBe(true);
    expect(isArchieToolAllowed('sales', 'jobtread_schema')).toBe(false);
  });
});
