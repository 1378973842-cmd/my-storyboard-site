import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { createRequireAuth } from "./userAuth.js";
import { stripReferenceCostumeLockFromPrompt } from "../lib/nineGrid/nineGridCore.js";

export type PersistImageMeta = {
  userId?: string;
  prompt?: string;
  model?: string;
  params?: CanvasGenerationParams;
  canvasId?: string;
  nodeId?: string;
  recordGeneration?: boolean;
};

export type CanvasGenerationParams = {
  size?: string;
  aspect_ratio?: string;
  canvas_resolution?: string;
  canvas_ratio?: string;
  quality?: string;
  provider_id?: string;
  [key: string]: unknown;
};

export type RecordCanvasGenerationInput = {
  userId: string;
  thumbnailPath: string;
  prompt?: string;
  model?: string;
  params?: CanvasGenerationParams;
  canvasId?: string;
  nodeId?: string;
};

export type CanvasGenerationRow = {
  id: string;
  user_id: string;
  thumbnail_path: string;
  prompt: string;
  model: string;
  params_json: string;
  canvas_id: string;
  node_id: string;
  favorited_at: string | null;
  shared_at: string | null;
  created_at: string;
  owner_name?: string;
};

export function createPersistImageHandler(
  db: InstanceType<typeof Database>,
  basePersist: (url: string) => Promise<string>
): (url: string, meta?: PersistImageMeta) => Promise<string> {
  return async (url, meta) => {
    const saved = await basePersist(url);
    if (!meta?.userId) return saved;
    recordFileOwnership(db, saved, meta.userId);
    if (meta.recordGeneration === false) return saved;
    recordCanvasGeneration(db, {
      userId: meta.userId,
      thumbnailPath: saved,
      prompt: meta.prompt,
      model: meta.model,
      params: meta.params,
      canvasId: meta.canvasId,
      nodeId: meta.nodeId,
    });
    return saved;
  };
}

export function initCanvasGenerationsSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_generations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      thumbnail_path TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      params_json TEXT NOT NULL DEFAULT '{}',
      canvas_id TEXT NOT NULL DEFAULT '',
      node_id TEXT NOT NULL DEFAULT '',
      shared_at DATETIME,
      favorited_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_gen_user ON canvas_generations(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_canvas_gen_shared ON canvas_generations(shared_at);
    CREATE INDEX IF NOT EXISTS idx_canvas_gen_path ON canvas_generations(thumbnail_path);
    CREATE INDEX IF NOT EXISTS idx_canvas_gen_fav ON canvas_generations(user_id, favorited_at DESC);

    CREATE TABLE IF NOT EXISTS file_ownership (
      relative_path TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_file_owner_user ON file_ownership(user_id);
  `);
  ensureCanvasGenerationsColumn(db, "favorited_at", "DATETIME");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_canvas_gen_fav ON canvas_generations(user_id, favorited_at DESC)"
  );
}

function ensureCanvasGenerationsColumn(
  db: InstanceType<typeof Database>,
  column: string,
  sqlType: string
): void {
  const cols = db.prepare("PRAGMA table_info(canvas_generations)").all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE canvas_generations ADD COLUMN ${column} ${sqlType}`);
}

export function recordFileOwnership(
  db: InstanceType<typeof Database>,
  relativePath: string,
  userId: string
): void {
  const p = normalizeUploadPath(relativePath);
  if (!p || !userId) return;
  db.prepare(
    `INSERT INTO file_ownership (relative_path, user_id) VALUES (?, ?)
     ON CONFLICT(relative_path) DO UPDATE SET user_id = excluded.user_id`
  ).run(p, userId);
}

/** 仅当尚无归属时登记，用于迁移旧画布/旧生成图，避免覆盖已有 owner */
export function ensureFileOwnership(
  db: InstanceType<typeof Database>,
  relativePath: string,
  userId: string
): boolean {
  const p = normalizeUploadPath(relativePath);
  if (!p || !userId) return false;
  const result = db
    .prepare(
      `INSERT INTO file_ownership (relative_path, user_id) VALUES (?, ?)
       ON CONFLICT(relative_path) DO NOTHING`
    )
    .run(p, userId);
  return result.changes > 0;
}

/** 登录体系上线前落盘的 AI 图（generated_images 表）补登记到管理员 */
export function backfillLegacyGeneratedImageOwnership(
  db: InstanceType<typeof Database>,
  adminUserId: string
): number {
  if (!adminUserId) return 0;
  const rows = db
    .prepare("SELECT relative_path FROM generated_images")
    .all() as { relative_path: string }[];
  let count = 0;
  for (const row of rows) {
    if (ensureFileOwnership(db, row.relative_path, adminUserId)) count += 1;
  }
  return count;
}

