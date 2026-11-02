CREATE TABLE IF NOT EXISTS afaq_records (record_type TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS afaq_payments (order_id TEXT PRIMARY KEY, invoice_id TEXT, invoice_url TEXT, amount REAL NOT NULL, currency TEXT NOT NULL, pay_currency TEXT, status TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
