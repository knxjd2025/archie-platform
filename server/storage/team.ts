import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { companies, teamMembers, type Company, type TeamMember } from '../../shared/schema';
import { runAsSystem } from '../tenant/context';
import type { TeamMemberInput } from './team-validate';

export async function getTeamMemberByEmail(email: string): Promise<TeamMember | undefined> {
  const rows = await db.select().from(teamMembers).where(eq(teamMembers.email, email.toLowerCase()));
  return rows[0];
}

export interface SignInMember { member: TeamMember; company: Company }

/**
 * The roster row for an email, with its company, looked up across every
 * company: at sign-in nobody knows the company yet. Email is unique across
 * Archie (one person, one company), so this is at most one row.
 */
export function findSignInMember(email: string): Promise<SignInMember | undefined> {
  return runAsSystem('sign-in: find member by email', async () => {
    const rows = await db.select({ member: teamMembers, company: companies })
      .from(teamMembers)
      .innerJoin(companies, eq(companies.id, teamMembers.companyId))
      .where(eq(teamMembers.email, email.trim().toLowerCase()));
    return rows[0];
  });
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  return db.select().from(teamMembers).orderBy(teamMembers.role, teamMembers.name);
}

export async function createTeamMember(input: TeamMemberInput, createdBy: string): Promise<TeamMember> {
  const rows = await db.insert(teamMembers).values({
    name: input.name,
    email: input.email,
    role: input.role,
    phone: input.phone,
    canLogin: input.canLogin ?? false,
    notifyEmail: input.notifyEmail ?? true,
    notifySms: input.notifySms ?? false,
    jobtreadSalesRep: input.jobtreadSalesRep ?? null,
    createdBy,
  }).returning();
  return rows[0];
}

/** The member (if any) already mapped to this JobTread Sales Rep name, case-insensitively. */
export async function memberByJobtreadRep(repName: string, excludeId?: number): Promise<TeamMember | undefined> {
  const rows = await db.select().from(teamMembers).where(sql`lower(${teamMembers.jobtreadSalesRep}) = ${repName.toLowerCase()}`);
  return rows.find((r) => r.id !== excludeId);
}

export async function getTeamMemberById(id: number): Promise<TeamMember | undefined> {
  const rows = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
  return rows[0];
}

export async function updateTeamMember(id: number, patch: Partial<TeamMemberInput> & { active?: boolean; reportsTo?: number | null }): Promise<TeamMember | undefined> {
  const rows = await db.update(teamMembers).set(patch).where(eq(teamMembers.id, id)).returning();
  return rows[0];
}

export async function touchLogin(email: string, googleSub: string): Promise<void> {
  await db.update(teamMembers)
    .set({ googleSub, lastLoginAt: new Date() })
    .where(eq(teamMembers.email, email.toLowerCase()));
}
