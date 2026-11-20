/**
 * The operator console's reads and writes (routes in ./routes.ts).
 *
 * Which access each one uses, narrowest first:
 *   - one company's details (team, integrations, counts) run AS THAT COMPANY
 *     (runAsCompany), so row level security still keeps every other company
 *     out of those queries;
 *   - the list of every company, changing a company's status, and the audit
 *     log are system work (runAsSystem), each with its own reason: a company
 *     cannot read another's row or change its own (migrations/0008), and the
 *     audit log is readable by the system role only (migrations/0011).
 * The company id always comes from the URL, never from the operator's own
 * session, which belongs to whatever company the operator signs in through.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  companies, companyIntegrations, integrationTokens, operatorAuditLog, teamMembers,
  type Company,
} from '../../shared/schema';
import { runAsCompany, runAsSystem } from '../tenant/context';
import { clearSessionRevalidationCache } from '../auth/middleware';
import { isLiveCompany } from '../../shared/company';
import { quoteForSeats, type Plan } from '../../shared/billing/pricing';
import { isGoodSubscription } from '../../shared/billing/status';

export const COMPANY_STATUSES = ['trial', 'active', 'paused', 'cancelled'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
export const USAGE_WINDOW_DAYS = 30;

/** Every number on the operator page for one company. */
export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  trialEndsAt: string | null;
  members: number;
  canSignIn: number;
  lastSignInAt: string | null;
  kynexProConnected: boolean;
  leads30d: number;
  messages30d: number;
  /**
   * Billing (shared/billing/pricing.ts, server/billing/*). The plan, seats and
   * monthly total are what the company's current team costs (people who can
   * sign in); subscriptionStatus is Stripe's, or null with no subscription.
   */
  plan: Plan;
  seats: number;
  monthlyTotalCents: number;
  subscriptionStatus: string | null;
  /** No subscription that is active, trialing or past due. */
  noSubscription: boolean;
  /** The last seat update to Stripe failed (retried hourly). */
  seatSyncFailed: boolean;
}

export interface TeamRow {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  canSignIn: boolean;
  hasPassword: boolean;
  lastSignInAt: string | null;
}

export interface AuditRow {
  at: string;
  operatorEmail: string;
  action: string;
  details: Record<string, unknown>;
}

export interface CompanyDetail extends CompanySummary {
  team: TeamRow[];
  integrations: string[];
  recentActions: AuditRow[];
}

const iso = (d: unknown): string | null => {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
const num = (v: unknown): number => Number(v) || 0;

/**
 * Names people know, for the providers in company_integrations and
 * integration_tokens. Names only: credentials are never read here.
 * ghl_webhook is the signing secret that comes with KynexPro, not a
 * connection of its own.
 */
const PROVIDER_NAMES: Record<string, string | null> = {
  ghl: 'KynexPro',
  ghl_webhook: null,
  jobtread: 'Current CRM (JobTread)',
  companycam: 'CompanyCam',
  quickbooks: 'QuickBooks',
  everee: 'Everee',
  gmail: 'Gmail',
};
export const integrationName = (provider: string): string | null =>
  provider in PROVIDER_NAMES ? PROVIDER_NAMES[provider] : provider.charAt(0).toUpperCase() + provider.slice(1);

/** The counts for one row, as SQL over the companies alias `c`. Each uses an index that starts with company_id. */
const summaryColumns = (since: Date) => sql`
  c.id, c.name, c.slug, c.status, c.created_at, c.trial_ends_at,
  (select count(*) from team_members m where m.company_id = c.id) as members,
  (select count(*) from team_members m where m.company_id = c.id and m.active and m.can_login) as can_sign_in,
  (select max(m.last_login_at) from team_members m where m.company_id = c.id) as last_sign_in_at,
  (c.ghl_location_id is not null and exists (
     select 1 from company_integrations i where i.company_id = c.id and i.provider = 'ghl')) as kynexpro,
  (select count(*) from leads l where l.company_id = c.id and l.created_at >= ${since}) as leads_30d,
  (select count(*) from comm_messages x where x.company_id = c.id and x.sent_at >= ${since}) as messages_30d,
  (select b.subscription_status from company_billing b where b.company_id = c.id) as subscription_status,
  (select b.seat_sync_error is not null from company_billing b where b.company_id = c.id) as seat_sync_failed`;

function toSummary(r: Record<string, unknown>): CompanySummary {
  const quote = quoteForSeats(num(r.can_sign_in));
  const subscriptionStatus = typeof r.subscription_status === 'string' ? r.subscription_status : null;
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    status: String(r.status),
    createdAt: iso(r.created_at) ?? '',
    trialEndsAt: iso(r.trial_ends_at),
    members: num(r.members),
    canSignIn: num(r.can_sign_in),
    lastSignInAt: iso(r.last_sign_in_at),
    kynexProConnected: r.kynexpro === true,
    leads30d: num(r.leads_30d),
    messages30d: num(r.messages_30d),
    plan: quote.plan,
    seats: quote.seats,
    monthlyTotalCents: quote.monthlyTotalCents,
    subscriptionStatus,
    noSubscription: !isGoodSubscription(subscriptionStatus),
    seatSyncFailed: r.seat_sync_failed === true,
  };
}

