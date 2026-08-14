import type { Express, RequestHandler } from "express";
import type Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { recordFileOwnership } from "./canvasGenerations.js";

const KIND = new Set(["bug", "idea"]);
const ANON_LABEL = "匿名用户";
const TITLE_MAX = 80;
const BODY_MAX = 4000;
const COMMENT_MAX = 1000;
const IMAGES_MAX = 6;

type PostRow = {
  id: string;
  author_id: string;
  anonymous: number;
  kind: string;
  title: string;
  body: string;
  images_json: string;
  created_at: string;
  author_name: string;
  like_count: number;
  comment_count: number;
  liked: number;
};

type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  anonymous: number;
  body: string;
  created_at: string;
  author_name: string;
  like_count: number;
  liked: number;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: IMAGES_MAX },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    if (!mime.startsWith("image/")) {
      cb(new Error("仅支持图片"));
      return;
    }
    cb(null, true);
  },
});

function parseImages(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => String(x || "").trim())
      .filter((u) => u.startsWith("/uploads/voice/"))
      .slice(0, IMAGES_MAX);
  } catch {
    return [];
  }
}

function bool01(v: unknown): number {
  return v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
}

function publicPost(row: PostRow, viewerId: string, isAdmin: boolean) {
  const anonymous = Boolean(row.anonymous);
  const mine = row.author_id === viewerId;
  return {
    id: row.id,
    kind: row.kind === "idea" ? "idea" : "bug",
    title: row.title,
    body: row.body,
    images: parseImages(row.images_json),
    created_at: row.created_at,
    anonymous,
    author_label: anonymous ? ANON_LABEL : row.author_name || "成员",
    is_mine: mine,
    can_delete: canDeleteVoice(row.author_id, viewerId, isAdmin),
    like_count: Number(row.like_count) || 0,
    liked: Boolean(row.liked),
    comment_count: Number(row.comment_count) || 0,
  };
}

function publicComment(row: CommentRow, viewerId: string, isAdmin: boolean) {
  const anonymous = Boolean(row.anonymous);
  const mine = row.author_id === viewerId;
  return {
    id: row.id,
    post_id: row.post_id,
    body: row.body,
    created_at: row.created_at,
    anonymous,
    author_label: anonymous ? ANON_LABEL : row.author_name || "成员",
    is_mine: mine,
    can_delete: canDeleteVoice(row.author_id, viewerId, isAdmin),
    like_count: Number(row.like_count) || 0,
    liked: Boolean(row.liked),
  };
}

/** 作者本人可删；管理员可管理删除。其它人不能删。匿名发声仍记 author_id。 */
export function canDeleteVoice(authorId: string, viewerId: string, isAdmin: boolean): boolean {
  if (!authorId || !viewerId) return false;
  return authorId === viewerId || isAdmin;
}

