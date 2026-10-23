import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  pgEnum,
  uuid,
  varchar,
  decimal,
  doublePrecision,
  uniqueIndex,
  index,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type { CommissionSources } from './job-commission';


// ============================================================
// Companies (tenancy) — see docs/archie/01-multi-company.md
// ============================================================

/**
 * One row per home service company using Archie. Every other table carries a
 * company_id pointing here, and row level security in the database keeps each
 * company's rows invisible to every other company.
 */
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // Picks the trade pack (inspections, report sections, wording).
  trade: text('trade').notNull().default('roofing'),
  status: text('status', { enum: ['trial', 'active', 'paused', 'cancelled'] }).notNull().default('trial'),
  // The company's GHL sub-account, which holds its contacts, messages,
  // calendars and pipelines.
  ghlLocationId: text('ghl_location_id').unique(),
  branding: jsonb('branding').$type<import('./company').CompanyBranding>().notNull().default({}),
  settings: jsonb('settings').$type<import('./company').CompanySettings>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Company = typeof companies.$inferSelect;

/**
 * The company a row belongs to. The default stamps the company of the current
 * request (set per connection by server/db.ts), so insert code does not have to
 * pass it, and with no company set the insert fails instead of landing nowhere.
 */
const companyId = () => uuid('company_id').notNull().references(() => companies.id).default(sql`archie_current_company()`);

/**
 * Credentials for a company's connected apps (GHL first). Read only by server
 * code; never sent to the browser.
 */
/**
 * One-time tokens that carry a browser sign-in into the native app
 * (server/auth/native-handoff.ts). Only the token's SHA-256 is stored. Its own
 * table, not settings: nothing but the handoff code writes it, so a row here
 * can be trusted to name the company and person it was minted for.
 */
export const nativeHandoffs = pgTable('native_handoffs', {
  companyId: companyId(),
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const companyIntegrations = pgTable('company_integrations', {
  id: serial('id').primaryKey(),
  companyId: companyId(),
  provider: text('provider').notNull(),
  // Encrypted with ARCHIE_SECRETS_KEY (server/tenant/secrets.ts).
  credentials: text('credentials').notNull(),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  oneProviderPerCompany: uniqueIndex('company_integrations_company_provider_uq').on(t.companyId, t.provider),
}));

// Enums
export const agentRoleEnum = pgEnum('agent_role', [
  'ceo',
  'cfo',
  'cmo',
  'cto',
  'coo',
  'sales_manager',
  'customer_service',
  'project_coordinator',
  'estimator',
  'cpa',
  'tax_accountant',
  'tax_lawyer',
]);

export const agentStatusEnum = pgEnum('agent_status', ['active', 'paused', 'disabled']);

export const leadStatusEnum = pgEnum('lead_status', [
  'new',
  'contacted',
  'qualified',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
  'disqualified',
]);

export const taskStatusEnum = pgEnum('task_status', ['pending', 'in_progress', 'completed', 'failed']);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);

// 'manager' is the stored value for a Sales Leader — it predates the org chart
// and is load-bearing in this enum and in every atLeast('manager') call.
// shared/rbac.ts ROLE_LABEL renders it "Sales Leader" for humans.
export const teamRoleEnum = pgEnum('team_role', ['admin', 'sales_director', 'manager', 'customer_service', 'sales', 'production']);

export const kpiEventTypeEnum = pgEnum('kpi_event_type', ['door_knock', 'lead_contacted', 'report_created', 'report_presented', 'referral_received', 'lead_given']);

// Users table
export const users = pgTable('users', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  password: text('password').notNull(),
  name: text('name').notNull(),
  role: text('role').default('user'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('users_company_email_uq').on(t.companyId, t.email),
}));

// Team members — authoritative roster for role, login gate, and contact info
export const teamMembers = pgTable('team_members', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  role: teamRoleEnum('role').notNull(),
  active: boolean('active').notNull().default(true),
  canLogin: boolean('can_login').notNull().default(false),
  notifyEmail: boolean('notify_email').notNull().default(true),
  notifySms: boolean('notify_sms').notNull().default(false),
  googleSub: text('google_sub'),
  lastLoginAt: timestamp('last_login_at'),
  createdBy: text('created_by'),
  // The exact JobTread "Sales Rep" dropdown value for this person (e.g.
  // "Dana Reed"). Used to attribute JobTread jobs to a rep login.
  jobtreadSalesRep: text('jobtread_sales_rep'),
  // Reporting line: the sales leader this person reports to. Drives 'team'
  // data scope — a leader sees their own records plus their direct reports'.
  // Self-referential, so it is typed loosely here and constrained in SQL.
  reportsTo: integer('reports_to'),
  // JobTread membership id, so the reporting line can be synced both ways
  // (JobTread models this as membership.parentMembership).
  jobtreadMembershipId: text('jobtread_membership_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

// In-app rep→job overrides. Keyed by JobTread job id so a re-sync (which
// rebuilds the leads rows) never wipes them. An override wins over the
// JobTread "Sales Rep" field in the resolver.
export const repAssignments = pgTable('rep_assignments', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  // NOT unique: a job can be shared. Uniqueness is on (job, member), with a
  // partial unique index keeping at most one 'primary' per job.
  jobExternalId: text('job_external_id').notNull(),
  teamMemberId: integer('team_member_id').notNull().references((): AnyPgColumn => teamMembers.id),
  /** 'primary' owns it (commission, "my book"); 'secondary' shares visibility. */
  role: text('role').notNull().default('primary'),
  /** 'manual' | 'jobtread_task' | 'jobtread_comment' | 'calendar' | 'jt_sales_rep' */
  source: text('source').notNull().default('manual'),
  /** 'high' | 'medium' | 'low' — lets a human tell a guess from a decision. */
  confidence: text('confidence'),
  /** Human-readable why, e.g. "task assigned to Dana Reed". */
  evidence: text('evidence'),
  assignedBy: text('assigned_by'),
  assignedAt: timestamp('assigned_at').defaultNow(),
});

export type RepAssignment = typeof repAssignments.$inferSelect;
export type NewRepAssignment = typeof repAssignments.$inferInsert;

// Follow-up reminders on a client/lead — "call back Friday". Stored locally
// (reliable, powers the dashboard "due today"); optionally mirrored to JobTread
// as a comment. Rep-scoped via assignedTo / the linked job.
export const followUps = pgTable('follow_ups', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id'),      // JobTread job id (the client), nullable
  clientName: text('client_name'),
  note: text('note').notNull(),
  dueDate: date('due_date'),                    // YYYY-MM-DD (date-only)
  assignedTo: integer('assigned_to').references((): AnyPgColumn => teamMembers.id),
  createdBy: text('created_by'),                // session user email
  done: boolean('done').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});

export type FollowUp = typeof followUps.$inferSelect;
export type NewFollowUp = typeof followUps.$inferInsert;

// Per-person, per-agent chat threads that reset each business day. One row per
// (user, agent, day) — so a new day always starts a fresh conversation — with a
// day-end AI summary stored on the row, letting the agents recall past days.
export const agentChats = pgTable('agent_chats', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  userEmail: text('user_email').notNull(),
  agentKey: text('agent_key').notNull(),        // 'advisor' | exec/team agent role
  day: text('day').notNull(),                   // YYYY-MM-DD (the company's business day)
  summary: text('summary'),
  summarizedAt: timestamp('summarized_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  // chat-store.ts opens today's thread with ON CONFLICT on these three columns;
  // without this index Postgres rejects that insert outright (migration 0041).
  userAgentDay: uniqueIndex('agent_chats_user_agent_day_uq').on(t.userEmail, t.agentKey, t.day),
}));

