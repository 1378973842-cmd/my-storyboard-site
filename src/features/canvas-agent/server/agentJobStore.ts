import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import {
  isActiveAgentJob,
  isTerminalAgentJob,
  nextAgentJobStatus,
  type AgentJobEvent,
  type AgentJobStatus,
} from "../core/jobState";

export type AgentJob = {
  id: string;
  user_id: string;
  canvas_id: string;
  conversation_id: string;
  status: AgentJobStatus;
  step: number;
  step_total: number;
  request: Record<string, unknown>;
  result: Record<string, unknown>;
  observations: Array<Record<string, unknown>>;
  error: string;
  created_at: number;
  updated_at: number;
  heartbeat_at: number;
  finished_at: number | null;
};

/** 心跳超过这个时长、又不是终止态，就认为这轮已经丢了。 */
const STALE_MS = 15 * 60 * 1000;

type JobRow = {
  id: string;
  user_id: string;
  canvas_id: string;
  conversation_id: string;
  status: string;
  step: number;
  step_total?: number;
  request_json: string;
  result_json: string;
  observations_json?: string;
  error: string;
  created_at: number;
  updated_at: number;
  heartbeat_at: number;
  finished_at: number | null;
};

function parseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function rowToJob(row: JobRow): AgentJob {
  let observations: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(String(row.observations_json || "[]"));
    observations = Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item === "object" && !Array.isArray(item))
      : [];
  } catch {
    observations = [];
  }
  return {
    id: row.id,
    user_id: row.user_id,
    canvas_id: row.canvas_id,
    conversation_id: row.conversation_id,
    status: row.status as AgentJobStatus,
    step: Number(row.step) || 0,
    step_total: Math.max(1, Number(row.step_total) || 1),
    request: parseJson(row.request_json),
    result: parseJson(row.result_json),
    observations,
    error: String(row.error || ""),
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
    heartbeat_at: Number(row.heartbeat_at) || 0,
    finished_at: row.finished_at == null ? null : Number(row.finished_at),
  };
}

export function initCanvasAgentJobSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_agent_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0,
      step_total INTEGER NOT NULL DEFAULT 1,
      request_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      observations_json TEXT NOT NULL DEFAULT '[]',
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_agent_jobs_owner
      ON canvas_agent_jobs(user_id, conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_canvas_agent_jobs_status
      ON canvas_agent_jobs(status, updated_at DESC);
  `);
  ensureJobColumn(db, "step_total", "INTEGER NOT NULL DEFAULT 1");
  ensureJobColumn(db, "observations_json", "TEXT NOT NULL DEFAULT '[]'");
}

function ensureJobColumn(
  db: InstanceType<typeof Database>,
  column: string,
  definition: string,
): void {
  const columns = db.prepare("PRAGMA table_info(canvas_agent_jobs)").all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE canvas_agent_jobs ADD COLUMN ${column} ${definition}`);
  }
}

export function createAgentJob(
  db: InstanceType<typeof Database>,
  input: {
    userId: string;
    canvasId: string;
    conversationId: string;
    request?: Record<string, unknown>;
  },
): AgentJob {
  const now = Date.now();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO canvas_agent_jobs (
       id, user_id, canvas_id, conversation_id, status, step,
       request_json, result_json, error, created_at, updated_at, heartbeat_at, finished_at
     ) VALUES (?, ?, ?, ?, 'queued', 0, ?, '{}', '', ?, ?, ?, NULL)`
  ).run(
    id,
    input.userId,
    input.canvasId,
    input.conversationId,
    JSON.stringify(input.request || {}),
    now,
    now,
    now,
  );
  const job = getAgentJob(db, input.userId, id);
  if (!job) throw new Error("作业创建失败");
  return job;
}

export function getAgentJob(
  db: InstanceType<typeof Database>,
  userId: string,
  jobId: string,
): AgentJob | null {
  const row = db.prepare(
    `SELECT * FROM canvas_agent_jobs WHERE id = ? AND user_id = ?`
  ).get(jobId, userId) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function listAgentJobs(
  db: InstanceType<typeof Database>,
  userId: string,
  filter: { conversationId?: string; activeOnly?: boolean; limit?: number } = {},
): AgentJob[] {
  const limit = Math.min(Math.max(Math.floor(Number(filter.limit) || 20), 1), 100);
  const conversationId = String(filter.conversationId || "").trim();
  const rows = conversationId
    ? db.prepare(
      `SELECT * FROM canvas_agent_jobs WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(userId, conversationId, limit) as JobRow[]
    : db.prepare(
      `SELECT * FROM canvas_agent_jobs WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(userId, limit) as JobRow[];
  const jobs = rows.map(rowToJob);
  return filter.activeOnly ? jobs.filter((job) => isActiveAgentJob(job.status)) : jobs;
}

/**
 * 用事件推进一步。状态机不认的事件返回 null，调用方当作「已经推进过」处理，不重复写。
 */
export function transitionAgentJob(
  db: InstanceType<typeof Database>,
  userId: string,
  jobId: string,
  event: AgentJobEvent,
  patch: { step?: number; result?: Record<string, unknown>; error?: string } = {},
): AgentJob | null {
  const current = getAgentJob(db, userId, jobId);
  if (!current) return null;
  const next = nextAgentJobStatus(current.status, event);
  if (!next) return null;
  const now = Date.now();
  const result = patch.result
    ? { ...current.result, ...patch.result }
    : current.result;
  db.prepare(
    `UPDATE canvas_agent_jobs
     SET status = ?, step = ?, result_json = ?, error = ?, updated_at = ?, heartbeat_at = ?, finished_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    next,
    patch.step == null ? current.step : Math.floor(Number(patch.step) || 0),
    JSON.stringify(result),
    patch.error == null ? current.error : patch.error,
    now,
    now,
    isTerminalAgentJob(next) ? now : null,
    jobId,
    userId,
  );
  return getAgentJob(db, userId, jobId);
}

