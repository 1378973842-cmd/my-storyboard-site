import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { mergeEffectedNodes, parseEffectedNodes, type EffectedNode } from "../core/effectLedger";
import { citationsInUserMessage } from "../core/referencePrompt";
import type { AskCard } from "../core/askCard";

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
      updated_at INTEGER NOT NULL,
      agent_playbook_id TEXT NOT NULL DEFAULT '',
      agent_stage INTEGER,
      agent_cited_nodes TEXT NOT NULL DEFAULT '',
      agent_effected_nodes TEXT NOT NULL DEFAULT '',
      agent_cancel_marker TEXT NOT NULL DEFAULT ''
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
  ensureConversationColumn(db, "agent_playbook_id", "TEXT NOT NULL DEFAULT ''");
  ensureConversationColumn(db, "agent_stage", "INTEGER");
  ensureConversationColumn(db, "agent_cited_nodes", "TEXT NOT NULL DEFAULT ''");
  ensureConversationColumn(db, "agent_effected_nodes", "TEXT NOT NULL DEFAULT ''");
  ensureConversationColumn(db, "agent_cancel_marker", "TEXT NOT NULL DEFAULT ''");
}

function ensureConversationColumn(
  db: InstanceType<typeof Database>,
  column: string,
  definition: string,
): void {
  const columns = db.prepare("PRAGMA table_info(canvas_agent_conversations)").all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE canvas_agent_conversations ADD COLUMN ${column} ${definition}`);
  }
}

export function readConversationStage(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): { playbookId: string; stage: number | null } {
  const row = db.prepare(
    `SELECT agent_playbook_id, agent_stage
     FROM canvas_agent_conversations WHERE id = ? AND user_id = ?`
  ).get(conversationId, userId) as { agent_playbook_id?: string; agent_stage?: number | null } | undefined;
  const stage = row?.agent_stage;
  return {
    playbookId: String(row?.agent_playbook_id || ""),
    stage: typeof stage === "number" && Number.isInteger(stage) ? stage : null,
  };
}

export function recordConversationStage(
  db: InstanceType<typeof Database>,
  userId: string,
  proposalId: string,
  playbookId: string,
  stage: number,
): void {
  const row = db.prepare(
    `SELECT conversation_id FROM canvas_agent_messages
     WHERE user_id = ? AND json_extract(metadata_json, '$.proposal.id') = ?`
  ).get(userId, proposalId) as { conversation_id?: string } | undefined;
  const conversationId = String(row?.conversation_id || "");
  if (!conversationId) return;
  db.prepare(
    `UPDATE canvas_agent_conversations
     SET agent_playbook_id = ?, agent_stage = ?
     WHERE id = ? AND user_id = ?`
  ).run(playbookId, stage, conversationId, userId);
}

function parseCitedNodeIds(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

export function readConversationCitedNodes(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): string[] {
  const row = db.prepare(
    `SELECT agent_cited_nodes
     FROM canvas_agent_conversations WHERE id = ? AND user_id = ?`
  ).get(conversationId, userId) as { agent_cited_nodes?: string } | undefined;
  return parseCitedNodeIds(row?.agent_cited_nodes);
}

/** 只并用户消息里的 {{节点}}。确认、使用模型、模型写进提案的 id 都不写。 */
export function recordConversationCitations(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
  message: string,
): string[] {
  const current = readConversationCitedNodes(db, userId, conversationId);
  const incoming = [...citationsInUserMessage(message).nodes];
  if (!incoming.length) return current;
  const merged = [...new Set([...current, ...incoming])].sort();
  if (merged.length === current.length && merged.every((id, index) => id === current[index])) return current;
  db.prepare(
    `UPDATE canvas_agent_conversations
     SET agent_cited_nodes = ?
     WHERE id = ? AND user_id = ?`
  ).run(JSON.stringify(merged), conversationId, userId);
  return merged;
}

export function readConversationEffected(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): EffectedNode[] {
  const row = db.prepare(
    `SELECT agent_effected_nodes
     FROM canvas_agent_conversations WHERE id = ? AND user_id = ?`
  ).get(conversationId, userId) as { agent_effected_nodes?: string } | undefined;
  return parseEffectedNodes(row?.agent_effected_nodes);
}

/** 只并这一次落板新建的节点。别的会话的节点不写进来。 */
export function recordConversationEffected(
  db: InstanceType<typeof Database>,
  userId: string,
  proposalId: string,
  incoming: EffectedNode[],
  changelog: string,
): EffectedNode[] {
  const row = db.prepare(
    `SELECT id, conversation_id FROM canvas_agent_messages
     WHERE user_id = ? AND json_extract(metadata_json, '$.proposal.id') = ?`
  ).get(userId, proposalId) as { id?: string; conversation_id?: string } | undefined;
  const conversationId = String(row?.conversation_id || "");
  if (!conversationId) return [];
  const merged = mergeEffectedNodes(readConversationEffected(db, userId, conversationId), incoming);
  db.prepare(
    `UPDATE canvas_agent_conversations
     SET agent_effected_nodes = ?
     WHERE id = ? AND user_id = ?`
  ).run(JSON.stringify(merged), conversationId, userId);
  if (row?.id && (incoming.length || changelog)) {
    db.prepare(
      `UPDATE canvas_agent_messages
       SET metadata_json = json_set(
         metadata_json,
         '$.proposal.effectedNodes', json(?),
         '$.proposal.changelog', ?
       )
       WHERE id = ? AND user_id = ?`
    ).run(JSON.stringify(incoming), changelog, row.id, userId);
  }
  return merged;
}

/** 下一轮读一次「刚发生了什么」，读完就标掉，避免后面每轮都复读。 */
export function takeConversationChangelog(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): string {
  const row = db.prepare(
    `SELECT id, json_extract(metadata_json, '$.proposal.changelog') AS changelog
     FROM canvas_agent_messages
     WHERE conversation_id = ? AND user_id = ?
       AND json_extract(metadata_json, '$.proposal.status') IN ('applied', 'partial', 'exec_failed')
       AND coalesce(json_extract(metadata_json, '$.proposal.changelogRead'), 0) = 0
       AND length(coalesce(json_extract(metadata_json, '$.proposal.changelog'), '')) > 0
     ORDER BY created_at DESC LIMIT 1`
  ).get(conversationId, userId) as { id?: string; changelog?: string } | undefined;
  const changelog = String(row?.changelog || "").trim();
  if (!row?.id || !changelog) return "";
  db.prepare(
    `UPDATE canvas_agent_messages
     SET metadata_json = json_set(metadata_json, '$.proposal.changelogRead', 1)
     WHERE id = ? AND user_id = ?`
  ).run(row.id, userId);
  return changelog;
}

/** 最近一张审批卡之后，还没有用户在卡上点过批准或拒绝。建、连、改已自动落板，只有这张卡还在等人。 */
export function hasPendingRunApproval(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): boolean {
  const card = db.prepare(
    `SELECT created_at FROM canvas_agent_messages
     WHERE conversation_id = ? AND user_id = ? AND role = 'assistant'
       AND EXISTS (SELECT 1 FROM json_each(metadata_json, '$.asks') WHERE json_extract(value, '$.mode') = 'approve_run_node')
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(conversationId, userId) as { created_at?: number } | undefined;
  if (card?.created_at == null) return false;
  const answered = db.prepare(
    `SELECT 1 AS ok FROM canvas_agent_messages
     WHERE conversation_id = ? AND user_id = ? AND role = 'user' AND created_at >= ?
       AND (json_extract(metadata_json, '$.askAnswer.mode') = 'approve_run_node'
         OR EXISTS (SELECT 1 FROM json_each(metadata_json, '$.askAnswers') WHERE json_extract(value, '$.mode') = 'approve_run_node'))
     LIMIT 1`
  ).get(conversationId, userId, card.created_at);
  return !answered;
}

