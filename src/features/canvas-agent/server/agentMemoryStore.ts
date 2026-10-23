import type Database from "better-sqlite3";

export type AgentMemoryKind = "fact" | "preference";

export type AgentMemoryRow = {
  kind: AgentMemoryKind;
  key: string;
  value: string;
  source: string;
  updated_at: number;
};

const MAX_FACTS = 60;
const MAX_VALUE = 400;

export function initCanvasAgentMemorySchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_agent_memory (
      user_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'agent',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, canvas_id, kind, key)
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_agent_memory_recency
      ON canvas_agent_memory(user_id, canvas_id, updated_at DESC);
  `);
}

export function normalizeMemoryKind(value: unknown): AgentMemoryKind | null {
  const kind = String(value || "").trim();
  return kind === "fact" || kind === "preference" ? kind : null;
}

/** 返回落库后的行；key 或 value 为空时返回 null。 */
export function upsertAgentMemory(
  db: InstanceType<typeof Database>,
  userId: string,
  canvasId: string,
  input: { kind: unknown; key: unknown; value: unknown; source?: string },
): AgentMemoryRow | null {
  const kind = normalizeMemoryKind(input.kind);
  const key = String(input.key || "").trim().slice(0, 80);
  const value = String(input.value || "").trim().slice(0, MAX_VALUE);
  if (!kind || !key || !value) return null;
  const now = Date.now();
  db.prepare(
    `INSERT INTO canvas_agent_memory (user_id, canvas_id, kind, key, value, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, canvas_id, kind, key) DO UPDATE SET
       value = excluded.value,
       source = excluded.source,
       updated_at = excluded.updated_at`
  ).run(userId, canvasId, kind, key, value, String(input.source || "agent").slice(0, 40), now);
  return { kind, key, value, source: String(input.source || "agent"), updated_at: now };
}

export function listAgentMemory(
  db: InstanceType<typeof Database>,
  userId: string,
  canvasId: string,
  limit = 20,
): AgentMemoryRow[] {
  const rows = db.prepare(
    `SELECT kind, key, value, source, updated_at FROM canvas_agent_memory
     WHERE user_id = ? AND canvas_id = ?
     ORDER BY updated_at DESC LIMIT ?`
  ).all(userId, canvasId, Math.min(Math.max(Math.floor(limit) || 20, 1), MAX_FACTS)) as AgentMemoryRow[];
  return rows.map((row) => ({
    kind: normalizeMemoryKind(row.kind) || "fact",
    key: String(row.key || ""),
    value: String(row.value || ""),
    source: String(row.source || ""),
    updated_at: Number(row.updated_at) || 0,
  }));
}

export function deleteAgentMemory(
  db: InstanceType<typeof Database>,
  userId: string,
  canvasId: string,
  kind: unknown,
  key: string,
): boolean {
  const normalized = normalizeMemoryKind(kind);
  if (!normalized) return false;
  const result = db.prepare(
    `DELETE FROM canvas_agent_memory WHERE user_id = ? AND canvas_id = ? AND kind = ? AND key = ?`
  ).run(userId, canvasId, normalized, String(key || "").trim());
  return Number(result.changes) > 0;
}

export function deleteAgentMemoryForCanvas(
  db: InstanceType<typeof Database>,
  canvasId: string,
): void {
  try {
    db.prepare("DELETE FROM canvas_agent_memory WHERE canvas_id = ?").run(canvasId);
  } catch {
    /* 老库还没建内存表 */
  }
}
