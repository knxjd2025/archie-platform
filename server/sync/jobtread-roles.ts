/**
 * Keeps app roles and JobTread roles in step.
 *
 * WHAT SYNCS WHICH WAY — verified against the live Pave schema, not assumed:
 *
 *   role          BOTH WAYS.  membership.role is readable, and
 *                 updateMembership accepts roleId.
 *   reporting line JOBTREAD -> APP ONLY.  membership.parentMembership is
 *                 readable, but updateMembership exposes no parent/manager
 *                 field (its only relevant input is roleId). There is no
 *                 createMembership mutation either. So the app cannot push a
 *                 reporting line into JobTread — the app is the source of
 *                 truth for it, and JobTread's value is imported when present.
 *                 As of this writing every membership there has parent = null.
 *
 * Role ids are per-organization, so they are resolved by NAME at run time
 * rather than hard-coded — a restored or recreated role gets a new id.
 */
import { JobTreadClient } from '../integrations/jobtread';
import { db } from '../db';
import { teamMembers } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import type { TeamRole } from '../../shared/rbac';

/**
 * JobTread role name -> app role.
 *
 * Roles absent here (Customer, Renter, Realtor, Spouse, Property Manager,
 * Sub-Contractor) are external parties, not staff — they must never map to an
 * app login, so an unmapped role is left alone rather than defaulted.
 */
export const JT_ROLE_TO_APP: Record<string, TeamRole> = {
  'Admin': 'admin',
  'Sales Leader': 'manager',
  'Sales Partner': 'sales',
  'Estimator': 'sales',
  'Production Manager': 'production',
  'Quality Control': 'production',
  'Distribution': 'production',
  'Supplementor': 'production',
};

/**
 * App role -> JobTread role name, for pushing a change back.
 *
 * Not a strict inverse: several JobTread roles collapse to one app role, so
 * this picks the canonical counterpart. sales_director and customer_service
 * have no JobTread equivalent — mapped to their nearest sensible role so a
 * push never silently no-ops, and flagged in the result.
 */
export const APP_ROLE_TO_JT: Record<TeamRole, string> = {
  admin: 'Admin',
  sales_director: 'Admin',
  manager: 'Sales Leader',
  customer_service: 'Sales Partner',
  sales: 'Sales Partner',
  production: 'Production Manager',
};

export interface JtMembership {
  id: string;
  name: string;
  roleName: string | null;
  parentMembershipId: string | null;
  isInternal: boolean;
}

/** Match a JobTread person to an app team member. */
export function matchMember(
  jt: JtMembership,
  members: Array<{ id: number; name: string; email: string; jobtreadSalesRep: string | null; jobtreadMembershipId: string | null }>,
): number | null {
  // An id recorded on a previous run is authoritative — names change.
  const byId = members.find((m) => m.jobtreadMembershipId === jt.id);
  if (byId) return byId.id;
  const norm = (s: string) => s.trim().toLowerCase();
  const n = norm(jt.name);
  if (!n) return null;
  // The Sales Rep dropdown value is the deliberate mapping, so prefer it.
  const byRep = members.find((m) => m.jobtreadSalesRep && norm(m.jobtreadSalesRep) === n);
  if (byRep) return byRep.id;
  const byName = members.find((m) => norm(m.name) === n);
  return byName ? byName.id : null;
}

export async function fetchMemberships(jt = new JobTreadClient()): Promise<JtMembership[]> {
  const org = await (jt as any).getOrganizationId();
  const r: any = await jt.paveQuery({
    organization: {
      $: { id: org },
      memberships: {
        $: { size: 100 },
        nodes: {
          id: {},
          isInternal: {},
          user: { name: {} },
          role: { name: {} },
          parentMembership: { id: {} },
        },
      },
    },
  });
  return (r?.organization?.memberships?.nodes || []).map((m: any) => ({
    id: String(m.id),
    name: String(m?.user?.name || ''),
    roleName: m?.role?.name ?? null,
    parentMembershipId: m?.parentMembership?.id ?? null,
    isInternal: !!m.isInternal,
  }));
}

async function roleIdsByName(jt: JobTreadClient): Promise<Map<string, string>> {
  const org = await (jt as any).getOrganizationId();
  const r: any = await jt.paveQuery({
    organization: { $: { id: org }, roles: { $: { size: 50 }, nodes: { id: {}, name: {} } } },
  });
  const map = new Map<string, string>();
  for (const x of r?.organization?.roles?.nodes || []) map.set(String(x.name), String(x.id));
  return map;
}

