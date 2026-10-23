import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export type AgentApiKeyRow = {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type AgentApiKeyOwner = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: null;
  cover_url: null;
  role: "admin" | "user";
};

export function initCanvasAgentApiKeySchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_agent_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_agent_api_keys_owner
      ON canvas_agent_api_keys(user_id, created_at DESC);
  `);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 只有创建这一次能看到明文 token；库里只存 sha256。 */
export function createAgentApiKey(
  db: InstanceType<typeof Database>,
  userId: string,
  name: string,
): { token: string; key: AgentApiKeyRow } | null {
  if (!userId) return null;
  const token = `agt_${randomBytes(24).toString("hex")}`;
  const id = uuidv4();
  const now = Date.now();
  const prefix = token.slice(0, 12);
  db.prepare(
    `INSERT INTO canvas_agent_api_keys (id, user_id, name, token_hash, prefix, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).run(id, userId, String(name || "").slice(0, 60), hashToken(token), prefix, now);
  return {
    token,
    key: {
      id,
      user_id: userId,
      name: String(name || "").slice(0, 60),
      prefix,
      created_at: now,
      last_used_at: null,
      revoked_at: null,
    },
  };
}

export function listAgentApiKeys(
  db: InstanceType<typeof Database>,
  userId: string,
): AgentApiKeyRow[] {
  return db.prepare(
    `SELECT id, user_id, name, prefix, created_at, last_used_at, revoked_at
     FROM canvas_agent_api_keys WHERE user_id = ? ORDER BY created_at DESC`
  ).all(userId) as AgentApiKeyRow[];
}

export function revokeAgentApiKey(
  db: InstanceType<typeof Database>,
  userId: string,
  keyId: string,
): boolean {
  const result = db.prepare(
    `UPDATE canvas_agent_api_keys SET revoked_at = ?
     WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
  ).run(Date.now(), String(keyId || ""), userId);
  return Number(result.changes) > 0;
}

/** Bearer 解析：token 有效且用户没被禁用才算数。 */
export function resolveAgentApiKeyOwner(
  db: InstanceType<typeof Database>,
  token: string,
): AgentApiKeyOwner | null {
  const raw = String(token || "").trim();
  if (!raw.startsWith("agt_")) return null;
  const row = db.prepare(
    `SELECT k.id AS key_id, u.id, u.email, u.display_name, u.role, u.disabled
     FROM canvas_agent_api_keys k
     JOIN users u ON u.id = k.user_id
     WHERE k.token_hash = ? AND k.revoked_at IS NULL
     LIMIT 1`
  ).get(hashToken(raw)) as {
    key_id?: string;
    id?: string;
    email?: string;
    display_name?: string;
    role?: string;
    disabled?: number;
  } | undefined;
  if (!row?.id || Number(row.disabled) === 1) return null;
  if (row.key_id) {
    db.prepare("UPDATE canvas_agent_api_keys SET last_used_at = ? WHERE id = ?")
      .run(Date.now(), row.key_id);
  }
  return {
    id: row.id,
    email: String(row.email || ""),
    display_name: String(row.display_name || ""),
    avatar_url: null,
    cover_url: null,
    role: row.role === "admin" ? "admin" : "user",
  };
}

