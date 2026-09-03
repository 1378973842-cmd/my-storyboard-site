import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { existsSync } from "fs";
import path from "path";
import { canAccessUploadPath } from "./canvasGenerations.js";
import { headUploadsObject, isOssEnabled, streamUploadsObject } from "./ossStore.js";

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
      res.setHeader("Cache-Control", "private, max-age=3600");
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
    res.setHeader("Cache-Control", "private, max-age=3600");
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
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.type(guessContentType(abs));
  res.sendFile(abs);
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
