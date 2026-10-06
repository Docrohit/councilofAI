import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function openDb(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "council.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'cookie');
    CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), config TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS attachment_owner ON attachments(user_id);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, type TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS event_run ON events(run_id,id);
    CREATE INDEX IF NOT EXISTS run_owner ON runs(user_id);
    CREATE TABLE IF NOT EXISTS benchmarks(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences(user_id TEXT PRIMARY KEY REFERENCES users(id), config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS integrations(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, config TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS integration_owner_kind ON integrations(user_id,kind);
    CREATE TABLE IF NOT EXISTS files(user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(user_id,name));
    CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, content TEXT NOT NULL, original TEXT, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS email_tokens(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, expires INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS email_token_owner ON email_tokens(user_id,purpose);
    CREATE TABLE IF NOT EXISTS payment_submissions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), file_name TEXT NOT NULL, mime TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', image BLOB);
    CREATE INDEX IF NOT EXISTS payment_owner ON payment_submissions(user_id,created_at);
    CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, content TEXT NOT NULL, resources TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,name));`);
  const columns = (
    db.prepare("PRAGMA table_info(users)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!columns.includes("email_verified"))
    db.exec(
      "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1",
    );
  if (!columns.includes("access_approved"))
    db.exec(
      "ALTER TABLE users ADD COLUMN access_approved INTEGER NOT NULL DEFAULT 0",
    );
  if (!columns.includes("free_messages_used"))
    db.exec(
      "ALTER TABLE users ADD COLUMN free_messages_used INTEGER NOT NULL DEFAULT 0",
    );
  if (!columns.includes("confirmed_at"))
    db.exec("ALTER TABLE users ADD COLUMN confirmed_at TEXT");
  // Paid access runs until this time; each verified payment extends it by the billing period.
  if (!columns.includes("access_until"))
    db.exec("ALTER TABLE users ADD COLUMN access_until TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS payment_orders(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chain TEXT NOT NULL CHECK (chain IN ('lightning','onchain')), amount_sats INTEGER NOT NULL, months INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','review','paid','expired','rejected')),
      invoice TEXT, payment_hash TEXT, verify_url TEXT, zap_request_id TEXT, zap_recipient TEXT, zap_provider_pubkey TEXT,
      address TEXT, tx_reference TEXT, proof_check TEXT, proof_note TEXT, confirmations INTEGER NOT NULL DEFAULT 0,
      admin_note TEXT, expires_at TEXT NOT NULL, paid_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS payment_order_owner ON payment_orders(user_id, created_at);
    CREATE INDEX IF NOT EXISTS payment_order_open ON payment_orders(status, chain);
    -- Each payment (an on-chain output or a Lightning payment hash) unlocks at most one order; claims outlive orders.
    CREATE TABLE IF NOT EXISTS payment_claims(reference TEXT PRIMARY KEY, order_id TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const paymentColumns = (
    db.prepare("PRAGMA table_info(payment_submissions)").all() as {
      name: string;
    }[]
  ).map((c) => c.name);
  if (!paymentColumns.includes("image"))
    db.exec("ALTER TABLE payment_submissions ADD COLUMN image BLOB");
  return db;
}
export type DB = ReturnType<typeof openDb>;
