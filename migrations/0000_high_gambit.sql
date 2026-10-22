DO $$ BEGIN
 CREATE TYPE "agent_role" AS ENUM('ceo', 'cfo', 'cmo', 'cto', 'coo', 'sales_manager', 'customer_service', 'project_coordinator', 'estimator', 'cpa', 'tax_accountant', 'tax_lawyer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "agent_status" AS ENUM('active', 'paused', 'disabled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "claim_stage" AS ENUM('intake', 'inspection_done', 'sa_signed', 'adjuster_scheduled', 'adjuster_met', 'decision_pending', 'approved', 'supplementing', 'build_scheduled', 'build_done', 'final_invoiced', 'depreciation_pending', 'closed', 'denied_dispute');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "knowledge_category" AS ENUM('company', 'services', 'pricing', 'service_area', 'industry', 'faq', 'scripts', 'competitors', 'reviews', 'legal');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "lead_status" AS ENUM('new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'disqualified');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "loop_kind" AS ENUM('unanswered_inbound', 'new_lead_untouched', 'promise_made', 'claim_milestone', 'estimate_stale', 'invoice_unpaid', 'appointment_conflict', 'appointment_stale_confirmed', 'callback_requested', 'integration_failure', 'custom');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "loop_source" AS ENUM('gmail', 'ghl', 'jobtread', 'calendar', 'sms', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "loop_state" AS ENUM('open', 'nudged', 'escalated', 'snoozed', 'done', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "loop_urgency" AS ENUM('emergency', 'urgent', 'normal', 'low');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "message_role" AS ENUM('user', 'assistant', 'system', 'tool');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "nudge_channel" AS ENUM('sms', 'email');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "nudge_status" AS ENUM('sent', 'delivered', 'failed', 'queued_quiet_hours', 'dry_run');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "outreach_attempt_status" AS ENUM('pending', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "outreach_campaign_status" AS ENUM('draft', 'active', 'paused', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "outreach_lead_status" AS ENUM('scraped', 'enriching', 'enriched', 'personalizing', 'personalized', 'queued', 'sent', 'delivered', 'opened', 'replied', 'converted', 'failed', 'bounced');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "brain_person" AS ENUM('james', 'thomas', 'banning', 'admin', 'unassigned');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "scrape_job_status" AS ENUM('pending', 'running', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "task_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"task_id" integer,
	"context" text NOT NULL,
	"decision" text NOT NULL,
	"reasoning" text,
	"confidence" numeric(3, 2),
	"overridden" boolean DEFAULT false,
	"overridden_by" integer,
	"override_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"status" "task_status" DEFAULT 'pending',
	"result" jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "agent_role" NOT NULL,
	"title" text NOT NULL,
	"persona" text NOT NULL,
	"system_prompt" text NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb,
	"status" "agent_status" DEFAULT 'active',
	"avatar" text,
	"reports_to" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brain_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'sweep' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"events_seen" integer DEFAULT 0 NOT NULL,
	"loops_opened" integer DEFAULT 0 NOT NULL,
	"loops_closed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_name" text NOT NULL,
	"contact" jsonb,
	"jobtread_job_id" text,
	"carrier" text,
	"policy_number" text,
	"claim_number" text,
	"date_of_loss" timestamp,
	"adjuster" jsonb,
	"amounts" jsonb,
	"stage" "claim_stage" DEFAULT 'intake' NOT NULL,
	"stage_entered_at" timestamp DEFAULT now() NOT NULL,
	"next_action" text NOT NULL,
	"next_action_owner" "brain_person" DEFAULT 'james' NOT NULL,
	"next_action_due" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "communication_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer,
	"agent_id" integer,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"content" text,
	"external_id" text,
	"status" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"agent_id" integer,
	"title" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" timestamp NOT NULL,
	"revenue" numeric(12, 2) DEFAULT '0',
	"expenses" numeric(12, 2) DEFAULT '0',
	"new_leads" integer DEFAULT 0,
	"qualified_leads" integer DEFAULT 0,
	"converted_leads" integer DEFAULT 0,
	"active_jobs" integer DEFAULT 0,
	"completed_jobs" integer DEFAULT 0,
	"new_reviews" integer DEFAULT 0,
	"avg_rating" numeric(2, 1),
	"data" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"subject_template" text NOT NULL,
	"body_template" text NOT NULL,
	"subject_prompt" text,
	"first_line_prompt" text,
	"target_industries" jsonb,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_type" text,
	"expires_at" timestamp,
	"realm_id" text,
	"scope" text,
	"raw_response" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"document_id" integer,
	"chunk_id" integer,
	"query" text,
	"relevance_score" numeric(5, 4),
	"used_in_response" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" text,
	"token_count" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" "knowledge_category" NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb,
	"source" text,
	"version" integer DEFAULT 1,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text,
	"source" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"status" "lead_status" DEFAULT 'new',
	"score" integer,
	"service_type" text,
	"property_type" text,
	"notes" text,
	"qualified_at" timestamp,
	"qualified_by" integer,
	"qualification_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_contacted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nudges" (
	"id" serial PRIMARY KEY NOT NULL,
	"loop_id" integer NOT NULL,
	"to_person" "brain_person" NOT NULL,
	"channel" "nudge_channel" NOT NULL,
	"body" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"status" "nudge_status" DEFAULT 'sent' NOT NULL,
	"provider_ref" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"ack_at" timestamp,
	CONSTRAINT "nudges_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_loops" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "loop_kind" NOT NULL,
	"source" "loop_source" NOT NULL,
	"source_ref" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"contact" jsonb,
	"summary" text NOT NULL,
	"evidence" jsonb,
	"owner" "brain_person" DEFAULT 'unassigned' NOT NULL,
	"urgency" "loop_urgency" DEFAULT 'normal' NOT NULL,
	"due_at" timestamp,
	"state" "loop_state" DEFAULT 'open' NOT NULL,
	"snooze_until" timestamp,
	"claim_id" integer,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"last_event_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	CONSTRAINT "open_loops_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"email_subject" text NOT NULL,
	"email_first_line" text NOT NULL,
	"email_body" text,
	"instantly_email_id" text,
	"status" "outreach_attempt_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"replied_at" timestamp,
	"bounced_at" timestamp,
	"error" text,
	"attempt_number" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" "outreach_campaign_status" DEFAULT 'draft' NOT NULL,
	"industries" jsonb NOT NULL,
	"target_locations" jsonb,
	"daily_lead_target" integer DEFAULT 250,
	"instantly_api_key" text,
	"instantly_campaign_id" text,
	"email_template_id" integer,
	"run_time" text DEFAULT '09:00',
	"timezone" text DEFAULT 'America/New_York',
	"warm_up_enabled" boolean DEFAULT true,
	"warm_up_start_date" timestamp,
	"warm_up_daily_limit" integer DEFAULT 10,
	"current_daily_limit" integer DEFAULT 10,
	"total_leads_generated" integer DEFAULT 0,
	"total_emails_sent" integer DEFAULT 0,
	"total_opens" integer DEFAULT 0,
	"total_replies" integer DEFAULT 0,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"company_name" text NOT NULL,
	"industry" text NOT NULL,
	"website" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"owner_first_name" text,
	"owner_last_name" text,
	"owner_email" text,
	"email_verified" boolean DEFAULT false,
	"email_verification_source" text,
	"email_verification_score" numeric(5, 2),
	"company_size" text,
	"year_founded" text,
	"linkedin_url" text,
	"facebook_url" text,
	"google_review_count" integer,
	"google_rating" numeric(2, 1),
	"personalized_subject_line" text,
	"personalized_first_line" text,
	"personalization_context" jsonb,
	"status" "outreach_lead_status" DEFAULT 'scraped' NOT NULL,
	"dedupe_hash" text NOT NULL,
	"source_url" text,
	"scrape_job_id" integer,
	"instantly_lead_id" text,
	"scheduled_send_at" timestamp,
	"actual_sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plaid_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"access_token" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"cursor" text,
	"status" text DEFAULT 'active',
	"consent_expiration" timestamp,
	"accounts" jsonb,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "plaid_items_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plaid_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"plaid_item_id" integer NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"date" timestamp NOT NULL,
	"name" text,
	"merchant_name" text,
	"category" jsonb,
	"pending" boolean DEFAULT false,
	"payment_channel" text,
	"raw_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "plaid_transactions_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scrape_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"industry" text NOT NULL,
	"location" text,
	"search_query" text NOT NULL,
	"target_count" integer DEFAULT 50,
	"status" "scrape_job_status" DEFAULT 'pending' NOT NULL,
	"leads_found" integer DEFAULT 0,
	"leads_processed" integer DEFAULT 0,
	"duplicates_skipped" integer DEFAULT 0,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'user',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watch_cursors" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"channel" text DEFAULT '' NOT NULL,
	"cursor" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"trigger_data" jsonb,
	"status" "task_status" DEFAULT 'pending',
	"current_step" integer DEFAULT 0,
	"step_results" jsonb,
	"error" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" text NOT NULL,
	"trigger_conditions" jsonb,
	"steps" jsonb NOT NULL,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_reports_to_agents_id_fk" FOREIGN KEY ("reports_to") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_access_log" ADD CONSTRAINT "knowledge_access_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_access_log" ADD CONSTRAINT "knowledge_access_log_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_access_log" ADD CONSTRAINT "knowledge_access_log_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_qualified_by_agents_id_fk" FOREIGN KEY ("qualified_by") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_lead_id_outreach_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "outreach_leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "email_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "plaid_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
