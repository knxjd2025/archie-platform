-- Migration 0038: a canvassed house belongs to the rep who tagged it; labels,
-- follow-up dates, and the daily rep reminder
--
-- 1. canvass_property_meta
--
-- Every rep used to see every rep's pins. A house now belongs to whoever
-- tagged it first: that rep and anyone whose data scope covers them (admins,
-- directors, their sales leader) see it, and nobody else does. Another rep who
-- adds the same address is told it is taken and shown nothing about it.
--
-- canvass_properties is owned by the postgres role (see 0022), so nothing is
-- added to it. Ownership lives here, keyed by canvass_property_id. A house
-- with no row here belongs to canvass_properties.created_by, so every existing
-- pin already has an owner without a backfill; a row is written the first time
-- a house is labelled, given a follow-up date, or reassigned by an admin.
--
-- labels are the rep's own tags for the door ("hail damage", "dog", "come back
-- after 5"). follow_up_at is when the rep said they would go back; the daily
-- reminder lists the ones that are due.
--
-- 2. rep_daily_reminders
--
-- One row per rep per day the morning reminder went out: what it counted and
-- whether each channel landed. The unique key is what stops the cron (which
-- fires twice a day so 8 AM Eastern is hit on both sides of daylight saving)
-- from sending anyone two, and it is the record of who was reminded.

CREATE TABLE IF NOT EXISTS canvass_property_meta (
  id SERIAL PRIMARY KEY,
  canvass_property_id INTEGER NOT NULL UNIQUE,
  owner_email TEXT,
  labels TEXT[] NOT NULL DEFAULT '{}',
  follow_up_at TIMESTAMP,
  assigned_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS canvass_property_meta_owner_idx ON canvass_property_meta (lower(owner_email));
CREATE INDEX IF NOT EXISTS canvass_property_meta_follow_up_idx ON canvass_property_meta (follow_up_at) WHERE follow_up_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS rep_daily_reminders (
  id SERIAL PRIMARY KEY,
  team_member_id INTEGER NOT NULL REFERENCES team_members(id),
  reminder_date DATE NOT NULL,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  email_status TEXT,  -- sent | failed | skipped | dry_run
  sms_status TEXT,    -- sent | failed | skipped | dry_run
  error TEXT,
  sent_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (team_member_id, reminder_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON canvass_property_meta TO brnmig;
GRANT SELECT, INSERT, UPDATE, DELETE ON rep_daily_reminders TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE canvass_property_meta_id_seq TO brnmig;
GRANT USAGE, SELECT ON SEQUENCE rep_daily_reminders_id_seq TO brnmig;
