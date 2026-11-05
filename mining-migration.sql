-- AFAQ MINING migration — USDT TRC20 rewards
-- Apply to the existing Cloudflare D1 database only after taking a backup.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mining_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO mining_config(config_key,config_value,updated_at) VALUES
 ('enabled','0',datetime('now')),
 ('points_per_hour','0',datetime('now')),
 ('minimum_withdrawal_points','0',datetime('now')),
 ('points_per_usdt','0',datetime('now')),
 ('network','TRC20',datetime('now')),
 ('token','USDT',datetime('now'));

CREATE TABLE IF NOT EXISTS mining_sessions (
  session_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','completed','cancelled')),
  points_awarded INTEGER NOT NULL DEFAULT 0 CHECK(points_awarded >= 0),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_mining_session
 ON mining_sessions(member_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_mining_sessions_member ON mining_sessions(member_id,created_at);

CREATE TABLE IF NOT EXISTS mining_wallets (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  points_balance INTEGER NOT NULL DEFAULT 0 CHECK(points_balance >= 0),
  usdt_earned_minor INTEGER NOT NULL DEFAULT 0 CHECK(usdt_earned_minor >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mining_ledger (
  entry_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  session_id TEXT,
  withdrawal_id TEXT,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('reward','withdrawal_hold','withdrawal_release','withdrawal_paid','admin_adjustment')),
  points_delta INTEGER NOT NULL DEFAULT 0,
  usdt_minor_delta INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mining_ledger_member ON mining_ledger(member_id,created_at);

CREATE TABLE IF NOT EXISTS mining_withdrawals (
  withdrawal_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  points_amount INTEGER NOT NULL CHECK(points_amount > 0),
  usdt_minor_amount INTEGER NOT NULL CHECK(usdt_minor_amount > 0),
  network TEXT NOT NULL DEFAULT 'TRC20' CHECK(network='TRC20'),
  token TEXT NOT NULL DEFAULT 'USDT' CHECK(token='USDT'),
  destination_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending_review','approved','rejected','broadcast','paid')),
  txid TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mining_withdrawals_member ON mining_withdrawals(member_id,created_at);
CREATE INDEX IF NOT EXISTS idx_mining_withdrawals_status ON mining_withdrawals(status,created_at);

-- No mining rate or monetary value is enabled by default. Admin must set approved values.
