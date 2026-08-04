import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import {
  isGalleryWorkCategory,
  type GalleryWorkCategoryId,
} from "../lib/galleryCategories.js";
import {
  normalizeUploadPath,
  recordFileOwnership,
  resolveFullUploadPath,
} from "./canvasGenerations.js";
import { createRequireAuth } from "./userAuth.js";

const TITLE_MAX = 80;
const DESC_MAX = 500;
const STEP_NOTE_MAX = 1000;
const IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 9;
const MAX_PROCESS_STEPS = 6;
const MAX_IMAGES_PER_STEP = 3;

export type GalleryProcessStep = {
  /** 兼容字段：等同 images[0] */
  image_path: string;
  images: string[];
  note: string;
};

type GalleryWorkRow = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  image_path: string;
  images_json?: string | null;
  process_steps_json?: string | null;
  source_favorite_id: string | null;
  published: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  owner_name?: string;
};

export type GalleryWorkDto = {
  id: string;
  title: string;
  description: string;
  category: string;
  image_path: string;
  images: string[];
  process_steps: GalleryProcessStep[];
  preview_path: string;
  thumbnail_path: string;
  source_favorite_id: string | null;
  published: boolean;
  owner_name?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  favorited?: boolean;
  favorite_count?: number;
  /** 兼容旧画廊卡片字段 */
  prompt: string;
  model: string;
  shared_at: string | null;
};

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: MAX_IMAGES + MAX_PROCESS_STEPS * MAX_IMAGES_PER_STEP },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase();
    if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
      cb(null, true);
      return;
    }
    cb(new Error("仅支持 JPG / PNG / WebP / GIF"));
  },
});

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return map[mime] || ".jpg";
}

function removeLocalUpload(projectRoot: string, webPath: string | null | undefined): void {
  const rel = String(webPath || "")
    .replace(/^\/uploads\//, "")
    .replace(/\\/g, "/");
  if (!rel || rel.includes("..") || !rel.startsWith("gallery-works/")) return;
  const abs = path.join(projectRoot, "public", "uploads", rel);
  const root = path.join(projectRoot, "public", "uploads", "gallery-works");
  if (!abs.startsWith(root) || !existsSync(abs)) return;
  try {
    unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

function saveWorkImage(
  db: InstanceType<typeof Database>,
  projectRoot: string,
  userId: string,
  buffer: Buffer,
  mime: string
): string {
  const ext = extFromMime(mime);
  const filename = `${uuidv4()}${ext}`;
  const dir = path.join(projectRoot, "public", "uploads", "gallery-works");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), buffer);
  const url = `/uploads/gallery-works/${filename}`;
  recordFileOwnership(db, url, userId);
  return url;
}

function parseImagesJson(raw: string | null | undefined, fallback: string): string[] {
  const primary = normalizeUploadPath(fallback) || String(fallback || "").trim();
  let list: string[] = [];
  try {
    const parsed = JSON.parse(String(raw || "[]")) as unknown;
    if (Array.isArray(parsed)) {
      list = parsed
        .map((x) => normalizeUploadPath(String(x || "")) || "")
        .filter(Boolean);
    }
  } catch {
    list = [];
  }
  if (primary && !list.includes(primary)) list = [primary, ...list];
  if (!list.length && primary) list = [primary];
  return list.slice(0, MAX_IMAGES);
}

function stepImagePaths(step: GalleryProcessStep): string[] {
  const list = Array.isArray(step.images) ? step.images.filter(Boolean) : [];
  if (list.length) return list;
  return step.image_path ? [step.image_path] : [];
}

function parseProcessStepsJson(raw: string | null | undefined): GalleryProcessStep[] {
  try {
    const parsed = JSON.parse(String(raw || "[]")) as unknown;
    if (!Array.isArray(parsed)) return [];
    const steps: GalleryProcessStep[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const note = String(row.note || "")
        .trim()
        .slice(0, STEP_NOTE_MAX);
      const fromArray = Array.isArray(row.images)
        ? row.images
            .map((p) => normalizeUploadPath(String(p || "")) || "")
            .filter(Boolean)
        : [];
      const primary = normalizeUploadPath(String(row.image_path || "")) || "";
      const images = (fromArray.length ? fromArray : primary ? [primary] : []).slice(
        0,
        MAX_IMAGES_PER_STEP
      );
      if (!images.length) continue;
      steps.push({ image_path: images[0], images, note });
      if (steps.length >= MAX_PROCESS_STEPS) break;
    }
    return steps;
  } catch {
    return [];
  }
}

function rowToDto(
  projectRoot: string,
  row: GalleryWorkRow
): GalleryWorkDto {
  const images = parseImagesJson(row.images_json, row.image_path);
  const image = images[0] || normalizeUploadPath(row.image_path) || row.image_path;
  const preview = resolveFullUploadPath(projectRoot, image);
  const process_steps = parseProcessStepsJson(row.process_steps_json);
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    category: row.category || "",
    image_path: image,
    images,
    process_steps,
    preview_path: preview,
    thumbnail_path: image,
    source_favorite_id: row.source_favorite_id,
    published: Number(row.published) === 1,
    owner_name: row.owner_name,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    published_at: row.published_at,
    prompt: row.description || row.title,
    model: "",
    shared_at: row.published_at,
  };
}

