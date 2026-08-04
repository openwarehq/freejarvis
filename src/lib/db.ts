import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH } from "./config";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT 'New session',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      source      TEXT NOT NULL DEFAULT 'deck',
      -- When the brain is Hermes, the session lives over there and this is the
      -- handle. Keeping our own row anyway means the deck's tab strip, titles
      -- and ordering survive Hermes being briefly unreachable.
      remote_id   TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      -- Tool traffic rides in the same table so a transcript replays in order.
      tool_name   TEXT,
      tool_args   TEXT,
      tool_ok     INTEGER,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_by_session
      ON messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS memories (
      id          TEXT PRIMARY KEY,
      body        TEXT NOT NULL,
      tag         TEXT NOT NULL DEFAULT 'note',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      schedule    TEXT NOT NULL,
      prompt      TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      last_run_at INTEGER,
      last_status TEXT,
      last_output TEXT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      tool_name   TEXT NOT NULL,
      tool_args   TEXT NOT NULL,
      reason      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  INTEGER NOT NULL,
      decided_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS activity (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,
      detail      TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
  `);
}

/* ── settings ─────────────────────────────────────────────────────────── */

export function getSetting(key: string): string | null {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    const v = row?.value?.trim();
    return v ? v : null;
  } catch {
    // Reading config must never be the thing that takes the app down — a
    // missing or locked database should degrade to "use the environment".
    return null;
  }
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function allSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/* ── sessions & messages ──────────────────────────────────────────────── */

export type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  source: string;
  remote_id: string | null;
};

export type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_args: string | null;
  tool_ok: number | null;
  created_at: number;
};

export function createSession(title = "New session", source = "deck"): SessionRow {
  const now = Date.now();
  const id = `ses_${rid()}`;
  getDb()
    .prepare(
      "INSERT INTO sessions (id, title, created_at, updated_at, source) VALUES (?,?,?,?,?)",
    )
    .run(id, title, now, now, source);
  return { id, title, created_at: now, updated_at: now, source, remote_id: null };
}

export function listSessions(limit = 50): SessionRow[] {
  return getDb()
    .prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as SessionRow[];
}

export function getSession(id: string): SessionRow | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | SessionRow
    | undefined;
}

export function touchSession(id: string, title?: string) {
  if (title) {
    getDb()
      .prepare("UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?")
      .run(Date.now(), title, id);
  } else {
    getDb().prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), id);
  }
}

export function setRemoteId(id: string, remoteId: string) {
  getDb().prepare("UPDATE sessions SET remote_id = ? WHERE id = ?").run(remoteId, id);
}

export function deleteSession(id: string) {
  getDb().prepare("DELETE FROM messages WHERE session_id = ?").run(id);
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function addMessage(m: {
  session_id: string;
  role: string;
  content: string;
  tool_name?: string | null;
  tool_args?: string | null;
  tool_ok?: boolean | null;
}): MessageRow {
  const row: MessageRow = {
    id: `msg_${rid()}`,
    session_id: m.session_id,
    role: m.role,
    content: m.content,
    tool_name: m.tool_name ?? null,
    tool_args: m.tool_args ?? null,
    tool_ok: m.tool_ok == null ? null : m.tool_ok ? 1 : 0,
    created_at: Date.now(),
  };
  getDb()
    .prepare(
      "INSERT INTO messages (id, session_id, role, content, tool_name, tool_args, tool_ok, created_at) " +
        "VALUES (@id,@session_id,@role,@content,@tool_name,@tool_args,@tool_ok,@created_at)",
    )
    .run(row);
  touchSession(m.session_id);
  return row;
}

export function listMessages(sessionId: string): MessageRow[] {
  return getDb()
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as MessageRow[];
}

/* ── memory ───────────────────────────────────────────────────────────── */

export type MemoryRow = { id: string; body: string; tag: string; created_at: number };

export function addMemory(body: string, tag = "note"): MemoryRow {
  const row = { id: `mem_${rid()}`, body, tag, created_at: Date.now() };
  getDb()
    .prepare("INSERT INTO memories (id, body, tag, created_at) VALUES (@id,@body,@tag,@created_at)")
    .run(row);
  return row;
}

export function listMemories(limit = 200): MemoryRow[] {
  return getDb()
    .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?")
    .all(limit) as MemoryRow[];
}

export function searchMemories(q: string, limit = 20): MemoryRow[] {
  // Substring match, not FTS. The corpus is a person's notes, which is
  // hundreds of rows, not millions — an index here would be ceremony.
  return getDb()
    .prepare(
      "SELECT * FROM memories WHERE body LIKE ? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?",
    )
    .all(`%${q}%`, limit) as MemoryRow[];
}

export function deleteMemory(id: string) {
  getDb().prepare("DELETE FROM memories WHERE id = ?").run(id);
}

/* ── jobs ─────────────────────────────────────────────────────────────── */

export type JobRow = {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: number;
  created_at: number;
  last_run_at: number | null;
  last_status: string | null;
  last_output: string | null;
};

export function createJob(name: string, schedule: string, prompt: string): JobRow {
  const row = {
    id: `job_${rid()}`,
    name,
    schedule,
    prompt,
    enabled: 1,
    created_at: Date.now(),
    last_run_at: null,
    last_status: null,
    last_output: null,
  };
  getDb()
    .prepare(
      "INSERT INTO jobs (id,name,schedule,prompt,enabled,created_at) VALUES (@id,@name,@schedule,@prompt,@enabled,@created_at)",
    )
    .run(row);
  return row;
}

export function listJobs(): JobRow[] {
  return getDb().prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as JobRow[];
}

export function getJob(id: string): JobRow | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
}

export function setJobEnabled(id: string, enabled: boolean) {
  getDb().prepare("UPDATE jobs SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function deleteJob(id: string) {
  getDb().prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

export function recordJobRun(id: string, status: string, output: string) {
  getDb()
    .prepare("UPDATE jobs SET last_run_at = ?, last_status = ?, last_output = ? WHERE id = ?")
    .run(Date.now(), status, output.slice(0, 4000), id);
}

/* ── approvals ────────────────────────────────────────────────────────── */

export type ApprovalRow = {
  id: string;
  session_id: string;
  tool_name: string;
  tool_args: string;
  reason: string;
  status: string;
  created_at: number;
  decided_at: number | null;
};

export function createApproval(
  sessionId: string,
  toolName: string,
  toolArgs: string,
  reason: string,
): ApprovalRow {
  const row = {
    id: `apr_${rid()}`,
    session_id: sessionId,
    tool_name: toolName,
    tool_args: toolArgs,
    reason,
    status: "pending",
    created_at: Date.now(),
    decided_at: null,
  };
  getDb()
    .prepare(
      "INSERT INTO approvals (id,session_id,tool_name,tool_args,reason,status,created_at) " +
        "VALUES (@id,@session_id,@tool_name,@tool_args,@reason,@status,@created_at)",
    )
    .run(row);
  return row;
}

export function getApproval(id: string): ApprovalRow | undefined {
  return getDb().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as
    | ApprovalRow
    | undefined;
}

export function decideApproval(id: string, status: "approved" | "denied") {
  getDb()
    .prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?")
    .run(status, Date.now(), id);
}

export function listApprovals(limit = 50): ApprovalRow[] {
  return getDb()
    .prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?")
    .all(limit) as ApprovalRow[];
}

/* ── activity ─────────────────────────────────────────────────────────── */

export function logActivity(kind: string, detail: string) {
  getDb()
    .prepare("INSERT INTO activity (kind, detail, created_at) VALUES (?,?,?)")
    .run(kind, detail.slice(0, 500), Date.now());
  // The ticker shows the recent past, not the archive.
  getDb().exec(
    "DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 200)",
  );
}

export function listActivity(limit = 40) {
  return getDb()
    .prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?")
    .all(limit) as { id: number; kind: string; detail: string; created_at: number }[];
}

export function rid(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
  );
}
