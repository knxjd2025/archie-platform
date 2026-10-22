-- Migration: Create outreach automation tables
-- Description: Adds tables for daily lead scraping and email outreach automation

-- Create enums
CREATE TYPE outreach_campaign_status AS ENUM ('draft', 'active', 'paused', 'completed');
CREATE TYPE outreach_lead_status AS ENUM ('scraped', 'enriching', 'enriched', 'personalizing', 'personalized', 'queued', 'sent', 'delivered', 'opened', 'replied', 'converted', 'failed', 'bounced');
CREATE TYPE outreach_attempt_status AS ENUM ('pending', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed');
CREATE TYPE scrape_job_status AS ENUM ('pending', 'running', 'completed', 'failed');

-- Create email_templates table
CREATE TABLE IF NOT EXISTS email_templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  subject_prompt TEXT,
  first_line_prompt TEXT,
  target_industries JSONB,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create outreach_campaigns table
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status outreach_campaign_status NOT NULL DEFAULT 'draft',
  industries JSONB NOT NULL,
  target_locations JSONB,
  daily_lead_target INTEGER DEFAULT 250,
  instantly_api_key TEXT,
  instantly_campaign_id TEXT,
  email_template_id INTEGER REFERENCES email_templates(id),
  run_time TEXT DEFAULT '09:00',
  timezone TEXT DEFAULT 'America/New_York',
  warm_up_enabled BOOLEAN DEFAULT TRUE,
  warm_up_start_date TIMESTAMP,
  warm_up_daily_limit INTEGER DEFAULT 10,
  current_daily_limit INTEGER DEFAULT 10,
  total_leads_generated INTEGER DEFAULT 0,
  total_emails_sent INTEGER DEFAULT 0,
  total_opens INTEGER DEFAULT 0,
  total_replies INTEGER DEFAULT 0,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create outreach_leads table
CREATE TABLE IF NOT EXISTS outreach_leads (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES outreach_campaigns(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  company_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  website TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  owner_first_name TEXT,
  owner_last_name TEXT,
  owner_email TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_source TEXT,
  email_verification_score DECIMAL(5,2),
  company_size TEXT,
  year_founded TEXT,
  linkedin_url TEXT,
  facebook_url TEXT,
  google_review_count INTEGER,
  google_rating DECIMAL(2,1),
  personalized_subject_line TEXT,
  personalized_first_line TEXT,
  personalization_context JSONB,
  status outreach_lead_status NOT NULL DEFAULT 'scraped',
  dedupe_hash TEXT NOT NULL,
  source_url TEXT,
  scrape_job_id INTEGER,
  instantly_lead_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create outreach_attempts table
CREATE TABLE IF NOT EXISTS outreach_attempts (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES outreach_leads(id),
  campaign_id INTEGER NOT NULL REFERENCES outreach_campaigns(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  email_subject TEXT NOT NULL,
  email_first_line TEXT NOT NULL,
  email_body TEXT,
  instantly_email_id TEXT,
  status outreach_attempt_status NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  replied_at TIMESTAMP,
  bounced_at TIMESTAMP,
  error TEXT,
  attempt_number INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create scrape_jobs table
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES outreach_campaigns(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  industry TEXT NOT NULL,
  location TEXT,
  search_query TEXT NOT NULL,
  target_count INTEGER DEFAULT 50,
  status scrape_job_status NOT NULL DEFAULT 'pending',
  leads_found INTEGER DEFAULT 0,
  leads_processed INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  error TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_outreach_campaigns_user_id ON outreach_campaigns(user_id);
CREATE INDEX idx_outreach_campaigns_status ON outreach_campaigns(status);
CREATE INDEX idx_outreach_campaigns_next_run ON outreach_campaigns(next_run_at);

CREATE INDEX idx_outreach_leads_campaign_id ON outreach_leads(campaign_id);
CREATE INDEX idx_outreach_leads_user_id ON outreach_leads(user_id);
CREATE INDEX idx_outreach_leads_status ON outreach_leads(status);
CREATE INDEX idx_outreach_leads_dedupe ON outreach_leads(dedupe_hash);
CREATE INDEX idx_outreach_leads_email ON outreach_leads(owner_email);

CREATE INDEX idx_outreach_attempts_lead_id ON outreach_attempts(lead_id);
CREATE INDEX idx_outreach_attempts_campaign_id ON outreach_attempts(campaign_id);
CREATE INDEX idx_outreach_attempts_status ON outreach_attempts(status);

CREATE INDEX idx_scrape_jobs_campaign_id ON scrape_jobs(campaign_id);
CREATE INDEX idx_scrape_jobs_status ON scrape_jobs(status);