/**
 * 最近一条带提问卡的助手消息里，还没有用户答复的题。
 * 审批卡不算：它走 hasPendingRunApproval，那套是「没点批准就不跑」。
 * 这里只回答一件事：用户有没有理那张卡。没理不是同意，不能替他按默认值走。
 */
export function pendingAskQuestions(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): string[] {
  const row = db.prepare(
    `SELECT id, created_at, metadata_json FROM canvas_agent_messages
     WHERE conversation_id = ? AND user_id = ? AND role = 'assistant'
       AND EXISTS (SELECT 1 FROM json_each(metadata_json, '$.asks') WHERE json_extract(value, '$.mode') <> 'approve_run_node')
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(conversationId, userId) as { id?: string; created_at?: number; metadata_json?: string } | undefined;
  if (!row?.id) return [];
  let cards: AskCard[] = [];
  try {
    const parsed = JSON.parse(String(row.metadata_json || "{}")) as { asks?: AskCard[] };
    cards = Array.isArray(parsed.asks) ? parsed.asks : [];
  } catch {
    return [];
  }
  const questions = cards.filter((card) => (
    card && card.mode !== "approve_run_node" && String(card.question || "").trim()
  ));
  if (!questions.length) return [];
  const answered = new Set<string>();
  const later = db.prepare(
    `SELECT metadata_json FROM canvas_agent_messages
     WHERE conversation_id = ? AND user_id = ? AND role = 'user' AND created_at >= ?
     ORDER BY created_at ASC, rowid ASC`
  ).all(conversationId, userId, Number(row.created_at) || 0) as Array<{ metadata_json?: string }>;
  later.forEach((item) => {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(String(item.metadata_json || "{}")) as Record<string, unknown>;
    } catch {
      return;
    }
    const one = meta.askAnswer && typeof meta.askAnswer === "object" ? [meta.askAnswer] : [];
    const many = Array.isArray(meta.askAnswers) ? meta.askAnswers : [];
    [...one, ...many].forEach((answer) => {
      const cardId = String((answer as { cardId?: string }).cardId || "");
      if (cardId) answered.add(cardId);
    });
  });
  return questions.filter((card) => !answered.has(card.id)).map((card) => card.question);
}

export type ConversationCancelMarker = { at: number; messageId: string };

/** 取消只有用户可以发起，所以只能由显式接口写；落在会话上，不落在聊天流里。 */
export function setConversationCancelMarker(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): ConversationCancelMarker | null {
  const row = db.prepare(
    `SELECT id FROM canvas_agent_conversations WHERE id = ? AND user_id = ?`
  ).get(conversationId, userId) as { id?: string } | undefined;
  if (!row?.id) return null;
  const last = db.prepare(
    `SELECT id FROM canvas_agent_messages
     WHERE conversation_id = ? AND user_id = ? AND role = 'user'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(conversationId, userId) as { id?: string } | undefined;
  const marker = { at: Date.now(), messageId: String(last?.id || "") };
  db.prepare(
    `UPDATE canvas_agent_conversations SET agent_cancel_marker = ? WHERE id = ? AND user_id = ?`
  ).run(JSON.stringify(marker), conversationId, userId);
  return marker;
}

/** 下一轮读一次「用户取消过」，读完清空，避免后面每轮都复读。 */
export function takeConversationCancelMarker(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): ConversationCancelMarker | null {
  const row = db.prepare(
    `SELECT agent_cancel_marker FROM canvas_agent_conversations WHERE id = ? AND user_id = ?`
  ).get(conversationId, userId) as { agent_cancel_marker?: string } | undefined;
  if (!row) return null;
  const raw = String(row.agent_cancel_marker || "");
  if (!raw) return null;
  db.prepare(
    `UPDATE canvas_agent_conversations SET agent_cancel_marker = '' WHERE id = ? AND user_id = ?`
  ).run(conversationId, userId);
  try {
    const parsed = JSON.parse(raw) as { at?: number; messageId?: string };
    return { at: Number(parsed?.at) || 0, messageId: String(parsed?.messageId || "") };
  } catch {
    return { at: 0, messageId: "" };
  }
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
    try {
      db.prepare("DELETE FROM canvas_agent_jobs WHERE conversation_id = ?").run(conversationId);
    } catch {
      /* 老库还没建 jobs 表 */
    }
    return true;
  });
  return transaction();
}