/** 一步跑完的观察。多步续跑（C）和服务端判定（B）都从这里接。 */
export function appendAgentJobObservation(
  db: InstanceType<typeof Database>,
  userId: string,
  jobId: string,
  observation: Record<string, unknown>,
): AgentJob | null {
  const current = getAgentJob(db, userId, jobId);
  if (!current) return null;
  const now = Date.now();
  const observations = [...current.observations, observation].slice(-50);
  const step = Math.min(current.step_total, current.step + 1);
  db.prepare(
    `UPDATE canvas_agent_jobs
     SET observations_json = ?, step = ?, updated_at = ?, heartbeat_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(JSON.stringify(observations), step, now, now, jobId, userId);
  return getAgentJob(db, userId, jobId);
}

/** 计划有几步。一步一批时是 1；拆成逐节点执行（C）时就是节点数。 */
export function setAgentJobSteps(
  db: InstanceType<typeof Database>,
  userId: string,
  jobId: string,
  stepTotal: number,
): void {
  const total = Math.max(1, Math.floor(Number(stepTotal) || 1));
  db.prepare(
    `UPDATE canvas_agent_jobs SET step_total = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(total, Date.now(), jobId, userId);
}

/** 流还开着就说明这轮还活着，顺手续心跳。 */
export function touchAgentJob(
  db: InstanceType<typeof Database>,
  userId: string,
  jobId: string,
): void {
  const now = Date.now();
  db.prepare(
    `UPDATE canvas_agent_jobs SET heartbeat_at = ? WHERE id = ? AND user_id = ?`
  ).run(now, jobId, userId);
}

/** 取消接口用：把这条会话上还活着的作业一起收掉。 */export function cancelActiveJobsForConversation(
  db: InstanceType<typeof Database>,
  userId: string,
  conversationId: string,
): number {
  const rows = db.prepare(
    `SELECT id FROM canvas_agent_jobs
     WHERE user_id = ? AND conversation_id = ? AND status IN ('queued','running','waiting_approval','executing')`
  ).all(userId, conversationId) as Array<{ id?: string }>;
  let cancelled = 0;
  rows.forEach((row) => {
    const id = String(row.id || "");
    if (id && transitionAgentJob(db, userId, id, "cancel")) cancelled += 1;
  });
  return cancelled;
}

/** 心跳停了、又没结束的作业。重连时用它判断「这轮是不是已经丢了」。 */
export function isStaleAgentJob(job: AgentJob, now = Date.now()): boolean {
  if (isTerminalAgentJob(job.status)) return false;
  const beat = job.heartbeat_at || job.updated_at || job.created_at;
  return now - beat > STALE_MS;
}

export function deleteAgentJobsForConversation(
  db: InstanceType<typeof Database>,
  conversationId: string,
): void {
  db.prepare("DELETE FROM canvas_agent_jobs WHERE conversation_id = ?").run(conversationId);
}

export function deleteAgentJobsForCanvas(
  db: InstanceType<typeof Database>,
  canvasId: string,
): void {
  db.prepare("DELETE FROM canvas_agent_jobs WHERE canvas_id = ?").run(canvasId);
}