export const agentChatMessages = pgTable('agent_chat_messages', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  chatId: integer('chat_id').notNull().references((): AnyPgColumn => agentChats.id),
  role: text('role').notNull(),                 // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type AgentChat = typeof agentChats.$inferSelect;
export type AgentChatMessage = typeof agentChatMessages.$inferSelect;

// Roof reports requested from the Reports API, tracked per client. The Reports
// API has no list endpoint, so this is how a client's reports are found again;
// status/urls are refreshed by polling the job while it's still running.
export const clientReports = pgTable('client_reports', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  reportId: text('report_id').notNull().unique(),
  reportType: text('report_type'),
  status: text('status').notNull().default('queued'),   // queued|running|succeeded|failed
  reportUrl: text('report_url'),
  pdfUrl: text('pdf_url'),
  error: text('error'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  // Reports are generated in-process and stored here — the rendered HTML, the
  // structured report (drives the JobTread proposal/budget), and a token that
  // makes the report shareable at /r/<token>.
  html: text('html'),
  data: jsonb('data'),
  shareToken: text('share_token'),
  title: text('title'),
  /** Set when a rep marks this report as shown to the customer (in person or otherwise) — distinct from "generated" and from a JobTread proposal "send". */
  presentedAt: timestamp('presented_at'),
  presentedBy: text('presented_by'),
  /**
   * The JobTread proposal this report produced. Without it a second push
   * creates a SECOND proposal on the same job — two different prices in front
   * of one customer — instead of updating the first.
   */
  jobtreadDocumentId: text('jobtread_document_id'),
  jobtreadPushedAt: timestamp('jobtread_pushed_at'),
  /**
   * Fingerprint of the LINE ITEMS last sent — not the whole report, so a
   * prose-only refinement does not raise a false "out of date" flag while a
   * price or scope change does.
   */
  jobtreadPushedHash: text('jobtread_pushed_hash'),
  /** draft | pending | approved | denied, as JobTread reported it at push time. */
  jobtreadDocStatus: text('jobtread_doc_status'),
  /**
   * Customer engagement with the shared report page: which chapters they
   * actually scrolled to (by object id) and which Good/Better/Best tier they
   * tapped, reported back from the page itself via POST /r/:token/track.
   * Shape: { viewedChapterIds: string[], selectedTier: 'good'|'better'|'best'|null, lastEventAt: string }
   * Nobody reads this from a rep-facing screen yet — it's captured so that
   * surface can be built next without a second migration.
   */
  engagement: jsonb('engagement'),
}, (t) => ({
  // Public links find their company by this token, so it must name one report.
  shareTokenUq: uniqueIndex('client_reports_share_token_uq').on(t.shareToken),
}));

export type ClientReport = typeof clientReports.$inferSelect;

// Door-to-door canvassing: houses a rep pins in the field, with the storm
// history and rough roof measurements pulled for that address.
export const canvassProperties = pgTable('canvass_properties', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  address: text('address').notNull(),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  status: text('status').notNull().default('not_knocked'),
  notes: text('notes'),
  ownerName: text('owner_name'),
  phone: text('phone'),
  email: text('email'),
  stormSummary: jsonb('storm_summary'),
  measurements: jsonb('measurements'),
  /** Set once the door turns into a real lead/job. */
  leadExternalId: text('lead_external_id'),
  knockedBy: text('knocked_by'),
  knockedAt: timestamp('knocked_at'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type CanvassProperty = typeof canvassProperties.$inferSelect;

// A neighbourhood the rep drew on the canvass map and pulled owner contacts
// for through Tracerfy's Lead Builder (shared/canvass-areas.ts). Tracerfy takes
// a radius, so `geography` is the covering circle and `shape` the real drawing;
// each delivered home is tested against the drawing (canvass_enrichment.in_area).
export const canvassAreas = pgTable('canvass_areas', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  shape: jsonb('shape').notNull(),
  filters: jsonb('filters').notNull(),
  geography: jsonb('geography').notNull(),
  status: text('status').notNull().default('pending'), // pending | running | importing | complete | failed
  tracerfyListId: integer('tracerfy_list_id'),
  previewCount: integer('preview_count'),
  requestedCount: integer('requested_count'),
  deliveredCount: integer('delivered_count'),
  inAreaCount: integer('in_area_count'),
  creditsDeducted: integer('credits_deducted'),
  error: text('error'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});
export type CanvassArea = typeof canvassAreas.$inferSelect;

// What Tracerfy knows about a canvassed home: owner, phones with DNC/TCPA
// flags, emails, roof and property facts, propensity scores. One row per
// home; kept apart from canvass_properties (owned by another role) and from
// the rep's own contact fields, which stay hand-edited.
export const canvassEnrichment = pgTable('canvass_enrichment', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  canvassPropertyId: integer('canvass_property_id').notNull().unique(),
  areaId: integer('area_id'),
  source: text('source').notNull().default('tracerfy'),
  inArea: boolean('in_area'),
  ownerName: text('owner_name'),
  owner2Name: text('owner2_name'),
  mailingAddress: text('mailing_address'),
  phones: jsonb('phones').notNull().default([]),
  emails: jsonb('emails').notNull().default([]),
  litigator: boolean('litigator'),
  contactClean: boolean('contact_clean'),
  propertyType: text('property_type'),
  yearBuilt: integer('year_built'),
  buildingSqft: integer('building_sqft'),
  roofMaterial: text('roof_material'),
  roofConstruction: text('roof_construction'),
  estimatedValue: integer('estimated_value'),
  equityPercent: doublePrecision('equity_percent'),
  yearsOwned: integer('years_owned'),
  ownerOccupied: boolean('owner_occupied'),
  absenteeOwner: boolean('absentee_owner'),
  highEquity: boolean('high_equity'),
  freeClear: boolean('free_clear'),
  vacant: boolean('vacant'),
  mlsActive: boolean('mls_active'),
  roofScore: integer('roof_score'),
  sellScore: integer('sell_score'),
  raw: jsonb('raw'),
  creditsSpent: integer('credits_spent'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
export type CanvassEnrichment = typeof canvassEnrichment.$inferSelect;

// Who a canvassed house belongs to, and the rep's own labels and follow-up date
// for it (migration 0038). Kept apart from canvass_properties, which is owned
// by another role. No row → the house belongs to canvass_properties.created_by.
export const canvassPropertyMeta = pgTable('canvass_property_meta', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  canvassPropertyId: integer('canvass_property_id').notNull().unique(),
  ownerEmail: text('owner_email'),
  labels: text('labels').array().notNull().default([]),
  followUpAt: timestamp('follow_up_at'),
  assignedBy: text('assigned_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
export type CanvassPropertyMeta = typeof canvassPropertyMeta.$inferSelect;

// One row per rep per day the morning "update your leads" reminder went out.
export const repDailyReminders = pgTable('rep_daily_reminders', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  teamMemberId: integer('team_member_id').notNull().references((): AnyPgColumn => teamMembers.id),
  reminderDate: date('reminder_date').notNull(),
  counts: jsonb('counts').notNull().default({}),
  emailStatus: text('email_status'),
  smsStatus: text('sms_status'),
  error: text('error'),
  sentAt: timestamp('sent_at').defaultNow(),
}, (t) => ({
  // One check-in per rep per day: the cron claims the day by inserting this row.
  companyRepDayUq: uniqueIndex('rep_daily_reminders_company_rep_day_uq').on(t.companyId, t.teamMemberId, t.reminderDate),
}));
export type RepDailyReminder = typeof repDailyReminders.$inferSelect;

// Bugs: what people report with the "Report a bug" button, and the errors the
// app catches on its own (a screen that crashed, a request that failed on the
// server). Caught errors are grouped by `fingerprint` — the same failure a
// hundred times is one row with `occurrences` = 100, not a hundred rows. A
// person's report has no fingerprint and is always its own row.
export const bugReports = pgTable('bug_reports', {
  // Null for errors raised before anyone is signed in (no company yet).
  companyId: uuid('company_id').references(() => companies.id).default(sql`archie_current_company()`),
  id: serial('id').primaryKey(),
  kind: text('kind').notNull(), // 'report' | 'client_error' | 'server_error'
  status: text('status').notNull().default('new'), // 'new' | 'fixing' | 'fixed' | 'ignored'
  fingerprint: text('fingerprint'),
  message: text('message').notNull(),
  details: text('details'),
  page: text('page'),
  url: text('url'),
  userEmail: text('user_email'),
  userAgent: text('user_agent'),
  context: jsonb('context').notNull().default({}),
  screenshot: text('screenshot'),
  occurrences: integer('occurrences').notNull().default(1),
  firstSeen: timestamp('first_seen').notNull().defaultNow(),
  lastSeen: timestamp('last_seen').notNull().defaultNow(),
  notes: text('notes'),
});
export type BugReport = typeof bugReports.$inferSelect;

// Inbox watch: each scan of a mailbox (its window, so the next one starts
// where it stopped) and the emails worth a rep's attention that it found.
export const inboxScans = pgTable('inbox_scans', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  mailbox: text('mailbox').notNull(),
  fromAt: timestamp('from_at').notNull(),
  toAt: timestamp('to_at').notNull(),
  messagesSeen: integer('messages_seen').notNull().default(0),
  itemsAdded: integer('items_added').notNull().default(0),
  flagged: integer('flagged').notNull().default(0),
  startedBy: text('started_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const inboxItems = pgTable('inbox_items', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  mailbox: text('mailbox').notNull(),
  messageId: text('message_id').notNull(),
  threadId: text('thread_id'),
  fromName: text('from_name'),
  fromEmail: text('from_email'),
  subject: text('subject'),
  snippet: text('snippet'),
  receivedAt: timestamp('received_at'),
  category: text('category').notNull().default('other'), // lead | customer | important | other
  score: integer('score').notNull().default(0),
  reason: text('reason'),
  matchedExternalId: text('matched_external_id'),
  matchedName: text('matched_name'),
  status: text('status').notNull().default('new'), // new | handled | dismissed
  unread: boolean('unread'),
  handledBy: text('handled_by'),
  handledAt: timestamp('handled_at'),
  followUpId: integer('follow_up_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  mailboxMessage: uniqueIndex('inbox_items_mailbox_message_idx').on(t.mailbox, t.messageId),
}));
export type InboxItem = typeof inboxItems.$inferSelect;

// Sales-activity KPI log: doors knocked, leads run (contacted), reports made
// and presented. One row per discrete event, attributed to a team member —
// powers the admin (all reps) and sales-rep (own only) KPI dashboards.
export const kpiEvents = pgTable('kpi_events', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  teamMemberId: integer('team_member_id').references(() => teamMembers.id),
  repName: text('rep_name'), // fallback label when attribution can't resolve a teamMemberId
  type: kpiEventTypeEnum('type').notNull(),
  refTable: text('ref_table'), // 'canvass_properties' | 'client_reports' | 'leads'
  refId: text('ref_id'),
  /** Referral source, or a short line of context for a manually logged event. */
  note: text('note'),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type KpiEvent = typeof kpiEvents.$inferSelect;
export type NewKpiEvent = typeof kpiEvents.$inferInsert;

export const commissionStatusEnum = pgEnum('commission_status', ['draft', 'approved']);

// Commission calculations, ported from a standalone commission calculator
// tool into the app so a manager's approval is a durable record (not lost on
// refresh) and the AI advisors can read/write the same numbers.
export const commissions = pgTable('commissions', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id'), // optional free-text JobTread id/number link
  jobName: text('job_name').notNull(),
  teamMemberId: integer('team_member_id').references(() => teamMembers.id),
  repName: text('rep_name').notNull(),
  leadSource: text('lead_source').notNull(), // 'self' | 'company'
  jobType: text('job_type').notNull(),       // 'retail' | 'insurance'
  overheadPct: decimal('overhead_pct', { precision: 5, scale: 2 }).notNull(),
  overrideUsed: boolean('override_used').notNull().default(false),
  revenue: decimal('revenue', { precision: 12, scale: 2 }).notNull(),
  material: decimal('material', { precision: 12, scale: 2 }).notNull().default('0'),
  labor: decimal('labor', { precision: 12, scale: 2 }).notNull().default('0'),
  other: decimal('other', { precision: 12, scale: 2 }).notNull().default('0'),
  profit: decimal('profit', { precision: 12, scale: 2 }).notNull(),
  commissionAmount: decimal('commission_amount', { precision: 12, scale: 2 }).notNull(),
  status: commissionStatusEnum('status').notNull().default('draft'),
  createdBy: text('created_by').notNull(),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type Commission = typeof commissions.$inferSelect;
export type NewCommission = typeof commissions.$inferInsert;

export const jobCommissionStatusEnum = pgEnum('job_commission_status', ['open', 'approved', 'denied', 'paid']);

// One per sold JobTread job — created automatically when the job is sold
// (leads sync / stage change / first open of the client profile), pre-filled
// from the job, then walked through a rep + admin checklist before an admin
// approves and pays it. The rep's free-form Commission Calculator (table
// above) is untouched; this is the admin's per-client record. Checklist keys
// and the readiness rules live in shared/job-commission.ts.
export const jobCommissions = pgTable('job_commissions', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  jobName: text('job_name'),
  teamMemberId: integer('team_member_id').references(() => teamMembers.id),
  repName: text('rep_name'),
  leadSource: text('lead_source'),                       // 'self' | 'company' — null until the rep says
  jobType: text('job_type').notNull().default('retail'), // 'retail' | 'insurance'
  manualOverheadPct: decimal('manual_overhead_pct', { precision: 5, scale: 2 }), // admin override, else rate table
  overheadPct: decimal('overhead_pct', { precision: 5, scale: 2 }),
  revenue: decimal('revenue', { precision: 12, scale: 2 }).notNull().default('0'),
  material: decimal('material', { precision: 12, scale: 2 }).notNull().default('0'),
  labor: decimal('labor', { precision: 12, scale: 2 }).notNull().default('0'),
  other: decimal('other', { precision: 12, scale: 2 }).notNull().default('0'),
  profit: decimal('profit', { precision: 12, scale: 2 }),
  commissionAmount: decimal('commission_amount', { precision: 12, scale: 2 }),
  /** { [checkKey]: { by, at } } — a ticked box; absent = unticked. */
  checks: jsonb('checks').$type<Record<string, { by: string; at: string }>>().notNull().default({}),
  /**
   * Per-line breakdown: { material: [{ kind:'doc'|'manual', label, amount, docId… }] }.
   * A line with sources has its numeric column rewritten to their sum on save,
   * so the columns above stay the one figure every read path uses.
   */
  sources: jsonb('sources').$type<CommissionSources>().notNull().default({}),
  /**
   * Draws already paid to the rep against this job — the 10% taken off the top
   * of each customer payment before the final one. Deducted from the rep's
   * half only; the company's half is untouched by it.
   */
  advancesPaid: decimal('advances_paid', { precision: 12, scale: 2 }).notNull().default('0'),
  /** commission_amount − advances_paid: what is still owed. Negative = overpaid. */
  balanceDue: decimal('balance_due', { precision: 12, scale: 2 }),
  /**
   * A commission set by hand, overriding the formula. Some jobs are settled on
   * something other than half the profit and the record has to be able to say
   * so out loud rather than have someone bend the costs until the number comes
   * out right.
   */
  manualCommission: decimal('manual_commission', { precision: 12, scale: 2 }),
  /** Why a commission was denied. Required when it is — a bare 'denied' helps nobody. */
  deniedReason: text('denied_reason'),
  deniedBy: text('denied_by'),
  deniedAt: timestamp('denied_at'),
  notes: text('notes'),
  status: jobCommissionStatusEnum('status').notNull().default('open'),
  createdBy: text('created_by').notNull(), // email, or 'system:sync' / 'system:stage'
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at'),
  paidBy: text('paid_by'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('job_commissions_company_job_external_id_uq').on(t.companyId, t.jobExternalId),
}));

export type JobCommission = typeof jobCommissions.$inferSelect;
export type NewJobCommission = typeof jobCommissions.$inferInsert;

/**
 * Who gets paid on a job, and how much of its pool. A job earns one commission
 * — half the profit, or a figure set by hand — and when two reps worked it,
 * that one pool is divided here. The job's money stays on job_commissions and
 * is never copied down, because a revenue figure that exists in two places is
 * a revenue figure that eventually disagrees with itself.
 *
 * job_commissions keeps its rep_name, team_member_id, commission_amount,
 * balance_due and status columns as a roll-up of these rows, rewritten on
 * every write, so the agenda, the scorecard, the AI tools and the rep-scoping
 * predicate all keep reading the one column they always read.
 */
export const jobCommissionSplits = pgTable('job_commission_splits', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobCommissionId: integer('job_commission_id').notNull().references(() => jobCommissions.id, { onDelete: 'cascade' }),
  teamMemberId: integer('team_member_id').references(() => teamMembers.id),
  repName: text('rep_name'),
  /** This rep's percentage of the pool. Shares across a job must come to 100. */
  sharePct: decimal('share_pct', { precision: 5, scale: 2 }).notNull().default('100.00'),
  /** A figure agreed for this rep regardless of the share; null means use the share. */
  manualAmount: decimal('manual_amount', { precision: 12, scale: 2 }),
  /** What this rep earned: pool x share, or manual_amount. */
  commissionAmount: decimal('commission_amount', { precision: 12, scale: 2 }),
  /** commission_amount minus everything paid on this split. Negative = overpaid. */
  balanceDue: decimal('balance_due', { precision: 12, scale: 2 }),
  status: jobCommissionStatusEnum('status').notNull().default('open'),
  deniedReason: text('denied_reason'),
  deniedBy: text('denied_by'),
  deniedAt: timestamp('denied_at'),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
export type JobCommissionSplit = typeof jobCommissionSplits.$inferSelect;
export type NewJobCommissionSplit = typeof jobCommissionSplits.$inferInsert;

/**
 * Every payment actually handed to a rep on a job. The company pays on each
 * customer check as it lands, so one rep on one job is usually several of
 * these: the 10% draws off the top of each check, then the balance at the end.
 *
 * "Advances paid" is the sum of the draw rows rather than a figure kept up to
 * date by hand, so there is only one place the number can come from and no way
 * for two of them to disagree. `reference` is the check the money came out of.
 */
export const jobCommissionPayouts = pgTable('job_commission_payouts', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  splitId: integer('split_id').notNull().references(() => jobCommissionSplits.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  /** 'draw' — off the top of a customer check; 'balance' — the settle-up. */
  kind: text('kind').notNull().default('draw'),
  /** Which customer check this came out of, in whatever way the office names them. */
  reference: text('reference'),
  note: text('note'),
  paidAt: timestamp('paid_at').notNull().defaultNow(),
  paidBy: text('paid_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
export type JobCommissionPayout = typeof jobCommissionPayouts.$inferSelect;
export type NewJobCommissionPayout = typeof jobCommissionPayouts.$inferInsert;

// Audit trail for every write-back action to JobTread/GHL. Since writes are
// direct (no approval queue), this gives accountability: who did what, where.
export const writeLog = pgTable('write_log', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  actor: text('actor').notNull(),        // session user email
  system: text('system').notNull(),      // 'jobtread' | 'ghl'
  action: text('action').notNull(),      // 'set_stage' | 'add_note' | 'reply_sms' | 'reply_email' | 'update_contact' | 'create_lead'
  targetId: text('target_id'),           // job / contact id
  summary: text('summary'),              // human-readable
  ok: boolean('ok').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  // Finishing a signed document asks "has this step been done?" of the log on
  // every job view (server/signatures/routes.ts); without this each ask was a
  // scan of the whole log. Migration 0042.
  actionTargetIdx: index('write_log_action_target_idx').on(t.action, t.targetId),
}));

export type WriteLog = typeof writeLog.$inferSelect;
export type NewWriteLog = typeof writeLog.$inferInsert;

// Agents table - AI executive team definitions
export const agents = pgTable('agents', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  role: agentRoleEnum('role').notNull(),
  title: text('title').notNull(), // e.g., "Chief Marketing Officer"
  persona: text('persona').notNull(), // Character description
  systemPrompt: text('system_prompt').notNull(),
  tools: jsonb('tools').$type<string[]>().default([]),
  status: agentStatusEnum('status').default('active'),
  avatar: text('avatar'), // URL or emoji
  reportsTo: integer('reports_to').references((): AnyPgColumn => agents.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  // Advisors are looked up by role. Two cold starts seeding at once used to
  // insert the same role twice (migration 0041 merges and enforces this).
  roleUq: uniqueIndex('agents_company_role_uq').on(t.companyId, t.role),
}));

// Conversations - threads with agents
export const conversations = pgTable('conversations', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  agentId: integer('agent_id').references(() => agents.id),
  title: text('title'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Messages within conversations
export const messages = pgTable('messages', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').references(() => conversations.id).notNull(),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'),
  toolResults: jsonb('tool_results'),
  createdAt: timestamp('created_at').defaultNow(),
});

/**
 * Customer phone calls — ours, not a provider's.
 *
 * Every call and text currently lives inside GoHighLevel, which means nobody
 * can answer "what did the cold caller do last week" from this app, and the
 * history leaves the day we stop paying for it. GHL's own call records carry
 * the Twilio Call SID, so `providerSid` is the same key whether a row was
 * mirrored from GHL or written by Twilio directly — which is what lets the
 * cutover happen without the UI noticing.
 *
 * Not to be confused with `conversations`/`messages` above: those model an AI
 * agent chat (role, tool calls), and a text message is not one.
 */
export const calls = pgTable('calls', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  providerSid: text('provider_sid').unique(),
  direction: text('direction').notNull(),
  fromE164: text('from_e164').notNull(),
  toE164: text('to_e164').notNull(),
  ourNumber: text('our_number'),

  leadId: integer('lead_id').references(() => leads.id),
  leadExternalId: text('lead_external_id'),
  teamMemberId: integer('team_member_id'),
  repName: text('rep_name'),

  answeredBy: text('answered_by'),
  status: text('status'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  durationSeconds: integer('duration_seconds'),

  recordingUrl: text('recording_url'),
  recordingSid: text('recording_sid'),
  recordingSeconds: integer('recording_seconds'),
  transcript: text('transcript'),
  transcriptSource: text('transcript_source'),
  summary: text('summary'),
  outcome: text('outcome'),
  extracted: jsonb('extracted'),

  costCents: integer('cost_cents'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Texts and emails to customers through our own numbers and mailboxes. */
export const commMessages = pgTable('comm_messages', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  providerSid: text('provider_sid').unique(),
  channel: text('channel').notNull(),
  direction: text('direction').notNull(),
  fromAddr: text('from_addr').notNull(),
  toAddr: text('to_addr').notNull(),
  ourNumber: text('our_number'),

  leadId: integer('lead_id').references(() => leads.id),
  leadExternalId: text('lead_external_id'),
  teamMemberId: integer('team_member_id'),

  subject: text('subject'),
  body: text('body'),
  media: jsonb('media'),
  status: text('status'),
  errorDetail: text('error_detail'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** The numbers we own and what each one is for. */
export const phoneNumbers = pgTable('phone_numbers', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  e164: text('e164').notNull().unique(),
  label: text('label').notNull(),
  purpose: text('purpose').notNull().default('direct'),
  teamMemberId: integer('team_member_id'),
  provider: text('provider').notNull().default('twilio'),
  providerSid: text('provider_sid'),
  forwardsTo: text('forwards_to'),
  /** 'browser' | 'phone' | 'both' — where a call to this number rings. */
  ringTo: text('ring_to').notNull().default('phone'),
  /** The Voice SDK identity to ring when the browser is a target. */
  clientIdentity: text('client_identity'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Leads - from JobTread and GoHighLevel
export const leads = pgTable('leads', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  externalId: text('external_id'), // ID from source system
  source: text('source').notNull(), // 'jobtread' | 'gohighlevel' | 'manual'

  // Contact info
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),

  // Lead details
  status: leadStatusEnum('status').default('new'),
  score: integer('score'), // 1-10 qualification score
  serviceType: text('service_type'), // 'repair', 'replacement', 'inspection', etc.
  propertyType: text('property_type'), // 'residential', 'commercial'
  notes: text('notes'),

  // Qualification data
  qualifiedAt: timestamp('qualified_at'),
  qualifiedBy: integer('qualified_by').references(() => agents.id),
  qualificationReason: text('qualification_reason'),

  // Who typed this lead in — the call-center person or rep who took the call.
  // Distinct from the sales rep who owns the job: the taker gets the credit for
  // the lead, the rep gets the commission for the sale.
  enteredBy: text('entered_by'),                // email
  enteredByName: text('entered_by_name'),       // display name at the time

  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  lastContactedAt: timestamp('last_contacted_at'),

  // JobTread job mirror (populated by the jobs sync) — powers the production
  // board, rep attribution, and per-client docs.
  jobName: text('job_name'),
  jobNumber: text('job_number'),
  stage: text('stage'),                         // JobTread "Status" custom field (pipeline stage)
  jtSalesRep: text('jt_sales_rep'),             // JobTread "Sales Rep" custom field
  projectManager: text('project_manager'),      // JobTread "Project Manager" custom field
  projectedValue: decimal('projected_value', { precision: 12, scale: 2 }),
  scheduleStart: timestamp('schedule_start'),
  scheduleEnd: timestamp('schedule_end'),
  closedOn: timestamp('closed_on'),
  insuranceClaim: boolean('insurance_claim'),
});

// Agent Tasks - work items for agents
export const agentTasks = pgTable('agent_tasks', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  agentId: integer('agent_id').references(() => agents.id).notNull(),
  type: text('type').notNull(), // 'qualify_lead', 'send_sms', 'generate_report', etc.
  payload: jsonb('payload'), // Input data
  status: taskStatusEnum('status').default('pending'),
  result: jsonb('result'), // Output data
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Agent Decisions - audit trail of AI decisions
export const agentDecisions = pgTable('agent_decisions', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  agentId: integer('agent_id').references(() => agents.id).notNull(),
  taskId: integer('task_id').references(() => agentTasks.id),
  context: text('context').notNull(), // What prompted the decision
  decision: text('decision').notNull(), // What was decided
  reasoning: text('reasoning'), // Why (from AI)
  confidence: decimal('confidence', { precision: 3, scale: 2 }), // 0.00 - 1.00
  overridden: boolean('overridden').default(false),
  overriddenBy: integer('overridden_by').references(() => users.id),
  overrideReason: text('override_reason'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Daily Metrics - aggregated business data
export const dailyMetrics = pgTable('daily_metrics', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  date: timestamp('date').notNull(),

  // Revenue
  revenue: decimal('revenue', { precision: 12, scale: 2 }).default('0'),
  expenses: decimal('expenses', { precision: 12, scale: 2 }).default('0'),

  // Leads
  newLeads: integer('new_leads').default(0),
  qualifiedLeads: integer('qualified_leads').default(0),
  convertedLeads: integer('converted_leads').default(0),

  // Jobs
  activeJobs: integer('active_jobs').default(0),
  completedJobs: integer('completed_jobs').default(0),

  // Reviews
  newReviews: integer('new_reviews').default(0),
  avgRating: decimal('avg_rating', { precision: 2, scale: 1 }),

  // Additional data
  data: jsonb('data'), // Flexible storage for other metrics

  createdAt: timestamp('created_at').defaultNow(),
});

// Integration cache - synced data from external systems
export const integrationCache = pgTable('integration_cache', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  source: text('source').notNull(), // 'jobtread' | 'gohighlevel'
  entityType: text('entity_type').notNull(), // 'contact', 'job', 'invoice', etc.
  externalId: text('external_id').notNull(),
  data: jsonb('data').notNull(),
  syncedAt: timestamp('synced_at').defaultNow(),
});

// Automated workflows
export const workflows = pgTable('workflows', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  trigger: text('trigger').notNull(), // 'new_lead', 'job_completed', etc.
  triggerConditions: jsonb('trigger_conditions'), // Filter criteria
  steps: jsonb('steps').$type<WorkflowStep[]>().notNull(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export interface WorkflowStep {
  id: string;
  type: 'agent_action' | 'delay' | 'condition' | 'notification';
  agentRole?: string;
  action?: string;
  params?: Record<string, any>;
  delayMinutes?: number;
  condition?: {
    field: string;
    operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains';
    value: any;
  };
}

// Workflow execution runs
export const workflowRuns = pgTable('workflow_runs', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  workflowId: integer('workflow_id').references(() => workflows.id).notNull(),
  triggerData: jsonb('trigger_data'),
  status: taskStatusEnum('status').default('pending'),
  currentStep: integer('current_step').default(0),
  stepResults: jsonb('step_results'),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});

// Communication log - all outbound messages
export const communicationLog = pgTable('communication_log', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  leadId: integer('lead_id').references(() => leads.id),
  agentId: integer('agent_id').references(() => agents.id),
  channel: text('channel').notNull(), // 'sms', 'email', 'call'
  direction: text('direction').notNull(), // 'inbound', 'outbound'
  content: text('content'),
  externalId: text('external_id'), // Message ID from GHL/Twilio
  status: text('status'), // 'sent', 'delivered', 'failed', 'read'
  createdAt: timestamp('created_at').defaultNow(),
});

// Settings - app configuration
export const settings = pgTable('settings', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  key: text('key').notNull(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('settings_company_key_uq').on(t.companyId, t.key),
}));

// ===================
// RAG Knowledge Base
// ===================

// Knowledge base categories
export const knowledgeCategoryEnum = pgEnum('knowledge_category', [
  'company',           // Company info, policies, procedures
  'services',          // Roofing services offered
  'pricing',           // Pricing guidelines, estimates
  'service_area',      // where the company works
  'industry',          // Roofing industry knowledge
  'faq',               // Common questions and answers
  'scripts',           // Sales scripts, call scripts
  'competitors',       // Competitor information
  'reviews',           // Review responses templates
  'legal',             // Warranty info, contracts, compliance
]);

// Knowledge documents for RAG
export const knowledgeDocuments = pgTable('knowledge_documents', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: knowledgeCategoryEnum('category').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]),
  metadata: jsonb('metadata'), // Additional structured data
  source: text('source'), // Where this info came from
  version: integer('version').default(1),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: integer('created_by').references(() => users.id),
});

// Knowledge chunks for embedding-based retrieval
export const knowledgeChunks = pgTable('knowledge_chunks', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  documentId: integer('document_id').references(() => knowledgeDocuments.id).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: text('embedding'), // JSON array of floats (for simple storage)
  tokenCount: integer('token_count'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Knowledge access log - track what agents retrieve
export const knowledgeAccessLog = pgTable('knowledge_access_log', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  agentId: integer('agent_id').references(() => agents.id),
  documentId: integer('document_id').references(() => knowledgeDocuments.id),
  chunkId: integer('chunk_id').references(() => knowledgeChunks.id),
  query: text('query'), // What the agent was looking for
  relevanceScore: decimal('relevance_score', { precision: 5, scale: 4 }),
  usedInResponse: boolean('used_in_response').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
}));

export const agentsRelations = relations(agents, ({ many }) => ({
  conversations: many(conversations),
  tasks: many(agentTasks),
  decisions: many(agentDecisions),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  qualifiedByAgent: one(agents, {
    fields: [leads.qualifiedBy],
    references: [agents.id],
  }),
  communications: many(communicationLog),
}));

// Knowledge base relations
export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [knowledgeDocuments.createdBy],
    references: [users.id],
  }),
  chunks: many(knowledgeChunks),
  accessLogs: many(knowledgeAccessLog),
}));

export const knowledgeChunksRelations = relations(knowledgeChunks, ({ one }) => ({
  document: one(knowledgeDocuments, {
    fields: [knowledgeChunks.documentId],
    references: [knowledgeDocuments.id],
  }),
}));

export const knowledgeAccessLogRelations = relations(knowledgeAccessLog, ({ one }) => ({
  agent: one(agents, {
    fields: [knowledgeAccessLog.agentId],
    references: [agents.id],
  }),
  document: one(knowledgeDocuments, {
    fields: [knowledgeAccessLog.documentId],
    references: [knowledgeDocuments.id],
  }),
  chunk: one(knowledgeChunks, {
    fields: [knowledgeAccessLog.chunkId],
    references: [knowledgeChunks.id],
  }),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type InsertAgent = typeof agents.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;
export type AgentTask = typeof agentTasks.$inferSelect;
export type AgentDecision = typeof agentDecisions.$inferSelect;
export type DailyMetrics = typeof dailyMetrics.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type InsertKnowledgeDocument = typeof knowledgeDocuments.$inferInsert;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type InsertKnowledgeChunk = typeof knowledgeChunks.$inferInsert;
export type KnowledgeAccessLog = typeof knowledgeAccessLog.$inferSelect;

// ===================
// Financial Integrations
// ===================

// OAuth/API tokens for financial integrations (QBO, Plaid, Everee)
export const integrationTokens = pgTable('integration_tokens', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),      // 'quickbooks', 'everee', 'gmail'
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenType: text('token_type'),
  expiresAt: timestamp('expires_at'),
  realmId: text('realm_id'),                 // QBO company/realm ID
  scope: text('scope'),
  rawResponse: jsonb('raw_response'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Plaid linked bank items
export const plaidItems = pgTable('plaid_items', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  itemId: text('item_id').notNull().unique(),
  accessToken: text('access_token').notNull(),
  institutionId: text('institution_id'),
  institutionName: text('institution_name'),
  cursor: text('cursor'),
  status: text('status').default('active'),
  consentExpiration: timestamp('consent_expiration'),
  accounts: jsonb('accounts'),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Plaid transactions (local cache)
export const plaidTransactions = pgTable('plaid_transactions', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  plaidItemId: integer('plaid_item_id').references(() => plaidItems.id).notNull(),
  transactionId: text('transaction_id').notNull().unique(),
  accountId: text('account_id').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  date: timestamp('date').notNull(),
  name: text('name'),
  merchantName: text('merchant_name'),
  category: jsonb('category'),
  pending: boolean('pending').default(false),
  paymentChannel: text('payment_channel'),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Financial integration types
export type IntegrationToken = typeof integrationTokens.$inferSelect;
export type InsertIntegrationToken = typeof integrationTokens.$inferInsert;
export type PlaidItem = typeof plaidItems.$inferSelect;
export type InsertPlaidItem = typeof plaidItems.$inferInsert;
export type PlaidTransaction = typeof plaidTransactions.$inferSelect;
export type InsertPlaidTransaction = typeof plaidTransactions.$inferInsert;

// ============================================================
// CLAIMS
// ============================================================

export const claims = pgTable('claims', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  customerName: text('customer_name').notNull(),
  contact: jsonb('contact').$type<{ phone?: string; email?: string }>(),
  jobtreadJobId: text('jobtread_job_id'),
  carrier: text('carrier'),
  policyNumber: text('policy_number'),
  claimNumber: text('claim_number'),
  dateOfLoss: timestamp('date_of_loss'),
  adjuster: jsonb('adjuster').$type<{ name?: string; phone?: string; email?: string }>(),
  amounts: jsonb('amounts').$type<{ deductible?: number; acv?: number; rcv?: number; firstCheck?: number; supplements?: number }>(),
  // Claim pipeline stage (shared/claims-pipeline.ts). Text, not the old
  // claim_stage enum, so the stage set can change without an enum migration.
  stage: text('stage').notNull().default('file_claim'),
  disputeSteps: jsonb('dispute_steps').$type<Array<{ key: string; done: boolean }>>().notNull().default([]),
  checks: jsonb('checks').$type<Record<string, boolean>>().notNull().default({}),
  history: jsonb('history').$type<Array<{ stage: string; at: string; by: string }>>().notNull().default([]),
  stageEnteredAt: timestamp('stage_entered_at').defaultNow().notNull(),
  nextAction: text('next_action').notNull(),
  /** Team member email who owns the next action; null until someone is assigned. */
  nextActionOwner: text('next_action_owner'),
  nextActionDue: timestamp('next_action_due').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================
// SYNC WORKERS — normalized read models (spec: sync-workers Phase 1)
// ============================================================

export const invoiceKindEnum = pgEnum('invoice_kind', ['ar', 'ap']);
export const syncStatusEnum = pgEnum('sync_status', ['ok', 'partial', 'error']);

// Sent proposals/estimates (JobTread customerOrder)
export const deals = pgTable('deals', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  sourceId: text('source_id').notNull(),   // JobTread document id
  customer: text('customer'),
  amount: decimal('amount', { precision: 12, scale: 2 }),
  type: text('type'),                                // e.g. "Retail Roofing Proposal"
  status: text('status'),                            // draft|pending|approved|denied
  issueDate: text('issue_date'),                     // yyyy-mm-dd
  signedAt: timestamp('signed_at'),
  jobRef: text('job_ref'),
  ownerId: integer('owner_id').references((): AnyPgColumn => teamMembers.id),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('deals_company_source_id_uq').on(t.companyId, t.sourceId),
}));

// AR (customerInvoice) + AP (vendorBill)
export const invoices = pgTable('invoices', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  kind: invoiceKindEnum('kind').notNull(),
  party: text('party'),                              // customer (AR) or vendor (AP)
  amount: decimal('amount', { precision: 12, scale: 2 }),
  balance: decimal('balance', { precision: 12, scale: 2 }),
  dueDate: text('due_date'),
  issueDate: text('issue_date'),
  status: text('status'),
  jobRef: text('job_ref'),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('invoices_company_source_id_uq').on(t.companyId, t.sourceId),
}));

// Calendar events (inspections/appointments)
export const appointments = pgTable('appointments', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  sourceId: text('source_id').notNull(),    // `${calendarSource}:${eventId}`
  title: text('title'),
  start: timestamp('start'),
  end: timestamp('end'),
  address: text('address'),
  calendarSource: text('calendar_source'),           // mailbox / calendar id
  kind: text('kind'),                                 // inspection|adjuster|internal|other
  attendees: jsonb('attendees').$type<string[]>().default([]),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('appointments_company_source_id_uq').on(t.companyId, t.sourceId),
}));

export const syncRuns = pgTable('sync_runs', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  source: text('source').notNull(),                  // jobtread|calendar|...
  status: syncStatusEnum('status').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  counts: jsonb('counts').$type<Record<string, number>>().default({}),
  error: text('error'),
});

// ============================================================
// FIELD INSPECTION FORM (field schema: shared/inspection-form.ts)
// ============================================================

// A rep's on-site checklist for one job, filled in-app (not JobTread — see
// shared/inspection-form.ts's header comment) so the answers can drive
// Inspection/Estimate/Proposal/Presentation generation directly instead of
// re-asking the same questions per report type. `answers` mirrors
// INSPECTION_FORM_FIELDS by field name; inspectionType and recommendation are
// promoted to real columns because report generation branches on them
// (retail vs insurance framing, repair vs replacement default).
export const inspectionSubmissionStatusEnum = pgEnum('inspection_submission_status', ['draft', 'submitted', 'reviewed']);

export const inspectionSubmissions = pgTable('inspection_submissions', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  teamMemberId: integer('team_member_id').references(() => teamMembers.id),
  inspectorName: text('inspector_name'),
  inspectionType: text('inspection_type'), // 'Insurance Claim' | 'Retail / Non-Insurance' | 'Storm Response' | 'Pre-Purchase' | 'Warranty / Maintenance'
  recommendation: text('recommendation'), // reviewer field — 'Full replacement' | 'Repair only' | ...
  /**
   * Which checklist the answers follow — residential (shared/inspection-form.ts)
   * or commercial (shared/commercial-inspection-form.ts) — travels INSIDE this
   * blob as `__formKind` (server/inspections/lookup.ts inferFormKind). A
   * column would be cleaner, but brnmig does not own this table in production,
   * so ALTER TABLE is refused; the JSON key needs no migration.
   */
  answers: jsonb('answers').$type<Record<string, any>>().notNull().default({}),
  status: inspectionSubmissionStatusEnum('status').notNull().default('draft'),
  signedAt: timestamp('signed_at'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  jobtreadSyncedAt: timestamp('jobtread_synced_at'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type InspectionSubmission = typeof inspectionSubmissions.$inferSelect;
export type NewInspectionSubmission = typeof inspectionSubmissions.$inferInsert;

// ============================================================
// PRE-CONSTRUCTION CHECKLIST (field schema: shared/preconstruction-checklist.ts)
// ============================================================

// Filled by the sales rep at the point they collect the down payment: site
// photos (material drop, dumpster, aerial, risk items) plus confirmation
// that the standard pre-install talking points were covered with the
// homeowner. No review step — the rep submits and it's done.
export const preconChecklistStatusEnum = pgEnum('precon_checklist_status', ['draft', 'submitted']);

export const preConstructionChecklists = pgTable('precon_checklists', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  teamMemberId: integer('team_member_id').references(() => teamMembers.id),
  repName: text('rep_name'),
  answers: jsonb('answers').$type<Record<string, any>>().notNull().default({}),
  status: preconChecklistStatusEnum('status').notNull().default('draft'),
  submittedAt: timestamp('submitted_at'),
  jobtreadSyncedAt: timestamp('jobtread_synced_at'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type PreConstructionChecklist = typeof preConstructionChecklists.$inferSelect;
export type NewPreConstructionChecklist = typeof preConstructionChecklists.$inferInsert;

// ============================================================
// FINAL WALKTHROUGH (field schema: shared/final-walkthrough.ts)
// ============================================================

// Done by the sales rep or project manager once the crew is off the roof:
// magnetic nail sweep, cleanup and leftovers, property and roof checks, the
// homeowner conversation. Each "Issue found" becomes a follow-up on submit;
// `issueCount` is denormalized so the production board can show it without
// unpacking the answers blob.
export const finalWalkthroughs = pgTable('final_walkthroughs', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  teamMemberId: integer('team_member_id').references(() => teamMembers.id),
  walkedBy: text('walked_by'),
  answers: jsonb('answers').$type<Record<string, any>>().notNull().default({}),
  status: preconChecklistStatusEnum('status').notNull().default('draft'),
  issueCount: integer('issue_count').notNull().default(0),
  submittedAt: timestamp('submitted_at'),
  jobtreadSyncedAt: timestamp('jobtread_synced_at'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * The Certificate of Completion for a job: built from its final walkthrough,
 * signed by us and then by the homeowner over a capability-token link, and
 * attached to the depreciation request once both names are on it.
 */
export const jobCertificates = pgTable('job_certificates', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  walkthroughId: integer('walkthrough_id'),
  /** Snapshot of the walkthrough as it read when the certificate was built, so
   *  a signed certificate never changes under the signatures. */
  data: jsonb('data').$type<Record<string, any>>().notNull().default({}),
  status: text('status').notNull().default('draft'),   // draft | sent | signed
  companySigner: text('company_signer'),
  companySignedAt: timestamp('company_signed_at'),
  homeownerName: text('homeowner_name'),
  homeownerEmail: text('homeowner_email'),
  homeownerSigner: text('homeowner_signer'),
  homeownerSignedAt: timestamp('homeowner_signed_at'),
  homeownerIp: text('homeowner_ip'),
  signToken: text('sign_token').unique(),
  sentAt: timestamp('sent_at'),
  sentBy: text('sent_by'),
  jobtreadFileId: text('jobtread_file_id'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('job_certificates_company_job_external_id_uq').on(t.companyId, t.jobExternalId),
}));

export type JobCertificate = typeof jobCertificates.$inferSelect;

// ============================================================
// PRODUCTION PIPELINE (stages, trades, gates: shared/production-pipeline.ts)
// ============================================================

// One row per sold job once someone touches it on the production board. The
// app's own eleven-stage pipeline (Approved → Waiting for DP → … → Closed
// Out) plus the trades on the job and the stage tick-boxes. JobTread's
// coarser "Status" is written on every move (jobtreadStatusFor) but this row
// is the authority for where the job sits.
export const productionPipeline = pgTable('production_pipeline', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  stage: text('stage').notNull(),
  trades: jsonb('trades').$type<Array<{ key: string; done: boolean }>>().notNull().default([{ key: 'roofing', done: false }]),
  checks: jsonb('checks').$type<Record<string, boolean>>().notNull().default({}),
  depositReceivedAt: timestamp('deposit_received_at'),
  stageEnteredAt: timestamp('stage_entered_at').defaultNow(),
  history: jsonb('history').$type<Array<{ stage: string; at: string; by: string }>>().notNull().default([]),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('production_pipeline_company_job_external_id_uq').on(t.companyId, t.jobExternalId),
}));

export type ProductionPipelineRow = typeof productionPipeline.$inferSelect;

// One row per job once it's moved on the sales board (shared/sales-pipeline.ts).
// Approved / DP Received hand the job to the production pipeline.
export const salesPipeline = pgTable('sales_pipeline', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  stage: text('stage').notNull(),
  /** Why the deal died — a key from SALES_LOST_REASONS. Cleared when it's reopened. */
  lostReason: text('lost_reason'),
  /** The detail behind that reason; required when the reason is 'other'. */
  lostNote: text('lost_note'),
  checks: jsonb('checks').$type<Record<string, boolean>>().notNull().default({}),
  stageEnteredAt: timestamp('stage_entered_at').defaultNow(),
  /** `reason` is carried on the entry that marked the deal lost. */
  history: jsonb('history').$type<Array<{ stage: string; at: string; by: string; reason?: string | null }>>().notNull().default([]),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('sales_pipeline_company_job_external_id_uq').on(t.companyId, t.jobExternalId),
}));
export type SalesPipelineRow = typeof salesPipeline.$inferSelect;

export type FinalWalkthrough = typeof finalWalkthroughs.$inferSelect;
export type NewFinalWalkthrough = typeof finalWalkthroughs.$inferInsert;

export type Deal = typeof deals.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;

// ===================
// SALES PLAYBOOK (shared/playbook.ts): per-job stage checklists and each rep's income goal plan
// ===================

/** One stage checklist for one job. `items` maps item key → who ticked it and when (plus any follow-ups it created). */
export const jobChecklists = pgTable('job_checklists', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  checklistKey: text('checklist_key').notNull(),
  items: jsonb('items').$type<Record<string, { by: string; at: string; followUpIds?: number[] }>>().notNull().default({}),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  jobKeyIdx: uniqueIndex('job_checklists_company_job_key_idx').on(t.companyId, t.jobExternalId, t.checklistKey),
}));

export type JobChecklist = typeof jobChecklists.$inferSelect;

/** The Income Goal Plan inputs a rep sets for themselves (the math lives in shared/playbook.ts). */
export const repGoals = pgTable('rep_goals', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  teamMemberId: integer('team_member_id').references(() => teamMembers.id).notNull().unique(),
  incomeGoal: integer('income_goal').notNull().default(100000),
  avgCommission: integer('avg_commission').notNull().default(1500),
  closeRate: integer('close_rate').notNull().default(40),
  sellingMonths: integer('selling_months').notNull().default(9),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type RepGoal = typeof repGoals.$inferSelect;

// ============================================================
// SIGNATURE REQUESTS (the e-sign flow: shared/signatures.ts)
// ============================================================

/**
 * One document sent out for signature. `html` is the document frozen at the
 * moment it went out and `docHash` its SHA-256 — the source it was built from
 * can be regenerated, and a signed document must never change under the
 * signatures. The property is geocoded once here so the signing page can say
 * how far the signer was from the roof without a lookup on their critical path.
 */
export const signatureRequests = pgTable('signature_requests', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  jobExternalId: text('job_external_id').notNull(),
  sourceKind: text('source_kind').notNull(),      // report | certificate | letter
  sourceRef: text('source_ref'),
  title: text('title').notNull(),
  html: text('html').notNull(),
  docHash: text('doc_hash').notNull(),
  message: text('message'),
  propertyAddress: text('property_address'),
  propertyLat: doublePrecision('property_lat'),
  propertyLng: doublePrecision('property_lng'),
  status: text('status').notNull().default('draft'),  // draft | sent | signed | declined | voided
  createdBy: text('created_by').notNull(),
  sentAt: timestamp('sent_at'),
  sentBy: text('sent_by'),
  completedAt: timestamp('completed_at'),
  voidedAt: timestamp('voided_at'),
  voidedBy: text('voided_by'),
  voidReason: text('void_reason'),
  jobtreadFileId: text('jobtread_file_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  jobIdx: index('signature_requests_job_idx').on(t.jobExternalId),
  statusIdx: index('signature_requests_status_idx').on(t.status),
}));

export type SignatureRequest = typeof signatureRequests.$inferSelect;

/**
 * One signer on one request. The token is the capability that stands in for a
 * login — per signer, not per document, so two people on one deed sign for
 * themselves and the trail can tell them apart. `geo` is where they were when
 * they signed; `viewGeo` where they were when they opened it.
 */
export const signatureSigners = pgTable('signature_signers', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  requestId: integer('request_id').references(() => signatureRequests.id, { onDelete: 'cascade' }).notNull(),
  ordinal: integer('ordinal').notNull().default(0),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  role: text('role').notNull().default('customer'),   // customer | company
  token: text('token').notNull().unique(),
  emailedAt: timestamp('emailed_at'),
  emailError: text('email_error'),
  textedAt: timestamp('texted_at'),
  textError: text('text_error'),
  remindedAt: timestamp('reminded_at'),
  remindCount: integer('remind_count').notNull().default(0),
  firstViewedAt: timestamp('first_viewed_at'),
  lastViewedAt: timestamp('last_viewed_at'),
  viewCount: integer('view_count').notNull().default(0),
  signedAt: timestamp('signed_at'),
  signedName: text('signed_name'),
  signatureKind: text('signature_kind'),              // typed | drawn
  signatureImage: text('signature_image'),            // base64 JPEG, drawn only
  declinedAt: timestamp('declined_at'),
  declineReason: text('decline_reason'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  geo: jsonb('geo').$type<Record<string, any>>(),
  viewGeo: jsonb('view_geo').$type<Record<string, any>>(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  requestIdx: index('signature_signers_request_idx').on(t.requestId),
}));

export type SignatureSigner = typeof signatureSigners.$inferSelect;

// ============================================================
// MONDAY MEETINGS (the schedule and shapes live in shared/monday-meetings.ts)
// ============================================================

/**
 * One pack per Monday. `agendas` is what the room was actually shown, frozen
 * when the Sunday job ran — the pipelines move underneath it, and a pack that
 * silently rewrote itself would be no record at all.
 */
export const meetingWeeks = pgTable('meeting_weeks', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  // A calendar day, not an instant: the pack belongs to a Monday where the
  // company is, and `date` keeps it that way through every timezone.
  monday: date('monday').notNull(),
  agendas: jsonb('agendas').$type<Record<string, any>[]>().notNull().default([]),
  weekFrom: date('week_from'),
  weekTo: date('week_to'),
  generatedAt: timestamp('generated_at'),
  generatedBy: text('generated_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  companyKeyUq: uniqueIndex('meeting_weeks_company_monday_uq').on(t.companyId, t.monday),
}));

export type MeetingWeek = typeof meetingWeeks.$inferSelect;

/** What was said in one room, in one week. */
export const meetingNotes = pgTable('meeting_notes', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  weekId: integer('week_id').references(() => meetingWeeks.id, { onDelete: 'cascade' }).notNull(),
  meeting: text('meeting').notNull(),                 // leadership | claims | sales | payroll
  notes: text('notes').notNull().default(''),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  weekMeetingIdx: uniqueIndex('meeting_notes_week_meeting_idx').on(t.weekId, t.meeting),
}));

export type MeetingNote = typeof meetingNotes.$inferSelect;

/**
 * What somebody agreed to do. The owner is an email rather than a roster id so
 * an action outlives the person leaving the roster, and anything still open
 * appears at the top of the next week's pack.
 */
export const meetingActions = pgTable('meeting_actions', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  weekId: integer('week_id').references(() => meetingWeeks.id, { onDelete: 'cascade' }).notNull(),
  meeting: text('meeting').notNull(),
  actionText: text('action_text').notNull(),
  ownerEmail: text('owner_email'),
  dueDate: text('due_date'),
  doneAt: timestamp('done_at'),
  doneBy: text('done_by'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  weekIdx: index('meeting_actions_week_idx').on(t.weekId),
}));

export type MeetingAction = typeof meetingActions.$inferSelect;

// ---- The meeting spine: scorecard, rocks, issues, ratings (migration 0032) ----
// The pack tells the room what is true; these are what the room does about it.
// See shared/monday-meetings.ts for the reasoning behind each one.

export const scorecardMetrics = pgTable('scorecard_metrics', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  // Stable identifier the pack computes against, so relabelling a metric keeps
  // its goal and its history.
  key: text('key').notNull(),
  label: text('label').notNull(),
  meeting: text('meeting').notNull().default('leadership'),
  // 'company' is one number for the business and belongs to the admin room;
  // 'rep' is computed per person, and a rep only ever sees their own (0034).
  scope: text('scope').notNull().default('company'),
  // One owner. A number owned by everybody is owned by nobody.
  ownerEmail: text('owner_email'),
  // Null on purpose — an unset goal shows as "unset", never as a pass.
  goal: decimal('goal'),
  direction: text('direction').notNull().default('at_least'),   // at_least | at_most
  unit: text('unit').notNull().default('count'),                // count | money | days
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  // The key names the measure the pack computes; the room is the other half of
  // the identity, so leadership and sales can each carry "new leads" with
  // their own owner and goal (migration 0033).
  keyPerMeeting: uniqueIndex('scorecard_metrics_company_key_meeting_scope_idx').on(t.companyId, t.key, t.meeting, t.scope),
}));

