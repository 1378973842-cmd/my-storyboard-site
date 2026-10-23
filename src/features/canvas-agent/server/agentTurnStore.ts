import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export type AgentTurnStatus = "running" | "ok" | "error" | "aborted";

export type AgentTurn = {
  id: string;
  user_id: string;
  canvas_id: string;
  conversation_id: string;
  job_id: string;
  model: string;
  playbook_id: string;
  status: AgentTurnStatus;
  error: string;
  reply_chars: number;
  proposal_actions: number;
  started_at: number;
  ended_at: number | null;
  latency_ms: number | null;
};

export function initCanvasAgentTurnSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_agent_turns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      job_id TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      playbook_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT NOT NULL DEFAULT '',
      reply_chars INTEGER NOT NULL DEFAULT 0,
      proposal_actions INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      latency_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_agent_turns_user
      ON canvas_agent_turns(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_canvas_agent_turns_started
      ON canvas_agent_turns(started_at DESC);
  `);
}

export function startAgentTurn(
  db: InstanceType<typeof Database>,
  input: {
    userId: string;
    canvasId: string;
    conversationId: string;
    jobId: string;
    model: string;
    playbookId?: string;
  },
): string {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO canvas_agent_turns (
       id, user_id, canvas_id, conversation_id, job_id, model, playbook_id,
       status, error, reply_chars, proposal_actions, started_at, ended_at, latency_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', '', 0, 0, ?, NULL, NULL)`
  ).run(
    id,
    input.userId,
    input.canvasId,
    input.conversationId,
    input.jobId,
    input.model,
    input.playbookId || "",
    Date.now(),
  );
  return id;
}

export function finishAgentTurn(
  db: InstanceType<typeof Database>,
  turnId: string,
  input: {
    status: Exclude<AgentTurnStatus, "running">;
    error?: string;
    replyChars?: number;
    proposalActions?: number;
  },
): void {
  if (!turnId) return;
  const now = Date.now();
  db.prepare(
    `UPDATE canvas_agent_turns
     SET status = ?, error = ?, reply_chars = ?, proposal_actions = ?,
         ended_at = ?, latency_ms = ? - started_at
     WHERE id = ?`
  ).run(
    input.status,
    String(input.error || "").slice(0, 500),
    Math.max(0, Math.floor(Number(input.replyChars) || 0)),
    Math.max(0, Math.floor(Number(input.proposalActions) || 0)),
    now,
    now,
    turnId,
  );
}

/** 配额只看「最近 24 小时真正发起过的轮次」，失败也算（它已经花过模型钱）。 */
export function countTurnsSince(
  db: InstanceType<typeof Database>,
  userId: string,
  sinceMs: number,
): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM canvas_agent_turns WHERE user_id = ? AND started_at >= ?`
  ).get(userId, sinceMs) as { c?: number } | undefined;
  return Number(row?.c) || 0;
}

export function overDailyQuota(count: number, limit: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return count >= limit;
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export type AgentTurnMetrics = {
  totals: { turns: number; ok: number; error: number; aborted: number; running: number };
  latencyMs: { p50: number; p95: number; avg: number };
  byModel: Array<{ model: string; turns: number; errors: number }>;
  byDay: Array<{ day: string; turns: number; errors: number }>;
};

export function summarizeAgentTurns(
  db: InstanceType<typeof Database>,
  userId: string,
  sinceMs: number,
): AgentTurnMetrics {
  const rows = db.prepare(
    `SELECT model, status, latency_ms, started_at FROM canvas_agent_turns
     WHERE user_id = ? AND started_at >= ?`
  ).all(userId, sinceMs) as Array<{
    model?: string;
    status?: string;
    latency_ms?: number | null;
    started_at?: number;
  }>;
  const totals = { turns: rows.length, ok: 0, error: 0, aborted: 0, running: 0 };
  const latencies: number[] = [];
  const byModel = new Map<string, { turns: number; errors: number }>();
  const byDay = new Map<string, { turns: number; errors: number }>();
  rows.forEach((row) => {
    const status = String(row.status || "running");
    if (status === "ok") totals.ok += 1;
    else if (status === "error") totals.error += 1;
    else if (status === "aborted") totals.aborted += 1;
    else totals.running += 1;
    if (typeof row.latency_ms === "number") latencies.push(row.latency_ms);
    const model = String(row.model || "unknown");
    const modelEntry = byModel.get(model) || { turns: 0, errors: 0 };
    modelEntry.turns += 1;
    if (status === "error") modelEntry.errors += 1;
    byModel.set(model, modelEntry);
    const day = new Date(Number(row.started_at) || 0).toISOString().slice(0, 10);
    const dayEntry = byDay.get(day) || { turns: 0, errors: 0 };
    dayEntry.turns += 1;
    if (status === "error") dayEntry.errors += 1;
    byDay.set(day, dayEntry);
  });
  const avg = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : 0;
  return {
    totals,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      avg,
    },
    byModel: [...byModel.entries()]
      .map(([model, value]) => ({ model, ...value }))
      .sort((a, b) => b.turns - a.turns),
    byDay: [...byDay.entries()]
      .map(([day, value]) => ({ day, ...value }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