export const MAX_PAGE = 100;

/** Escape LIKE wildcards so a search for "50%" means those characters. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** Every company, newest first, a page at a time, optionally matching a name or slug. */
export async function listCompanies(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ companies: CompanySummary[]; total: number }> {
  const q = (opts.q || '').trim().slice(0, 100);
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 50), 1), MAX_PAGE);
  const offset = Math.min(Math.max(Math.floor(opts.offset ?? 0), 0), 1_000_000);
  const since = new Date(Date.now() - USAGE_WINDOW_DAYS * DAY_MS);
  const where = q ? sql`where c.name ilike ${likePattern(q)} or c.slug ilike ${likePattern(q)}` : sql``;
  return runAsSystem('operator console: list every company', async () => {
    const page = await db.execute(sql`select ${summaryColumns(since)} from companies c ${where}
      order by c.created_at desc, c.id limit ${limit} offset ${offset}`);
    const count = await db.execute(sql`select count(*) as n from companies c ${where}`);
    return { companies: (page.rows as Record<string, unknown>[]).map(toSummary), total: num((count.rows[0] as any)?.n) };
  });
}

/**
 * One company with its team, integrations and recent operator actions, or
 * null when there is no such company. Read as that company, so nothing here
 * can reach another company's rows; only its audit rows need system access.
 */
export async function getCompanyDetail(companyId: string): Promise<CompanyDetail | null> {
  const since = new Date(Date.now() - USAGE_WINDOW_DAYS * DAY_MS);
  const read = await runAsCompany(companyId, async () => {
    const rows = await db.execute(sql`select ${summaryColumns(since)} from companies c where c.id = ${companyId}`);
    if (!rows.rows[0]) return null;
    // Chosen columns only: never the password hash or the lockout counters.
    const team = await db.select({
      id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, role: teamMembers.role,
      active: teamMembers.active, canLogin: teamMembers.canLogin, lastLoginAt: teamMembers.lastLoginAt,
      hasPassword: sql<boolean>`${teamMembers.passwordHash} is not null`,
    }).from(teamMembers).orderBy(teamMembers.role, teamMembers.name);
    // Provider names only: the credentials columns are never selected.
    const saved = await db.select({ provider: companyIntegrations.provider }).from(companyIntegrations);
    const tokens = await db.select({ provider: integrationTokens.provider }).from(integrationTokens)
      .where(eq(integrationTokens.isActive, true));
    return { summary: toSummary(rows.rows[0] as Record<string, unknown>), team, providers: [...saved, ...tokens].map((p) => p.provider) };
  }, { loadProfile: false });
  if (!read) return null;
  const recentActions = await runAsSystem('operator console: read the audit log for one company', () =>
    db.select().from(operatorAuditLog).where(eq(operatorAuditLog.targetCompanyId, companyId))
      .orderBy(desc(operatorAuditLog.createdAt), desc(operatorAuditLog.id)).limit(20));
  const integrations = [...new Set(read.providers.map(integrationName).filter((n): n is string => !!n))].sort();
  return {
    ...read.summary,
    team: read.team.map((m) => ({
      id: m.id, name: m.name, email: m.email, role: m.role, active: m.active,
      canSignIn: m.active && m.canLogin, hasPassword: m.hasPassword === true, lastSignInAt: iso(m.lastLoginAt),
    })),
    integrations,
    recentActions: recentActions.map((a) => ({ at: iso(a.createdAt) ?? '', operatorEmail: a.operatorEmail, action: a.action, details: a.details })),
  };
}

