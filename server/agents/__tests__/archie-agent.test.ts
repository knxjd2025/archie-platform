import { describe, it, expect, beforeAll } from 'vitest';
import { buildArchieForRole } from '../archie-agent';
import { archieToolsForRole, isArchieToolAllowed, type ArchieToolName } from '../archie-tools';

// The Advisor runs on the open model, so it needs the fal key rather than Claude's.
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY ||= 'test-key';
  process.env.FAL_AI_API_KEY ||= 'test-key';
});

const BOOK_TOOLS = ['get_my_leads', 'get_pipeline_summary', 'get_project', 'get_follow_ups', 'create_follow_up', 'get_my_schedule', 'get_my_kpis', 'lookup_job', 'get_job_commissions'] as const;

const ALL_ARCHIE_TOOLS = ['get_leads', 'get_pipeline', 'get_receivables', 'get_payables', 'get_schedule', 'get_calendar', 'get_lead_kpis', 'get_watchlist', 'search_email', 'search_drive', 'read_drive_file'] as const;

describe('buildArchieForRole', () => {
  it('registers exactly the role-allowed Archie tools (plus base knowledge tool)', () => {
    for (const role of ['admin', 'manager', 'sales', 'production'] as const) {
      // pass an email so the delegated Gmail tool (search_email) registers.
      const names = new Set(buildArchieForRole(role, 'user@bestroofingnow.com').toolNames());
      const allowed = new Set(archieToolsForRole(role));
      for (const t of allowed) expect(names.has(t)).toBe(true);
      for (const t of ALL_ARCHIE_TOOLS) {
        if (!allowed.has(t)) expect(names.has(t)).toBe(false);
      }
    }
  });
  it('production Archie cannot see payables, leads, or the team schedule', () => {
    const names = new Set(buildArchieForRole('production', 'crew@bestroofingnow.com').toolNames());
    expect(names.has('get_payables')).toBe(false);
    expect(names.has('get_leads')).toBe(false);
    // The team-wide appointments mirror is manager+; their own calendar is not.
    expect(names.has('get_schedule')).toBe(false);
    expect(names.has('get_calendar')).toBe(true);
  });
  it('omits the own-account tools when the caller has no mailbox', () => {
    // Gmail/Drive/Calendar all impersonate the caller. With no email there is no
    // mailbox to scope to, so they must not register at all rather than fall
    // back to some default account.
    const names = new Set(buildArchieForRole('admin').toolNames());
    for (const t of ['get_calendar', 'search_email', 'search_drive', 'read_drive_file']) {
      expect(names.has(t), t).toBe(false);
    }
  });
  it('leaves the book out entirely when there is no viewer to scope it', () => {
    // An unscoped book would show one rep another rep's leads, so no viewer means no book.
    for (const role of ['admin', 'manager', 'sales', 'production'] as const) {
      const names = new Set(buildArchieForRole(role, 'user@bestroofingnow.com').toolNames());
      for (const t of BOOK_TOOLS) expect(names.has(t), `${role}:${t}`).toBe(false);
    }
  });
  it('gives everyone the NC reference and the website tools', () => {
    for (const role of ['admin', 'manager', 'sales', 'production'] as const) {
      const names = new Set(buildArchieForRole(role).toolNames());
      for (const t of ['nc_roofing_reference', 'search_bestroofingnow', 'read_bestroofingnow_page']) {
        expect(names.has(t), `${role}:${t}`).toBe(true);
      }
    }
  });
  it('security invariant: never registers a tool above the caller role', () => {
    for (const role of ['admin', 'manager', 'sales', 'production'] as const) {
      for (const name of buildArchieForRole(role, 'user@bestroofingnow.com').toolNames()) {
        if ((ALL_ARCHIE_TOOLS as readonly string[]).includes(name)) {
          expect(isArchieToolAllowed(role, name as ArchieToolName)).toBe(true);
        }
      }
    }
  });
});
