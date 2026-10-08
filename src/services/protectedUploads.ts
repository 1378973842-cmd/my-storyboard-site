import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { existsSync } from "fs";
import path from "path";
import { canAccessUploadPath, ensureGalleryThumbnail, recordFileOwnership } from "./canvasGenerations.js";
import {
  ensureOssBucketCors,
  headUploadsObject,
  isOssEnabled,
  signUploadsPutUrl,
  signUploadsUrl,
  signedReadExpiryMs,
  streamUploadsObject,
} from "./ossStore.js";
import { randomUUID } from "crypto";

function uploadsAbsPath(projectRoot: string, webPath: string): string | null {
  const rel = String(webPath || "")
    .replace(/^\/uploads\//, "")
    .replace(/\\/g, "/");
  if (!rel || rel.includes("..")) return null;
  const abs = path.join(projectRoot, "public", "uploads", rel);
  const root = path.join(projectRoot, "public", "uploads");
  if (!abs.startsWith(root)) return null;
  return abs;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
  };
  return map[ext] || "application/octet-stream";
}

const PRESIGN_MAX_BYTES = 80 * 1024 * 1024;

function canvasUploadKind(mimeRaw: string, name: string): { kind: string; ext: string } {
  const mime = String(mimeRaw || "").toLowerCase();
  let ext = path.extname(name || "").toLowerCase();
  if (mime.startsWith("video/") || [".mp4", ".webm", ".mov", ".m4v"].includes(ext)) {
    return { kind: "video", ext: ext || ".mp4" };
  }
  if (mime.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".aac", ".ogg"].includes(ext)) {
    return { kind: "audio", ext: ext || ".mp3" };
  }
  if (!ext || ![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) ext = ".png";
  return { kind: "image", ext };
}

function serveProtectedUpload(
  db: InstanceType<typeof Database>,
  projectRoot: string,
  req: Request,
  res: Response
): void {
  const webPath = req.path.startsWith("/uploads/") ? req.path : `/uploads${req.path}`;
  const userId = req.authUser?.id ?? null;
  if (!canAccessUploadPath(db, webPath, userId)) {
    res.status(403).json({ error: "无权访问该文件" });
    return;
  }
  // 必须同源输出：302 到 OSS 签名 URL 会让 <img>/<video> 跨域，canvas toBlob/画笔/截帧全部失败。
  // 本地有文件走 sendFile（支持 Range）；否则把 OSS 流经本站发出（同样支持 Range）。
  const abs = uploadsAbsPath(projectRoot, webPath);
  if (abs && existsSync(abs)) {
    serveLocalFallback(res, projectRoot, webPath);
    return;
  }
  if (!isOssEnabled()) {
    res.status(404).json({ error: "文件不存在" });
    return;
  }
  void serveOssProxy(req, res, projectRoot, webPath);
}

async function serveOssProxy(
  req: Request,
  res: Response,
  projectRoot: string,
  webPath: string
): Promise<void> {
  try {
    if (req.method === "HEAD") {
      const meta = await headUploadsObject(projectRoot, webPath);
      if (!meta) {
        res.status(404).json({ error: "文件不存在" });
        return;
      }
      res.setHeader("Cache-Control", cacheControlForUpload(webPath));
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", meta.mime || guessContentType(webPath));
      if (meta.size > 0) res.setHeader("Content-Length", String(meta.size));
      res.status(200).end();
      return;
    }
    const range = typeof req.headers.range === "string" ? req.headers.range : "";
    const got = await streamUploadsObject(webPath, range ? { range } : undefined);
    if (!got?.stream) {
      res.status(404).json({ error: "文件不存在" });
      return;
    }
    const mime = got.headers["content-type"] || got.headers["Content-Type"] || guessContentType(webPath);
    const length = got.headers["content-length"] || got.headers["Content-Length"];
    const contentRange = got.headers["content-range"] || got.headers["Content-Range"];
    res.status(got.status === 206 || contentRange ? 206 : 200);
    res.setHeader("Cache-Control", cacheControlForUpload(webPath));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", mime);
    if (length) res.setHeader("Content-Length", length);
    if (contentRange) res.setHeader("Content-Range", contentRange);
    req.on("close", () => {
      try {
        (got.stream as { destroy?: () => void }).destroy?.();
      } catch {
        /* ignore */
      }
    });
    got.stream.pipe(res);
  } catch (err) {
    console.warn("[uploads] OSS 读取失败", (err as Error)?.message);
    if (!res.headersSent) res.status(404).json({ error: "文件不存在" });
  }
}

function serveLocalFallback(
  res: Response,
  projectRoot: string,
  webPath: string
): void {
  const abs = uploadsAbsPath(projectRoot, webPath);
  if (!abs || !existsSync(abs)) {
    res.status(404).json({ error: "文件不存在" });
    return;
  }
  res.setHeader("Cache-Control", cacheControlForUpload(webPath));
  res.type(guessContentType(abs));
  res.sendFile(abs);
}

/** 缩略图文件名稳定，可以缓存一周；其它素材仍 1 小时。 */
function cacheControlForUpload(webPath: string): string {
  if (webPath.includes("/gallery/") && webPath.endsWith("_thumb.webp")) {
    return "private, max-age=604800";
  }
  return "private, max-age=3600";
}

