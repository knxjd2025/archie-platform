-- Add spaced email sending columns to outreach_leads
-- These columns allow scheduling emails throughout the day instead of all at once

ALTER TABLE outreach_leads
ADD COLUMN IF NOT EXISTS scheduled_send_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS actual_sent_at TIMESTAMP;

-- Index for finding due emails efficiently
CREATE INDEX IF NOT EXISTS idx_outreach_leads_scheduled_send
ON outreach_leads (status, scheduled_send_at)
WHERE status = 'queued' AND scheduled_send_at IS NOT NULL;
