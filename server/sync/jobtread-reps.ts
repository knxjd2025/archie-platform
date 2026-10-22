/**
 * Keeps the app's roster in step with JobTread's job "Sales Rep" dropdown.
 *
 * JobTread is where a job gets attributed to a rep, by a dropdown of names.
 * The app maps each team member to one of those names (jobtreadSalesRep) —
 * that mapping is what scopes leads, KPIs and commissions to a person. When
 * JobTread has a name the app hasn't mapped, that rep's work is invisible in
 * the app until an admin links it. This module:
 *   - reads the dropdown's options,
 *   - links any team member whose name matches an option and has no mapping
 *     yet (safe, exact-name only),
 *   - reports what's left: names JobTread has that nobody in the app is,
 *     and mappings in the app that JobTread no longer offers.
 * Run hourly by the sync and on demand from the Team page.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { teamMembers } from '../../shared/schema';
import { JobTreadClient } from '../integrations/jobtread';

/** Dropdown values that are placeholders, not people. Never mapped or reported as missing. */
export const NON_PERSON_OPTIONS = new Set(['other', 'unassigned', 'none', 'n/a', 'tbd']);

export interface RosterRow { id: number; name: string; email: string; active: boolean; jobtreadSalesRep: string | null }

export interface RepLinkPlan {
  /** Members to map: member id -> the JobTread option (exact, case-insensitive name match, member currently unmapped). */
  link: Array<{ id: number; name: string; repName: string }>;
  /** JobTread options nobody in the app is mapped to (placeholders excluded). */
  unmapped: string[];
  /** App mappings JobTread's dropdown no longer offers — jobs can't be attributed to them anymore. */
  stale: Array<{ id: number; name: string; repName: string }>;
  /** Option -> member, for everything already (or about to be) mapped. */
  mapped: Array<{ repName: string; id: number; name: string; email: string; active: boolean }>;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Pure: what to do given JobTread's options and the roster. */
export function planRepLinks(options: string[], roster: RosterRow[]): RepLinkPlan {
  const people = options.filter((o) => o.trim() && !NON_PERSON_OPTIONS.has(norm(o)));
  const byRep = new Map<string, RosterRow>();
  for (const m of roster) if (m.jobtreadSalesRep) byRep.set(norm(m.jobtreadSalesRep), m);

  const link: RepLinkPlan['link'] = [];
  for (const o of people) {
    if (byRep.has(norm(o))) continue;
    // Exact name match only, and only one candidate — two "Chris"es is a human call.
    const candidates = roster.filter((m) => !m.jobtreadSalesRep && norm(m.name) === norm(o));
    if (candidates.length === 1) { link.push({ id: candidates[0].id, name: candidates[0].name, repName: o }); byRep.set(norm(o), { ...candidates[0], jobtreadSalesRep: o }); }
  }
  const unmapped = people.filter((o) => !byRep.has(norm(o)));
  const optionSet = new Set(options.map(norm));
  const stale = roster
    .filter((m) => m.jobtreadSalesRep && !optionSet.has(norm(m.jobtreadSalesRep)))
    .map((m) => ({ id: m.id, name: m.name, repName: m.jobtreadSalesRep as string }));
  const mapped = people
    .filter((o) => byRep.has(norm(o)))
    .map((o) => { const m = byRep.get(norm(o))!; return { repName: o, id: m.id, name: m.name, email: m.email, active: m.active }; });
  return { link, unmapped, stale, mapped };
}

export interface RepSyncResult extends RepLinkPlan {
  options: string[];
  linked: number;
}

export async function loadRoster(): Promise<RosterRow[]> {
  return db.select({ id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, active: teamMembers.active, jobtreadSalesRep: teamMembers.jobtreadSalesRep }).from(teamMembers);
}

/** Read JobTread's options and apply the safe links. `dryRun` reports without writing. */
export async function syncSalesRepsFromJobTread(opts: { dryRun?: boolean; jt?: JobTreadClient } = {}): Promise<RepSyncResult> {
  const jt = opts.jt ?? new JobTreadClient();
  const options = await jt.getSalesRepOptions();
  const plan = planRepLinks(options, await loadRoster());
  let linked = 0;
  if (!opts.dryRun) {
    for (const l of plan.link) {
      await db.update(teamMembers).set({ jobtreadSalesRep: l.repName }).where(eq(teamMembers.id, l.id));
      linked++;
    }
  }
  return { ...plan, options, linked };
}