/** The company row, or null. As that company: its own row is the only one it can read. */
export async function getCompany(companyId: string): Promise<Company | null> {
  const [row] = await runAsCompany(companyId, () => db.select().from(companies).where(eq(companies.id, companyId)), { loadProfile: false });
  return row ?? null;
}

export interface OperatorAction {
  operatorEmail: string;
  action: string;
  companyId: string | null;
  details?: Record<string, unknown>;
}

/** Append one row to the audit log. Never pass a link, token or password in `details`. */
export function recordOperatorAction(a: OperatorAction, tx: Pick<typeof db, 'insert'> = db): Promise<unknown> {
  return tx.insert(operatorAuditLog).values({
    operatorEmail: a.operatorEmail.trim().toLowerCase(),
    action: a.action,
    targetCompanyId: a.companyId,
    details: a.details ?? {},
  });
}

/** Write an audit row as system work, outside any other transaction. */
export const audit = (a: OperatorAction) =>
  runAsSystem(`operator console: audit ${a.action}`, () => recordOperatorAction(a));

/**
 * Set a company's status. Leaving the live statuses (trial, active) also ends
 * every session of the company's people, in the same transaction as the
 * change and its audit row, so all three happen or none does. Sign-in already
 * refuses a paused or cancelled company. Returns the old status and how many
 * sessions ended, or null when there is no such company.
 */
export async function setCompanyStatus(companyId: string, status: CompanyStatus, operatorEmail: string):
  Promise<{ from: string; to: CompanyStatus; sessionsEnded: number } | null> {
  const result = await runAsSystem('operator console: change one company\'s status', () => db.transaction(async (tx) => {
    const [before] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for('update');
    if (!before) return null;
    await tx.update(companies).set({ status, updatedAt: new Date() }).where(eq(companies.id, companyId));
    let sessionsEnded = 0;
    if (!isLiveCompany({ status })) {
      // The session table is global (no row level security); every signed-in
      // session names its company, so this reaches exactly this company's people.
      const ended = await tx.execute(sql`delete from "session" where sess->'user'->>'companyId' = ${companyId}`);
      sessionsEnded = ended.rowCount ?? 0;
    }
    await recordOperatorAction({
      operatorEmail, action: 'company.status', companyId,
      details: { from: before.status, to: status, sessionsEnded },
    }, tx);
    return { from: before.status, to: status, sessionsEnded };
  }));
  // This instance's cached roster checks; other instances' expire in 30 seconds,
  // and their sessions are already gone.
  if (result) clearSessionRevalidationCache();
  return result;
}

/** A slug from a company name: "Acme Roofing & Sons" becomes "acme-roofing-sons". */
export function slugify(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return base || 'company';
}

/** The first of slug, slug-2, slug-3 ... that no company has. */
export async function freeSlug(name: string): Promise<string> {
  const base = slugify(name);
  const taken = await runAsSystem('operator console: find a free company slug', async () => {
    const rows = await db.select({ slug: companies.slug }).from(companies)
      .where(sql`${companies.slug} = ${base} or ${companies.slug} like ${`${base}-%`}`);
    return new Set(rows.map((r) => r.slug));
  });
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

/** True when an email is already on any company's team (email is unique across Archie). */
export async function emailTaken(email: string): Promise<boolean> {
  const rows = await runAsSystem('operator console: check an email is free', () =>
    db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.email, email.trim().toLowerCase())).limit(1));
  return rows.length > 0;
}

/** One team member of the given company, as that company (another company's member is simply not found). */
export async function getMember(companyId: string, memberId: number) {
  const [row] = await runAsCompany(companyId, () => db.select({
    id: teamMembers.id, name: teamMembers.name, email: teamMembers.email, active: teamMembers.active, canLogin: teamMembers.canLogin,
  }).from(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.companyId, companyId))), { loadProfile: false });
  return row ?? null;
}