function signedReadForPath(webPath: string): { url: string; via: "oss" | "local"; exp: number } {
  if (!isOssEnabled()) {
    return { url: webPath, via: "local", exp: Date.now() + 8 * 1000 };
  }
  try {
    return { url: signUploadsUrl(webPath), via: "oss", exp: signedReadExpiryMs() };
  } catch (err) {
    console.warn("[uploads/signed]", (err as Error)?.message);
    return { url: webPath, via: "local", exp: Date.now() + 8 * 1000 };
  }
}

/**
 * 登录后可访问 /uploads/*；按 file_ownership / 公共画廊 shared_at 校验。
 * 须在 express.static(public) 之前注册。
 */
export function registerProtectedUploadRoutes(
  app: Express,
  db: InstanceType<typeof Database>,
  projectRoot: string,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void
): void {
  void ensureOssBucketCors();

  /** 灯箱/预览用：签名直链让浏览器打阿里云，避免 2G ECS 转发整图。画笔/裁剪仍走同源 /uploads。 */
  app.get("/api/uploads/signed", requireAuth, (req, res) => {
    const raw = String(req.query.path || req.query.url || "").trim();
    const webPath = raw.split("?")[0];
    if (!webPath.startsWith("/uploads/") || webPath.includes("..")) {
      res.status(400).json({ error: "bad path" });
      return;
    }
    const userId = req.authUser?.id ?? null;
    if (!canAccessUploadPath(db, webPath, userId)) {
      res.status(403).json({ error: "无权访问该文件" });
      return;
    }
    const signed = signedReadForPath(webPath);
    res.json({ url: signed.url, via: signed.via, exp: signed.exp });
  });

  /** 开板：视口内缩略图一次签名，避免每张图各打一趟。 */
  app.post("/api/uploads/signed-batch", requireAuth, (req, res) => {
    const rawPaths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const userId = req.authUser?.id ?? null;
    const urls: Record<string, string> = {};
    let exp = Date.now() + 8 * 1000;
    let via: "oss" | "local" = "local";
    for (const raw of rawPaths.slice(0, 80)) {
      const webPath = String(raw || "").trim().split("?")[0];
      if (!webPath.startsWith("/uploads/") || webPath.includes("..")) continue;
      if (!canAccessUploadPath(db, webPath, userId)) continue;
      const signed = signedReadForPath(webPath);
      urls[webPath] = signed.url;
      via = signed.via;
      exp = signed.exp;
    }
    res.json({ urls, via, exp });
  });

  app.post("/api/uploads/presign", requireAuth, (req, res) => {
    const name = String(req.body?.name || "file").slice(0, 180);
    const mime = String(req.body?.mime || "application/octet-stream").slice(0, 120);
    const size = Number(req.body?.size || 0);
    if (size > PRESIGN_MAX_BYTES) {
      res.status(413).json({ error: "file too large" });
      return;
    }
    const { kind, ext } = canvasUploadKind(mime, name);
    const filename = `canvas_${randomUUID().replace(/-/g, "").slice(0, 12)}${ext}`;
    const webPath = `/uploads/canvas/${filename}`;
    const userId = req.authUser?.id;
    if (userId) recordFileOwnership(db, webPath, userId);
    if (!isOssEnabled()) {
      res.json({ via: "local", path: webPath, kind });
      return;
    }
    try {
      const contentType = mime || guessContentType(webPath);
      res.json({
        via: "oss",
        path: webPath,
        kind,
        contentType,
        putUrl: signUploadsPutUrl(webPath, { mime: contentType }),
      });
    } catch (err) {
      console.warn("[uploads/presign]", (err as Error)?.message);
      res.json({ via: "local", path: webPath, kind });
    }
  });

  app.post("/api/uploads/complete", requireAuth, (req, res) => {
    const webPath = String(req.body?.path || "").split("?")[0];
    const name = String(req.body?.name || "").slice(0, 180);
    if (!webPath.startsWith("/uploads/canvas/") || webPath.includes("..")) {
      res.status(400).json({ error: "bad path" });
      return;
    }
    const userId = req.authUser?.id ?? null;
    if (!canAccessUploadPath(db, webPath, userId)) {
      res.status(403).json({ error: "无权访问该文件" });
      return;
    }
    const { kind } = canvasUploadKind("", webPath);
    if (kind === "image") {
      void ensureGalleryThumbnail(projectRoot, webPath).catch((e) => {
        console.warn("[uploads/complete] thumb", (e as Error)?.message);
      });
    }
    res.json({ url: webPath, name: name || path.basename(webPath), kind });
  });

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path !== "/uploads" && !req.path.startsWith("/uploads/")) return next();
    return requireAuth(req, res, () => serveProtectedUpload(db, projectRoot, req, res));
  });
}

/** 静态资源中间件：跳过 /uploads（由 registerProtectedUploadRoutes 处理） */
export function publicStaticExceptUploads(projectRoot: string) {
  const publicRoot = path.join(projectRoot, "public");
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/uploads" || req.path.startsWith("/uploads/")) {
      return next();
    }
    return express.static(publicRoot)(req, res, next);
  };
}
