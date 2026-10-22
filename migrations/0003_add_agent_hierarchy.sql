-- Add employee hierarchy to agents and new financial roles

-- Add new roles to the agent_role enum
ALTER TYPE agent_role ADD VALUE IF NOT EXISTS 'cpa';
ALTER TYPE agent_role ADD VALUE IF NOT EXISTS 'tax_accountant';
ALTER TYPE agent_role ADD VALUE IF NOT EXISTS 'tax_lawyer';

-- Add reports_to column for manager-employee relationship
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reports_to INTEGER REFERENCES agents(id);

-- Index for efficient hierarchy queries
CREATE INDEX IF NOT EXISTS idx_agents_reports_to ON agents(reports_to);
