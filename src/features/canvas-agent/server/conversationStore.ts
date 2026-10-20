import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export type CanvasAgentConversation = {
  id: string;
  canvas_id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type CanvasAgentStoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown>;
  created_at: number;
};

export function initCanvasAgentConversationSchema(
  db: InstanceType<typeof Database>
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_agent_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_agent_conversations_owner
      ON canvas_agent_conversations(user_id, canvas_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS canvas_agent_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES canvas_agent_conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_agent_messages_conversation
      ON canvas_agent_messages(conversation_id, created_at ASC);
  `);
}

export function listCanvasAgentConversations(
  db: InstanceType<typeof Database>,
  userId: string,
  canvasId: string
): CanvasAgentConversation[] {
  return db.prepare(
    `SELECT id, canvas_id, title, created_at, updated_at
     FROM canvas_agent_conversations
     WHERE user_id = ? AND canvas_id = ?
     ORDER BY updated_at DESC LIMIT 100`
  ).all(userId, canvasId) as CanvasAgentConversation[];
}

export function createCanvasAgentConversation(
  db: InstanceType<typeof Database>,
  userId: string,
  canvasId: string,
  title = "探索创作方向"
): CanvasAgentConversation {
  const now = Date.now();
  const row = {
    id: uuidv4(),
    canvas_id: canvasId.slice(0, 120),
    title: normalizeTitle(title),
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO canvas_agent_conversations
      (id, user_id, canvas_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, userId, row.canvas_id, row.title, now, now);
  return row;
}

export function getOwnedCanvasAgentConversation(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string
): CanvasAgentConversation | null {
  return (db.prepare(
    `SELECT id, canvas_id, title, created_at, updated_at
     FROM canvas_agent_conversations WHERE id = ? AND user_id = ?`
  ).get(conversationId, userId) as CanvasAgentConversation | undefined) || null;
}

export function renameCanvasAgentConversation(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
  title: string
): CanvasAgentConversation | null {
  db.prepare(
    `UPDATE canvas_agent_conversations
     SET title = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(normalizeTitle(title), Date.now(), conversationId, userId);
  return getOwnedCanvasAgentConversation(db, userId, conversationId);
}

export function deleteCanvasAgentConversation(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string
): boolean {
  const transaction = db.transaction(() => {
    const owned = getOwnedCanvasAgentConversation(db, userId, conversationId);
    if (!owned) return false;
    db.prepare(
      "DELETE FROM canvas_agent_messages WHERE conversation_id = ? AND user_id = ?"
    ).run(conversationId, userId);
    db.prepare(
      "DELETE FROM canvas_agent_conversations WHERE id = ? AND user_id = ?"
    ).run(conversationId, userId);
    return true;
  });
  return transaction();
}

export function listCanvasAgentMessages(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string
): CanvasAgentStoredMessage[] {
  if (!getOwnedCanvasAgentConversation(db, userId, conversationId)) return [];
  const rows = db.prepare(
    `SELECT id, role, content, metadata_json, created_at
     FROM canvas_agent_messages
     WHERE conversation_id = ? AND user_id = ?
     ORDER BY created_at ASC, rowid ASC LIMIT 500`
  ).all(conversationId, userId) as Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    metadata_json: string;
    created_at: number;
  }>;
  return rows.map(({ metadata_json, ...row }) => ({
    ...row,
    metadata: parseMetadata(metadata_json),
  }));
}

export function appendCanvasAgentMessage(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  metadata: Record<string, unknown> = {}
): string {
  if (!getOwnedCanvasAgentConversation(db, userId, conversationId)) {
    throw Object.assign(new Error("Agent 会话不存在"), { status: 404 });
  }
  const id = uuidv4();
  const now = Date.now();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO canvas_agent_messages
        (id, conversation_id, user_id, role, content, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      conversationId,
      userId,
      role,
      content.slice(0, 30_000),
      JSON.stringify(metadata),
      now
    );
    db.prepare(
      `UPDATE canvas_agent_conversations SET updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(now, conversationId, userId);
  });
  transaction();
  return id;
}

export type CanvasAgentProposalOutcome = {
  status: string;
  error: string | null;
  partialSkipped: number | null;
  reason: string | null;
};

// 无索引，靠会话消息 LIMIT 500 兜住。这条 UPDATE 本身不加 LIMIT，扫描的是该用户的消息行。
export function updateCanvasAgentProposalOutcome(
  db: InstanceType<typeof Database>,
  userId: string,
  proposalId: string,
  outcome: CanvasAgentProposalOutcome,
): number {
  const result = db.prepare(
    `UPDATE canvas_agent_messages
     SET metadata_json = json_set(
       metadata_json,
       '$.proposal.status', ?,
       '$.proposal.error', ?,
       '$.proposal.partialSkipped', ?,
       '$.proposal.reason', ?
     )
     WHERE user_id = ?
       AND json_extract(metadata_json, '$.proposal.id') = ?`
  ).run(
    outcome.status,
    outcome.error,
    outcome.partialSkipped,
    outcome.reason,
    userId,
    proposalId,
  );
  return Number(result.changes) || 0;
}

export function resolveCanvasAgentConversation(
  db: InstanceType<typeof Database>,
  userId: string,
  canvasId: string,
  conversationId: string,
  firstMessage: string
): CanvasAgentConversation {
  const existing = conversationId
    ? getOwnedCanvasAgentConversation(db, userId, conversationId)
    : null;
  if (existing) {
    if (existing.canvas_id !== canvasId) {
      throw Object.assign(new Error("Agent 会话不属于当前画布"), { status: 403 });
    }
    return existing;
  }
  return createCanvasAgentConversation(db, userId, canvasId, firstMessage.slice(0, 28));
}

function normalizeTitle(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80) || "未命名对话";
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
