import { describe, it, expect } from 'vitest';
import { ARCHIE_TOOL_MIN_ROLE, isArchieToolAllowed, archieToolsForRole } from '../archie-tools';
import { calendarMailboxes } from '../../sync/calendar-sync';
import type { TeamRole } from '../../../shared/rbac';

const ROLES: TeamRole[] = ['admin', 'manager', 'sales', 'production'];

describe('own-account Google tools', () => {
  it('lets a rep search their OWN inbox', () => {
    // Delegation impersonates the caller, so search_email can only ever reach
    // the signed-in person's mailbox — a rep cannot read anyone else's.
    expect(isArchieToolAllowed('sales', 'search_email')).toBe(true);
    expect(isArchieToolAllowed('production', 'search_email')).toBe(false);
  });

  it('gives everyone their own live calendar', () => {
    for (const r of ROLES) expect(isArchieToolAllowed(r, 'get_calendar'), r).toBe(true);
  });

  it('keeps Drive at manager+ — shared company folders surface there', () => {
    expect(isArchieToolAllowed('sales', 'search_drive')).toBe(false);
    expect(isArchieToolAllowed('sales', 'read_drive_file')).toBe(false);
    expect(isArchieToolAllowed('manager', 'search_drive')).toBe(true);
  });
});

describe('team-wide calendar mirror is not readable by reps', () => {
  it('holds get_schedule at manager+', () => {
    // get_schedule reads the `appointments` mirror, which has no per-user
    // filter: every synced mailbox in one table. At its previous 'production'
    // minimum, any rep asking "what's on the schedule" got the owner's and the
    // office's calendars, personal entries included.
    expect(ARCHIE_TOOL_MIN_ROLE.get_schedule).toBe('manager');
    for (const r of ['sales', 'production'] as TeamRole[]) {
      expect(isArchieToolAllowed(r, 'get_schedule'), r).toBe(false);
    }
    for (const r of ['manager', 'admin'] as TeamRole[]) {
      expect(isArchieToolAllowed(r, 'get_schedule'), r).toBe(true);
    }
  });

  it('still leaves a rep a way to see their own day', () => {
    // Losing the team mirror must not leave reps with no calendar at all.
    const tools = archieToolsForRole('sales');
    expect(tools).toContain('get_calendar');
    expect(tools).not.toContain('get_schedule');
  });

  it('never grants a rep more than a manager', () => {
    for (const tool of Object.keys(ARCHIE_TOOL_MIN_ROLE) as Array<keyof typeof ARCHIE_TOOL_MIN_ROLE>) {
      if (isArchieToolAllowed('sales', tool)) {
        expect(isArchieToolAllowed('manager', tool), tool).toBe(true);
        expect(isArchieToolAllowed('admin', tool), tool).toBe(true);
      }
    }
  });
});

describe('calendarMailboxes', () => {
  const m = (email: string, active = true) => ({ email, active });

  it('sweeps every active member, including new hires', () => {
    // A hard-coded list once omitted a rep entirely, so their appointments were
    // invisible app-wide even though delegation worked for their mailbox.
    expect(
      calendarMailboxes([m('pat@acme.test'), m('morgan@acme.test')], 'acme.test'),
    ).toEqual(['morgan@acme.test', 'pat@acme.test']);
  });

  it('skips deactivated people', () => {
    expect(calendarMailboxes([m('a@x.com'), m('gone@x.com', false)], 'x.com')).toEqual(['a@x.com']);
  });

  it('dedupes and normalises case', () => {
    expect(calendarMailboxes([m('A@x.com'), m('a@x.com'), m(' a@x.com ')], 'x.com')).toEqual(['a@x.com']);
  });

  it('ignores rows without a usable address', () => {
    expect(calendarMailboxes([m('a@x.com'), m(''), m('not-an-email'), { email: null, active: true }], 'x.com')).toEqual(['a@x.com']);
  });

  it('sweeps nobody without a delegated domain, and nobody off the domain', () => {
    // Pruning only touches mailboxes that were swept, so an empty sweep removes nothing.
    expect(calendarMailboxes([m('a@x.com')], '')).toEqual([]);
    expect(calendarMailboxes([m('a@x.com'), m('b@gmail.com')], 'x.com')).toEqual(['a@x.com']);
  });
});
