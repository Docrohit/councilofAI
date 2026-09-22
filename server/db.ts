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
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, type TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS event_run ON events(run_id,id);
    CREATE INDEX IF NOT EXISTS run_owner ON runs(user_id);
    CREATE TABLE IF NOT EXISTS benchmarks(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences(user_id TEXT PRIMARY KEY REFERENCES users(id), config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files(user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(user_id,name));
    CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL, content TEXT NOT NULL, original TEXT, status TEXT NOT NULL DEFAULT 'pending');`);
  return db;
}
export type DB = ReturnType<typeof openDb>;
