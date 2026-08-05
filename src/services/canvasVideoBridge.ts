import type { Express, Request, RequestHandler, Response } from "express";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { isHailuoH3Model, runHailuoH3VideoJob } from "./runningHubHailuoVideo.js";

export type CanvasVideoPayload = {
  prompt?: string;
  provider_id?: string;
  model?: string;
  duration?: number | string;
  aspect_ratio?: string;
  resolution?: string;
  images?: Array<{ url?: string; role?: string } | string>;
  videos?: string[];
  audios?: string[];
  enhance_prompt?: boolean;
  enable_upsample?: boolean;
  watermark?: boolean;
  camerafixed?: boolean;
  generate_audio?: boolean;
};

type CanvasVideoBridgeDeps = {
  projectRoot: string;
  requireGate?: RequestHandler;
  /** 可选：登记文件归属 */
  onPersisted?: (localUrl: string, req: Request) => void;
};

function collectUrls(list: CanvasVideoPayload["images"]): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
    else if (item && typeof item === "object" && typeof item.url === "string" && item.url.trim()) {
      out.push(item.url.trim());
    }
  }
  return out;
}

async function persistRemoteVideo(url: string, projectRoot: string): Promise<string> {
  const input = String(url || "").trim();
  if (!input) throw new Error("空视频 URL");
  if (input.startsWith("/uploads/")) return input;

  const uploadsDir = path.join(projectRoot, "public", "uploads", "canvas");
  mkdirSync(uploadsDir, { recursive: true });

  const maxBytes = Number(process.env.UPSTREAM_VIDEO_PROXY_MAX_BYTES || 200 * 1024 * 1024);
  const timeoutMs = Number(process.env.UPSTREAM_VIDEO_PROXY_TIMEOUT_MS || 300000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(input, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`下载视频失败 (${res.status})`);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const arr = await res.arrayBuffer();
    if (arr.byteLength <= 0) throw new Error("上游视频为空");
    if (arr.byteLength > maxBytes) {
      throw new Error(`视频过大（上限 ${(maxBytes / (1024 * 1024)).toFixed(0)} MB）`);
    }
    let ext = ".mp4";
    try {
      const pathname = new URL(input).pathname.toLowerCase();
      if (pathname.endsWith(".webm")) ext = ".webm";
      else if (pathname.endsWith(".mov")) ext = ".mov";
      else if (pathname.endsWith(".mp4")) ext = ".mp4";
    } catch {
      /* ignore */
    }
    if (ct.includes("webm")) ext = ".webm";
    else if (ct.includes("quicktime") || ct.includes("mov")) ext = ".mov";

    const filename = `video_${uuidv4().replace(/-/g, "").slice(0, 16)}${ext}`;
    const abs = path.join(uploadsDir, filename);
    writeFileSync(abs, Buffer.from(arr));
    return `/uploads/canvas/${filename}`;
  } finally {
    clearTimeout(timer);
  }
}

async function handleCanvasVideo(
  req: Request,
  res: Response,
  deps: CanvasVideoBridgeDeps
): Promise<void> {
  const payload = (req.body || {}) as CanvasVideoPayload;
  const prompt = String(payload.prompt || "").trim();
  const model = String(payload.model || "").trim();

  if (!prompt) {
    res.status(400).json({ error: "缺少 prompt" });
    return;
  }

  if (!isHailuoH3Model(model)) {
    res.status(501).json({
      error: `视频模型「${model || "(空)"}」尚未接入本站。当前已支持：hailuo-h3（RunningHub 海螺 H3）。`,
    });
    return;
  }

  try {
    const images = collectUrls(payload.images);
    const videos = Array.isArray(payload.videos)
      ? payload.videos.map((v) => String(v || "").trim()).filter(Boolean)
      : [];
    const audios = Array.isArray(payload.audios)
      ? payload.audios.map((v) => String(v || "").trim()).filter(Boolean)
      : [];

    console.log("[canvas-video/hailuo-h3]", {
      images: images.length,
      videos: videos.length,
      audios: audios.length,
      resolution: payload.resolution,
      duration: payload.duration,
      ratio: payload.aspect_ratio,
    });

    const upstreamUrl = await runHailuoH3VideoJob({
      prompt,
      images,
      videos,
      audios,
      resolution: payload.resolution,
      duration: payload.duration,
      ratio: payload.aspect_ratio,
      projectRoot: deps.projectRoot,
    });

    const localUrl = await persistRemoteVideo(upstreamUrl, deps.projectRoot);
    deps.onPersisted?.(localUrl, req);

    console.log("[canvas-video/hailuo-h3] done", {
      localUrl,
      upstream: String(upstreamUrl || "").slice(0, 120),
    });

    res.json({
      videos: [{ url: localUrl, kind: "video" }],
      url: localUrl,
      model: "hailuo-h3",
      upstream_url: upstreamUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[canvas-video] failed:", msg);
    res.status(502).json({ error: msg });
  }
}

export function registerCanvasVideoRoutes(app: Express, deps: CanvasVideoBridgeDeps): void {
  const gate = deps.requireGate;
  const handlers: RequestHandler[] = [
    ...(gate ? [gate] : []),
    (req, res) => {
      void handleCanvasVideo(req, res, deps);
    },
  ];
  app.post("/api/canvas-video", ...handlers);
}
