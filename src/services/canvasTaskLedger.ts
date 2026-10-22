import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { Express, RequestHandler } from "express";

export type CanvasTaskStatus = "queued" | "running" | "succeeded" | "failed";

export type CanvasTaskRecord<TResult = unknown> = {
  id: string;
  userId: string;
  canvasId: string;
  nodeId: string;
  taskType: string;
  payload: unknown;
  status: CanvasTaskStatus;
  createdAt: number;
  updatedAt: number;
  result: TResult | null;
  error: string;
  upstreamTaskId?: string;
};

export function canonicalizeParams(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : canonicalizeParams(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined && item !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalizeParams(item)])
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 1_000_000) / 1_000_000;
  }
  return value;
}

export function hashCanonicalParams(value: unknown): string {
  const canonical = JSON.stringify(canonicalizeParams(value));
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function initCanvasTaskLedger(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_tasks (
      task_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL DEFAULT '',
      node_id TEXT NOT NULL DEFAULT '',
      task_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      params_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      result_json TEXT,
      error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_tasks_owner
      ON canvas_tasks(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_canvas_tasks_canvas
      ON canvas_tasks(user_id, canvas_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS canvas_task_runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      params_hash_at_run TEXT NOT NULL,
      provider_request_json TEXT NOT NULL DEFAULT '{}',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      outcome TEXT,
      FOREIGN KEY (task_id) REFERENCES canvas_tasks(task_id)
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_task_runs_task
      ON canvas_task_runs(task_id, attempt);
    CREATE TABLE IF NOT EXISTS canvas_task_bindings (
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_task_bindings_canvas
      ON canvas_task_bindings(user_id, canvas_id, updated_at DESC);
  `);
  ensureColumn(db, "canvas_tasks", "params_hash", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "canvas_tasks", "upstream_task_id", "TEXT NOT NULL DEFAULT ''");
  const now = Date.now();
  db.prepare(
    `UPDATE canvas_task_runs
     SET finished_at = ?, outcome = 'failed'
     WHERE outcome IS NULL
       AND task_id IN (
         SELECT task_id FROM canvas_tasks WHERE status IN ('queued', 'running')
       )`
  ).run(now);
  db.prepare(
    `UPDATE canvas_tasks
     SET status = 'failed',
         error = '服务重启中断了本地执行；未自动重试以避免重复扣费',
         updated_at = ?
     WHERE status IN ('queued', 'running')`
  ).run(now);
  db.prepare("DELETE FROM canvas_tasks WHERE updated_at < ?").run(
    now - 30 * 24 * 60 * 60 * 1000
  );
  db.prepare("DELETE FROM canvas_task_bindings WHERE updated_at < ?").run(
    now - 30 * 24 * 60 * 60 * 1000
  );
}

export function registerCanvasTaskLedgerRoutes(
  app: Express,
  db: InstanceType<typeof Database>,
  requireGate?: RequestHandler
): void {
  initCanvasTaskLedger(db);
  const gate = requireGate ? [requireGate] : [];
  app.get("/api/canvas-task-ledger", ...gate, (req, res) => {
    const userId = req.authUser?.id || "";
    const canvasId = String(req.query.canvas_id || "").trim().slice(0, 120);
    if (!userId || !canvasId) return res.status(400).json({ error: "缺少 canvas_id" });
    const rows = db.prepare(
      `SELECT task_id, metadata_json, updated_at FROM canvas_task_bindings
       WHERE user_id = ? AND canvas_id = ?
       ORDER BY updated_at ASC LIMIT 200`
    ).all(userId, canvasId) as Array<{
      task_id: string;
      metadata_json: string;
      updated_at: number;
    }>;
    return res.json({
      tasks: rows.map((row) => ({
        task_id: row.task_id,
        info: parseJson(row.metadata_json),
        updated_at: row.updated_at,
      })),
    });
  });
  app.post("/api/canvas-task-ledger", ...gate, (req, res) => {
    const userId = req.authUser?.id || "";
    const taskId = String(req.body?.task_id || "").trim().slice(0, 160);
    const canvasId = String(req.body?.canvas_id || "").trim().slice(0, 120);
    const info = req.body?.info && typeof req.body.info === "object" ? req.body.info : {};
    const metadataJson = JSON.stringify(info);
    if (!userId || !taskId || !canvasId) {
      return res.status(400).json({ error: "缺少 task_id 或 canvas_id" });
    }
    if (metadataJson.length > 200_000) {
      return res.status(413).json({ error: "任务元数据过大" });
    }
    db.prepare(
      `INSERT INTO canvas_task_bindings
        (task_id, user_id, canvas_id, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id, user_id) DO UPDATE SET
         canvas_id = excluded.canvas_id,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`
    ).run(taskId, userId, canvasId, metadataJson, Date.now());
    return res.json({ ok: true });
  });
  app.delete("/api/canvas-task-ledger/:taskId", ...gate, (req, res) => {
    const userId = req.authUser?.id || "";
    db.prepare("DELETE FROM canvas_task_bindings WHERE task_id = ? AND user_id = ?")
      .run(String(req.params.taskId || ""), userId);
    return res.json({ ok: true });
  });
}

export function saveCanvasTask(
  db: InstanceType<typeof Database> | undefined,
  task: CanvasTaskRecord
): void {
  if (!db) return;
  const paramsHash = hashCanonicalParams(task.payload);
  db.prepare(
    `INSERT INTO canvas_tasks
      (task_id, user_id, canvas_id, node_id, task_type, payload_json, status,
       result_json, error, created_at, updated_at, params_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET
       status = excluded.status,
       result_json = excluded.result_json,
       error = excluded.error,
       updated_at = excluded.updated_at`
  ).run(
    task.id,
    task.userId,
    task.canvasId,
    task.nodeId,
    task.taskType,
    JSON.stringify(task.payload ?? {}),
    task.status,
    task.result == null ? null : JSON.stringify(task.result),
    task.error,
    task.createdAt,
    task.updatedAt,
    paramsHash
  );
  if (task.status === "running") {
    db.prepare(
      `INSERT INTO canvas_task_runs
        (run_id, task_id, attempt, params_hash_at_run, provider_request_json, started_at)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(run_id) DO NOTHING`
    ).run(`${task.id}:1`, task.id, paramsHash, JSON.stringify(canonicalizeParams(task.payload)), task.updatedAt);
  } else if (task.status === "succeeded" || task.status === "failed") {
    db.prepare(
      `UPDATE canvas_task_runs SET finished_at = ?, outcome = ?
       WHERE run_id = ?`
    ).run(task.updatedAt, task.status === "succeeded" ? "success" : "failed", `${task.id}:1`);
  }
}

export function saveCanvasTaskUpstreamId(
  db: InstanceType<typeof Database> | undefined,
  taskId: string,
  upstreamTaskId: string
): void {
  const upstream = String(upstreamTaskId || "").trim();
  if (!db || !taskId || !upstream) return;
  db.prepare(
    `UPDATE canvas_tasks
     SET upstream_task_id = ?, updated_at = ?
     WHERE task_id = ?`
  ).run(upstream, Date.now(), taskId);
}

export function readCanvasTask<TResult>(
  db: InstanceType<typeof Database> | undefined,
  taskId: string,
  userId: string
): CanvasTaskRecord<TResult> | null {
  if (!db || !taskId || !userId) return null;
  const row = db.prepare(
    `SELECT task_id, user_id, canvas_id, node_id, task_type, payload_json,
            status, result_json, error, created_at, updated_at, upstream_task_id
     FROM canvas_tasks WHERE task_id = ? AND user_id = ?`
  ).get(taskId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.task_id),
    userId: String(row.user_id),
    canvasId: String(row.canvas_id),
    nodeId: String(row.node_id),
    taskType: String(row.task_type),
    payload: parseJson(row.payload_json),
    status: String(row.status) as CanvasTaskStatus,
    result: row.result_json == null ? null : parseJson(row.result_json) as TResult,
    error: String(row.error || ""),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    upstreamTaskId: String(row.upstream_task_id || ""),
  };
}

function parseJson(value: unknown): unknown {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function ensureColumn(
  db: InstanceType<typeof Database>,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
