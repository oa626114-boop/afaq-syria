-- AFAQ SYRIA CENTRAL TREASURY — additive D1 migration
-- Apply after reviewing in a D1 staging database first.
-- Amounts are stored as integer atomic units; USDT uses 6 decimals.
-- This schema does NOT create bank accounts or blockchain wallets.

CREATE TABLE IF NOT EXISTS treasury_api_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  scopes TEXT NOT NULL DEFAULT 'payments:create,payments:read',
  allowed_currencies TEXT NOT NULL DEFAULT 'USD,EUR,TRY,USDT',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS treasury_payments (
  treasury_payment_id TEXT PRIMARY KEY,
  external_reference TEXT NOT NULL,
  client_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('fiat','crypto')),
  source_currency TEXT NOT NULL,
  source_network TEXT,
  source_amount TEXT NOT NULL,
  source_amount_minor INTEGER,
  requested_settlement_asset TEXT NOT NULL DEFAULT 'USDT'
    CHECK(requested_settlement_asset='USDT'),
  settlement_network TEXT CHECK(settlement_network IN ('TRC20','ERC20') OR settlement_network IS NULL),
  settlement_amount_atomic INTEGER,
  settlement_txid TEXT,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  provider_invoice_id TEXT,
  provider_status TEXT NOT NULL DEFAULT 'created',
  treasury_status TEXT NOT NULL DEFAULT 'pending',
  fees_amount TEXT,
  fees_currency TEXT,
  payer_reference TEXT,
  purpose TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider_payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(client_id, external_reference),
  UNIQUE(client_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_treasury_payments_status
  ON treasury_payments(treasury_status, created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_payments_provider
  ON treasury_payments(provider, provider_payment_id);

CREATE TABLE IF NOT EXISTS treasury_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  treasury_payment_id TEXT,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  received_at TEXT NOT NULL,
  processed_at TEXT,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS treasury_ledger (
  entry_id TEXT PRIMARY KEY,
  treasury_payment_id TEXT,
  entry_type TEXT NOT NULL CHECK(entry_type IN
    ('deposit','conversion_in','conversion_fee','provider_fee','withdrawal','adjustment','reversal')),
  asset TEXT NOT NULL,
  network TEXT,
  amount_atomic INTEGER NOT NULL CHECK(amount_atomic > 0),
  direction TEXT NOT NULL CHECK(direction IN ('credit','debit')),
  external_txid TEXT,
  description TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(treasury_payment_id, entry_type, asset, network, direction)
);

CREATE INDEX IF NOT EXISTS idx_treasury_ledger_asset
  ON treasury_ledger(asset, network, created_at);

CREATE TABLE IF NOT EXISTS treasury_payout_requests (
  payout_id TEXT PRIMARY KEY,
  asset TEXT NOT NULL DEFAULT 'USDT',
  network TEXT NOT NULL CHECK(network IN ('TRC20','ERC20')),
  amount_atomic INTEGER NOT NULL CHECK(amount_atomic > 0),
  destination_address TEXT NOT NULL,
  destination_address_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK(status IN ('pending_approval','approved','processing','completed','rejected','failed')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  txid TEXT,
  test_transfer_required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