export const rocks = pgTable('rocks', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  meeting: text('meeting').notNull().default('leadership'),
  title: text('title').notNull(),
  ownerEmail: text('owner_email'),
  quarter: text('quarter').notNull(),                           // '2026-Q3'
  status: text('status').notNull().default('on_track'),         // on_track | off_track | done
  dueDate: date('due_date'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  quarterIdx: index('rocks_quarter_idx').on(t.quarter, t.meeting),
}));

export const meetingIssues = pgTable('meeting_issues', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  meeting: text('meeting').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  source: text('source').notNull().default('manual'),           // manual | scorecard | rock | pack
  // Stable per finding, so the Sunday job raises an auto-filed issue once
  // rather than a fresh copy every week.
  sourceKey: text('source_key'),
  raisedBy: text('raised_by'),
  raisedAt: timestamp('raised_at').defaultNow(),
  // The Monday it first appeared — the age that makes a chronic issue obvious.
  firstSeenWeek: date('first_seen_week'),
  priority: integer('priority'),                                // 1..3 once picked
  solvedAt: timestamp('solved_at'),
  solvedNote: text('solved_note'),
  solvedBy: text('solved_by'),
  droppedAt: timestamp('dropped_at'),
  droppedBy: text('dropped_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  openIdx: index('meeting_issues_open_idx').on(t.meeting, t.solvedAt, t.droppedAt),
}));