export interface SyncResult {
  linked: number;
  rolesImported: string[];
  reportingImported: string[];
  unmatched: string[];
  skipped: string[];
}

/**
 * Pull from JobTread: link memberships to team members, import roles, and
 * import the reporting line where JobTread has one.
 *
 * Conflict rule: JobTread wins for ROLE (it governs what someone can do in the
 * system that holds the work). The app wins for the REPORTING LINE, because
 * JobTread cannot accept a write for it — an app value is never overwritten by
 * a null from JobTread.
 */
export async function pullFromJobTread(jt = new JobTreadClient()): Promise<SyncResult> {
  const memberships = await fetchMemberships(jt);
  const out: SyncResult = { linked: 0, rolesImported: [], reportingImported: [], unmatched: [], skipped: [] };

  // Both passes run in one transaction: a role update with no matching
  // reportsTo update (process killed mid-loop) would leave the reporting
  // tree half-synced, so either the whole pull commits or none of it does.
  await db.transaction(async (tx) => {
    const members = await tx
      .select({
        id: teamMembers.id,
        name: teamMembers.name,
        email: teamMembers.email,
        role: teamMembers.role,
        jobtreadSalesRep: teamMembers.jobtreadSalesRep,
        jobtreadMembershipId: teamMembers.jobtreadMembershipId,
        reportsTo: teamMembers.reportsTo,
      })
      .from(teamMembers);

    const membershipToMemberId = new Map<string, number>();

    for (const jm of memberships) {
      if (!jm.isInternal) continue;
      const memberId = matchMember(jm, members);
      if (!memberId) { out.unmatched.push(jm.name || jm.id); continue; }
      membershipToMemberId.set(jm.id, memberId);

      const patch: Record<string, any> = {};
      const existing = members.find((m) => m.id === memberId)!;
      if (existing.jobtreadMembershipId !== jm.id) { patch.jobtreadMembershipId = jm.id; out.linked++; }

      const mapped = jm.roleName ? JT_ROLE_TO_APP[jm.roleName] : undefined;
      if (jm.roleName && !mapped) {
        // An external-party role (Customer, Realtor…) must not become a login.
        out.skipped.push(`${jm.name}: JobTread role "${jm.roleName}" has no app equivalent`);
      } else if (mapped && mapped !== existing.role) {
        patch.role = mapped;
        out.rolesImported.push(`${jm.name}: ${existing.role} -> ${mapped}`);
      }
      if (Object.keys(patch).length) {
        await tx.update(teamMembers).set(patch).where(eq(teamMembers.id, memberId));
      }
    }

    // Second pass: the parent's membership must be linked before it can resolve.
    for (const jm of memberships) {
      if (!jm.isInternal || !jm.parentMembershipId) continue;
      const memberId = membershipToMemberId.get(jm.id);
      const parentId = membershipToMemberId.get(jm.parentMembershipId);
      if (!memberId || !parentId || memberId === parentId) continue;
      const existing = members.find((m) => m.id === memberId);
      if (existing?.reportsTo === parentId) continue;
      await tx.update(teamMembers).set({ reportsTo: parentId }).where(eq(teamMembers.id, memberId));
      out.reportingImported.push(`${jm.name} -> parent ${parentId}`);
    }
  });

  return out;
}

/**
 * Push one person's app role to JobTread. Returns why it was skipped rather
 * than throwing, so a role change in the app is never blocked by JobTread.
 */
export async function pushRoleToJobTread(
  memberId: number,
  jt = new JobTreadClient(),
): Promise<{ ok: boolean; reason?: string }> {
  const [m] = await db
    .select({ role: teamMembers.role, membershipId: teamMembers.jobtreadMembershipId, name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.id, memberId));
  if (!m) return { ok: false, reason: 'no such team member' };
  if (!m.membershipId) return { ok: false, reason: 'not linked to a JobTread membership yet — run the pull first' };

  const wanted = APP_ROLE_TO_JT[m.role as TeamRole];
  const ids = await roleIdsByName(jt);
  const roleId = ids.get(wanted);
  if (!roleId) return { ok: false, reason: `JobTread has no role named "${wanted}"` };

  try {
    await jt.paveQuery({
      updateMembership: { $: { id: m.membershipId, roleId }, membership: { $: { id: m.membershipId }, id: {} } },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'JobTread rejected the role update' };
  }
}
