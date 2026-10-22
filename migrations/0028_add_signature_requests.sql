-- Migration 0028: Signature requests
--
-- "Send any document we build for signature, by text and by email, and record
-- where they were standing when they signed it."
--
-- A request is one document frozen at the moment it went out (the HTML plus a
-- SHA-256 of it), and one row per signer. Each signer gets their own random
-- token — the capability that stands in for a login, the same model as the
-- shared report pages at /r/:token — so husband and wife each sign for
-- themselves and the audit trail can tell them apart.

CREATE TABLE IF NOT EXISTS signature_requests (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL,

  -- What was sent. source_kind/source_ref point back at the thing the app
  -- built (a report, the certificate, an insurance letter); html is the frozen
  -- copy, because the source can be regenerated and a signed document must
  -- never change under the signatures.
  source_kind TEXT NOT NULL,
  source_ref TEXT,
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  doc_hash TEXT NOT NULL,
  message TEXT,

  -- Where the property is, geocoded once when the request goes out, so "how
  -- far from the roof were they" can be answered at signing time without a
  -- lookup on the signer's critical path.
  property_address TEXT,
  property_lat DOUBLE PRECISION,
  property_lng DOUBLE PRECISION,

  status TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | signed | declined | voided
  created_by TEXT NOT NULL,
  sent_at TIMESTAMP,
  sent_by TEXT,
  completed_at TIMESTAMP,
  voided_at TIMESTAMP,
  voided_by TEXT,
  void_reason TEXT,
  jobtread_file_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signature_requests_job_idx ON signature_requests (job_external_id);
CREATE INDEX IF NOT EXISTS signature_requests_status_idx ON signature_requests (status);

CREATE TABLE IF NOT EXISTS signature_signers (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer',  -- customer | company
  token TEXT NOT NULL UNIQUE,

  -- Delivery: one column per channel, because "the text went and the email
  -- bounced" is the ordinary case and a single sent_at could not say it.
  emailed_at TIMESTAMP,
  email_error TEXT,
  texted_at TIMESTAMP,
  text_error TEXT,
  reminded_at TIMESTAMP,
  remind_count INTEGER NOT NULL DEFAULT 0,

  first_viewed_at TIMESTAMP,
  last_viewed_at TIMESTAMP,
  view_count INTEGER NOT NULL DEFAULT 0,

  signed_at TIMESTAMP,
  signed_name TEXT,
  signature_kind TEXT,                    -- typed | drawn
  signature_image TEXT,                   -- base64 JPEG, drawn signatures only
  declined_at TIMESTAMP,
  decline_reason TEXT,

  -- Who and where. geo holds the resolved location: GPS coordinates and
  -- accuracy when the browser gave them up, the reverse-geocoded address, and
  -- how far that was from the property.
  ip TEXT,
  user_agent TEXT,
  geo JSONB,
  view_geo JSONB,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signature_signers_request_idx ON signature_signers (request_id);
