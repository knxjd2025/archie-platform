/**
 * Reading what Roof Lee sends (docs/sisters/contract-v2.md in the Roof Lee
 * repository). A body that cannot be read at all is answered 400. A field
 * Archie does not know is data and never an error. One person in a team list
 * who cannot be added is left out and named; the rest are still added.
 */
import type { TeamRole } from '../../shared/rbac';

/**
 * Every role Roof Lee sends Archie. Archie is told the two sales roles (added
 * in Roof Lee on 2026-11-19) as they are, wherever a role is sent: a team
 * list, an `acting` block, `actingRole` in an address and a sign-in ticket.
 * A role missing here would be skipped in a team list, and the person would
 * lose their access, so a new Roof Lee role must be added here before Roof Lee
 * sends it.
 */
export const ROOFLI_ROLES = ['owner', 'admin', 'office', 'crew', 'sales_manager', 'salesperson'] as const;
export type RoofliRole = (typeof ROOFLI_ROLES)[number];

/**
 * A person's role in Archie, from their role in Roof Lee. Archie applies its
 * own rules to the role it holds, never to a role named in a request.
 *
 * A sales manager works like the office (Roof Lee's own words: "Like the
 * office, and can approve reports, proposals and messages to customers"; the
 * approving happens in Roof Lee, per kind of request, never as a wider tier),
 * so Archie holds them as office staff (`customer_service`): every customer
 * and lead, owned or not, and no money. Not Archie's sales leader (`manager`):
 * that role sees only its own leads and its direct reports', a reporting line
 * Roof Lee never sends, so a sales manager would lose every lead nobody owns.
 * A salesperson is Archie's sales rep (`sales`): only their own leads and
 * jobs, in reads and writes alike (shared/rbac.ts).
 */
export const ROLE_MAP: Record<RoofliRole, TeamRole> = {
  owner: 'admin',
  admin: 'admin',
  office: 'customer_service',
  crew: 'production',
  sales_manager: 'customer_service',
  salesperson: 'sales',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MEMBERS = 500;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Someone who could not be added, and why, in a plain sentence. */
export interface Skipped { authUserId: string; reason: string }

/** One person as Archie will hold them. */
export interface IncomingMember {
  authUserId: string;
  email: string;
  name: string;
  role: TeamRole;
}

export interface ProvisionPlan { keys: string[]; active: boolean; trial: boolean }

export interface CompanyRequest {
  roofliCompanyId: string;
  name: string;
  slug: string | undefined;
  city: string | null;
  state: string | null;
  members: IncomingMember[];
  skipped: Skipped[];
  facts: Record<string, unknown> | undefined;
  plan: ProvisionPlan | undefined;
  /** A KynexPro sub-account id. An id only: Roof Lee never sends a credential. */
  kynexproLocationId: string | undefined;
  timezone: string | null | undefined;
}

export const REASON = {
  email: 'This person has no email address that Archie can use.',
  role: 'This person has a role that Archie does not know.',
  taken: 'This email address already belongs to someone else in Archie.',
  blocked: 'This email address is not allowed in Archie.',
} as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * The team list. Fails only when the list itself cannot be read (it is not a
 * list, or someone in it has no shared sign-in id to name them by).
 */
export function parseMembers(raw: unknown): Parsed<{ members: IncomingMember[]; skipped: Skipped[] }> {
  if (!Array.isArray(raw)) return { ok: false, error: 'The team must be a list of people.' };
  if (raw.length > MAX_MEMBERS) return { ok: false, error: 'That team is too large to take in one request.' };
  const members: IncomingMember[] = [];
  const skipped: Skipped[] = [];
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || !isUuid(item.authUserId)) return { ok: false, error: 'Everyone on the team needs a sign-in id.' };
    const authUserId = item.authUserId.toLowerCase();
    // The same person listed twice is one person.
    if (seenIds.has(authUserId)) continue;
    seenIds.add(authUserId);
    const email = typeof item.email === 'string' ? item.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) { skipped.push({ authUserId, reason: REASON.email }); continue; }
    if (typeof item.role !== 'string' || !Object.hasOwn(ROLE_MAP, item.role)) { skipped.push({ authUserId, reason: REASON.role }); continue; }
    // Two people cannot share one address: the second is left out.
    if (seenEmails.has(email)) { skipped.push({ authUserId, reason: REASON.taken }); continue; }
    seenEmails.add(email);
    const fullName = typeof item.fullName === 'string' ? item.fullName.trim().slice(0, 120) : '';
    members.push({ authUserId, email, name: fullName || email.split('@')[0], role: ROLE_MAP[item.role as RoofliRole] });
  }
  return { ok: true, value: { members, skipped } };
}

