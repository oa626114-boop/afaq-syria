-- AFAQ SYRIA D1 schema — aligned with worker.js
-- Worker creates/migrates these tables automatically; apply manually only if desired.
CREATE TABLE IF NOT EXISTS afaq_records (record_type TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS afaq_payments (order_id TEXT PRIMARY KEY, invoice_id TEXT, invoice_url TEXT, amount REAL NOT NULL, currency TEXT NOT NULL, pay_currency TEXT, status TEXT NOT NULL, payload TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_credits (order_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, member_id TEXT NOT NULL UNIQUE, account_number TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL DEFAULT '', password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS member_sessions (token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions(member_id);
CREATE TABLE IF NOT EXISTS member_balances (member_id TEXT NOT NULL, currency TEXT NOT NULL, balance_minor INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(member_id,currency));
CREATE TABLE IF NOT EXISTS internal_transfers (transfer_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL, note TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_transfers_sender ON internal_transfers(sender_id,created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_recipient ON internal_transfers(recipient_id,created_at);
CREATE TABLE IF NOT EXISTS account_ledger (entry_id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, member_id TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL, entry_type TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ledger_member ON account_ledger(member_id,created_at);
CREATE TABLE IF NOT EXISTS auth_rate_limits (rate_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS trg_payment_credit_balance AFTER INSERT ON payment_credits BEGIN
 INSERT INTO member_balances(member_id,currency,balance_minor,updated_at) VALUES(NEW.member_id,NEW.currency,NEW.amount_minor,NEW.created_at)
 ON CONFLICT(member_id,currency) DO UPDATE SET balance_minor=member_balances.balance_minor+NEW.amount_minor,updated_at=NEW.created_at;
 INSERT INTO account_ledger(entry_id,transfer_id,member_id,currency,amount_minor,entry_type,created_at)
 VALUES(lower(hex(randomblob(16))),'PAY-' || NEW.order_id,NEW.member_id,NEW.currency,NEW.amount_minor,'payment_in',NEW.created_at);
END;


-- Private member chat and call signaling tables.
CREATE TABLE IF NOT EXISTS chat_conversations (
 id TEXT PRIMARY KEY, member_a TEXT NOT NULL, member_b TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(member_a,member_b), CHECK(member_a < member_b)
);
CREATE TABLE IF NOT EXISTS chat_messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
 body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
 FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS chat_blocks (
 blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(blocker_id,blocked_id)
);
CREATE TABLE IF NOT EXISTS chat_reports (
 id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, reported_id TEXT NOT NULL,
 reason TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS call_signals (
 id TEXT PRIMARY KEY, call_id TEXT NOT NULL, sender_id TEXT NOT NULL,
 recipient_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT,
 created_at TEXT NOT NULL, consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_call_signals_recipient ON call_signals(recipient_id,created_at);


-- AFAQ BANK withdrawal requests. Funds are not debited when requested.
CREATE TABLE IF NOT EXISTS bank_withdrawal_requests (
 withdrawal_id TEXT PRIMARY KEY,
 idempotency_key TEXT NOT NULL UNIQUE,
 member_id TEXT NOT NULL,
 currency TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
 method TEXT NOT NULL DEFAULT 'bank_transfer',
 note TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 payout_reference TEXT UNIQUE,
 created_at TEXT NOT NULL,
 processed_at TEXT,
 processed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_withdrawals_member ON bank_withdrawal_requests(member_id,created_at);
