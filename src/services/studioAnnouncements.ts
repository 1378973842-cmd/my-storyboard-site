import type { Express, RequestHandler } from "express";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
  read: number;
};

export function initStudioAnnouncementsSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_studio_announcements_created ON studio_announcements(created_at DESC);

    CREATE TABLE IF NOT EXISTS studio_announcement_reads (
      user_id TEXT NOT NULL,
      announcement_id TEXT NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, announcement_id)
    );
  `);
}

export function registerStudioAnnouncementRoutes(
  app: Express,
  db: InstanceType<typeof Database>,
  requireAuth: RequestHandler,
  requireAdmin: RequestHandler
): void {
  app.get("/api/announcements", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const rows = db
        .prepare(
          `SELECT a.id, a.title, a.body, a.author_id, a.created_at,
                  u.display_name AS author_name,
                  CASE WHEN r.user_id IS NOT NULL THEN 1 ELSE 0 END AS read
           FROM studio_announcements a
           JOIN users u ON u.id = a.author_id
           LEFT JOIN studio_announcement_reads r
             ON r.announcement_id = a.id AND r.user_id = ?
           ORDER BY a.created_at DESC
           LIMIT 50`
        )
        .all(userId) as AnnouncementRow[];
      const unreadCount = rows.filter((r) => !r.read).length;
      res.json({ announcements: rows, unreadCount });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "加载公告失败" });
    }
  });

  app.post("/api/admin/announcements", requireAdmin, (req, res) => {
    try {
      const title = String(req.body?.title ?? "").trim();
      const body = String(req.body?.body ?? "").trim();
      if (!title) return res.status(400).json({ error: "标题不能为空" });
      if (!body) return res.status(400).json({ error: "正文不能为空" });
      if (title.length > 120) return res.status(400).json({ error: "标题过长（最多 120 字）" });
      if (body.length > 4000) return res.status(400).json({ error: "正文过长（最多 4000 字）" });

      const id = uuidv4();
      db.prepare(
        `INSERT INTO studio_announcements (id, title, body, author_id) VALUES (?, ?, ?, ?)`
      ).run(id, title, body, req.authUser!.id);
      const row = db
        .prepare(
          `SELECT a.id, a.title, a.body, a.author_id, a.created_at,
                  u.display_name AS author_name, 0 AS read
           FROM studio_announcements a
           JOIN users u ON u.id = a.author_id
           WHERE a.id = ?`
        )
        .get(id) as AnnouncementRow;
      res.json({ ok: true, announcement: row });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "发布公告失败" });
    }
  });

  app.post("/api/announcements/read-all", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      db.prepare(
        `INSERT OR IGNORE INTO studio_announcement_reads (user_id, announcement_id)
         SELECT ?, a.id FROM studio_announcements a`
      ).run(userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "全部已读失败" });
    }
  });

  app.post("/api/announcements/:id/read", requireAuth, (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "无效公告" });
      const exists = db.prepare("SELECT id FROM studio_announcements WHERE id = ?").get(id);
      if (!exists) return res.status(404).json({ error: "公告不存在" });
      db.prepare(
        `INSERT OR IGNORE INTO studio_announcement_reads (user_id, announcement_id) VALUES (?, ?)`
      ).run(req.authUser!.id, id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "标记已读失败" });
    }
  });
}
