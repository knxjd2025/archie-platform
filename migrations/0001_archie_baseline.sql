CREATE TYPE "public"."agent_role" AS ENUM('ceo', 'cfo', 'cmo', 'cto', 'coo', 'sales_manager', 'customer_service', 'project_coordinator', 'estimator', 'cpa', 'tax_accountant', 'tax_lawyer');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'paused', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."inspection_submission_status" AS ENUM('draft', 'submitted', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('ar', 'ap');--> statement-breakpoint
CREATE TYPE "public"."job_commission_status" AS ENUM('open', 'approved', 'denied', 'paid');--> statement-breakpoint
CREATE TYPE "public"."knowledge_category" AS ENUM('company', 'services', 'pricing', 'service_area', 'industry', 'faq', 'scripts', 'competitors', 'reviews', 'legal');--> statement-breakpoint
CREATE TYPE "public"."kpi_event_type" AS ENUM('door_knock', 'lead_contacted', 'report_created', 'report_presented', 'referral_received', 'lead_given');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."outreach_attempt_status" AS ENUM('pending', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outreach_campaign_status" AS ENUM('draft', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."outreach_lead_status" AS ENUM('scraped', 'enriching', 'enriched', 'personalizing', 'personalized', 'queued', 'sent', 'delivered', 'opened', 'replied', 'converted', 'failed', 'bounced');--> statement-breakpoint
CREATE TYPE "public"."precon_checklist_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."scrape_job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('ok', 'partial', 'error');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('admin', 'sales_director', 'manager', 'customer_service', 'sales', 'production');--> statement-breakpoint
CREATE TABLE "agent_chat_messages" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_chats" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"user_email" text NOT NULL,
	"agent_key" text NOT NULL,
	"day" text NOT NULL,
	"summary" text,
	"summarized_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_decisions" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "agent_tasks" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "agents" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "appointments" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"title" text,
	"start" timestamp,
	"end" timestamp,
	"address" text,
	"calendar_source" text,
	"kind" text,
	"attendees" jsonb DEFAULT '[]'::jsonb,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"company_id" uuid DEFAULT archie_current_company(),
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"fingerprint" text,
	"message" text NOT NULL,
	"details" text,
	"page" text,
	"url" text,
	"user_email" text,
	"user_agent" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"screenshot" text,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_sid" text,
	"direction" text NOT NULL,
	"from_e164" text NOT NULL,
	"to_e164" text NOT NULL,
	"our_number" text,
	"lead_id" integer,
	"lead_external_id" text,
	"team_member_id" integer,
	"rep_name" text,
	"answered_by" text,
	"status" text,
	"started_at" timestamp,
	"ended_at" timestamp,
	"duration_seconds" integer,
	"recording_url" text,
	"recording_sid" text,
	"recording_seconds" integer,
	"transcript" text,
	"transcript_source" text,
	"summary" text,
	"outcome" text,
	"extracted" jsonb,
	"cost_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calls_provider_sid_unique" UNIQUE("provider_sid")
);
--> statement-breakpoint
CREATE TABLE "canvass_areas" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"shape" jsonb NOT NULL,
	"filters" jsonb NOT NULL,
	"geography" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tracerfy_list_id" integer,
	"preview_count" integer,
	"requested_count" integer,
	"delivered_count" integer,
	"in_area_count" integer,
	"credits_deducted" integer,
	"error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "canvass_enrichment" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"canvass_property_id" integer NOT NULL,
	"area_id" integer,
	"source" text DEFAULT 'tracerfy' NOT NULL,
	"in_area" boolean,
	"owner_name" text,
	"owner2_name" text,
	"mailing_address" text,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"litigator" boolean,
	"contact_clean" boolean,
	"property_type" text,
	"year_built" integer,
	"building_sqft" integer,
	"roof_material" text,
	"roof_construction" text,
	"estimated_value" integer,
	"equity_percent" double precision,
	"years_owned" integer,
	"owner_occupied" boolean,
	"absentee_owner" boolean,
	"high_equity" boolean,
	"free_clear" boolean,
	"vacant" boolean,
	"mls_active" boolean,
	"roof_score" integer,
	"sell_score" integer,
	"raw" jsonb,
	"credits_spent" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "canvass_enrichment_canvass_property_id_unique" UNIQUE("canvass_property_id")
);
--> statement-breakpoint
CREATE TABLE "canvass_properties" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"city" text,
	"state" text,
	"zip" text,
	"lat" double precision,
	"lng" double precision,
	"status" text DEFAULT 'not_knocked' NOT NULL,
	"notes" text,
	"owner_name" text,
	"phone" text,
	"email" text,
	"storm_summary" jsonb,
	"measurements" jsonb,
	"lead_external_id" text,
	"knocked_by" text,
	"knocked_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "canvass_property_meta" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"canvass_property_id" integer NOT NULL,
	"owner_email" text,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"follow_up_at" timestamp,
	"assigned_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "canvass_property_meta_canvass_property_id_unique" UNIQUE("canvass_property_id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
	"stage" text DEFAULT 'file_claim' NOT NULL,
	"dispute_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stage_entered_at" timestamp DEFAULT now() NOT NULL,
	"next_action" text NOT NULL,
	"next_action_owner" text,
	"next_action_due" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_reports" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"report_id" text NOT NULL,
	"report_type" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"report_url" text,
	"pdf_url" text,
	"error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"html" text,
	"data" jsonb,
	"share_token" text,
	"title" text,
	"presented_at" timestamp,
	"presented_by" text,
	"jobtread_document_id" text,
	"jobtread_pushed_at" timestamp,
	"jobtread_pushed_hash" text,
	"jobtread_doc_status" text,
	"engagement" jsonb,
	CONSTRAINT "client_reports_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
