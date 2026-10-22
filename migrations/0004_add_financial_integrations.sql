-- Migration 0004: Financial Integration Token Storage + Plaid Tables
-- Supports QuickBooks Online, Plaid, and Everee integrations

-- Generic OAuth/API token storage for all financial integrations
CREATE TABLE IF NOT EXISTS integration_tokens (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,            -- 'quickbooks', 'everee', 'gmail'
  access_token TEXT,
  refresh_token TEXT,
  token_type TEXT,
  expires_at TIMESTAMP,
  realm_id TEXT,                     -- QBO company/realm ID
  scope TEXT,
  raw_response JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Plaid linked bank items (access tokens are persistent, not short-lived OAuth)
CREATE TABLE IF NOT EXISTS plaid_items (
  id SERIAL PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE,      -- Plaid item ID
  access_token TEXT NOT NULL,        -- Plaid access token (persistent)
  institution_id TEXT,               -- e.g., 'ins_XXX'
  institution_name TEXT,             -- e.g., 'US Bank', 'First Bank'
  cursor TEXT,                       -- transactionsSync cursor for incremental sync
  status TEXT DEFAULT 'active',      -- 'active', 'needs_reauth', 'revoked'
  consent_expiration TIMESTAMP,
  accounts JSONB,                    -- Cached account list [{accountId, name, type, mask}]
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Plaid transactions (local cache so agents can query without hitting API)
CREATE TABLE IF NOT EXISTS plaid_transactions (
  id SERIAL PRIMARY KEY,
  plaid_item_id INTEGER REFERENCES plaid_items(id) ON DELETE CASCADE NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,    -- Positive = debit/expense, negative = credit/income
  date DATE NOT NULL,
  name TEXT,                         -- Transaction description
  merchant_name TEXT,
  category JSONB,                    -- Plaid category array
  pending BOOLEAN DEFAULT FALSE,
  payment_channel TEXT,              -- 'online', 'in store', 'other'
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_integration_tokens_provider ON integration_tokens(provider);
CREATE INDEX IF NOT EXISTS idx_integration_tokens_active ON integration_tokens(is_active);
CREATE INDEX IF NOT EXISTS idx_plaid_items_status ON plaid_items(status);
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_date ON plaid_transactions(date);
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_account ON plaid_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_plaid_transactions_item ON plaid_transactions(plaid_item_id);
