// AFAQ SYRIA — Cloudflare Worker: payments + member accounts + internal transfers
// Bindings: D1 database named DB
// Secrets: NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET, SESSION_PEPPER, ADMIN_API_TOKEN
// Vars: ALLOWED_ORIGIN=https://oa626114-boop.github.io (exact origin)
// IMPORTANT: Member account numbers are internal identifiers, NOT bank IBANs.
// A real IBAN must be issued by a licensed bank/payment partner.

const enc = new TextEncoder();
const now = () => new Date().toISOString();
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "")
    .split(",").map(x => x.trim()).filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key,X-Admin-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
const reply = (req, env, data, status = 200) => json(data, status, corsHeaders(req, env));

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return b64url(b);
}
async function sha256(value) {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}
async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 310000, hash: "SHA-256" },
    material, 256
  );
  return b64url(bits);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}
function newMemberId() {
  return "AFQ-" + randomToken(9).toUpperCase().replace(/[-_]/g, "").slice(0, 12);
}
function newAccountNumber() {
  return "AQ" + randomToken(10).toUpperCase().replace(/[-_]/g, "").slice(0, 16);
}
async function ensureTables(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing");
  const statements = [
    `CREATE TABLE IF NOT EXISTS afaq_records (
      record_type TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS afaq_payments (
      order_id TEXT PRIMARY KEY, invoice_id TEXT, invoice_url TEXT, amount REAL NOT NULL,
      currency TEXT NOT NULL, pay_currency TEXT, status TEXT NOT NULL, payload TEXT, created_by TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS payment_credits (
      order_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, currency TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY, member_id TEXT NOT NULL UNIQUE, account_number TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL DEFAULT '', password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS member_sessions (
      token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions(member_id)`,
    `CREATE TABLE IF NOT EXISTS member_balances (
      member_id TEXT NOT NULL, currency TEXT NOT NULL, balance_minor INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, PRIMARY KEY(member_id, currency)
    )`,
    `CREATE TABLE IF NOT EXISTS internal_transfers (
      transfer_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
      sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, currency TEXT NOT NULL,
      amount_minor INTEGER NOT NULL, note TEXT, created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_transfers_sender ON internal_transfers(sender_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_transfers_recipient ON internal_transfers(recipient_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS account_ledger (
      entry_id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, member_id TEXT NOT NULL,
      currency TEXT NOT NULL, amount_minor INTEGER NOT NULL, entry_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TRIGGER IF NOT EXISTS trg_payment_credit_balance
      AFTER INSERT ON payment_credits
      BEGIN
        INSERT INTO member_balances(member_id,currency,balance_minor,updated_at)
        VALUES(NEW.member_id,NEW.currency,NEW.amount_minor,NEW.created_at)
        ON CONFLICT(member_id,currency) DO UPDATE SET
          balance_minor=member_balances.balance_minor+NEW.amount_minor,
          updated_at=NEW.created_at;
        INSERT INTO account_ledger(entry_id,transfer_id,member_id,currency,amount_minor,entry_type,created_at)
        VALUES(lower(hex(randomblob(16))),'PAY-' || NEW.order_id,NEW.member_id,NEW.currency,
          NEW.amount_minor,'payment_in',NEW.created_at);
      END`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_member ON account_ledger(member_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS auth_rate_limits (
      rate_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
    )`,
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
  // Backward-compatible migrations for databases created by earlier Worker versions.
  try { await env.DB.prepare("ALTER TABLE members ADD COLUMN full_name TEXT NOT NULL DEFAULT ''").run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE afaq_payments ADD COLUMN created_by TEXT").run(); } catch {}
}

async function hasAdminAccess(req, env) {
  const ownerEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!ownerEmail) return false;
  const auth = await getAuth(req, env);
  return !!auth && auth.email.toLowerCase() === ownerEmail;
}

async function allowAuthAttempt(req, env, action, maximum = 8, windowSeconds = 900) {
  const pepper = String(env.SESSION_PEPPER || "");
  if (pepper.length < 32) return false;
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const rateKey = await sha256(action + "|" + ip + "|" + pepper);
  const stamp = Math.floor(Date.now() / 1000);
  const resetBefore = stamp - windowSeconds;
  await env.DB.prepare(
    `INSERT INTO auth_rate_limits(rate_key,window_start,attempts) VALUES(?,?,1)
     ON CONFLICT(rate_key) DO UPDATE SET
       attempts=CASE WHEN auth_rate_limits.window_start<=? THEN 1 ELSE auth_rate_limits.attempts+1 END,
       window_start=CASE WHEN auth_rate_limits.window_start<=? THEN ? ELSE auth_rate_limits.window_start END`
  ).bind(rateKey, stamp, resetBefore, resetBefore, stamp).run();
  const row = await env.DB.prepare("SELECT attempts FROM auth_rate_limits WHERE rate_key=?").bind(rateKey).first();
  return Number(row?.attempts || 0) <= maximum;
}

async function getAuth(req, env) {
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const pepper = String(env.SESSION_PEPPER || "");
  if (pepper.length < 32) throw new Error("SESSION_PEPPER must be configured with at least 32 characters");
  const tokenHash = await sha256(token + pepper);
  const row = await env.DB.prepare(
    `SELECT s.member_id, m.member_id AS public_member_id, m.account_number, m.email, m.full_name
     FROM member_sessions s JOIN members m ON m.id=s.member_id
     WHERE s.token_hash=? AND s.expires_at>? AND m.status='active'`
  ).bind(tokenHash, now()).first();
  return row || null;
}
function amountToMinor(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100000000) return null;
  const minor = Math.round(n * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  return minor;
}
const currencies = new Set(["USD", "EUR", "TRY", "SYP", "GBP", "CAD", "AUD", "AED", "SAR"]);

async function verifyIPN(raw, sig, secret) {
  if (!sig || !secret) return false;
  let body;
  try { body = JSON.parse(raw); } catch { return false; }
  const sorted = v => Array.isArray(v) ? v.map(sorted) :
    v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => (o[k] = sorted(v[k]), o), {}) : v;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, enc.encode(JSON.stringify(sorted(body))));
  const expected = [...new Uint8Array(signed)].map(x => x.toString(16).padStart(2, "0")).join("");
  return safeEqual(expected, sig.toLowerCase());
}

async function handle(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (req.method === "OPTIONS") {
    const h = corsHeaders(req, env);
    if (!h["Access-Control-Allow-Origin"]) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: h });
  }
  if (req.method === "GET" && path === "/health") {
    let database = false;
    try {
      if (env.DB) {
        await env.DB.prepare("SELECT 1 AS ok").first();
        database = true;
      }
    } catch {}
    return reply(req, env, {
      ok: database,
      service: "AFAQ SYRIA API",
      database: database ? "connected" : "not_configured",
      members: true,
      payments: { crypto: !!env.NOWPAYMENTS_API_KEY && !!env.NOWPAYMENTS_IPN_SECRET, cards: false },
      endpoints: ["/api/member/register", "/api/member/login", "/api/member/me",
        "/api/member/logout", "/api/member/transfer", "/api/member/transfers",
        "/api/payment/create", "/api/payment/status", "/api/payment/ipn"],
      time: now()
    }, database ? 200 : 503);
  }

  await ensureTables(env);

  // Member registration
  if (req.method === "POST" && path === "/api/member/register") {
    let body; try { body = await req.json(); } catch { return reply(req, env, { ok:false, error:"Invalid JSON" }, 400); }
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.name || body.full_name || "").trim().slice(0,120);
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      return reply(req, env, { ok:false, error:"Enter a valid email address" }, 400);
    if (fullName.length < 2)
      return reply(req, env, { ok:false, error:"Enter your full name" }, 400);
    if (password.length < 10 || password.length > 128)
      return reply(req, env, { ok:false, error:"Password must be 10–128 characters" }, 400);
    if (String(env.SESSION_PEPPER || "").length < 32)
      return reply(req, env, { ok:false, error:"Server session security is not configured" }, 503);
    if (!(await allowAuthAttempt(req, env, "register", 5, 3600)))
      return reply(req, env, {ok:false,error:"Too many registration attempts. Try again later."}, 429);
    const salt = randomToken(16), hash = await passwordHash(password, salt);
    let memberId, accountNumber, internalId;
    // Retry collisions rather than assuming a random identifier is unique.
    for (let attempt = 0; attempt < 4; attempt++) {
      memberId = newMemberId(); accountNumber = newAccountNumber(); internalId = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO members(id,member_id,account_number,email,full_name,password_salt,password_hash,created_at)
           VALUES(?,?,?,?,?,?,?,?)`
        ).bind(internalId, memberId, accountNumber, email, fullName, salt, hash, now()).run();
        break;
      } catch (e) {
        if (attempt === 3) {
          const exists = await env.DB.prepare("SELECT id FROM members WHERE email=?").bind(email).first();
          return reply(req, env, { ok:false, error: exists ? "Email is already registered" : "Could not create member account" }, exists ? 409 : 500);
        }
      }
    }
    const seed = ["USD","EUR","TRY","SYP","GBP","AED","SAR"];
    for (const currency of seed)
      await env.DB.prepare("INSERT OR IGNORE INTO member_balances(member_id,currency,balance_minor,updated_at) VALUES(?,?,0,?)")
        .bind(internalId, currency, now()).run();
    const token = randomToken(32), tokenHash = await sha256(token + env.SESSION_PEPPER);
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await env.DB.prepare("INSERT INTO member_sessions(token_hash,member_id,expires_at,created_at) VALUES(?,?,?,?)")
      .bind(tokenHash, internalId, expires, now()).run();
    return reply(req, env, { ok:true, token, expires_at:expires,
      member:{ member_id:memberId, account_number:accountNumber, email, name:fullName, iban:null, iban_status:"pending_bank_partner" } }, 201);
  }

  // Member login by email OR member ID
  if (req.method === "POST" && path === "/api/member/login") {
    if (String(env.SESSION_PEPPER || "").length < 32)
      return reply(req, env, { ok:false, error:"Server session security is not configured" }, 503);
    if (!(await allowAuthAttempt(req, env, "login", 8, 900)))
      return reply(req, env, {ok:false,error:"Too many login attempts. Try again in 15 minutes."}, 429);
    let body; try { body = await req.json(); } catch { return reply(req, env, { ok:false, error:"Invalid JSON" }, 400); }
    const login = String(body.login || body.email || body.member_id || "").trim();
    const password = String(body.password || "");
    const row = await env.DB.prepare(
      "SELECT * FROM members WHERE lower(email)=lower(?) OR upper(member_id)=upper(?) LIMIT 1"
    ).bind(login, login).first();
    if (!row || row.status !== "active") return reply(req, env, { ok:false, error:"Invalid login or password" }, 401);
    const candidate = await passwordHash(password, row.password_salt);
    if (!safeEqual(candidate, row.password_hash)) return reply(req, env, { ok:false, error:"Invalid login or password" }, 401);
    const token = randomToken(32), tokenHash = await sha256(token + env.SESSION_PEPPER);
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await env.DB.prepare("INSERT INTO member_sessions(token_hash,member_id,expires_at,created_at) VALUES(?,?,?,?)")
      .bind(tokenHash, row.id, expires, now()).run();
    return reply(req, env, { ok:true, token, expires_at:expires,
      member:{ member_id:row.member_id, account_number:row.account_number, email:row.email, name:row.full_name || '', iban:null, iban_status:"pending_bank_partner" } });
  }

  if (req.method === "POST" && path === "/api/member/logout") {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, { ok:false, error:"Unauthorized" }, 401);
    const token = (req.headers.get("Authorization") || "").slice(7).trim();
    await env.DB.prepare("DELETE FROM member_sessions WHERE token_hash=?")
      .bind(await sha256(token + env.SESSION_PEPPER)).run();
    return reply(req, env, { ok:true });
  }

  if (req.method === "GET" && path === "/api/member/me") {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, { ok:false, error:"Unauthorized" }, 401);
    const balances = await env.DB.prepare("SELECT currency,balance_minor FROM member_balances WHERE member_id=? ORDER BY currency")
      .bind(auth.member_id).all();
    return reply(req, env, { ok:true, member:{ member_id:auth.public_member_id,
      account_number:auth.account_number, email:auth.email, name:auth.full_name || '', iban:null, iban_status:"pending_bank_partner" },
      balances:(balances.results || []).map(x => ({ currency:x.currency, balance:Number(x.balance_minor)/100 })) });
  }


  // AFAQ WALLET — internal AFAQ rewards. Uses the existing AFAQ SYRIA member session.
  if (req.method === "GET" && path === "/api/wallet/summary") {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, {ok:false,error:"Unauthorized"}, 401);
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS afaq_wallet_balances (
      member_id TEXT PRIMARY KEY, balance_units INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS afaq_mining_sessions (
      session_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, started_at TEXT NOT NULL,
      ended_at TEXT, status TEXT NOT NULL DEFAULT 'active'
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS afaq_mining_rewards (
      reward_id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, member_id TEXT NOT NULL,
      amount_units INTEGER NOT NULL, seconds_mined INTEGER NOT NULL, created_at TEXT NOT NULL
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS afaq_wallet_ledger (
      entry_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, amount_units INTEGER NOT NULL,
      entry_type TEXT NOT NULL, reference_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    )`).run();
    await env.DB.prepare("INSERT OR IGNORE INTO afaq_wallet_balances(member_id,balance_units,updated_at) VALUES(?,0,?)").bind(auth.member_id,now()).run();
    const balance = await env.DB.prepare("SELECT balance_units FROM afaq_wallet_balances WHERE member_id=?").bind(auth.member_id).first();
    const active = await env.DB.prepare("SELECT session_id,started_at FROM afaq_mining_sessions WHERE member_id=? AND status='active' ORDER BY started_at DESC LIMIT 1").bind(auth.member_id).first();
    const rate = Math.max(0, Number(env.AFAQ_MINING_RATE_PER_HOUR || 0));
    return reply(req, env, {ok:true, member_id:auth.public_member_id, currency:"AFAQ", balance_units:Number(balance?.balance_units||0), mining:{enabled:rate>0, rate_per_hour:rate, active:!!active, session:active||null}, note:"Internal platform reward points; not a blockchain token or cash value."});
  }

  if (req.method === "POST" && (path === "/api/wallet/mining/start" || path === "/api/wallet/mining/stop")) {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, {ok:false,error:"Unauthorized"}, 401);
    const rate = Math.max(0, Number(env.AFAQ_MINING_RATE_PER_HOUR || 0));
    if (!(rate > 0)) return reply(req, env, {ok:false,error:"Mining is not enabled by the platform administrator"}, 503);
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS afaq_wallet_balances (member_id TEXT PRIMARY KEY, balance_units INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS afaq_mining_sessions (session_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL DEFAULT 'active')`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS afaq_mining_rewards (reward_id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, member_id TEXT NOT NULL, amount_units INTEGER NOT NULL, seconds_mined INTEGER NOT NULL, created_at TEXT NOT NULL)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS afaq_wallet_ledger (entry_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, amount_units INTEGER NOT NULL, entry_type TEXT NOT NULL, reference_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`).run();
    await env.DB.prepare("INSERT OR IGNORE INTO afaq_wallet_balances(member_id,balance_units,updated_at) VALUES(?,0,?)").bind(auth.member_id,now()).run();
    if (path.endsWith("/start")) {
      const existing = await env.DB.prepare("SELECT session_id FROM afaq_mining_sessions WHERE member_id=? AND status='active'").bind(auth.member_id).first();
      if (existing) return reply(req, env, {ok:true,session_id:existing.session_id,status:"already_active"});
      const id = crypto.randomUUID(), stamp=now();
      await env.DB.prepare("INSERT INTO afaq_mining_sessions(session_id,member_id,started_at,status) VALUES(?,?,?,'active')").bind(id,auth.member_id,stamp).run();
      return reply(req, env, {ok:true,session_id:id,status:"active",started_at:stamp},201);
    }
    const active = await env.DB.prepare("SELECT session_id,started_at FROM afaq_mining_sessions WHERE member_id=? AND status='active' ORDER BY started_at DESC LIMIT 1").bind(auth.member_id).first();
    if (!active) return reply(req, env, {ok:false,error:"No active mining session"},409);
    const ended = Date.now(), started = Date.parse(active.started_at);
    const seconds = Math.max(0,Math.min(86400,Math.floor((ended-started)/1000)));
    const units = Math.floor((seconds/3600)*rate*1000000);
    const stamp=now();
    // D1 batch: close once, create unique reward, then credit only when the reward insert succeeded.
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE afaq_mining_sessions SET status='completed',ended_at=? WHERE session_id=? AND status='active'").bind(stamp,active.session_id),
      env.DB.prepare("INSERT OR IGNORE INTO afaq_mining_rewards(reward_id,session_id,member_id,amount_units,seconds_mined,created_at) SELECT ?,?,?,?, ?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM afaq_mining_sessions WHERE session_id=? AND status='completed')").bind(crypto.randomUUID(),active.session_id,auth.member_id,units,seconds,stamp,active.session_id),
      env.DB.prepare("INSERT OR IGNORE INTO afaq_wallet_ledger(entry_id,member_id,amount_units,entry_type,reference_id,created_at) SELECT ?,?,?, 'mining_reward',?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM afaq_mining_rewards WHERE session_id=?)").bind(crypto.randomUUID(),auth.member_id,units,active.session_id,stamp,active.session_id),
      env.DB.prepare("UPDATE afaq_wallet_balances SET balance_units=balance_units+?,updated_at=? WHERE member_id=? AND EXISTS(SELECT 1 FROM afaq_wallet_ledger WHERE reference_id=? AND amount_units=?) AND (SELECT COUNT(*) FROM afaq_wallet_ledger WHERE reference_id=?)=1").bind(units,stamp,auth.member_id,active.session_id,units,active.session_id)
    ]);
    if (!results[0]?.meta?.changes) return reply(req, env, {ok:false,error:"Mining session was already closed"},409);
    return reply(req, env, {ok:true,status:"completed",seconds_mined:seconds,reward_units:units,currency:"AFAQ",message:"Reward credited as internal points; no blockchain token is created."});
  }

  if (req.method === "GET" && path === "/api/wallet/mining/history") {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, {ok:false,error:"Unauthorized"}, 401);
    const rows = await env.DB.prepare("SELECT amount_units,seconds_mined,created_at FROM afaq_mining_rewards WHERE member_id=? ORDER BY created_at DESC LIMIT 50").bind(auth.member_id).all();
    return reply(req, env, {ok:true,rewards:rows.results||[]});
  }

  // Internal member transfer. Idempotency-Key is mandatory to prevent duplicate submissions.
  if (req.method === "POST" && path === "/api/member/transfer") {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, { ok:false, error:"Unauthorized" }, 401);
    let body; try { body = await req.json(); } catch { return reply(req, env, { ok:false, error:"Invalid JSON" }, 400); }
    const recipientKey = String(body.recipient || body.recipient_id || body.account_number || "").trim().toUpperCase();
    const currency = String(body.currency || "").trim().toUpperCase();
    const minor = amountToMinor(body.amount);
    const idem = String(req.headers.get("Idempotency-Key") || body.idempotency_key || "").trim();
    if (!recipientKey || !minor || !currencies.has(currency) || !/^[A-Za-z0-9_-]{16,100}$/.test(idem))
      return reply(req, env, { ok:false, error:"Recipient, valid amount/currency and a unique Idempotency-Key are required" }, 400);
    const recipient = await env.DB.prepare(
      "SELECT id,member_id,account_number FROM members WHERE upper(member_id)=? OR upper(account_number)=? LIMIT 1"
    ).bind(recipientKey, recipientKey).first();
    if (!recipient) return reply(req, env, { ok:false, error:"Recipient account not found" }, 404);
    if (recipient.id === auth.member_id) return reply(req, env, { ok:false, error:"Cannot transfer to your own account" }, 400);
    const transferId = "AFT-" + crypto.randomUUID();
    const created = now();
    try {
      // All transfer effects are conditional on sufficient sender balance.
      // D1 batch executes these statements transactionally.
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO internal_transfers(transfer_id,idempotency_key,sender_id,recipient_id,currency,amount_minor,note,created_at)
           SELECT ?,?,?,?,?,?,?,?
           WHERE EXISTS (
             SELECT 1 FROM member_balances
             WHERE member_id=? AND currency=? AND balance_minor>=?
           )`
        ).bind(transferId, idem, auth.member_id, recipient.id, currency, minor,
          String(body.note || "").slice(0,160), created, auth.member_id, currency, minor),
        env.DB.prepare(
          `UPDATE member_balances SET balance_minor=balance_minor-?,updated_at=?
           WHERE member_id=? AND currency=? AND balance_minor>=?
             AND EXISTS (SELECT 1 FROM internal_transfers WHERE transfer_id=?)`
        ).bind(minor, created, auth.member_id, currency, minor, transferId),
        env.DB.prepare(
          `INSERT INTO account_ledger(entry_id,transfer_id,member_id,currency,amount_minor,entry_type,created_at)
           SELECT ?,?,?,?,?,?,? WHERE EXISTS (
             SELECT 1 FROM internal_transfers WHERE transfer_id=?
           )`
        ).bind(crypto.randomUUID(), transferId, auth.member_id, currency, -minor,
          "transfer_out", created, transferId),
        env.DB.prepare(
          `INSERT INTO member_balances(member_id,currency,balance_minor,updated_at)
           VALUES(?,?,?,?)
           ON CONFLICT(member_id,currency) DO UPDATE
           SET balance_minor=balance_minor+excluded.balance_minor,updated_at=excluded.updated_at
           WHERE EXISTS (SELECT 1 FROM internal_transfers WHERE transfer_id=?)`
        ).bind(recipient.id, currency, minor, created, transferId),
        env.DB.prepare(
          `INSERT INTO account_ledger(entry_id,transfer_id,member_id,currency,amount_minor,entry_type,created_at)
           SELECT ?,?,?,?,?,?,? WHERE EXISTS (
             SELECT 1 FROM internal_transfers WHERE transfer_id=?
           )`
        ).bind(crypto.randomUUID(), transferId, recipient.id, currency, minor,
          "transfer_in", created, transferId),
      ]);
      if (!results[0]?.meta?.changes) {
        return reply(req, env, { ok:false, error:"Insufficient funds for this currency" }, 409);
      }
      return reply(req, env, { ok:true, transfer:{ transfer_id:transferId,
        recipient_member_id:recipient.member_id, recipient_account:recipient.account_number,
        currency, amount:Number(minor)/100, status:"completed", created_at:created } }, 201);
    } catch (e) {
      const duplicate = await env.DB.prepare("SELECT transfer_id FROM internal_transfers WHERE idempotency_key=?").bind(idem).first();
      if (duplicate) return reply(req, env, { ok:false, error:"This transfer request was already processed", transfer_id:duplicate.transfer_id }, 409);
      return reply(req, env, { ok:false, error:"Transfer failed; no confirmation was issued" }, 500);
    }
  }

  if (req.method === "GET" && path === "/api/member/transfers") {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, { ok:false, error:"Unauthorized" }, 401);
    const rows = await env.DB.prepare(
      `SELECT t.transfer_id,t.currency,t.amount_minor,t.note,t.created_at,
       CASE WHEN t.sender_id=? THEN 'out' ELSE 'in' END AS direction,
       CASE WHEN t.sender_id=? THEN r.member_id ELSE s.member_id END AS other_member_id
       FROM internal_transfers t
       JOIN members s ON s.id=t.sender_id JOIN members r ON r.id=t.recipient_id
       WHERE t.sender_id=? OR t.recipient_id=? ORDER BY t.created_at DESC LIMIT 100`
    ).bind(auth.member_id, auth.member_id, auth.member_id, auth.member_id).all();
    return reply(req, env, { ok:true, transfers:(rows.results || []).map(x => ({
      transfer_id:x.transfer_id, currency:x.currency, amount:Number(x.amount_minor)/100,
      note:x.note, created_at:x.created_at, direction:x.direction, other_member_id:x.other_member_id
    })) });
  }

  // NOWPayments IPN. A unique credit row plus its SQLite trigger makes
  // successful-payment balance crediting atomic and idempotent.
  if ((path === "/api/payment/ipn" || path === "/ipn") && req.method === "POST") {
    const raw = await req.text();
    const valid = await verifyIPN(raw, req.headers.get("x-nowpayments-sig"), env.NOWPAYMENTS_IPN_SECRET);
    if (!valid) return json({ ok:false, error:"Invalid IPN signature" }, 401);

    let event;
    try { event = JSON.parse(raw); } catch { return json({ok:false,error:"Invalid IPN JSON"},400); }
    const orderId = String(event.order_id || "").trim();
    const paymentStatus = String(event.payment_status || "unknown").toLowerCase();
    if (!orderId) return json({ok:false,error:"Missing order_id"},400);

    const payment = await env.DB.prepare(
      "SELECT order_id,created_by,amount,currency,status FROM afaq_payments WHERE order_id=?"
    ).bind(orderId).first();
    if (!payment) return json({ok:false,error:"Payment order not found"},404);

    const stamp = now();
    if (paymentStatus === "finished") {
      const amountMinor = amountToMinor(payment.amount);
      const creditCurrency = String(payment.currency || "").toUpperCase();
      const reportedAmount = amountToMinor(event.price_amount);
      const reportedCurrency = String(event.price_currency || "").toUpperCase();

      // A signed webhook is not enough on its own: also bind the completed
      // payment to the exact invoice amount and currency stored for this order.
      // This prevents a mismatched provider event from crediting an account.
      if (!payment.created_by || !amountMinor || !currencies.has(creditCurrency))
        return json({ok:false,error:"Payment cannot be credited; account or currency is invalid"},409);
      if (!reportedAmount || reportedAmount !== amountMinor || reportedCurrency !== creditCurrency)
        return json({ok:false,error:"Completed payment does not match the invoice amount or currency"},409);

      // INSERT OR IGNORE succeeds only once per order_id. The trigger credits
      // the member balance only when this unique row is first inserted.
      await env.DB.prepare(
        `INSERT OR IGNORE INTO payment_credits(order_id,member_id,currency,amount_minor,created_at)
         SELECT order_id,created_by,?, ?, ? FROM afaq_payments WHERE order_id=? AND created_by IS NOT NULL`
      ).bind(creditCurrency, amountMinor, stamp, orderId).run();
    }

    await env.DB.prepare(
      "UPDATE afaq_payments SET status=?,payload=?,updated_at=? WHERE order_id=?"
    ).bind(paymentStatus, JSON.stringify(event), stamp, orderId).run();
    const credit = await env.DB.prepare("SELECT order_id FROM payment_credits WHERE order_id=?")
      .bind(orderId).first();
    return json({ ok:true, order_id:orderId, payment_status:paymentStatus, credited:!!credit });
  }

  if (req.method === "GET" && path === "/api/payment/config")
    return reply(req, env, { crypto:{provider:"NOWPayments",enabled:!!env.NOWPAYMENTS_API_KEY},
      cards:{enabled:false,provider:null,reason:"Merchant gateway credentials and approval are required"},
      wallets:{paypal:false,apple_pay:false,papara:false} });

  if ((path === "/api/payment/create" || path === "/create-payment") && req.method === "POST") {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, {ok:false,error:"Login required"}, 401);
    if (!env.NOWPAYMENTS_API_KEY || !env.NOWPAYMENTS_IPN_SECRET)
      return reply(req, env, { ok:false, error:"NOWPayments API key or IPN secret is not configured" }, 503);
    let body; try { body = await req.json(); } catch { return reply(req, env, { ok:false, error:"Invalid JSON" }, 400); }
    const amount = Number(body.amount), currency = String(body.currency || "usd").toLowerCase();
    const payCurrency = String(body.pay_currency || "usdttrc20").toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000)
      return reply(req, env, { ok:false, error:"Invalid amount" }, 400);
    if (!/^[a-z]{3,5}$/.test(currency)) return reply(req, env, { ok:false, error:"Unsupported invoice currency code" }, 400);
    const allowedCrypto = new Set(["usdttrc20","usdterc20","btc","eth","trx"]);
    const allowedFiat = new Set(["usd","eur","gbp","try","cad","aud"]);
    if (!allowedFiat.has(currency))
      return reply(req, env, { ok:false, error:"Unsupported invoice price currency" }, 400);
    if (payCurrency !== "all" && !allowedCrypto.has(payCurrency) && !allowedFiat.has(payCurrency))
      return reply(req, env, { ok:false, error:"Unsupported payment currency or network" }, 400);
    const orderId = "AFQ-" + crypto.randomUUID();
    const payload = { price_amount:amount, price_currency:currency, order_id:orderId,
      order_description:String(body.description || "AFAQ SYRIA invoice").slice(0,200),
      ipn_callback_url:url.origin + "/api/payment/ipn" };
    if (payCurrency !== "all") payload.pay_currency = payCurrency;
    if (body.success_url) payload.success_url = String(body.success_url).slice(0,500);
    if (body.cancel_url) payload.cancel_url = String(body.cancel_url).slice(0,500);
    const provider = await fetch("https://api.nowpayments.io/v1/invoice", {
      method:"POST", headers:{"x-api-key":env.NOWPAYMENTS_API_KEY,"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    const result = await provider.json().catch(() => ({}));
    if (!provider.ok) return reply(req, env, { ok:false, error:result.message || result.error || "NOWPayments invoice creation failed", provider_status:provider.status }, 502);
    if (!result.invoice_url) return reply(req, env, { ok:false, error:"NOWPayments did not return an invoice_url" }, 502);
    const created = now();
    await env.DB.prepare(
      `INSERT INTO afaq_payments(order_id,invoice_id,invoice_url,amount,currency,pay_currency,status,payload,created_at,updated_at,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(orderId,String(result.id || ""),String(result.invoice_url),amount,currency,payCurrency,"waiting",JSON.stringify(result),created,created,auth.member_id).run();
    return reply(req, env, { ok:true, order_id:orderId, invoice_id:result.id || null,
      invoice_url:result.invoice_url, status:"waiting", amount, currency, pay_currency:payCurrency });
  }

  if (req.method === "GET" && path === "/api/payment/status") {
    const auth = await getAuth(req, env);
    if (!auth) return reply(req, env, {ok:false,error:"Login required"}, 401);
    const id = url.searchParams.get("order_id");
    if (!id) return reply(req, env, { ok:false, error:"order_id is required" }, 400);
    const row = await env.DB.prepare(
      "SELECT order_id,invoice_id,invoice_url,amount,currency,pay_currency,status,created_at,updated_at FROM afaq_payments WHERE order_id=? AND created_by=?"
    ).bind(id, auth.member_id).first();
    return reply(req, env, row ? {ok:true,payment:row} : {ok:false,error:"Payment not found"}, row ? 200 : 404);
  }

  // Existing sync and records endpoints retained for compatibility with the current website.
  if (req.method === "POST" && path === "/api/v1/sync") {
    if (!(await hasAdminAccess(req, env)))
      return reply(req, env, {ok:false,error: env.ADMIN_EMAIL ? "Owner account authorization required" : "ADMIN_EMAIL is not configured"}, 401);
    let body; try { body = await req.json(); } catch { return reply(req, env, {error:"Invalid JSON"}, 400); }
    if (!body.records || typeof body.records !== "object" || Array.isArray(body.records))
      return reply(req, env, {error:"records object is required"}, 400);
    let saved = 0;
    for (const [type, value] of Object.entries(body.records)) {
      if (!/^[a-zA-Z0-9_-]{1,50}$/.test(type)) continue;
      const payload = JSON.stringify(value);
      if (payload.length > 900000) return reply(req, env, {error:"Record group too large: " + type}, 413);
      await env.DB.prepare(
        `INSERT INTO afaq_records(record_type,payload,updated_at) VALUES(?,?,?)
         ON CONFLICT(record_type) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`
      ).bind(type,payload,now()).run();
      saved++;
    }
    return reply(req, env, {ok:true,saved});
  }
  if (req.method === "GET" && path === "/api/v1/records") {
    if (!(await hasAdminAccess(req, env)))
      return reply(req, env, {ok:false,error: env.ADMIN_EMAIL ? "Owner account authorization required" : "ADMIN_EMAIL is not configured"}, 401);
    const type = url.searchParams.get("type");
    if (type) {
      const row = await env.DB.prepare("SELECT record_type,payload,updated_at FROM afaq_records WHERE record_type=?").bind(type).first();
      return reply(req, env, row ? {type:row.record_type,data:JSON.parse(row.payload),updated_at:row.updated_at} : {error:"Not found"}, row ? 200 : 404);
    }
    const rows = await env.DB.prepare("SELECT record_type,payload,updated_at FROM afaq_records ORDER BY record_type").all();
    return reply(req, env, {records:(rows.results || []).map(x => ({type:x.record_type,data:JSON.parse(x.payload),updated_at:x.updated_at}))});
  }
  if (req.method === "GET" && path === "/api/v1/payments") {
    if (!(await hasAdminAccess(req, env)))
      return reply(req, env, {ok:false,error: env.ADMIN_EMAIL ? "Owner account authorization required" : "ADMIN_EMAIL is not configured"}, 401);
    const rows = await env.DB.prepare(
      "SELECT order_id,invoice_id,invoice_url,amount,currency,pay_currency,status,created_at,updated_at FROM afaq_payments ORDER BY created_at DESC LIMIT 100"
    ).all();
    return reply(req, env, {payments:rows.results || []});
  }
  return reply(req, env, {ok:false,error:"Not found"}, 404);
}

export default {
  async fetch(req, env) {
    try {
      const origin = req.headers.get("Origin") || "";
      const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
      if (!allowed.length)
        return json({ok:false,error:"ALLOWED_ORIGIN is not configured"}, 503);
      if (origin && !allowed.includes(origin))
        return json({ok:false,error:"Origin not allowed"}, 403);
      return await handle(req, env);
    } catch (e) {
      const origin = req.headers.get("Origin") || "";
      const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
      const headers = origin && allowed.includes(origin) ? {"Access-Control-Allow-Origin":origin,"Vary":"Origin"} : {};
      return json({ok:false,error:"Internal server error",detail:env.DEBUG === "true" ? String(e) : undefined}, 500, headers);
    }
  }
};
