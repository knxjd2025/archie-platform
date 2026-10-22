-- Migration 0027: Certificate of Completion
--
-- Built from the job's submitted final walkthrough, signed by us and then by
-- the homeowner through a capability-token link, and attached to the
-- depreciation request once both signatures are on it.

CREATE TABLE IF NOT EXISTS job_certificates (
  id SERIAL PRIMARY KEY,
  job_external_id TEXT NOT NULL UNIQUE,
  walkthrough_id INTEGER,
  -- Snapshot of what the walkthrough said when the certificate was built, so a
  -- signed certificate never changes under the signatures.
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | sent | signed
  company_signer TEXT,
  company_signed_at TIMESTAMP,
  homeowner_name TEXT,
  homeowner_email TEXT,
  homeowner_signer TEXT,
  homeowner_signed_at TIMESTAMP,
  homeowner_ip TEXT,
  sign_token TEXT UNIQUE,
  sent_at TIMESTAMP,
  sent_by TEXT,
  jobtread_file_id TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_certificates_status_idx ON job_certificates (status);
