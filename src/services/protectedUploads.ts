import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { existsSync } from "fs";
import path from "path";
import { canAccessUploadPath } from "./canvasGenerations.js";

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
