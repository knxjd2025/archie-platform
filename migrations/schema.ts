import { pgTable, foreignKey, pgEnum, serial, integer, text, jsonb, timestamp, numeric, boolean, index, unique, varchar, date, doublePrecision } from "drizzle-orm/pg-core"
  import { sql } from "drizzle-orm"

export const agentRole = pgEnum("agent_role", ['ceo', 'cfo', 'cmo', 'cto', 'coo', 'sales_manager', 'customer_service', 'project_coordinator', 'estimator', 'cpa', 'tax_accountant', 'tax_lawyer'])
export const agentStatus = pgEnum("agent_status", ['active', 'paused', 'disabled'])
export const knowledgeCategory = pgEnum("knowledge_category", ['company', 'services', 'pricing', 'service_area', 'industry', 'faq', 'scripts', 'competitors', 'reviews', 'legal'])
export const leadStatus = pgEnum("lead_status", ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'disqualified'])
export const messageRole = pgEnum("message_role", ['user', 'assistant', 'system', 'tool'])
export const taskStatus = pgEnum("task_status", ['pending', 'in_progress', 'completed', 'failed'])
export const outreachCampaignStatus = pgEnum("outreach_campaign_status", ['draft', 'active', 'paused', 'completed'])
export const outreachLeadStatus = pgEnum("outreach_lead_status", ['scraped', 'enriching', 'enriched', 'personalizing', 'personalized', 'queued', 'sent', 'delivered', 'opened', 'replied', 'converted', 'failed', 'bounced'])
export const outreachAttemptStatus = pgEnum("outreach_attempt_status", ['pending', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed'])
export const scrapeJobStatus = pgEnum("scrape_job_status", ['pending', 'running', 'completed', 'failed'])


export const agentTasks = pgTable("agent_tasks", {
	id: serial("id").primaryKey().notNull(),
	agentId: integer("agent_id").notNull().references(() => agents.id),
	type: text("type").notNull(),
	payload: jsonb("payload"),
	status: taskStatus("status").default('pending'),
	result: jsonb("result"),
	error: text("error"),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const communicationLog = pgTable("communication_log", {
	id: serial("id").primaryKey().notNull(),
	leadId: integer("lead_id").references(() => leads.id),
	agentId: integer("agent_id").references(() => agents.id),
	channel: text("channel").notNull(),
	direction: text("direction").notNull(),
	content: text("content"),
	externalId: text("external_id"),
	status: text("status"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const conversations = pgTable("conversations", {
	id: serial("id").primaryKey().notNull(),
	userId: integer("user_id").references(() => users.id),
	agentId: integer("agent_id").references(() => agents.id),
	title: text("title"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const knowledgeAccessLog = pgTable("knowledge_access_log", {
	id: serial("id").primaryKey().notNull(),
	agentId: integer("agent_id").references(() => agents.id),
	documentId: integer("document_id").references(() => knowledgeDocuments.id),
	chunkId: integer("chunk_id").references(() => knowledgeChunks.id),
	query: text("query"),
	relevanceScore: numeric("relevance_score", { precision: 5, scale:  4 }),
	usedInResponse: boolean("used_in_response").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const agents = pgTable("agents", {
	id: serial("id").primaryKey().notNull(),
	name: text("name").notNull(),
	role: agentRole("role").notNull(),
	title: text("title").notNull(),
	persona: text("persona").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	tools: jsonb("tools").default([]),
	status: agentStatus("status").default('active'),
	avatar: text("avatar"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	reportsTo: integer("reports_to"),
},
(table) => {
	return {
		idxAgentsReportsTo: index("idx_agents_reports_to").on(table.reportsTo),
		agentsReportsToFkey: foreignKey({
			columns: [table.reportsTo],
			foreignColumns: [table.id],
			name: "agents_reports_to_fkey"
		}),
	}
});

export const dailyMetrics = pgTable("daily_metrics", {
	id: serial("id").primaryKey().notNull(),
	date: timestamp("date", { mode: 'string' }).notNull(),
	revenue: numeric("revenue", { precision: 12, scale:  2 }).default('0'),
	expenses: numeric("expenses", { precision: 12, scale:  2 }).default('0'),
	newLeads: integer("new_leads").default(0),
	qualifiedLeads: integer("qualified_leads").default(0),
	convertedLeads: integer("converted_leads").default(0),
	activeJobs: integer("active_jobs").default(0),
	completedJobs: integer("completed_jobs").default(0),
	newReviews: integer("new_reviews").default(0),
	avgRating: numeric("avg_rating", { precision: 2, scale:  1 }),
	data: jsonb("data"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const integrationCache = pgTable("integration_cache", {
	id: serial("id").primaryKey().notNull(),
	source: text("source").notNull(),
	entityType: text("entity_type").notNull(),
	externalId: text("external_id").notNull(),
	data: jsonb("data").notNull(),
	syncedAt: timestamp("synced_at", { mode: 'string' }).defaultNow(),
});

export const knowledgeChunks = pgTable("knowledge_chunks", {
	id: serial("id").primaryKey().notNull(),
	documentId: integer("document_id").notNull().references(() => knowledgeDocuments.id),
	chunkIndex: integer("chunk_index").notNull(),
	content: text("content").notNull(),
	embedding: text("embedding"),
	tokenCount: integer("token_count"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const knowledgeDocuments = pgTable("knowledge_documents", {
	id: serial("id").primaryKey().notNull(),
	title: text("title").notNull(),
	content: text("content").notNull(),
	category: knowledgeCategory("category").notNull(),
	tags: jsonb("tags").default([]),
	metadata: jsonb("metadata"),
	source: text("source"),
	version: integer("version").default(1),
	active: boolean("active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	createdBy: integer("created_by").references(() => users.id),
});

export const messages = pgTable("messages", {
	id: serial("id").primaryKey().notNull(),
	conversationId: integer("conversation_id").notNull().references(() => conversations.id),
	role: messageRole("role").notNull(),
	content: text("content").notNull(),
	toolCalls: jsonb("tool_calls"),
	toolResults: jsonb("tool_results"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const settings = pgTable("settings", {
	id: serial("id").primaryKey().notNull(),
	key: text("key").notNull(),
	value: jsonb("value"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		settingsKeyUnique: unique("settings_key_unique").on(table.key),
	}
});

export const agentDecisions = pgTable("agent_decisions", {
	id: serial("id").primaryKey().notNull(),
	agentId: integer("agent_id").notNull().references(() => agents.id),
	taskId: integer("task_id").references(() => agentTasks.id),
	context: text("context").notNull(),
	decision: text("decision").notNull(),
	reasoning: text("reasoning"),
	confidence: numeric("confidence", { precision: 3, scale:  2 }),
	overridden: boolean("overridden").default(false),
	overriddenBy: integer("overridden_by").references(() => users.id),
	overrideReason: text("override_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const leads = pgTable("leads", {
	id: serial("id").primaryKey().notNull(),
	externalId: text("external_id"),
	source: text("source").notNull(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	email: text("email"),
	phone: text("phone"),
	address: text("address"),
	city: text("city"),
	state: text("state"),
	zip: text("zip"),
	status: leadStatus("status").default('new'),
	score: integer("score"),
	serviceType: text("service_type"),
	propertyType: text("property_type"),
	notes: text("notes"),
	qualifiedAt: timestamp("qualified_at", { mode: 'string' }),
	qualifiedBy: integer("qualified_by").references(() => agents.id),
	qualificationReason: text("qualification_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	lastContactedAt: timestamp("last_contacted_at", { mode: 'string' }),
});

export const workflows = pgTable("workflows", {
	id: serial("id").primaryKey().notNull(),
	name: text("name").notNull(),
	description: text("description"),
	trigger: text("trigger").notNull(),
	triggerConditions: jsonb("trigger_conditions"),
	steps: jsonb("steps").notNull(),
	active: boolean("active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const workflowRuns = pgTable("workflow_runs", {
	id: serial("id").primaryKey().notNull(),
	workflowId: integer("workflow_id").notNull().references(() => workflows.id),
	triggerData: jsonb("trigger_data"),
	status: taskStatus("status").default('pending'),
	currentStep: integer("current_step").default(0),
	stepResults: jsonb("step_results"),
	error: text("error"),
	startedAt: timestamp("started_at", { mode: 'string' }).defaultNow(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
});

export const users = pgTable("users", {
	id: serial("id").primaryKey().notNull(),
	email: text("email").notNull(),
	password: text("password").default(''),
	name: text("name").notNull(),
	role: text("role").default('user'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	googleId: text("google_id"),
	avatarUrl: text("avatar_url"),
},
(table) => {
	return {
		usersEmailUnique: unique("users_email_unique").on(table.email),
	}
});

export const migrations = pgTable("_migrations", {
	id: serial("id").primaryKey().notNull(),
	name: varchar("name", { length: 255 }).notNull(),
	appliedAt: timestamp("applied_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		migrationsNameKey: unique("_migrations_name_key").on(table.name),
	}
});

export const emailTemplates = pgTable("email_templates", {
	id: serial("id").primaryKey().notNull(),
	userId: integer("user_id").references(() => users.id),
	name: text("name").notNull(),
	subjectTemplate: text("subject_template").notNull(),
	bodyTemplate: text("body_template").notNull(),
	subjectPrompt: text("subject_prompt"),
	firstLinePrompt: text("first_line_prompt"),
	targetIndustries: jsonb("target_industries"),
	isDefault: boolean("is_default").default(false),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const outreachLeads = pgTable("outreach_leads", {
	id: serial("id").primaryKey().notNull(),
	campaignId: integer("campaign_id").notNull().references(() => outreachCampaigns.id),
	userId: integer("user_id").notNull().references(() => users.id),
	companyName: text("company_name").notNull(),
	industry: text("industry").notNull(),
	website: text("website"),
	phone: text("phone"),
	address: text("address"),
	city: text("city"),
	state: text("state"),
	zipCode: text("zip_code"),
	ownerFirstName: text("owner_first_name"),
	ownerLastName: text("owner_last_name"),
	ownerEmail: text("owner_email"),
	emailVerified: boolean("email_verified").default(false),
	emailVerificationSource: text("email_verification_source"),
	emailVerificationScore: numeric("email_verification_score", { precision: 5, scale:  2 }),
	companySize: text("company_size"),
	yearFounded: text("year_founded"),
	linkedinUrl: text("linkedin_url"),
	facebookUrl: text("facebook_url"),
	googleReviewCount: integer("google_review_count"),
	googleRating: numeric("google_rating", { precision: 2, scale:  1 }),
	personalizedSubjectLine: text("personalized_subject_line"),
	personalizedFirstLine: text("personalized_first_line"),
	personalizationContext: jsonb("personalization_context"),
	status: outreachLeadStatus("status").default('scraped').notNull(),
	dedupeHash: text("dedupe_hash").notNull(),
	sourceUrl: text("source_url"),
	scrapeJobId: integer("scrape_job_id"),
	instantlyLeadId: text("instantly_lead_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	scheduledSendAt: timestamp("scheduled_send_at", { mode: 'string' }),
	actualSentAt: timestamp("actual_sent_at", { mode: 'string' }),
},
(table) => {
	return {
		idxOutreachLeadsCampaignId: index("idx_outreach_leads_campaign_id").on(table.campaignId),
		idxOutreachLeadsUserId: index("idx_outreach_leads_user_id").on(table.userId),
		idxOutreachLeadsStatus: index("idx_outreach_leads_status").on(table.status),
		idxOutreachLeadsDedupe: index("idx_outreach_leads_dedupe").on(table.dedupeHash),
		idxOutreachLeadsEmail: index("idx_outreach_leads_email").on(table.ownerEmail),
		idxOutreachLeadsScheduledSend: index("idx_outreach_leads_scheduled_send").on(table.scheduledSendAt, table.status),
	}
});

export const outreachCampaigns = pgTable("outreach_campaigns", {
	id: serial("id").primaryKey().notNull(),
	userId: integer("user_id").notNull().references(() => users.id),
	name: text("name").notNull(),
	status: outreachCampaignStatus("status").default('draft').notNull(),
	industries: jsonb("industries").notNull(),
	targetLocations: jsonb("target_locations"),
	dailyLeadTarget: integer("daily_lead_target").default(250),
	instantlyApiKey: text("instantly_api_key"),
	instantlyCampaignId: text("instantly_campaign_id"),
	emailTemplateId: integer("email_template_id").references(() => emailTemplates.id),
	runTime: text("run_time").default('09:00'),
	timezone: text("timezone").default('America/New_York'),
	warmUpEnabled: boolean("warm_up_enabled").default(true),
	warmUpStartDate: timestamp("warm_up_start_date", { mode: 'string' }),
	warmUpDailyLimit: integer("warm_up_daily_limit").default(10),
	currentDailyLimit: integer("current_daily_limit").default(10),
	totalLeadsGenerated: integer("total_leads_generated").default(0),
	totalEmailsSent: integer("total_emails_sent").default(0),
	totalOpens: integer("total_opens").default(0),
	totalReplies: integer("total_replies").default(0),
	lastRunAt: timestamp("last_run_at", { mode: 'string' }),
	nextRunAt: timestamp("next_run_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxOutreachCampaignsUserId: index("idx_outreach_campaigns_user_id").on(table.userId),
		idxOutreachCampaignsStatus: index("idx_outreach_campaigns_status").on(table.status),
		idxOutreachCampaignsNextRun: index("idx_outreach_campaigns_next_run").on(table.nextRunAt),
	}
});

export const outreachAttempts = pgTable("outreach_attempts", {
	id: serial("id").primaryKey().notNull(),
	leadId: integer("lead_id").notNull().references(() => outreachLeads.id),
	campaignId: integer("campaign_id").notNull().references(() => outreachCampaigns.id),
	userId: integer("user_id").notNull().references(() => users.id),
	emailSubject: text("email_subject").notNull(),
	emailFirstLine: text("email_first_line").notNull(),
	emailBody: text("email_body"),
	instantlyEmailId: text("instantly_email_id"),
	status: outreachAttemptStatus("status").default('pending').notNull(),
	sentAt: timestamp("sent_at", { mode: 'string' }),
	deliveredAt: timestamp("delivered_at", { mode: 'string' }),
	openedAt: timestamp("opened_at", { mode: 'string' }),
	clickedAt: timestamp("clicked_at", { mode: 'string' }),
	repliedAt: timestamp("replied_at", { mode: 'string' }),
	bouncedAt: timestamp("bounced_at", { mode: 'string' }),
	error: text("error"),
	attemptNumber: integer("attempt_number").default(1),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxOutreachAttemptsLeadId: index("idx_outreach_attempts_lead_id").on(table.leadId),
		idxOutreachAttemptsCampaignId: index("idx_outreach_attempts_campaign_id").on(table.campaignId),
		idxOutreachAttemptsStatus: index("idx_outreach_attempts_status").on(table.status),
	}
});

export const scrapeJobs = pgTable("scrape_jobs", {
	id: serial("id").primaryKey().notNull(),
	campaignId: integer("campaign_id").notNull().references(() => outreachCampaigns.id),
	userId: integer("user_id").notNull().references(() => users.id),
	industry: text("industry").notNull(),
	location: text("location"),
	searchQuery: text("search_query").notNull(),
	targetCount: integer("target_count").default(50),
	status: scrapeJobStatus("status").default('pending').notNull(),
	leadsFound: integer("leads_found").default(0),
	leadsProcessed: integer("leads_processed").default(0),
	duplicatesSkipped: integer("duplicates_skipped").default(0),
	error: text("error"),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxScrapeJobsCampaignId: index("idx_scrape_jobs_campaign_id").on(table.campaignId),
		idxScrapeJobsStatus: index("idx_scrape_jobs_status").on(table.status),
	}
});

export const plaidItems = pgTable("plaid_items", {
	id: serial("id").primaryKey().notNull(),
	itemId: text("item_id").notNull(),
	accessToken: text("access_token").notNull(),
	institutionId: text("institution_id"),
	institutionName: text("institution_name"),
	cursor: text("cursor"),
	status: text("status").default('active'),
	consentExpiration: timestamp("consent_expiration", { mode: 'string' }),
	accounts: jsonb("accounts"),
	lastSyncedAt: timestamp("last_synced_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxPlaidItemsStatus: index("idx_plaid_items_status").on(table.status),
		plaidItemsItemIdKey: unique("plaid_items_item_id_key").on(table.itemId),
	}
});

export const plaidTransactions = pgTable("plaid_transactions", {
	id: serial("id").primaryKey().notNull(),
	plaidItemId: integer("plaid_item_id").notNull().references(() => plaidItems.id, { onDelete: "cascade" } ),
	transactionId: text("transaction_id").notNull(),
	accountId: text("account_id").notNull(),
	amount: numeric("amount", { precision: 12, scale:  2 }).notNull(),
	date: date("date").notNull(),
	name: text("name"),
	merchantName: text("merchant_name"),
	category: jsonb("category"),
	pending: boolean("pending").default(false),
	paymentChannel: text("payment_channel"),
	rawData: jsonb("raw_data"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxPlaidTransactionsDate: index("idx_plaid_transactions_date").on(table.date),
		idxPlaidTransactionsAccount: index("idx_plaid_transactions_account").on(table.accountId),
		idxPlaidTransactionsItem: index("idx_plaid_transactions_item").on(table.plaidItemId),
		plaidTransactionsTransactionIdKey: unique("plaid_transactions_transaction_id_key").on(table.transactionId),
	}
});

export const integrationTokens = pgTable("integration_tokens", {
	id: serial("id").primaryKey().notNull(),
	provider: text("provider").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	tokenType: text("token_type"),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	realmId: text("realm_id"),
	scope: text("scope"),
	rawResponse: jsonb("raw_response"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	userId: integer("user_id").references(() => users.id),
	email: text("email"),
},
(table) => {
	return {
		idxIntegrationTokensProvider: index("idx_integration_tokens_provider").on(table.provider),
		idxIntegrationTokensActive: index("idx_integration_tokens_active").on(table.isActive),
		idxIntegrationTokensProviderUser: index("idx_integration_tokens_provider_user").on(table.provider, table.userId),
		idxIntegrationTokensEmail: index("idx_integration_tokens_email").on(table.email),
	}
});

export const roofReports = pgTable("roof_reports", {
	id: text("id").primaryKey().notNull(),
	userId: integer("user_id"),
	leadId: text("lead_id"),
	jobId: text("job_id"),
	projectId: text("project_id"),
	address: text("address").notNull(),
	city: text("city").notNull(),
	state: text("state").notNull(),
	zip: text("zip"),
	latitude: doublePrecision("latitude"),
	longitude: doublePrecision("longitude"),
	stormData: jsonb("storm_data"),
	damageData: jsonb("damage_data"),
	estimateData: jsonb("estimate_data"),
	totalEstimate: numeric("total_estimate", { precision: 12, scale:  2 }),
	dataQuality: text("data_quality"),
	roofDetails: jsonb("roof_details"),
	damageCounts: jsonb("damage_counts"),
	replacementData: jsonb("replacement_data"),
	inspectorNotes: text("inspector_notes"),
	measurements: jsonb("measurements"),
	reportVersion: text("report_version").default(2),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxRoofReportsLead: index("idx_roof_reports_lead").on(table.leadId),
		idxRoofReportsJob: index("idx_roof_reports_job").on(table.jobId),
		idxRoofReportsCreated: index("idx_roof_reports_created").on(table.createdAt),
	}
});

export const leadSyncCache = pgTable("lead_sync_cache", {
	id: serial("id").primaryKey().notNull(),
	externalId: text("external_id").notNull(),
	source: text("source").notNull(),
	contactName: text("contact_name"),
	email: text("email"),
	phone: text("phone"),
	address: text("address"),
	city: text("city"),
	state: text("state"),
	zip: text("zip"),
	status: text("status").default('new'),
	opportunityValue: numeric("opportunity_value", { precision: 12, scale:  2 }),
	jobName: text("job_name"),
	rawData: jsonb("raw_data"),
	lastContactedAt: timestamp("last_contacted_at", { mode: 'string' }),
	firstSeenAt: timestamp("first_seen_at", { mode: 'string' }).defaultNow(),
	lastSyncedAt: timestamp("last_synced_at", { mode: 'string' }).defaultNow(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxLeadSyncSource: index("idx_lead_sync_source").on(table.externalId, table.source),
		leadSyncCacheSourceExternalIdKey: unique("lead_sync_cache_source_external_id_key").on(table.externalId, table.source),
	}
});

export const leadFollowUps = pgTable("lead_follow_ups", {
	id: serial("id").primaryKey().notNull(),
	leadCacheId: integer("lead_cache_id").references(() => leadSyncCache.id),
	followUpType: text("follow_up_type").notNull(),
	dueDate: timestamp("due_date", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	completedBy: text("completed_by"),
	notes: text("notes"),
	autoGenerated: boolean("auto_generated").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxLeadFollowUpsLead: index("idx_lead_follow_ups_lead").on(table.leadCacheId),
		idxLeadFollowUpsDue: index("idx_lead_follow_ups_due").on(table.dueDate),
	}
});

export const briefingReports = pgTable("briefing_reports", {
	id: serial("id").primaryKey().notNull(),
	reportType: text("report_type").notNull(),
	periodStart: date("period_start").notNull(),
	periodEnd: date("period_end").notNull(),
	summary: text("summary"),
	metrics: jsonb("metrics"),
	highlights: jsonb("highlights"),
	rawData: jsonb("raw_data"),
	html: text("html"),
	generatedAt: timestamp("generated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxBriefingReportsGenerated: index("idx_briefing_reports_generated").on(table.generatedAt),
		briefingReportsReportTypePeriodStartPeriodEndKey: unique("briefing_reports_report_type_period_start_period_end_key").on(table.reportType, table.periodStart, table.periodEnd),
	}
});

export const leadIntelReports = pgTable("lead_intel_reports", {
	id: serial("id").primaryKey().notNull(),
	leadId: text("lead_id"),
	contactId: text("contact_id"),
	contactName: text("contact_name"),
	address: text("address"),
	city: text("city"),
	state: text("state"),
	zip: text("zip"),
	stormSummary: jsonb("storm_summary"),
	propertyData: jsonb("property_data"),
	enrichment: jsonb("enrichment"),
	recommendedPitch: text("recommended_pitch"),
	talkingPoints: jsonb("talking_points"),
	html: text("html"),
	generatedAt: timestamp("generated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxLeadIntelLead: index("idx_lead_intel_lead").on(table.leadId),
		idxLeadIntelGenerated: index("idx_lead_intel_generated").on(table.generatedAt),
	}
});

export const stormCanvassReports = pgTable("storm_canvass_reports", {
	id: serial("id").primaryKey().notNull(),
	eventLabel: text("event_label").notNull(),
	eventDate: date("event_date").notNull(),
	centerLat: doublePrecision("center_lat"),
	centerLng: doublePrecision("center_lng"),
	radiusMiles: numeric("radius_miles", { precision: 6, scale:  2 }),
	affectedCount: integer("affected_count").default(0),
	contacts: jsonb("contacts"),
	outreachScripts: jsonb("outreach_scripts"),
	html: text("html"),
	generatedAt: timestamp("generated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxStormCanvassEvent: index("idx_storm_canvass_event").on(table.eventDate),
	}
});

export const reportRequests = pgTable("report_requests", {
	id: text("id").primaryKey().notNull(),
	threadId: text("thread_id").notNull(),
	fromEmail: text("from_email").notNull(),
	repName: text("rep_name"),
	subject: text("subject"),
	status: text("status").default('needs_info').notNull(),
	jobId: text("job_id"),
	jobNumber: text("job_number"),
	address: text("address"),
	city: text("city"),
	state: text("state"),
	zip: text("zip"),
	template: text("template"),
	description: text("description"),
	photos: jsonb("photos").default([]),
	documents: jsonb("documents").default([]),
	contact: jsonb("contact").default({}),
	candidates: jsonb("candidates").default([]),
	uploadToken: text("upload_token"),
	lastQuestion: text("last_question"),
	questionCount: integer("question_count").default(0),
	warnings: jsonb("warnings").default([]),
	reportId: text("report_id"),
	shareUrl: text("share_url"),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	reportType: text("report_type"),
},
(table) => {
	return {
		idxReportRequestsThread: index("idx_report_requests_thread").on(table.threadId),
		idxReportRequestsToken: index("idx_report_requests_token").on(table.uploadToken),
		idxReportRequestsStatus: index("idx_report_requests_status").on(table.status),
		idxReportRequestsCreated: index("idx_report_requests_created").on(table.createdAt),
		reportRequestsThreadIdKey: unique("report_requests_thread_id_key").on(table.threadId),
		reportRequestsUploadTokenKey: unique("report_requests_upload_token_key").on(table.uploadToken),
	}
});