CREATE TABLE "comm_messages" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_sid" text,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"from_addr" text NOT NULL,
	"to_addr" text NOT NULL,
	"our_number" text,
	"lead_id" integer,
	"lead_external_id" text,
	"team_member_id" integer,
	"subject" text,
	"body" text,
	"media" jsonb,
	"status" text,
	"error_detail" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comm_messages_provider_sid_unique" UNIQUE("provider_sid")
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text,
	"job_name" text NOT NULL,
	"team_member_id" integer,
	"rep_name" text NOT NULL,
	"lead_source" text NOT NULL,
	"job_type" text NOT NULL,
	"overhead_pct" numeric(5, 2) NOT NULL,
	"override_used" boolean DEFAULT false NOT NULL,
	"revenue" numeric(12, 2) NOT NULL,
	"material" numeric(12, 2) DEFAULT '0' NOT NULL,
	"labor" numeric(12, 2) DEFAULT '0' NOT NULL,
	"other" numeric(12, 2) DEFAULT '0' NOT NULL,
	"profit" numeric(12, 2) NOT NULL,
	"commission_amount" numeric(12, 2) NOT NULL,
	"status" "commission_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "communication_log" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"trade" text DEFAULT 'roofing' NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"ghl_location_id" text,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "companies_ghl_location_id_unique" UNIQUE("ghl_location_id")
);
--> statement-breakpoint
CREATE TABLE "company_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"provider" text NOT NULL,
	"credentials" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"agent_id" integer,
	"title" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "deals" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"customer" text,
	"amount" numeric(12, 2),
	"type" text,
	"status" text,
	"issue_date" text,
	"signed_at" timestamp,
	"job_ref" text,
	"owner_id" integer,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "final_walkthroughs" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"team_member_id" integer,
	"walked_by" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "precon_checklist_status" DEFAULT 'draft' NOT NULL,
	"issue_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp,
	"jobtread_synced_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text,
	"client_name" text,
	"note" text NOT NULL,
	"due_date" date,
	"assigned_to" integer,
	"created_by" text,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "imessage_outbox" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"to_handle" text NOT NULL,
	"body" text NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "imessages" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"guid" text NOT NULL,
	"chat_guid" text,
	"handle" text,
	"handle_key" text,
	"direction" text NOT NULL,
	"service" text,
	"text" text,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp NOT NULL,
	"matched_external_id" text,
	"matched_name" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "imessages_guid_unique" UNIQUE("guid")
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox" text NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text,
	"from_name" text,
	"from_email" text,
	"subject" text,
	"snippet" text,
	"received_at" timestamp,
	"category" text DEFAULT 'other' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"matched_external_id" text,
	"matched_name" text,
	"status" text DEFAULT 'new' NOT NULL,
	"unread" boolean,
	"handled_by" text,
	"handled_at" timestamp,
	"follow_up_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbox_scans" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox" text NOT NULL,
	"from_at" timestamp NOT NULL,
	"to_at" timestamp NOT NULL,
	"messages_seen" integer DEFAULT 0 NOT NULL,
	"items_added" integer DEFAULT 0 NOT NULL,
	"flagged" integer DEFAULT 0 NOT NULL,
	"started_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inspection_submissions" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"team_member_id" integer,
	"inspector_name" text,
	"inspection_type" text,
	"recommendation" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "inspection_submission_status" DEFAULT 'draft' NOT NULL,
	"signed_at" timestamp,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"jobtread_synced_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "integration_cache" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "integration_tokens" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "invoices" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"party" text,
	"amount" numeric(12, 2),
	"balance" numeric(12, 2),
	"due_date" text,
	"issue_date" text,
	"status" text,
	"job_ref" text,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_certificates" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"walkthrough_id" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"company_signer" text,
	"company_signed_at" timestamp,
	"homeowner_name" text,
	"homeowner_email" text,
	"homeowner_signer" text,
	"homeowner_signed_at" timestamp,
	"homeowner_ip" text,
	"sign_token" text,
	"sent_at" timestamp,
	"sent_by" text,
	"jobtread_file_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "job_certificates_sign_token_unique" UNIQUE("sign_token")
);
--> statement-breakpoint
CREATE TABLE "job_checklists" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"checklist_key" text NOT NULL,
	"items" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_commission_payouts" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"split_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"kind" text DEFAULT 'draw' NOT NULL,
	"reference" text,
	"note" text,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"paid_by" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_commission_splits" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_commission_id" integer NOT NULL,
	"team_member_id" integer,
	"rep_name" text,
	"share_pct" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"manual_amount" numeric(12, 2),
	"commission_amount" numeric(12, 2),
	"balance_due" numeric(12, 2),
	"status" "job_commission_status" DEFAULT 'open' NOT NULL,
	"denied_reason" text,
	"denied_by" text,
	"denied_at" timestamp,
	"approved_by" text,
	"approved_at" timestamp,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_commissions" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"job_name" text,
	"team_member_id" integer,
	"rep_name" text,
	"lead_source" text,
	"job_type" text DEFAULT 'retail' NOT NULL,
	"manual_overhead_pct" numeric(5, 2),
	"overhead_pct" numeric(5, 2),
	"revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"material" numeric(12, 2) DEFAULT '0' NOT NULL,
	"labor" numeric(12, 2) DEFAULT '0' NOT NULL,
	"other" numeric(12, 2) DEFAULT '0' NOT NULL,
	"profit" numeric(12, 2),
	"commission_amount" numeric(12, 2),
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"advances_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"balance_due" numeric(12, 2),
	"manual_commission" numeric(12, 2),
	"denied_reason" text,
	"denied_by" text,
	"denied_at" timestamp,
	"notes" text,
	"status" "job_commission_status" DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"paid_by" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jobtread_archive" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"entity_type" text NOT NULL,
	"jt_id" text NOT NULL,
	"job_id" text,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jobtread_archive_company_id_entity_type_jt_id_pk" PRIMARY KEY("company_id","entity_type","jt_id")
);
--> statement-breakpoint
CREATE TABLE "jobtread_archive_steps" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"step" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cursor" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jobtread_archive_steps_company_id_step_pk" PRIMARY KEY("company_id","step")
);
--> statement-breakpoint
CREATE TABLE "knowledge_access_log" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "knowledge_chunks" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" text,
	"token_count" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "kpi_events" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"team_member_id" integer,
	"rep_name" text,
	"type" "kpi_event_type" NOT NULL,
	"ref_table" text,
	"ref_id" text,
	"note" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
	"entered_by" text,
	"entered_by_name" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_contacted_at" timestamp,
	"job_name" text,
	"job_number" text,
	"stage" text,
	"jt_sales_rep" text,
	"project_manager" text,
	"projected_value" numeric(12, 2),
	"schedule_start" timestamp,
	"schedule_end" timestamp,
	"closed_on" timestamp,
	"insurance_claim" boolean
);
--> statement-breakpoint
CREATE TABLE "meeting_actions" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"week_id" integer NOT NULL,
	"meeting" text NOT NULL,
	"action_text" text NOT NULL,
	"owner_email" text,
	"due_date" text,
	"done_at" timestamp,
	"done_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meeting_issues" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"meeting" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_key" text,
	"raised_by" text,
	"raised_at" timestamp DEFAULT now(),
	"first_seen_week" date,
	"priority" integer,
	"solved_at" timestamp,
	"solved_note" text,
	"solved_by" text,
	"dropped_at" timestamp,
	"dropped_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meeting_notes" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"week_id" integer NOT NULL,
	"meeting" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meeting_ratings" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"meeting" text NOT NULL,
	"monday" date NOT NULL,
	"rater_email" text NOT NULL,
	"score" integer NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meeting_weeks" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"monday" date NOT NULL,
	"agendas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"week_from" date,
	"week_to" date,
	"generated_at" timestamp,
	"generated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "native_handoffs" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_attempts" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "outreach_campaigns" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "outreach_leads" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "phone_numbers" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"e164" text NOT NULL,
	"label" text NOT NULL,
	"purpose" text DEFAULT 'direct' NOT NULL,
	"team_member_id" integer,
	"provider" text DEFAULT 'twilio' NOT NULL,
	"provider_sid" text,
	"forwards_to" text,
	"ring_to" text DEFAULT 'phone' NOT NULL,
	"client_identity" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "phone_numbers_e164_unique" UNIQUE("e164")
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "plaid_transactions" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "precon_checklists" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"team_member_id" integer,
	"rep_name" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "precon_checklist_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"jobtread_synced_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "production_pipeline" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"stage" text NOT NULL,
	"trades" jsonb DEFAULT '[{"key":"roofing","done":false}]'::jsonb NOT NULL,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deposit_received_at" timestamp,
	"stage_entered_at" timestamp DEFAULT now(),
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rep_assignments" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"team_member_id" integer NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"confidence" text,
	"evidence" text,
	"assigned_by" text,
	"assigned_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rep_daily_reminders" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"team_member_id" integer NOT NULL,
	"reminder_date" date NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_status" text,
	"sms_status" text,
	"error" text,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rep_goals" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"team_member_id" integer NOT NULL,
	"income_goal" integer DEFAULT 100000 NOT NULL,
	"avg_commission" integer DEFAULT 1500 NOT NULL,
	"close_rate" integer DEFAULT 40 NOT NULL,
	"selling_months" integer DEFAULT 9 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "rep_goals_team_member_id_unique" UNIQUE("team_member_id")
);
--> statement-breakpoint
CREATE TABLE "rocks" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"meeting" text DEFAULT 'leadership' NOT NULL,
	"title" text NOT NULL,
	"owner_email" text,
	"quarter" text NOT NULL,
	"status" text DEFAULT 'on_track' NOT NULL,
	"due_date" date,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sales_pipeline" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"stage" text NOT NULL,
	"lost_reason" text,
	"lost_note" text,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stage_entered_at" timestamp DEFAULT now(),
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scorecard_metrics" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"meeting" text DEFAULT 'leadership' NOT NULL,
	"scope" text DEFAULT 'company' NOT NULL,
	"owner_email" text,
	"goal" numeric,
	"direction" text DEFAULT 'at_least' NOT NULL,
	"unit" text DEFAULT 'count' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "settings" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "signature_requests" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_external_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text,
	"title" text NOT NULL,
	"html" text NOT NULL,
	"doc_hash" text NOT NULL,
	"message" text,
	"property_address" text,
	"property_lat" double precision,
	"property_lng" double precision,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"sent_at" timestamp,
	"sent_by" text,
	"completed_at" timestamp,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	"jobtread_file_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "signature_signers" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text DEFAULT 'customer' NOT NULL,
	"token" text NOT NULL,
	"emailed_at" timestamp,
	"email_error" text,
	"texted_at" timestamp,
	"text_error" text,
	"reminded_at" timestamp,
	"remind_count" integer DEFAULT 0 NOT NULL,
	"first_viewed_at" timestamp,
	"last_viewed_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"signed_at" timestamp,
	"signed_name" text,
	"signature_kind" text,
	"signature_image" text,
	"declined_at" timestamp,
	"decline_reason" text,
	"ip" text,
	"user_agent" text,
	"geo" jsonb,
	"view_geo" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "signature_signers_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"status" "sync_status" NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"counts" jsonb DEFAULT '{}'::jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" "team_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"can_login" boolean DEFAULT false NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_sms" boolean DEFAULT false NOT NULL,
	"google_sub" text,
	"last_login_at" timestamp,
	"created_by" text,
	"jobtread_sales_rep" text,
	"reports_to" integer,
	"jobtread_membership_id" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "team_members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'user',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "workflows" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
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
CREATE TABLE "write_log" (
	"company_id" uuid DEFAULT archie_current_company() NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"system" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"summary" text,
	"ok" boolean NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_chat_id_agent_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."agent_chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chats" ADD CONSTRAINT "agent_chats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_reports_to_agents_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvass_areas" ADD CONSTRAINT "canvass_areas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvass_enrichment" ADD CONSTRAINT "canvass_enrichment_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvass_properties" ADD CONSTRAINT "canvass_properties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvass_property_meta" ADD CONSTRAINT "canvass_property_meta_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_reports" ADD CONSTRAINT "client_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_messages" ADD CONSTRAINT "comm_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_messages" ADD CONSTRAINT "comm_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_integrations" ADD CONSTRAINT "company_integrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_team_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_walkthroughs" ADD CONSTRAINT "final_walkthroughs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_walkthroughs" ADD CONSTRAINT "final_walkthroughs_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assigned_to_team_members_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imessage_outbox" ADD CONSTRAINT "imessage_outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imessages" ADD CONSTRAINT "imessages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_scans" ADD CONSTRAINT "inbox_scans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_submissions" ADD CONSTRAINT "inspection_submissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_submissions" ADD CONSTRAINT "inspection_submissions_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_cache" ADD CONSTRAINT "integration_cache_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_certificates" ADD CONSTRAINT "job_certificates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_checklists" ADD CONSTRAINT "job_checklists_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commission_payouts" ADD CONSTRAINT "job_commission_payouts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commission_payouts" ADD CONSTRAINT "job_commission_payouts_split_id_job_commission_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."job_commission_splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commission_splits" ADD CONSTRAINT "job_commission_splits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commission_splits" ADD CONSTRAINT "job_commission_splits_job_commission_id_job_commissions_id_fk" FOREIGN KEY ("job_commission_id") REFERENCES "public"."job_commissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commission_splits" ADD CONSTRAINT "job_commission_splits_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commissions" ADD CONSTRAINT "job_commissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_commissions" ADD CONSTRAINT "job_commissions_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobtread_archive" ADD CONSTRAINT "jobtread_archive_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobtread_archive_steps" ADD CONSTRAINT "jobtread_archive_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_log" ADD CONSTRAINT "knowledge_access_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_log" ADD CONSTRAINT "knowledge_access_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_log" ADD CONSTRAINT "knowledge_access_log_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_log" ADD CONSTRAINT "knowledge_access_log_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_events" ADD CONSTRAINT "kpi_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_events" ADD CONSTRAINT "kpi_events_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_qualified_by_agents_id_fk" FOREIGN KEY ("qualified_by") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_actions" ADD CONSTRAINT "meeting_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_actions" ADD CONSTRAINT "meeting_actions_week_id_meeting_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."meeting_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_issues" ADD CONSTRAINT "meeting_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_week_id_meeting_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."meeting_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_ratings" ADD CONSTRAINT "meeting_ratings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_weeks" ADD CONSTRAINT "meeting_weeks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_handoffs" ADD CONSTRAINT "native_handoffs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_lead_id_outreach_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."outreach_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precon_checklists" ADD CONSTRAINT "precon_checklists_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precon_checklists" ADD CONSTRAINT "precon_checklists_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_pipeline" ADD CONSTRAINT "production_pipeline_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_assignments" ADD CONSTRAINT "rep_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_assignments" ADD CONSTRAINT "rep_assignments_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_daily_reminders" ADD CONSTRAINT "rep_daily_reminders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_daily_reminders" ADD CONSTRAINT "rep_daily_reminders_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_goals" ADD CONSTRAINT "rep_goals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_goals" ADD CONSTRAINT "rep_goals_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rocks" ADD CONSTRAINT "rocks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_pipeline" ADD CONSTRAINT "sales_pipeline_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_metrics" ADD CONSTRAINT "scorecard_metrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_request_id_signature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."signature_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_log" ADD CONSTRAINT "write_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_chats_user_agent_day_uq" ON "agent_chats" USING btree ("user_email","agent_key","day");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_company_role_uq" ON "agents" USING btree ("company_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_company_source_id_uq" ON "appointments" USING btree ("company_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_reports_share_token_uq" ON "client_reports" USING btree ("share_token");--> statement-breakpoint
CREATE UNIQUE INDEX "company_integrations_company_provider_uq" ON "company_integrations" USING btree ("company_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_company_source_id_uq" ON "deals" USING btree ("company_id","source_id");--> statement-breakpoint
CREATE INDEX "imessages_owner_handle_idx" ON "imessages" USING btree ("owner","handle_key","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_mailbox_message_idx" ON "inbox_items" USING btree ("mailbox","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_company_source_id_uq" ON "invoices" USING btree ("company_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_certificates_company_job_external_id_uq" ON "job_certificates" USING btree ("company_id","job_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_checklists_company_job_key_idx" ON "job_checklists" USING btree ("company_id","job_external_id","checklist_key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_commissions_company_job_external_id_uq" ON "job_commissions" USING btree ("company_id","job_external_id");--> statement-breakpoint
CREATE INDEX "jobtread_archive_job_idx" ON "jobtread_archive" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "meeting_actions_week_idx" ON "meeting_actions" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "meeting_issues_open_idx" ON "meeting_issues" USING btree ("meeting","solved_at","dropped_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_notes_week_meeting_idx" ON "meeting_notes" USING btree ("week_id","meeting");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_ratings_person_idx" ON "meeting_ratings" USING btree ("meeting","monday","rater_email");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_weeks_company_monday_uq" ON "meeting_weeks" USING btree ("company_id","monday");--> statement-breakpoint
CREATE UNIQUE INDEX "production_pipeline_company_job_external_id_uq" ON "production_pipeline" USING btree ("company_id","job_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rep_daily_reminders_company_rep_day_uq" ON "rep_daily_reminders" USING btree ("company_id","team_member_id","reminder_date");--> statement-breakpoint
CREATE INDEX "rocks_quarter_idx" ON "rocks" USING btree ("quarter","meeting");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_pipeline_company_job_external_id_uq" ON "sales_pipeline" USING btree ("company_id","job_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecard_metrics_company_key_meeting_scope_idx" ON "scorecard_metrics" USING btree ("company_id","key","meeting","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_company_key_uq" ON "settings" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "signature_requests_job_idx" ON "signature_requests" USING btree ("job_external_id");--> statement-breakpoint
CREATE INDEX "signature_requests_status_idx" ON "signature_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "signature_signers_request_idx" ON "signature_signers" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_company_email_uq" ON "users" USING btree ("company_id","email");--> statement-breakpoint
CREATE INDEX "write_log_action_target_idx" ON "write_log" USING btree ("action","target_id");