function parseTitle(raw: unknown): string | null {
  const title = String(raw ?? "").trim();
  if (!title) return null;
  if (title.length > TITLE_MAX) return null;
  return title;
}

function parseDescription(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, DESC_MAX);
}

function parseCategory(raw: unknown): GalleryWorkCategoryId | null {
  const id = String(raw ?? "").trim();
  return isGalleryWorkCategory(id) ? id : null;
}

export function initGalleryWorksSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gallery_works (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      image_path TEXT NOT NULL,
      images_json TEXT NOT NULL DEFAULT '[]',
      source_favorite_id TEXT,
      published INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_gallery_works_user ON gallery_works(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gallery_works_pub ON gallery_works(published, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gallery_works_cat ON gallery_works(category, published_at DESC);
  `);
  try {
    db.prepare("ALTER TABLE gallery_works ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]'").run();
  } catch {
    /* column exists */
  }
  try {
    db.prepare(
      "ALTER TABLE gallery_works ADD COLUMN process_steps_json TEXT NOT NULL DEFAULT '[]'"
    ).run();
  } catch {
    /* column exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS gallery_favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, work_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (work_id) REFERENCES gallery_works(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_gallery_fav_user ON gallery_favorites(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gallery_fav_work ON gallery_favorites(work_id);
  `);
}

export function isPublishedGalleryWorkPath(
  db: InstanceType<typeof Database>,
  relativePath: string
): boolean {
  const p = normalizeUploadPath(relativePath);
  if (!p) return false;
  try {
    const byPrimary = db
      .prepare(
        `SELECT id FROM gallery_works WHERE image_path = ? AND published = 1 LIMIT 1`
      )
      .get(p);
    if (byPrimary) return true;
    const byJson = db
      .prepare(
        `SELECT id FROM gallery_works
         WHERE published = 1 AND (images_json LIKE ? OR process_steps_json LIKE ?)
         LIMIT 1`
      )
      .get(`%${p}%`, `%${p}%`);
    return Boolean(byJson);
  } catch {
    return false;
  }
}

function getOwnedFavoriteImage(
  db: InstanceType<typeof Database>,
  favoriteId: string,
  userId: string
): string | null {
  const row = db
    .prepare(
      `SELECT thumbnail_path FROM canvas_generations
       WHERE id = ? AND user_id = ? AND favorited_at IS NOT NULL`
    )
    .get(favoriteId, userId) as { thumbnail_path: string } | undefined;
  if (!row) return null;
  return normalizeUploadPath(row.thumbnail_path) || null;
}

function getWorkForUser(
  db: InstanceType<typeof Database>,
  id: string,
  userId: string
): GalleryWorkRow | undefined {
  return db
    .prepare(`SELECT * FROM gallery_works WHERE id = ? AND user_id = ?`)
    .get(id, userId) as GalleryWorkRow | undefined;
}

function getWorkById(
  db: InstanceType<typeof Database>,
  id: string
): GalleryWorkRow | undefined {
  return db
    .prepare(
      `SELECT w.*, u.display_name AS owner_name
       FROM gallery_works w
       JOIN users u ON u.id = w.user_id
       WHERE w.id = ? AND u.disabled = 0`
    )
    .get(id) as GalleryWorkRow | undefined;
}

function favoriteCount(db: InstanceType<typeof Database>, workId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM gallery_favorites WHERE work_id = ?`)
    .get(workId) as { c: number };
  return Number(row?.c || 0);
}

function isFavoritedBy(
  db: InstanceType<typeof Database>,
  workId: string,
  userId: string
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM gallery_favorites WHERE work_id = ? AND user_id = ? LIMIT 1`
    )
    .get(workId, userId);
  return Boolean(row);
}

