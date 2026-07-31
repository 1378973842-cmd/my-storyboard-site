import type { Express, RequestHandler } from "express";
import type Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { recordFileOwnership } from "./canvasGenerations.js";

export type HomeCarouselRow = {
  id: string;
  image_url: string;
  sort: number;
  created_at: string;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 24 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    if (!mime.startsWith("image/")) {
      cb(new Error("仅支持图片文件"));
      return;
    }
    cb(null, true);
  },
});

function extFromMime(mime: string): string {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  return ".jpg";
}

function listItems(db: InstanceType<typeof Database>): HomeCarouselRow[] {
  return db
    .prepare(
      `SELECT id, image_url, sort, created_at
       FROM home_carousel
       ORDER BY sort ASC, created_at DESC
       LIMIT 60`
    )
    .all() as HomeCarouselRow[];
}

function replaceAllUrls(
  db: InstanceType<typeof Database>,
  urls: string[]
): HomeCarouselRow[] {
  const tx = db.transaction((imageUrls: string[]) => {
    db.prepare(`DELETE FROM home_carousel`).run();
    const insert = db.prepare(
      `INSERT INTO home_carousel (id, image_url, sort) VALUES (?, ?, ?)`
    );
    imageUrls.forEach((url, index) => {
      insert.run(uuidv4(), url, index + 1);
    });
  });
  tx(urls);
  return listItems(db);
}

export function initHomeCarouselSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_carousel (
      id TEXT PRIMARY KEY,
      image_url TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_home_carousel_sort ON home_carousel(sort ASC, created_at DESC);
  `);
}

export function registerHomeCarouselRoutes(
  app: Express,
  db: InstanceType<typeof Database>,
  requireAdmin: RequestHandler,
  projectRoot: string
): void {
  app.get("/api/home-carousel", (_req, res) => {
    try {
      res.json({ items: listItems(db) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "加载轮播失败" });
    }
  });

  app.post("/api/admin/home-carousel/upload", requireAdmin, (req, res) => {
    upload.array("images", 24)(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : "上传失败" });
      }
      try {
        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) return res.status(400).json({ error: "请拖入或选择图片" });
        const dir = path.join(projectRoot, "public", "uploads", "home-carousel");
        mkdirSync(dir, { recursive: true });
        const urls: string[] = [];
        for (const file of files) {
          const mime = String(file.mimetype || "image/jpeg").toLowerCase();
          const filename = `${uuidv4().replace(/-/g, "")}${extFromMime(mime)}`;
          writeFileSync(path.join(dir, filename), file.buffer);
          const url = `/uploads/home-carousel/${filename}`;
          recordFileOwnership(db, url, req.authUser!.id);
          urls.push(url);
        }
        res.json({ ok: true, urls });
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : "上传失败" });
      }
    });
  });

  /** 整表替换：拖入草稿后点「更新」发布到主页 */
  app.put("/api/admin/home-carousel", requireAdmin, (req, res) => {
    try {
      const raw = Array.isArray(req.body?.image_urls) ? req.body.image_urls : [];
      const urls = raw
        .map((u: unknown) => String(u || "").trim())
        .filter((u: string) => u.length > 0 && u.length <= 2000);
      for (const url of urls) {
        if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
          return res.status(400).json({ error: "图片地址无效" });
        }
      }
      if (urls.length > 60) return res.status(400).json({ error: "最多 60 张" });
      const items = replaceAllUrls(db, urls);
      res.json({ ok: true, items });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "更新轮播失败" });
    }
  });

  app.post("/api/admin/home-carousel", requireAdmin, (req, res) => {
    try {
      const imageUrl = String(req.body?.image_url ?? "").trim();
      if (!imageUrl) return res.status(400).json({ error: "图片 URL 不能为空" });
      if (imageUrl.length > 2000) return res.status(400).json({ error: "URL 过长" });
      if (!/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith("/")) {
        return res.status(400).json({ error: "请使用 http(s) 或站点相对路径" });
      }

      const maxSort = db.prepare("SELECT COALESCE(MAX(sort), 0) AS m FROM home_carousel").get() as {
        m: number;
      };
      const id = uuidv4();
      const sort = Number(maxSort?.m || 0) + 1;
      db.prepare(`INSERT INTO home_carousel (id, image_url, sort) VALUES (?, ?, ?)`).run(
        id,
        imageUrl,
        sort
      );
      const row = db
        .prepare(`SELECT id, image_url, sort, created_at FROM home_carousel WHERE id = ?`)
        .get(id) as HomeCarouselRow;
      res.json({ ok: true, item: row });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "添加轮播失败" });
    }
  });

  app.delete("/api/admin/home-carousel/:id", requireAdmin, (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "无效条目" });
      const result = db.prepare(`DELETE FROM home_carousel WHERE id = ?`).run(id);
      if (!result.changes) return res.status(404).json({ error: "条目不存在" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "删除失败" });
    }
  });
}
