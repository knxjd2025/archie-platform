-- Customer phone calls and text messages, owned by this app.
--
-- Today every call and text lives inside GoHighLevel — 6,055 conversations,
-- and the app has logged 11 contact events in its entire life. Nobody can ask
-- "what did the cold caller do last week" without opening GHL, and the data
-- leaves with GHL the day we stop paying for it.
--
-- The `conversations`/`messages` tables already in the schema are NOT this:
-- they model an AI agent chat (role, tool_calls, tool_results). The Twilio
-- webhook has been squeezing SMS into them, which is why a text has a "role".
--
-- Written so GHL and Twilio rows sit side by side: GHL's own call records
-- carry the Twilio Call SID in `altId`, so `provider_sid` is the same key on
-- both sides and a row mirrored from GHL today is the same row Twilio writes
-- tomorrow. That is what makes the cutover boring.

-- ---------------------------------------------------------------- numbers --
CREATE TABLE IF NOT EXISTS phone_numbers (
  id               serial PRIMARY KEY,
  e164             text NOT NULL UNIQUE,
  label            text NOT NULL,
  -- 'direct' = a person's line, 'main' = the published number,
  -- 'ai_answer' = answered by the voice agent, 'outbound' = dialling only.
  purpose          text NOT NULL DEFAULT 'direct',
  team_member_id   integer REFERENCES team_members(id) ON DELETE SET NULL,
  provider         text NOT NULL DEFAULT 'twilio',
  provider_sid     text,
  forwards_to      text,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamp NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ calls --
CREATE TABLE IF NOT EXISTS calls (
  id                 serial PRIMARY KEY,
  provider           text NOT NULL,                   -- 'twilio' | 'ghl'
  provider_sid       text UNIQUE,                     -- Twilio CallSid (CA…)
  direction          text NOT NULL,                   -- 'inbound' | 'outbound'
  from_e164          text NOT NULL,
  to_e164            text NOT NULL,
  our_number         text,                            -- which of ours was on it

  lead_id            integer REFERENCES leads(id) ON DELETE SET NULL,
  lead_external_id   text,
  team_member_id     integer REFERENCES team_members(id) ON DELETE SET NULL,
  rep_name           text,

  answered_by        text,                            -- 'human' | 'ai' | null
  status             text,                            -- completed | no-answer | busy | failed
  started_at         timestamp,
  ended_at           timestamp,
  duration_seconds   integer,

  recording_url      text,
  recording_sid      text,
  recording_seconds  integer,
  transcript         text,
  transcript_source  text,                            -- 'deepgram' | 'twilio' | 'ghl'
  summary            text,
  outcome            text,                            -- booked | callback | not_interested | wrong_number | spam | voicemail
  extracted          jsonb,                           -- what the voice agent pulled out of the call

  cost_cents         integer,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_started_at_idx        ON calls (started_at DESC);
CREATE INDEX IF NOT EXISTS calls_lead_id_idx           ON calls (lead_id);
CREATE INDEX IF NOT EXISTS calls_lead_external_id_idx  ON calls (lead_external_id);
CREATE INDEX IF NOT EXISTS calls_team_member_id_idx    ON calls (team_member_id);
CREATE INDEX IF NOT EXISTS calls_direction_status_idx  ON calls (direction, status);
CREATE INDEX IF NOT EXISTS calls_our_number_idx        ON calls (our_number);

-- --------------------------------------------------------------- messages --
-- Named comm_messages so it can never be confused with the agent-chat
-- `messages` table it is NOT replacing.
CREATE TABLE IF NOT EXISTS comm_messages (
  id                 serial PRIMARY KEY,
  provider           text NOT NULL,                   -- 'twilio' | 'ghl' | 'gmail'
  provider_sid       text UNIQUE,
  channel            text NOT NULL,                   -- 'sms' | 'mms' | 'email'
  direction          text NOT NULL,                   -- 'inbound' | 'outbound'
  from_addr          text NOT NULL,
  to_addr            text NOT NULL,
  our_number         text,

  lead_id            integer REFERENCES leads(id) ON DELETE SET NULL,
  lead_external_id   text,
  team_member_id     integer REFERENCES team_members(id) ON DELETE SET NULL,

  subject            text,
  body               text,
  media              jsonb,
  status             text,                            -- queued | sent | delivered | failed | undelivered
  error_detail       text,
  sent_at            timestamp,
  created_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comm_messages_sent_at_idx           ON comm_messages (sent_at DESC);
CREATE INDEX IF NOT EXISTS comm_messages_lead_id_idx           ON comm_messages (lead_id);
CREATE INDEX IF NOT EXISTS comm_messages_lead_external_id_idx  ON comm_messages (lead_external_id);
CREATE INDEX IF NOT EXISTS comm_messages_channel_dir_idx       ON comm_messages (channel, direction);
