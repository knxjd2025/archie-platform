-- Archie: constraints and indexes that shared/schema.ts does not express.
-- Carried over from the Best Roofing AI migrations, with keys made per company
-- wherever the value is only unique inside one company (job ids, emails).

-- Team reporting line.
ALTER TABLE team_members ADD CONSTRAINT team_members_reports_to_fkey FOREIGN KEY (reports_to) REFERENCES team_members(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE team_members ADD CONSTRAINT team_members_no_self_report CHECK (reports_to IS DISTINCT FROM id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS team_members_reports_to_idx ON team_members (reports_to);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS team_members_jt_membership_idx ON team_members (company_id, jobtread_membership_id) WHERE jobtread_membership_id IS NOT NULL;
--> statement-breakpoint

-- Who is on a job: one row per person per job, and one primary per job.
CREATE UNIQUE INDEX IF NOT EXISTS rep_assignments_job_member_idx ON rep_assignments (company_id, job_external_id, team_member_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS rep_assignments_one_primary_idx ON rep_assignments (company_id, job_external_id) WHERE role = 'primary';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rep_assignments_member_idx ON rep_assignments (team_member_id);
--> statement-breakpoint

-- Commission splits and payouts.
ALTER TABLE job_commission_splits ADD CONSTRAINT job_commission_splits_share_range CHECK (share_pct >= 0 AND share_pct <= 100);
--> statement-breakpoint
ALTER TABLE job_commission_payouts ADD CONSTRAINT job_commission_payouts_kind CHECK (kind IN ('draw', 'balance'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS job_commission_splits_one_per_member_idx ON job_commission_splits (job_commission_id, team_member_id) WHERE team_member_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_commission_splits_job_idx ON job_commission_splits (job_commission_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_commission_splits_member_idx ON job_commission_splits (team_member_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_commission_splits_status_idx ON job_commission_splits (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_commission_payouts_split_idx ON job_commission_payouts (split_id, paid_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_job_commissions_status ON job_commissions (status, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_job_commissions_member ON job_commissions (team_member_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_commissions_team_member ON commissions (team_member_id);
--> statement-breakpoint

-- Meetings: one open issue per source per meeting.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_issues_open_source_idx ON meeting_issues (company_id, meeting, source_key) WHERE source_key IS NOT NULL AND solved_at IS NULL AND dropped_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS meeting_actions_open_idx ON meeting_actions (done_at) WHERE done_at IS NULL;
--> statement-breakpoint

-- Bug reports: caught errors are grouped per company by fingerprint. Errors from
-- before sign-in have no company and group together (NULLS NOT DISTINCT).
CREATE UNIQUE INDEX IF NOT EXISTS bug_reports_company_fingerprint_uq ON bug_reports (company_id, fingerprint) NULLS NOT DISTINCT WHERE fingerprint IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bug_reports_last_seen_idx ON bug_reports (last_seen DESC);
--> statement-breakpoint

-- Lookups by job and by person.
CREATE INDEX IF NOT EXISTS idx_inspection_submissions_job ON inspection_submissions (job_external_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_inspection_submissions_member ON inspection_submissions (team_member_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_precon_checklists_job ON precon_checklists (job_external_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_precon_checklists_member ON precon_checklists (team_member_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_final_walkthroughs_job ON final_walkthroughs (job_external_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_final_walkthroughs_member ON final_walkthroughs (team_member_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_production_pipeline_stage ON production_pipeline (stage);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sales_pipeline_stage ON sales_pipeline (stage);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sales_pipeline_lost_reason_idx ON sales_pipeline (lost_reason) WHERE lost_reason IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_certificates_status_idx ON job_certificates (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_entered_by_idx ON leads (entered_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kpi_events_member_type_time ON kpi_events (team_member_id, type, occurred_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agents_reports_to ON agents (reports_to);
--> statement-breakpoint

-- Calls and messages.
CREATE INDEX IF NOT EXISTS calls_started_at_idx ON calls (started_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS calls_lead_id_idx ON calls (lead_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS calls_lead_external_id_idx ON calls (lead_external_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS calls_team_member_id_idx ON calls (team_member_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS calls_direction_status_idx ON calls (direction, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS calls_our_number_idx ON calls (our_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS comm_messages_sent_at_idx ON comm_messages (sent_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS comm_messages_lead_id_idx ON comm_messages (lead_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS comm_messages_lead_external_id_idx ON comm_messages (lead_external_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS comm_messages_channel_dir_idx ON comm_messages (channel, direction);
--> statement-breakpoint

-- Canvassing and inbox.
CREATE INDEX IF NOT EXISTS canvass_enrichment_area_idx ON canvass_enrichment (area_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS canvass_property_meta_owner_idx ON canvass_property_meta (lower(owner_email));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS canvass_property_meta_follow_up_idx ON canvass_property_meta (follow_up_at) WHERE follow_up_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbox_scans_mailbox_idx ON inbox_scans (mailbox, to_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbox_items_mailbox_status_idx ON inbox_items (mailbox, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS imessages_owner_match_idx ON imessages (owner, matched_external_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS imessage_outbox_owner_status_idx ON imessage_outbox (owner, status);
--> statement-breakpoint

-- Financial integrations and outreach.
CREATE INDEX IF NOT EXISTS idx_integration_tokens_provider ON integration_tokens (provider);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_integration_tokens_active ON integration_tokens (is_active);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plaid_items_status ON plaid_items (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_date ON plaid_transactions (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_account ON plaid_transactions (account_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_item ON plaid_transactions (plaid_item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_status ON outreach_campaigns (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_next_run ON outreach_campaigns (next_run_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outreach_leads_campaign_id ON outreach_leads (campaign_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outreach_leads_status ON outreach_leads (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outreach_leads_dedupe ON outreach_leads (dedupe_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outreach_leads_scheduled_send ON outreach_leads (status, scheduled_send_at) WHERE status = 'queued' AND scheduled_send_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outreach_attempts_lead_id ON outreach_attempts (lead_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outreach_attempts_campaign_id ON outreach_attempts (campaign_id);
