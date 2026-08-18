import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { createRequireAuth, createRequireAdmin } from "./userAuth.js";

export type PlatformErrorRow = {
  id: string;
  user_id: string;
  canvas_id: string;
  platform: string;
  model: string;
  prompt: string;
  error_message: string;
  request_json: string;
  run_ms: number;
  created_at: string;
  user_email?: string;
  user_display_name?: string;
};

export function initPlatformErrorsSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_errors (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      canvas_id TEXT,
      platform TEXT,
      model TEXT,
      prompt TEXT,
      error_message TEXT NOT NULL,
      request_json TEXT,
      run_ms INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_platform_errors_created ON platform_errors(created_at);
    CREATE INDEX IF NOT EXISTS idx_platform_errors_user ON platform_errors(user_id);
  `);
}

function publicErrorRow(row: PlatformErrorRow) {
  let request: Record<string, unknown> = {};
  try {
    request = JSON.parse(row.request_json || "{}") as Record<string, unknown>;
  } catch {
    request = {};
  }
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.user_email || "",
    user_display_name: row.user_display_name || "",
    canvas_id: row.canvas_id || "",
    platform: row.platform || "",
    model: row.model || "",
    prompt: row.prompt || "",
    error_message: row.error_message,
    request,
    run_ms: Number(row.run_ms) || 0,
    created_at: row.created_at,
  };
}

export function registerPlatformErrorsRoutes(app: Express, db: InstanceType<typeof Database>): void {
  const requireAuth = createRequireAuth(db);
  const requireAdmin = createRequireAdmin(db);

  app.post("/api/platform-errors", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const errorMessage = String(body.error || body.error_message || "").trim().slice(0, 4000);
      if (!errorMessage) {
        return res.status(400).json({ error: "缺少报错内容" });
      }
      const id = uuidv4();
      const requestJson = JSON.stringify(
        body.request && typeof body.request === "object" ? body.request : {}
      ).slice(0, 12000);
      db.prepare(
        `INSERT INTO platform_errors
         (id, user_id, canvas_id, platform, model, prompt, error_message, request_json, run_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.authUser!.id,
        String(body.canvas_id || body.canvasId || "").slice(0, 120),
        String(body.platform || "").slice(0, 120),
        String(body.model || "").slice(0, 200),
        String(body.prompt || "").slice(0, 2000),
        errorMessage,
        requestJson,
        Math.max(0, Number(body.run_ms || body.runMs) || 0)
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "记录报错失败" });
    }
  });

  app.get("/api/admin/platform-errors", requireAdmin, (req: Request, res: Response) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
      const q = String(req.query.q || "").trim().slice(0, 120).toLowerCase();
      const rows = db
        .prepare(
          `SELECT pe.id, pe.user_id, pe.canvas_id, pe.platform, pe.model, pe.prompt,
                  pe.error_message, pe.request_json, pe.run_ms, pe.created_at,
                  u.email AS user_email, u.display_name AS user_display_name
           FROM platform_errors pe
           LEFT JOIN users u ON u.id = pe.user_id
           ORDER BY pe.created_at DESC
           LIMIT 500`
        )
        .all() as PlatformErrorRow[];
      const items = rows
        .filter((row) => {
          if (!q) return true;
          const hay = [
            row.error_message,
            row.prompt,
            row.platform,
            row.model,
            row.canvas_id,
            row.user_email,
            row.user_display_name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
        .slice(0, limit)
        .map(publicErrorRow);
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "加载报错记录失败" });
    }
  });
}