export function initStudioVoiceBoardSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_voice_posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      anonymous INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      images_json TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_studio_voice_posts_created ON studio_voice_posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_studio_voice_posts_kind ON studio_voice_posts(kind);

    CREATE TABLE IF NOT EXISTS studio_voice_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      anonymous INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_studio_voice_comments_post ON studio_voice_comments(post_id, created_at);

    CREATE TABLE IF NOT EXISTS studio_voice_likes (
      user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, target_type, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_studio_voice_likes_target ON studio_voice_likes(target_type, target_id);
  `);
}

export function registerStudioVoiceBoardRoutes(
  app: Express,
  db: InstanceType<typeof Database>,
  requireAuth: RequestHandler,
  requireAdmin: RequestHandler,
  projectRoot: string
): void {
  const uploadsDir = path.join(projectRoot, "public", "uploads", "voice");
  mkdirSync(uploadsDir, { recursive: true });

  const postSelect = `
    SELECT p.id, p.author_id, p.anonymous, p.kind, p.title, p.body, p.images_json, p.created_at,
           u.display_name AS author_name,
           (SELECT COUNT(*) FROM studio_voice_likes l WHERE l.target_type='post' AND l.target_id=p.id) AS like_count,
           (SELECT COUNT(*) FROM studio_voice_comments c WHERE c.post_id=p.id) AS comment_count,
           CASE WHEN EXISTS(
             SELECT 1 FROM studio_voice_likes l
             WHERE l.target_type='post' AND l.target_id=p.id AND l.user_id=?
           ) THEN 1 ELSE 0 END AS liked
    FROM studio_voice_posts p
    JOIN users u ON u.id = p.author_id
  `;

  const commentSelect = `
    SELECT c.id, c.post_id, c.author_id, c.anonymous, c.body, c.created_at,
           u.display_name AS author_name,
           (SELECT COUNT(*) FROM studio_voice_likes l WHERE l.target_type='comment' AND l.target_id=c.id) AS like_count,
           CASE WHEN EXISTS(
             SELECT 1 FROM studio_voice_likes l
             WHERE l.target_type='comment' AND l.target_id=c.id AND l.user_id=?
           ) THEN 1 ELSE 0 END AS liked
    FROM studio_voice_comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `;

  app.get("/api/voice-posts", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const isAdmin = req.authUser!.role === "admin";
      const sort = String(req.query.sort || "new") === "likes" ? "likes" : "new";
      const kind = String(req.query.kind || "").trim();
      const order =
        sort === "likes"
          ? "like_count DESC, p.created_at DESC"
          : "p.created_at DESC";
      const kindSql = KIND.has(kind) ? "WHERE p.kind = ?" : "";
      const args = KIND.has(kind) ? [userId, kind] : [userId];
      const rows = db
        .prepare(`${postSelect} ${kindSql} ORDER BY ${order} LIMIT 80`)
        .all(...args) as PostRow[];
      res.json({ posts: rows.map((r) => publicPost(r, userId, isAdmin)) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "加载失败" });
    }
  });

  app.get("/api/voice-posts/:id", requireAuth, (req, res) => {
    try {
      const userId = req.authUser!.id;
      const isAdmin = req.authUser!.role === "admin";
      const id = String(req.params.id || "").trim();
      const post = db.prepare(`${postSelect} WHERE p.id = ?`).get(userId, id) as PostRow | undefined;
      if (!post) return res.status(404).json({ error: "帖子不存在" });
      const comments = db.prepare(commentSelect).all(userId, id) as CommentRow[];
      res.json({
        post: publicPost(post, userId, isAdmin),
        comments: comments.map((c) => publicComment(c, userId, isAdmin)),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "加载失败" });
    }
  });

  app.post("/api/voice-posts/upload", requireAuth, (req, res) => {
    upload.array("files", IMAGES_MAX)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err instanceof Error ? err.message : "上传失败" });
      try {
        const files = (req.files as Express.Multer.File[]) || [];
        const uploaded: { url: string }[] = [];
        for (const file of files) {
          if (!file?.buffer?.length) continue;
          const mime = String(file.mimetype || "").toLowerCase();
          const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
          const filename = `voice_${uuidv4().replace(/-/g, "").slice(0, 12)}${ext}`;
          writeFileSync(path.join(uploadsDir, filename), file.buffer);
          const url = `/uploads/voice/${filename}`;
          recordFileOwnership(db, url, req.authUser!.id);
          uploaded.push({ url });
        }
        res.json({ files: uploaded });
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : "上传失败" });
      }
    });
  });

  app.post("/api/voice-posts", requireAuth, (req, res) => {
    try {
      const title = String(req.body?.title ?? "").trim();
      const body = String(req.body?.body ?? "").trim();
      const kind = String(req.body?.kind ?? "bug").trim() === "idea" ? "idea" : "bug";
      const anonymous = bool01(req.body?.anonymous);
      const images = Array.isArray(req.body?.images)
        ? (req.body.images as unknown[])
            .map((u) => String(u || "").trim())
            .filter((u) => u.startsWith("/uploads/voice/"))
            .slice(0, IMAGES_MAX)
        : [];
      if (!title) return res.status(400).json({ error: "请写一个标题" });
      if (!body) return res.status(400).json({ error: "请描述一下问题和建议" });
      if (title.length > TITLE_MAX) return res.status(400).json({ error: `标题最多 ${TITLE_MAX} 字` });
      if (body.length > BODY_MAX) return res.status(400).json({ error: `正文最多 ${BODY_MAX} 字` });
      const id = uuidv4();
      db.prepare(
        `INSERT INTO studio_voice_posts (id, author_id, anonymous, kind, title, body, images_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.authUser!.id, anonymous, kind, title, body, JSON.stringify(images));
      const row = db.prepare(`${postSelect} WHERE p.id = ?`).get(req.authUser!.id, id) as PostRow;
      res.json({ post: publicPost(row, req.authUser!.id, req.authUser!.role === "admin") });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "发布失败" });
    }
  });

  app.delete("/api/voice-posts/:id", requireAuth, (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const row = db.prepare("SELECT author_id FROM studio_voice_posts WHERE id = ?").get(id) as
        | { author_id: string }
        | undefined;
      if (!row) return res.status(404).json({ error: "帖子不存在" });
      const isAdmin = req.authUser!.role === "admin";
      if (!canDeleteVoice(row.author_id, req.authUser!.id, isAdmin)) {
        return res.status(403).json({ error: "只能删除自己的发声" });
      }
      const comments = db.prepare("SELECT id FROM studio_voice_comments WHERE post_id = ?").all(id) as Array<{
        id: string;
      }>;
      const delLike = db.prepare("DELETE FROM studio_voice_likes WHERE target_type = ? AND target_id = ?");
      delLike.run("post", id);
      comments.forEach((c) => delLike.run("comment", c.id));
      db.prepare("DELETE FROM studio_voice_comments WHERE post_id = ?").run(id);
      db.prepare("DELETE FROM studio_voice_posts WHERE id = ?").run(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "删除失败" });
    }
  });

  const toggleLike = (targetType: "post" | "comment", targetId: string, userId: string) => {
    const exists = db
      .prepare("SELECT 1 FROM studio_voice_likes WHERE user_id=? AND target_type=? AND target_id=?")
      .get(userId, targetType, targetId);
    if (exists) {
      db.prepare("DELETE FROM studio_voice_likes WHERE user_id=? AND target_type=? AND target_id=?").run(
        userId,
        targetType,
        targetId
      );
      return false;
    }
    db.prepare("INSERT INTO studio_voice_likes (user_id, target_type, target_id) VALUES (?, ?, ?)").run(
      userId,
      targetType,
      targetId
    );
    return true;
  };

  app.post("/api/voice-posts/:id/like", requireAuth, (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const exists = db.prepare("SELECT id FROM studio_voice_posts WHERE id = ?").get(id);
      if (!exists) return res.status(404).json({ error: "帖子不存在" });
      const liked = toggleLike("post", id, req.authUser!.id);
      const like_count = (
        db.prepare("SELECT COUNT(*) AS n FROM studio_voice_likes WHERE target_type='post' AND target_id=?").get(id) as {
          n: number;
        }
      ).n;
      res.json({ liked, like_count });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "点赞失败" });
    }
  });

  app.post("/api/voice-posts/:id/comments", requireAuth, (req, res) => {
    try {
      const postId = String(req.params.id || "").trim();
      const exists = db.prepare("SELECT id FROM studio_voice_posts WHERE id = ?").get(postId);
      if (!exists) return res.status(404).json({ error: "帖子不存在" });
      const body = String(req.body?.body ?? "").trim();
      if (!body) return res.status(400).json({ error: "评论不能为空" });
      if (body.length > COMMENT_MAX) return res.status(400).json({ error: `评论最多 ${COMMENT_MAX} 字` });
      const id = uuidv4();
      db.prepare(
        `INSERT INTO studio_voice_comments (id, post_id, author_id, anonymous, body) VALUES (?, ?, ?, ?, ?)`
      ).run(id, postId, req.authUser!.id, bool01(req.body?.anonymous), body);
      const row = db
        .prepare(
          `SELECT c.id, c.post_id, c.author_id, c.anonymous, c.body, c.created_at,
                  u.display_name AS author_name,
                  (SELECT COUNT(*) FROM studio_voice_likes l WHERE l.target_type='comment' AND l.target_id=c.id) AS like_count,
                  CASE WHEN EXISTS(
                    SELECT 1 FROM studio_voice_likes l
                    WHERE l.target_type='comment' AND l.target_id=c.id AND l.user_id=?
                  ) THEN 1 ELSE 0 END AS liked
           FROM studio_voice_comments c
           JOIN users u ON u.id = c.author_id
           WHERE c.id = ?`
        )
        .get(req.authUser!.id, id) as CommentRow;
      res.json({ comment: publicComment(row, req.authUser!.id, req.authUser!.role === "admin") });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "评论失败" });
    }
  });

  app.delete("/api/voice-comments/:id", requireAuth, (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const row = db.prepare("SELECT author_id FROM studio_voice_comments WHERE id = ?").get(id) as
        | { author_id: string }
        | undefined;
      if (!row) return res.status(404).json({ error: "评论不存在" });
      if (!canDeleteVoice(row.author_id, req.authUser!.id, req.authUser!.role === "admin")) {
        return res.status(403).json({ error: "只能删除自己的评论" });
      }
      db.prepare("DELETE FROM studio_voice_likes WHERE target_type='comment' AND target_id=?").run(id);
      db.prepare("DELETE FROM studio_voice_comments WHERE id = ?").run(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "删除失败" });
    }
  });

  app.post("/api/voice-comments/:id/like", requireAuth, (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const exists = db.prepare("SELECT id FROM studio_voice_comments WHERE id = ?").get(id);
      if (!exists) return res.status(404).json({ error: "评论不存在" });
      const liked = toggleLike("comment", id, req.authUser!.id);
      const like_count = (
        db
          .prepare("SELECT COUNT(*) AS n FROM studio_voice_likes WHERE target_type='comment' AND target_id=?")
          .get(id) as { n: number }
      ).n;
      res.json({ liked, like_count });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "点赞失败" });
    }
  });

  void requireAdmin;
}
