/**
 * Whose canvassed houses a signed-in user may see.
 *
 * A house belongs to the rep who tagged it first — canvass_property_meta.owner_email
 * when an admin has reassigned it, otherwise canvass_properties.created_by. The
 * owner and anyone whose data scope covers them (admins and directors see all;
 * a sales leader sees their direct reports) can see it. Another rep cannot:
 * not the pin, not the notes, not the owner's phone number, and not even that
 * it exists beyond "another rep is already working this house".
 */
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { canvassProperties, canvassPropertyMeta, teamMembers } from '../../shared/schema';
import { dataScope } from '../../shared/rbac';
import { visibleEmailsFor } from '../access/team-scope';
import type { SessionUser } from '../access/rep-scope';

/** Lower-cased emails whose houses are visible. `null` = every house. */
export type VisibleOwners = string[] | null;

// ---- Pure core (unit-tested) -------------------------------------------------

export function canvassOwner(createdBy: string | null | undefined, metaOwner: string | null | undefined): string | null {
  const owner = (metaOwner || createdBy || '').trim().toLowerCase();
  return owner || null;
}

export function canSeeOwner(visible: VisibleOwners, owner: string | null): boolean {
  if (visible === null) return true;
  return !!owner && visible.includes(owner);
}

/**
 * The visible set for a user, given their role and the emails their team scope
 * resolved to. A rep always sees their own houses — even if their login has no
 * team_members row yet, which would otherwise resolve to nobody.
 */
export function resolveVisibleOwners(user: SessionUser, scoped: VisibleOwners): VisibleOwners {
  if (dataScope(user.role) === 'all') return null;
  const own = user.email.trim().toLowerCase();
  const list = (scoped ?? []).map((e) => e.toLowerCase());
  return list.includes(own) ? list : [...list, own];
}

/** A user who sees more than their own houses may hand one to someone they can see. */
export function canReassign(user: SessionUser, visible: VisibleOwners, toEmail: string): boolean {
  if (dataScope(user.role) === 'self') return false;
  return canSeeOwner(visible, toEmail.trim().toLowerCase());
}

// ---- DB-backed ---------------------------------------------------------------

/** The owner of a row, as SQL. Needs canvass_property_meta LEFT JOINed. */
export const ownerSql = sql<string | null>`lower(coalesce(${canvassPropertyMeta.ownerEmail}, ${canvassProperties.createdBy}))`;

/** WHERE limiting canvass_properties to a visible set. `undefined` = no limit. */
export function ownerWhere(visible: VisibleOwners): SQL | undefined {
  if (visible === null) return undefined;
  if (!visible.length) return sql`false`; // nobody → nothing, never everything
  return inArray(ownerSql, visible);
}

export async function visibleOwnersFor(user: SessionUser): Promise<VisibleOwners> {
  if (dataScope(user.role) === 'all') return null;
  return resolveVisibleOwners(user, await visibleEmailsFor(user));
}

export interface PropertyWithMeta {
  row: typeof canvassProperties.$inferSelect;
  meta: typeof canvassPropertyMeta.$inferSelect | null;
}

/** Every house at this address, whoever owns it. Addresses match case-insensitively. */
export async function propertyByAddress(address: string): Promise<PropertyWithMeta | null> {
  const [r] = await db.select({ row: canvassProperties, meta: canvassPropertyMeta })
    .from(canvassProperties)
    .leftJoin(canvassPropertyMeta, eq(canvassPropertyMeta.canvassPropertyId, canvassProperties.id))
    .where(sql`lower(${canvassProperties.address}) = ${address.trim().toLowerCase()}`)
    .limit(1);
  return r ?? null;
}

/**
 * One house this user may see, or null. Callers answer 404 either way, so a
 * rep probing ids learns nothing about another rep's houses.
 */
export async function loadVisibleProperty(user: SessionUser, id: number): Promise<PropertyWithMeta | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [r] = await db.select({ row: canvassProperties, meta: canvassPropertyMeta })
    .from(canvassProperties)
    .leftJoin(canvassPropertyMeta, eq(canvassPropertyMeta.canvassPropertyId, canvassProperties.id))
    .where(eq(canvassProperties.id, id));
  if (!r) return null;
  const visible = await visibleOwnersFor(user);
  return canSeeOwner(visible, canvassOwner(r.row.createdBy, r.meta?.ownerEmail)) ? r : null;
}

export type MetaPatch = Partial<Pick<typeof canvassPropertyMeta.$inferInsert, 'ownerEmail' | 'labels' | 'followUpAt' | 'assignedBy'>>;

export async function upsertMeta(propertyId: number, patch: MetaPatch): Promise<typeof canvassPropertyMeta.$inferSelect> {
  const now = new Date();
  const [row] = await db.insert(canvassPropertyMeta)
    .values({ canvassPropertyId: propertyId, ...patch, updatedAt: now })
    .onConflictDoUpdate({ target: canvassPropertyMeta.canvassPropertyId, set: { ...patch, updatedAt: now } })
    .returning();
  return row;
}

/** email (lower-cased) → display name, for "tagged by" on a leader's view. */
export async function repNamesByEmail(): Promise<Map<string, string>> {
  const rows = await db.select({ email: teamMembers.email, name: teamMembers.name }).from(teamMembers);
  return new Map(rows.map((r) => [r.email.toLowerCase(), r.name]));
}