function parsePlan(raw: unknown): ProvisionPlan | undefined {
  if (!isObject(raw) || typeof raw.active !== 'boolean' || typeof raw.trial !== 'boolean') return undefined;
  const keys = Array.isArray(raw.keys) ? raw.keys.filter((k): k is string => typeof k === 'string' && k.length <= 80).slice(0, 50) : [];
  return { keys, active: raw.active, trial: raw.trial };
}

/** The body of POST /api/sister/v1/companies. */
export function parseCompanyRequest(body: Record<string, unknown> | undefined): Parsed<CompanyRequest> {
  if (!body) return { ok: false, error: 'The request has no body.' };
  if (!isUuid(body.roofliCompanyId)) return { ok: false, error: 'The company id is missing or is not an id.' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) return { ok: false, error: 'The company needs a name of at most 200 characters.' };
  const team = parseMembers(body.members);
  if (!team.ok) return team;
  return {
    ok: true,
    value: {
      roofliCompanyId: body.roofliCompanyId.toLowerCase(),
      name,
      slug: typeof body.slug === 'string' ? body.slug : undefined,
      city: textOrNull(body.city),
      state: textOrNull(body.state),
      members: team.value.members,
      skipped: team.value.skipped,
      facts: isObject(body.facts) ? body.facts : undefined,
      plan: parsePlan(body.plan),
      kynexproLocationId: typeof body.kynexproLocationId === 'string' && /^[A-Za-z0-9]{10,40}$/.test(body.kynexproLocationId) ? body.kynexproLocationId : undefined,
      timezone: body.timezone === null ? null : typeof body.timezone === 'string' ? body.timezone : undefined,
    },
  };
}

/** Who a write is for: a statement by Roof Lee, covered by the signature. Not a sign-in. */
export interface Acting { authUserId: string; role: RoofliRole }

/** The `acting` block of a write. Absent is allowed where the contract says so; present must be whole. */
export function parseActing(raw: unknown): Parsed<Acting | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!isObject(raw) || !isUuid(raw.authUserId) || typeof raw.role !== 'string' || !(ROOFLI_ROLES as readonly string[]).includes(raw.role)) {
    return { ok: false, error: 'The person this request is for could not be read.' };
  }
  return { ok: true, value: { authUserId: raw.authUserId.toLowerCase(), role: raw.role as RoofliRole } };
}

/**
 * True when a body names the company in its address. The version 1 signature
 * covers only the body, so on those endpoints the body MUST name the company:
 * that is all that stops a request signed for one company being sent to
 * another's address.
 */
export function namesCompany(body: Record<string, unknown> | undefined, roofliCompanyId: string): boolean {
  return isUuid(body?.roofliCompanyId) && body.roofliCompanyId.toLowerCase() === roofliCompanyId.toLowerCase();
}

export type CloseMode = 'pause' | 'close';
export const isCloseMode = (v: unknown): v is CloseMode => v === 'pause' || v === 'close';

/** The two address fields that say who a read is for, with the same meaning as `acting` on a write. */
export const ACTING_USER_PARAM = 'actingUserId';
export const ACTING_ROLE_PARAM = 'actingRole';

/**
 * Who a read is for, from its address (which the signature covers). Both
 * fields absent means nobody: the scheduled run. One without the other, or
 * either unreadable, is a mistake.
 */