/**
 * 画布被彻底清空时，连它的 Agent 会话一起删。
 * 软删除不删：画布可以恢复，历史也得跟着回来。
 */
export function deleteCanvasAgentArtifacts(
  db: InstanceType<typeof Database>,
  canvasId: string
): number {
  const id = String(canvasId || "").trim();
  if (!id) return 0;
  try {
    const rows = db.prepare(
      "SELECT id FROM canvas_agent_conversations WHERE canvas_id = ?"
    ).all(id) as Array<{ id?: string }>;
    const ids = rows.map((row) => String(row.id || "")).filter(Boolean);
    if (!ids.length) return 0;
    const removeMessages = db.prepare(
      "DELETE FROM canvas_agent_messages WHERE conversation_id = ?"
    );
    const transaction = db.transaction(() => {
      ids.forEach((conversationId) => removeMessages.run(conversationId));
      db.prepare("DELETE FROM canvas_agent_conversations WHERE canvas_id = ?").run(id);
      try {
        db.prepare("DELETE FROM canvas_agent_jobs WHERE canvas_id = ?").run(id);
      } catch {
        /* 老库还没建 jobs 表 */
      }
      try {
        db.prepare("DELETE FROM canvas_agent_memory WHERE canvas_id = ?").run(id);
      } catch {
        /* 老库还没建内存表 */
      }
    });
    transaction();
    return ids.length;
  } catch (error) {
    console.warn("[canvas-agent] 清理画布会话失败:", error);
    return 0;
  }
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
  droppedConnects: number | null;
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
       '$.proposal.droppedConnects', ?,
       '$.proposal.reason', ?
     )
     WHERE user_id = ?
       AND json_extract(metadata_json, '$.proposal.id') = ?`
  ).run(
    outcome.status,
    outcome.error,
    outcome.partialSkipped,
    outcome.droppedConnects,
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