function withFavoriteMeta(
  db: InstanceType<typeof Database>,
  projectRoot: string,
  row: GalleryWorkRow,
  userId: string
): GalleryWorkDto {
  const dto = rowToDto(projectRoot, row);
  dto.favorite_count = favoriteCount(db, row.id);
  dto.favorited = isFavoritedBy(db, row.id, userId);
  return dto;
}

export function registerGalleryWorksRoutes(
  app: Express,
  db: InstanceType<typeof Database>,
  projectRoot: string
): void {
  const requireAuth = createRequireAuth(db);

  app.get("/api/gallery", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const rows = db
        .prepare(
          `SELECT w.*, u.display_name AS owner_name
           FROM gallery_works w
           JOIN users u ON u.id = w.user_id
           WHERE w.published = 1 AND u.disabled = 0
           ORDER BY COALESCE(w.published_at, w.updated_at) DESC
           LIMIT 300`
        )
        .all() as GalleryWorkRow[];

      const items = rows.map((row) => withFavoriteMeta(db, projectRoot, row, userId));

      // 兼容旧「收藏分享」条目（无分类，仅出现在「全部」）
      const legacy = db
        .prepare(
          `SELECT g.id, g.user_id, g.thumbnail_path, g.prompt, g.shared_at, g.created_at,
                  u.display_name AS owner_name
           FROM canvas_generations g
           JOIN users u ON u.id = g.user_id
           WHERE g.shared_at IS NOT NULL AND u.disabled = 0
             AND NOT EXISTS (
               SELECT 1 FROM gallery_works w WHERE w.source_favorite_id = g.id
             )
           ORDER BY g.shared_at DESC
           LIMIT 100`
        )
        .all() as Array<{
        id: string;
        user_id: string;
        thumbnail_path: string;
        prompt: string;
        shared_at: string | null;
        created_at: string;
        owner_name?: string;
      }>;

      for (const row of legacy) {
        const image = normalizeUploadPath(row.thumbnail_path) || row.thumbnail_path;
        const preview = resolveFullUploadPath(projectRoot, image);
        const title =
          String(row.prompt || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, TITLE_MAX) || "未命名作品";
        items.push({
          id: `legacy:${row.id}`,
          title,
          description: String(row.prompt || ""),
          category: "",
          image_path: image,
          images: [preview],
          process_steps: [],
          preview_path: preview,
          thumbnail_path: image,
          source_favorite_id: row.id,
          published: true,
          owner_name: row.owner_name,
          user_id: row.user_id,
          created_at: row.created_at,
          updated_at: row.shared_at || row.created_at,
          published_at: row.shared_at,
          favorited: false,
          favorite_count: 0,
          prompt: String(row.prompt || ""),
          model: "",
          shared_at: row.shared_at,
        });
      }

      items.sort((a, b) => {
        const ta = Date.parse(a.published_at || a.created_at) || 0;
        const tb = Date.parse(b.published_at || b.created_at) || 0;
        return tb - ta;
      });

      res.json({ items: items.slice(0, 300) });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "加载画廊失败" });
    }
  });

  app.get("/api/my-works", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const rows = db
        .prepare(
          `SELECT * FROM gallery_works
           WHERE user_id = ?
           ORDER BY updated_at DESC
           LIMIT 300`
        )
        .all(userId) as GalleryWorkRow[];
      res.json({
        items: rows.map((row) => withFavoriteMeta(db, projectRoot, row, userId)),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "加载作品失败" });
    }
  });

  /** 个人空间：从公共画廊收藏的他人作品 */
  app.get("/api/my-gallery-favorites", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const rows = db
        .prepare(
          `SELECT w.*, u.display_name AS owner_name, f.created_at AS favorited_at
           FROM gallery_favorites f
           JOIN gallery_works w ON w.id = f.work_id
           JOIN users u ON u.id = w.user_id
           WHERE f.user_id = ? AND w.published = 1 AND u.disabled = 0
           ORDER BY f.created_at DESC
           LIMIT 300`
        )
        .all(userId) as GalleryWorkRow[];
      res.json({
        items: rows.map((row) => {
          const dto = withFavoriteMeta(db, projectRoot, row, userId);
          dto.favorited = true;
          return dto;
        }),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "加载画廊收藏失败" });
    }
  });

  app.post("/api/gallery/works/:id/favorite", requireAuth, (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!id || id.startsWith("legacy:")) {
        return res.status(400).json({ error: "该作品暂不支持收藏" });
      }
      const userId = req.authUser!.id;
      const row = getWorkById(db, id);
      if (!row || Number(row.published) !== 1) {
        return res.status(404).json({ error: "作品不存在或未发布" });
      }

      const existing = db
        .prepare(
          `SELECT id FROM gallery_favorites WHERE user_id = ? AND work_id = ?`
        )
        .get(userId, id) as { id: string } | undefined;

      if (existing) {
        db.prepare(`DELETE FROM gallery_favorites WHERE id = ?`).run(existing.id);
        return res.json({
          ok: true,
          favorited: false,
          favorite_count: favoriteCount(db, id),
          item: withFavoriteMeta(db, projectRoot, row, userId),
        });
      }

      db.prepare(
        `INSERT INTO gallery_favorites (id, user_id, work_id) VALUES (?, ?, ?)`
      ).run(uuidv4(), userId, id);
      return res.json({
        ok: true,
        favorited: true,
        favorite_count: favoriteCount(db, id),
        item: withFavoriteMeta(db, projectRoot, getWorkById(db, id) || row, userId),
      });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : "收藏失败",
      });
    }
  });

  app.get("/api/gallery/works/:id", requireAuth, (req, res) => {
    const id = String(req.params.id || "");
    if (id.startsWith("legacy:")) {
      return res.status(404).json({ error: "旧分享条目请直接预览图片" });
    }
    const row = getWorkById(db, id);
    if (!row) return res.status(404).json({ error: "作品不存在" });
    if (Number(row.published) !== 1 && row.user_id !== req.authUser!.id) {
      return res.status(404).json({ error: "作品不存在" });
    }
    return res.json({
      item: withFavoriteMeta(db, projectRoot, row, req.authUser!.id),
    });
  });

  const handleUpsert = (mode: "create" | "update") => (req: Request, res: Response) => {
    imageUpload.fields([
      { name: "images", maxCount: MAX_IMAGES },
      { name: "step_images", maxCount: MAX_PROCESS_STEPS * MAX_IMAGES_PER_STEP },
    ])(req, res, (err) => {
      if (err) {
        const message = err instanceof Error ? err.message : "上传失败";
        return res.status(400).json({ error: message });
      }

      try {
        const userId = req.authUser!.id;
        const asDraft =
          /^(1|true|yes)$/i.test(String(req.body?.as_draft || "").trim());
        let title = parseTitle(req.body?.title);
        if (!title) {
          if (asDraft) title = "未命名草稿";
          else {
            return res.status(400).json({ error: `请填写作品名称（最多 ${TITLE_MAX} 字）` });
          }
        }
        const description = parseDescription(req.body?.description);
        let category = parseCategory(req.body?.category);
        if (!category) {
          if (asDraft) category = "original";
          else {
            return res.status(400).json({ error: "请选择作品分类" });
          }
        }

        let existing: GalleryWorkRow | undefined;
        if (mode === "update") {
          existing = getWorkForUser(db, String(req.params.id || ""), userId);
          if (!existing) return res.status(404).json({ error: "作品不存在" });
        }

        let keepPaths: string[] = [];
        try {
          const parsed = JSON.parse(String(req.body?.keep_paths || "[]")) as unknown;
          if (Array.isArray(parsed)) {
            keepPaths = parsed
              .map((x) => normalizeUploadPath(String(x || "")) || "")
              .filter(Boolean);
          }
        } catch {
          keepPaths = [];
        }

        let favoriteIds: string[] = [];
        try {
          const parsed = JSON.parse(String(req.body?.favorite_ids || "[]")) as unknown;
          if (Array.isArray(parsed)) {
            favoriteIds = parsed.map((x) => String(x || "").trim()).filter(Boolean);
          }
        } catch {
          favoriteIds = [];
        }
        const singleFav = String(req.body?.favorite_id || "").trim();
        if (singleFav && !favoriteIds.includes(singleFav)) favoriteIds.push(singleFav);

        const fileMap = (req.files || {}) as Record<string, Express.Multer.File[]>;
        const coverFiles = Array.isArray(fileMap.images) ? fileMap.images : [];
        const stepFiles = Array.isArray(fileMap.step_images) ? fileMap.step_images : [];

        const uploaded = coverFiles
          .filter((f) => f?.buffer?.length)
          .map((f) =>
            saveWorkImage(
              db,
              projectRoot,
              userId,
              f.buffer,
              (f.mimetype || "image/jpeg").toLowerCase()
            )
          );

        const fromFavs: string[] = [];
        for (const fid of favoriteIds) {
          const fromFav = getOwnedFavoriteImage(db, fid, userId);
          if (!fromFav) {
            return res.status(400).json({ error: "收藏不存在或无权使用" });
          }
          if (!fromFavs.includes(fromFav)) fromFavs.push(fromFav);
        }

        if (
          mode === "update" &&
          !keepPaths.length &&
          !uploaded.length &&
          !fromFavs.length &&
          existing
        ) {
          keepPaths = parseImagesJson(existing.images_json, existing.image_path);
        }

        const imagePaths = [...keepPaths, ...fromFavs, ...uploaded]
          .map((p) => normalizeUploadPath(p) || p)
          .filter(Boolean)
          .filter((p, i, arr) => arr.indexOf(p) === i)
          .slice(0, MAX_IMAGES);

        if (!imagePaths.length) {
          return res.status(400).json({ error: "请至少上传或导入一张图片" });
        }

        // process_steps:
        // 新格式 [{ note, images: [{ path?|favorite_id?|file?:true }, ...] }, ...]
        // 旧格式 [{ note, path?, favorite_id?, file?: true }, ...] 仍兼容（一步一图）
        type StepImageSpec = {
          path?: string;
          favorite_id?: string;
          file?: boolean;
        };
        type StepSpec = { note: string; images: StepImageSpec[] };
        let stepSpecs: StepSpec[] = [];
        try {
          const parsed = JSON.parse(String(req.body?.process_steps || "[]")) as unknown;
          if (Array.isArray(parsed)) {
            stepSpecs = parsed
              .filter((x) => x && typeof x === "object")
              .map((x) => {
                const row = x as Record<string, unknown>;
                const note = String(row.note || "")
                  .trim()
                  .slice(0, STEP_NOTE_MAX);
                let images: StepImageSpec[] = [];
                if (Array.isArray(row.images)) {
                  images = row.images
                    .filter((img) => img && typeof img === "object")
                    .map((img) => {
                      const item = img as Record<string, unknown>;
                      return {
                        path: String(item.path || "").trim() || undefined,
                        favorite_id: String(item.favorite_id || "").trim() || undefined,
                        file: Boolean(item.file),
                      };
                    })
                    .slice(0, MAX_IMAGES_PER_STEP);
                } else {
                  // legacy flat one-image step
                  images = [
                    {
                      path: String(row.path || "").trim() || undefined,
                      favorite_id: String(row.favorite_id || "").trim() || undefined,
                      file: Boolean(row.file),
                    },
                  ].filter((img) => img.file || img.path || img.favorite_id);
                }
                return { note, images };
              })
              .filter((s) => s.images.length > 0)
              .slice(0, MAX_PROCESS_STEPS);
          }
        } catch {
          stepSpecs = [];
        }

        let stepFileCursor = 0;
        const processSteps: GalleryProcessStep[] = [];
        for (const spec of stepSpecs) {
          const images: string[] = [];
          for (const imgSpec of spec.images) {
            let imagePath = "";
            if (imgSpec.file) {
              const f = stepFiles[stepFileCursor++];
              if (!f?.buffer?.length) {
                return res.status(400).json({ error: "创作过程步骤图片缺失" });
              }
              imagePath = saveWorkImage(
                db,
                projectRoot,
                userId,
                f.buffer,
                (f.mimetype || "image/jpeg").toLowerCase()
              );
            } else if (imgSpec.favorite_id) {
              const fromFav = getOwnedFavoriteImage(db, imgSpec.favorite_id, userId);
              if (!fromFav) {
                return res.status(400).json({ error: "创作过程引用的收藏无效" });
              }
              imagePath = fromFav;
            } else if (imgSpec.path) {
              imagePath = normalizeUploadPath(imgSpec.path) || "";
            }
            if (!imagePath) {
              return res.status(400).json({ error: "创作过程每张步骤图都需要有效来源" });
            }
            images.push(imagePath);
          }
          if (!images.length) {
            return res.status(400).json({ error: "创作过程每一步都需要至少一张图片" });
          }
          processSteps.push({
            image_path: images[0],
            images,
            note: spec.note,
          });
        }

        const processStepsJson = JSON.stringify(processSteps);

        const imagePath = imagePaths[0];
        const imagesJson = JSON.stringify(imagePaths);
        const favoriteId = favoriteIds[0] || null;

        if (existing) {
          const prev = parseImagesJson(existing.images_json, existing.image_path);
          const prevSteps = parseProcessStepsJson(existing.process_steps_json);
          const stillUsed = new Set([
            ...imagePaths,
            ...processSteps.flatMap((s) => stepImagePaths(s)),
          ]);
          for (const oldPath of [
            ...prev,
            ...prevSteps.flatMap((s) => stepImagePaths(s)),
          ]) {
            if (
              !stillUsed.has(oldPath) &&
              String(oldPath).startsWith("/uploads/gallery-works/")
            ) {
              removeLocalUpload(projectRoot, oldPath);
            }
          }
        }

        const now = new Date().toISOString();
        const publishedFlag = asDraft ? 0 : 1;
        const publishedAt = asDraft ? null : now;
        if (mode === "create") {
          const id = uuidv4();
          db.prepare(
            `INSERT INTO gallery_works
              (id, user_id, title, description, category, image_path, images_json, process_steps_json,
               source_favorite_id, published, created_at, updated_at, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id,
            userId,
            title,
            description,
            category,
            imagePath,
            imagesJson,
            processStepsJson,
            favoriteId,
            publishedFlag,
            now,
            now,
            publishedAt
          );
          if (!asDraft) {
            for (const fid of favoriteIds) {
              db.prepare(
                `UPDATE canvas_generations SET shared_at = COALESCE(shared_at, CURRENT_TIMESTAMP)
                 WHERE id = ? AND user_id = ?`
              ).run(fid, userId);
            }
          }
          const created = getWorkById(db, id);
          if (!created) return res.status(500).json({ error: "创建失败" });
          return res.json({
            ok: true,
            item: withFavoriteMeta(db, projectRoot, created, userId),
          });
        }

        db.prepare(
          `UPDATE gallery_works
           SET title = ?, description = ?, category = ?, image_path = ?, images_json = ?,
               process_steps_json = ?,
               source_favorite_id = COALESCE(?, source_favorite_id),
               published = ?,
               published_at = CASE
                 WHEN ? = 1 THEN COALESCE(published_at, ?)
                 ELSE published_at
               END,
               updated_at = ?
           WHERE id = ? AND user_id = ?`
        ).run(
          title,
          description,
          category,
          imagePath,
          imagesJson,
          processStepsJson,
          favoriteId,
          publishedFlag,
          publishedFlag,
          now,
          now,
          existing!.id,
          userId
        );
        if (!asDraft) {
          for (const fid of favoriteIds) {
            db.prepare(
              `UPDATE canvas_generations SET shared_at = COALESCE(shared_at, CURRENT_TIMESTAMP)
               WHERE id = ? AND user_id = ?`
            ).run(fid, userId);
          }
        }
        const updated = getWorkById(db, existing!.id);
        if (!updated) return res.status(500).json({ error: "更新失败" });
        return res.json({
          ok: true,
          item: withFavoriteMeta(db, projectRoot, updated, userId),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "发布失败";
        return res.status(400).json({ error: message });
      }
    });
  };

  app.post("/api/gallery/works", requireAuth, handleUpsert("create"));
  app.patch("/api/gallery/works/:id", requireAuth, handleUpsert("update"));

  app.delete("/api/gallery/works/:id", requireAuth, (req, res) => {
    try {
      const row = getWorkForUser(db, String(req.params.id || ""), req.authUser!.id);
      if (!row) return res.status(404).json({ error: "作品不存在" });
      const paths = [
        ...parseImagesJson(row.images_json, row.image_path),
        ...parseProcessStepsJson(row.process_steps_json).flatMap((s) => stepImagePaths(s)),
      ];
      db.prepare(`DELETE FROM gallery_favorites WHERE work_id = ?`).run(row.id);
      db.prepare(`DELETE FROM gallery_works WHERE id = ?`).run(row.id);
      for (const p of paths) {
        if (String(p).startsWith("/uploads/gallery-works/")) {
          removeLocalUpload(projectRoot, p);
        }
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "删除失败" });
    }
  });
}