export function parseActingQuery(query: Record<string, unknown>): Parsed<Acting | undefined> {
  const authUserId = query[ACTING_USER_PARAM];
  const role = query[ACTING_ROLE_PARAM];
  if (authUserId === undefined && role === undefined) return { ok: true, value: undefined };
  const parsed = parseActing({ authUserId, role });
  return parsed.ok && !parsed.value ? { ok: false, error: 'The person this request is for could not be read.' } : parsed;
}

/**
 * An id as Archie gives one out for a lead or a job: a whole number, as
 * digits. Anything else names nothing here.
 */
export function parseRecordId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,8}$/.test(raw)) return null;
  return Number(raw);
}

const PHONE_RE = /^[\d\s()+.-]{7,20}$/;

/** Plain text of at most `max` characters, or undefined when the field was not sent. `null` when it cannot be used. */
function words(raw: unknown, max: number): string | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const tidy = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim();
  if (tidy.length > max) return null;
  return tidy === '' ? undefined : tidy;
}

export interface NewLead {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  town?: string;
  jobType?: string;
  message?: string;
}

/** The body of POST .../leads. Only the fields the agreement lists are read. */
export function parseNewLead(body: Record<string, unknown> | undefined): Parsed<NewLead> {
  if (!body) return { ok: false, error: 'The request has no body.' };
  const name = words(body.name, 200);
  if (!name) return { ok: false, error: 'A lead needs a name of at most 200 characters.' };
  const phone = words(body.phone, 40);
  if (phone === null || (phone && !PHONE_RE.test(phone))) return { ok: false, error: 'That phone number does not look right.' };
  const email = words(body.email, 254);
  if (email === null || (email && !EMAIL_RE.test(email))) return { ok: false, error: 'That email address does not look right.' };
  const address = words(body.address, 300);
  const town = words(body.town, 80);
  const jobType = words(body.jobType, 80);
  const message = words(body.message, 4000);
  if (address === null || town === null || jobType === null || message === null) return { ok: false, error: 'One of the fields is too long or is not text.' };
  return { ok: true, value: { name, phone, email: email?.toLowerCase(), address, town, jobType, message } };
}

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'disqualified'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadChange {
  status?: LeadStatus;
  notes?: string;
  name?: string;
  phone?: string;
  email?: string;
}

/** The body of PATCH .../leads/{id}. At least one field must be given. */
export function parseLeadChange(body: Record<string, unknown> | undefined): Parsed<LeadChange> {
  if (!body) return { ok: false, error: 'The request has no body.' };
  const change: LeadChange = {};
  if (body.status !== undefined && body.status !== null) {
    if (typeof body.status !== 'string' || !(LEAD_STATUSES as readonly string[]).includes(body.status)) {
      return { ok: false, error: `The status must be one of: ${LEAD_STATUSES.join(', ')}.` };
    }
    change.status = body.status as LeadStatus;
  }
  const notes = words(body.notes, 4000);
  const name = words(body.name, 200);
  const phone = words(body.phone, 40);
  const email = words(body.email, 254);
  if (notes === null || name === null) return { ok: false, error: 'One of the fields is too long or is not text.' };
  if (phone === null || (phone && !PHONE_RE.test(phone))) return { ok: false, error: 'That phone number does not look right.' };
  if (email === null || (email && !EMAIL_RE.test(email))) return { ok: false, error: 'That email address does not look right.' };
  if (notes) change.notes = notes;
  if (name) change.name = name;
  if (phone) change.phone = phone;
  if (email) change.email = email.toLowerCase();
  if (Object.keys(change).length === 0) return { ok: false, error: 'Say what to change.' };
  return { ok: true, value: change };
}

/** The body of POST .../leads/{id}/notes. */
export function parseNote(body: Record<string, unknown> | undefined): Parsed<string> {
  const text = words(body?.text, 2000);
  if (!text) return { ok: false, error: 'A note needs some text, at most 2000 characters.' };
  return { ok: true, value: text };
}