export const meetingRatings = pgTable('meeting_ratings', {
  companyId: companyId(),
  id: serial('id').primaryKey(),
  meeting: text('meeting').notNull(),
  monday: date('monday').notNull(),
  raterEmail: text('rater_email').notNull(),
  score: integer('score').notNull(),                            // 1..10, checked in the DB
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  onePerPerson: uniqueIndex('meeting_ratings_person_idx').on(t.meeting, t.monday, t.raterEmail),
}));

export type ScorecardMetricRow = typeof scorecardMetrics.$inferSelect;
export type RockRow = typeof rocks.$inferSelect;
export type MeetingIssueRow = typeof meetingIssues.$inferSelect;
export type MeetingRatingRow = typeof meetingRatings.$inferSelect;

// ============================================================
// JOBTREAD ARCHIVE (migration 0039) — raw copy of everything in JobTread,
// step one of leaving it. See server/jobtread-archive/.
// ============================================================

export const jobtreadArchive = pgTable('jobtread_archive', {
  companyId: companyId(),
  entityType: text('entity_type').notNull(),
  jtId: text('jt_id').notNull(),
  jobId: text('job_id'),
  data: jsonb('data').notNull(),
  fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.companyId, t.entityType, t.jtId] }),
  jobIdx: index('jobtread_archive_job_idx').on(t.jobId),
}));

export const jobtreadArchiveSteps = pgTable('jobtread_archive_steps', {
  companyId: companyId(),
  step: text('step').notNull(),
  status: text('status').notNull().default('pending'),
  cursor: text('cursor'),
  counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
  errors: jsonb('errors').$type<Array<{ at: string; where: string; message: string }>>().notNull().default([]),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.companyId, t.step] }),
}));

export type JobtreadArchiveStepRow = typeof jobtreadArchiveSteps.$inferSelect;
