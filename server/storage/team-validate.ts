import { isBlockedLoginEmail } from '../auth/allowlist';
import { ALL_ROLES, type TeamRole } from '../../shared/rbac';

export interface TeamMemberInput {
  name: string;
  email: string;
  role: TeamRole;
  phone?: string;
  canLogin?: boolean;
  notifyEmail?: boolean;
  notifySms?: boolean;
  /** The exact JobTread "Sales Rep" dropdown value this person is, or null to unmap. */
  jobtreadSalesRep?: string | null;
}

const ROLES: TeamRole[] = ALL_ROLES;
const ROLE_LIST = ROLES.join('|');
const MAX_REP_NAME = 120;

function parseRepName(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === '') return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim();
  if (!t || t.length > MAX_REP_NAME) return { ok: false };
  return { ok: true, value: t };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateTeamMemberInput(
  input: unknown,
): { ok: true; value: TeamMemberInput } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Body must be an object' };
  const o = input as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name.trim()) return { ok: false, error: 'name is required' };
  if (typeof o.email !== 'string' || !EMAIL_RE.test(o.email)) return { ok: false, error: 'valid email is required' };
  if (isBlockedLoginEmail(o.email)) return { ok: false, error: `${o.email.trim().toLowerCase()} is not allowed on the team.` };
  if (typeof o.role !== 'string' || !ROLES.includes(o.role as TeamRole)) return { ok: false, error: `role must be ${ROLE_LIST}` };
  const rep = 'jobtreadSalesRep' in o ? parseRepName(o.jobtreadSalesRep) : { ok: true as const, value: undefined };
  if (!rep.ok) return { ok: false, error: `jobtreadSalesRep must be a name of at most ${MAX_REP_NAME} characters, or null` };
  const value: TeamMemberInput = {
    name: o.name.trim(),
    email: o.email.trim().toLowerCase(),
    role: o.role as TeamRole,
    phone: typeof o.phone === 'string' ? o.phone.trim() : undefined,
    canLogin: typeof o.canLogin === 'boolean' ? o.canLogin : undefined,
    notifyEmail: typeof o.notifyEmail === 'boolean' ? o.notifyEmail : undefined,
    notifySms: typeof o.notifySms === 'boolean' ? o.notifySms : undefined,
    ...(rep.value !== undefined ? { jobtreadSalesRep: rep.value } : {}),
  };
  return { ok: true, value };
}

export type TeamMemberPatch = Partial<TeamMemberInput> & { active?: boolean; reportsTo?: number | null };

/**
 * Same field whitelist as create, but every field optional and only present
 * keys are validated/copied — a PATCH must never be able to set a column
 * outside this list (e.g. googleSub, createdBy, reportsTo, jobtreadMembershipId)
 * by spreading the raw request body into the update.
 */
export function validateTeamMemberPatch(
  input: unknown,
): { ok: true; value: TeamMemberPatch } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Body must be an object' };
  const o = input as Record<string, unknown>;
  const value: TeamMemberPatch = {};

  if ('name' in o) {
    if (typeof o.name !== 'string' || !o.name.trim()) return { ok: false, error: 'name must be a non-empty string' };
    value.name = o.name.trim();
  }
  if ('email' in o) {
    if (typeof o.email !== 'string' || !EMAIL_RE.test(o.email)) return { ok: false, error: 'email must be a valid email' };
    if (isBlockedLoginEmail(o.email)) return { ok: false, error: `${o.email.trim().toLowerCase()} is not allowed on the team.` };
    value.email = o.email.trim().toLowerCase();
  }
  if ('role' in o) {
    if (typeof o.role !== 'string' || !ROLES.includes(o.role as TeamRole)) return { ok: false, error: `role must be ${ROLE_LIST}` };
    value.role = o.role as TeamRole;
  }
  if ('active' in o) {
    if (typeof o.active !== 'boolean') return { ok: false, error: 'active must be a boolean' };
    value.active = o.active;
  }
  if ('jobtreadSalesRep' in o) {
    const rep = parseRepName(o.jobtreadSalesRep);
    if (!rep.ok) return { ok: false, error: `jobtreadSalesRep must be a name of at most ${MAX_REP_NAME} characters, or null` };
    value.jobtreadSalesRep = rep.value;
  }
  if ('reportsTo' in o) {
    // The sales leader this person reports to (drives 'team' data scope).
    if (o.reportsTo !== null && !(Number.isInteger(o.reportsTo) && Number(o.reportsTo) > 0)) return { ok: false, error: 'reportsTo must be a team member id or null' };
    value.reportsTo = o.reportsTo === null ? null : Number(o.reportsTo);
  }
  if ('phone' in o) {
    if (o.phone !== null && typeof o.phone !== 'string') return { ok: false, error: 'phone must be a string' };
    value.phone = typeof o.phone === 'string' ? o.phone.trim() : undefined;
  }
  if ('canLogin' in o) {
    if (typeof o.canLogin !== 'boolean') return { ok: false, error: 'canLogin must be a boolean' };
    value.canLogin = o.canLogin;
  }
  if ('notifyEmail' in o) {
    if (typeof o.notifyEmail !== 'boolean') return { ok: false, error: 'notifyEmail must be a boolean' };
    value.notifyEmail = o.notifyEmail;
  }
  if ('notifySms' in o) {
    if (typeof o.notifySms !== 'boolean') return { ok: false, error: 'notifySms must be a boolean' };
    value.notifySms = o.notifySms;
  }
  return { ok: true, value };
}