export function normalizeUploadPath(raw: string): string {
  const text = String(raw || "").trim().replace(/\\/g, "/");
  if (!text.startsWith("/uploads/")) return "";
  const rel = text.slice("/uploads/".length);
  if (!rel || rel.includes("..")) return "";
  return `/uploads/${rel}`;
}

/** 画廊列表存缩略图路径；预览时尽量还原 uploads 下的原图。 */
export function resolveFullUploadPath(projectRoot: string, thumbnailPath: string): string {
  const normalized = normalizeUploadPath(thumbnailPath);
  if (!normalized) return thumbnailPath;
  const galleryMatch = normalized.match(/^\/uploads\/gallery\/(.+)_thumb\.webp$/i);
  if (!galleryMatch) return normalized;
  const baseName = galleryMatch[1];
  const uploadsDir = path.join(projectRoot, "public", "uploads");
  for (const ext of [".jpg", ".jpeg", ".png", ".webp", ".gif"]) {
    const abs = path.join(uploadsDir, `${baseName}${ext}`);
    if (existsSync(abs)) return `/uploads/${baseName}${ext}`;
  }
  return normalized;
}

async function ensureGalleryThumbnail(
  projectRoot: string,
  sourcePath: string
): Promise<string> {
  const normalized = normalizeUploadPath(sourcePath);
  if (!normalized) return sourcePath;
  const abs = path.join(projectRoot, "public", normalized.replace(/^\/uploads\//, "uploads/"));
  if (!existsSync(abs)) return normalized;

  const galleryDir = path.join(projectRoot, "public", "uploads", "gallery");
  mkdirSync(galleryDir, { recursive: true });
  const base = path.basename(abs, path.extname(abs));
  const thumbRel = `/uploads/gallery/${base}_thumb.webp`;
  const thumbAbs = path.join(galleryDir, `${base}_thumb.webp`);
  if (existsSync(thumbAbs)) return thumbRel;

  try {
    await sharp(abs)
      .rotate()
      .resize(640, 640, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(thumbAbs);
    return thumbRel;
  } catch {
    return normalized;
  }
}

export function deleteCanvasGenerationByPath(
  db: InstanceType<typeof Database>,
  userId: string,
  thumbnailPath: string
): boolean {
  const thumb = normalizeUploadPath(thumbnailPath);
  if (!thumb || !userId) return false;
  const result = db
    .prepare("DELETE FROM canvas_generations WHERE user_id = ? AND thumbnail_path = ?")
    .run(userId, thumb);
  return result.changes > 0;
}

export function toggleCanvasFavorite(
  db: InstanceType<typeof Database>,
  userId: string,
  input: RecordCanvasGenerationInput
): { favorited: boolean; id: string } {
  const thumb = normalizeUploadPath(input.thumbnailPath);
  if (!thumb || !userId) throw new Error("无效图片路径");

  recordFileOwnership(db, thumb, userId);

  const existing = db
    .prepare(
      "SELECT id, favorited_at, shared_at FROM canvas_generations WHERE user_id = ? AND thumbnail_path = ?"
    )
    .get(userId, thumb) as
    | { id: string; favorited_at: string | null; shared_at: string | null }
    | undefined;

  if (existing?.favorited_at) {
    if (existing.shared_at) {
      db.prepare("UPDATE canvas_generations SET favorited_at = NULL WHERE id = ?").run(existing.id);
    } else {
      db.prepare("DELETE FROM canvas_generations WHERE id = ?").run(existing.id);
    }
    return { favorited: false, id: existing.id };
  }

  const prompt = String(input.prompt ?? "").slice(0, 8000);
  const model = String(input.model ?? "").slice(0, 120);
  const paramsJson = JSON.stringify(input.params ?? {});
  const canvasId = String(input.canvasId ?? "").slice(0, 80);
  const nodeId = String(input.nodeId ?? "").slice(0, 80);

  if (existing) {
    db.prepare(
      `UPDATE canvas_generations
       SET favorited_at = CURRENT_TIMESTAMP, prompt = ?, model = ?, params_json = ?, canvas_id = ?, node_id = ?
       WHERE id = ?`
    ).run(prompt, model, paramsJson, canvasId, nodeId, existing.id);
    return { favorited: true, id: existing.id };
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO canvas_generations
      (id, user_id, thumbnail_path, prompt, model, params_json, canvas_id, node_id, favorited_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(id, userId, thumb, prompt, model, paramsJson, canvasId, nodeId);
  return { favorited: true, id };
}

export function recordCanvasGeneration(
  db: InstanceType<typeof Database>,
  input: RecordCanvasGenerationInput
): string {
  const thumb = normalizeUploadPath(input.thumbnailPath);
  if (!thumb) return "";
  recordFileOwnership(db, thumb, input.userId);
  const id = uuidv4();
  db.prepare(
    `INSERT INTO canvas_generations
      (id, user_id, thumbnail_path, prompt, model, params_json, canvas_id, node_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    thumb,
    String(input.prompt ?? "").slice(0, 8000),
    String(input.model ?? "").slice(0, 120),
    JSON.stringify(input.params ?? {}),
    String(input.canvasId ?? "").slice(0, 80),
    String(input.nodeId ?? "").slice(0, 80)
  );
  return id;
}

export function canAccessUploadPath(
  db: InstanceType<typeof Database>,
  relativePath: string,
  userId: string | null
): boolean {
  const p = normalizeUploadPath(relativePath);
  if (!p) return false;
  if (!userId) return false;

  // 团队成员头像：任一已登录用户可读
  if (p.startsWith("/uploads/avatars/")) return true;

  const owner = db
    .prepare("SELECT user_id FROM file_ownership WHERE relative_path = ?")
    .get(p) as { user_id: string } | undefined;
  // 尚无归属记录：登录体系上线前的团队共享文件，任一已登录用户可读
  if (!owner) return true;
  if (owner.user_id === userId) return true;

  const shared = db
    .prepare(
      `SELECT id FROM canvas_generations
       WHERE thumbnail_path = ? AND shared_at IS NOT NULL LIMIT 1`
    )
    .get(p);
  if (shared) return true;

  const galleryThumb = p.replace("/uploads/gallery/", "/uploads/");
  if (galleryThumb !== p) {
    const linked = db
      .prepare(
        `SELECT id FROM canvas_generations
         WHERE thumbnail_path = ? AND shared_at IS NOT NULL LIMIT 1`
      )
      .get(galleryThumb);
    if (linked) return true;
  }

  return false;
}

export function registerCanvasGenerationsRoutes(
  app: Express,
  db: InstanceType<typeof Database>,
  projectRoot: string
): void {
  const requireAuth = createRequireAuth(db);

  app.get("/api/favorites/paths", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const rows = db
        .prepare(
          `SELECT thumbnail_path FROM canvas_generations
           WHERE user_id = ? AND favorited_at IS NOT NULL`
        )
        .all(userId) as { thumbnail_path: string }[];
      res.json({ paths: rows.map((row) => row.thumbnail_path) });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "加载收藏失败" });
    }
  });

  app.post("/api/favorites/toggle", requireAuth, (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const result = toggleCanvasFavorite(db, req.authUser!.id, {
        userId: req.authUser!.id,
        thumbnailPath: String(body.thumbnail_path || ""),
        prompt: String(body.prompt || ""),
        model: String(body.model || ""),
        params: (body.params as CanvasGenerationParams) || {},
        canvasId: String(body.canvas_id || ""),
        nodeId: String(body.node_id || ""),
      });
      const row = db
        .prepare(
          `SELECT id, user_id, thumbnail_path, prompt, model, params_json, canvas_id, node_id,
                  favorited_at, shared_at, created_at
           FROM canvas_generations WHERE id = ?`
        )
        .get(result.id) as CanvasGenerationRow | undefined;
      res.json({
        favorited: result.favorited,
        item: row ? parseGenerationRow(row, projectRoot) : null,
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "收藏失败" });
    }
  });

  app.get("/api/my-favorites", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const rows = db
        .prepare(
          `SELECT id, user_id, thumbnail_path, prompt, model, params_json, canvas_id, node_id,
                  favorited_at, shared_at, created_at
           FROM canvas_generations
           WHERE user_id = ? AND favorited_at IS NOT NULL
           ORDER BY favorited_at DESC
           LIMIT 500`
        )
        .all(userId) as CanvasGenerationRow[];
      res.json({ items: rows.map((row) => parseGenerationRow(row, projectRoot)) });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "加载收藏失败" });
    }
  });

  /** 跨画布历史生成浏览（含未收藏的落盘记录） */
  app.get("/api/canvas-generations", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const q = String(req.query.q || "").trim().slice(0, 120).toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
      const rows = db
        .prepare(
          `SELECT id, user_id, thumbnail_path, prompt, model, params_json, canvas_id, node_id,
                  favorited_at, shared_at, created_at
           FROM canvas_generations
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 500`
        )
        .all(userId) as CanvasGenerationRow[];
      const items = rows
        .map((row) => parseGenerationRow(row, projectRoot))
        .filter((item) => {
          if (!q) return true;
          const hay = `${item.prompt} ${item.model} ${item.canvas_id}`.toLowerCase();
          return hay.includes(q);
        })
        .slice(0, limit);
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "加载历史生成失败" });
    }
  });

  app.get("/api/gallery", requireAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT g.id, g.user_id, g.thumbnail_path, g.prompt, g.model, g.params_json,
                g.canvas_id, g.node_id, g.shared_at, g.created_at, u.display_name AS owner_name
         FROM canvas_generations g
         JOIN users u ON u.id = g.user_id
         WHERE g.shared_at IS NOT NULL AND u.disabled = 0
         ORDER BY g.shared_at DESC
         LIMIT 300`
      )
      .all() as CanvasGenerationRow[];
    res.json({ items: rows.map((row) => parseGenerationRow(row, projectRoot)) });
  });

  app.post("/api/my-favorites/:id/share", requireAuth, async (req, res) => {
    try {
      const row = getOwnedFavorite(db, req.params.id, req.authUser!.id);
      if (!row) return res.status(404).json({ error: "收藏不存在" });
      const thumb = await ensureGalleryThumbnail(projectRoot, row.thumbnail_path);
      if (thumb !== row.thumbnail_path) {
        recordFileOwnership(db, thumb, req.authUser!.id);
      }
      db.prepare(
        `UPDATE canvas_generations SET shared_at = CURRENT_TIMESTAMP, thumbnail_path = ? WHERE id = ?`
      ).run(thumb, row.id);
      const updated = db
        .prepare(
          `SELECT id, user_id, thumbnail_path, prompt, model, params_json, canvas_id, node_id,
                  favorited_at, shared_at, created_at FROM canvas_generations WHERE id = ?`
        )
        .get(row.id) as CanvasGenerationRow;
      res.json({ item: parseGenerationRow(updated, projectRoot) });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "分享失败" });
    }
  });

  app.post("/api/my-favorites/:id/unshare", requireAuth, (req, res) => {
    const row = getOwnedFavorite(db, req.params.id, req.authUser!.id);
    if (!row) return res.status(404).json({ error: "收藏不存在" });
    db.prepare("UPDATE canvas_generations SET shared_at = NULL WHERE id = ?").run(row.id);
    const updated = db
      .prepare(
        `SELECT id, user_id, thumbnail_path, prompt, model, params_json, canvas_id, node_id,
                favorited_at, shared_at, created_at FROM canvas_generations WHERE id = ?`
      )
      .get(row.id) as CanvasGenerationRow;
    res.json({ item: parseGenerationRow(updated, projectRoot) });
  });

  app.delete("/api/my-favorites/:id", requireAuth, (req, res) => {
    const row = getOwnedFavorite(db, req.params.id, req.authUser!.id);
    if (!row) return res.status(404).json({ error: "收藏不存在" });
    if (row.shared_at) {
      db.prepare("UPDATE canvas_generations SET favorited_at = NULL WHERE id = ?").run(row.id);
    } else {
      db.prepare("DELETE FROM canvas_generations WHERE id = ?").run(row.id);
    }
    res.json({ ok: true });
  });
}

function getOwnedFavorite(
  db: InstanceType<typeof Database>,
  id: string,
  userId: string
): CanvasGenerationRow | undefined {
  return db
    .prepare(
      "SELECT * FROM canvas_generations WHERE id = ? AND user_id = ? AND favorited_at IS NOT NULL"
    )
    .get(id, userId) as CanvasGenerationRow | undefined;
}

function parseGenerationRow(row: CanvasGenerationRow, projectRoot?: string) {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(row.params_json || "{}") as Record<string, unknown>;
  } catch {
    params = {};
  }
  const thumbnail_path = row.thumbnail_path;
  const preview_path = projectRoot
    ? resolveFullUploadPath(projectRoot, thumbnail_path)
    : thumbnail_path;
  return {
    id: row.id,
    user_id: row.user_id,
    thumbnail_path,
    preview_path,
    prompt: stripReferenceCostumeLockFromPrompt(row.prompt),
    model: row.model,
    params,
    canvas_id: row.canvas_id,
    node_id: row.node_id,
    favorited_at: row.favorited_at,
    shared_at: row.shared_at,
    created_at: row.created_at,
    owner_name: row.owner_name,
  };
}

export function createProtectedUploadsMiddleware(
  db: InstanceType<typeof Database>,
  projectRoot: string
) {
  return (req: Request, res: Response, next: () => void) => {
    const urlPath = decodeURIComponent(req.path || "");
    if (!urlPath.startsWith("/uploads/")) return next();

    const userId = req.authUser?.id ?? null;
    if (!userId) {
      res.status(401).json({ error: "请先登录" });
      return;
    }

    if (canAccessUploadPath(db, urlPath, userId)) {
      const rel = urlPath.replace(/^\/uploads\//, "");
      const abs = path.join(projectRoot, "public", "uploads", rel);
      if (!abs.startsWith(path.join(projectRoot, "public", "uploads")) || !existsSync(abs)) {
        res.status(404).end();
        return;
      }
      res.sendFile(abs);
      return;
    }

    res.status(403).json({ error: "无权访问此文件" });
  };
}
