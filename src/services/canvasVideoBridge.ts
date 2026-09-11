import type { Express, Request, RequestHandler, Response } from "express";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { HAILUO_H3_MODEL_ID, isHailuoH3Model, runHailuoH3VideoJob } from "./runningHubHailuoVideo.js";
import {
  SEEDANCE_2_MODEL_ID,
  isSparkVideo20Model,
  runSparkVideo20Job,
} from "./runningHubSparkVideo.js";

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
  real_person_mode?: boolean;
  seed?: number;
};

type CanvasVideoPersistMeta = {
  prompt?: string;
  model?: string;
  duration?: number | string;
  aspect_ratio?: string;
  resolution?: string;
};

type CanvasVideoBridgeDeps = {
  projectRoot: string;
  requireGate?: RequestHandler;
  /** 可选：登记文件归属 / 写入生成历史 */
  onPersisted?: (localUrl: string, req: Request, meta?: CanvasVideoPersistMeta) => void;
};

type CanvasVideoResult = {
  videos: Array<{ url: string; kind: "video" }>;
  url: string;
  model: string;
  upstream_url?: string;
};

type CanvasVideoTask = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  created_at: number;
  updated_at: number;
  result: CanvasVideoResult | null;
  error: string;
};

const tasks = new Map<string, CanvasVideoTask>();

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
    const url = `/uploads/canvas/${filename}`;
    const abs = path.join(uploadsDir, filename);
    const buffer = Buffer.from(arr);
    // OSS 私有读：启用时优先写入 OSS，本地仍写一份兜底
    try {
      const oss = await import("./ossStore.js");
      if (oss.isOssEnabled()) {
        await oss.uploadBufferToOss({
          key: oss.mapUploadsPathToKey(url),
          buffer,
          mime: ct || "video/mp4",
          meta: { kind: "canvas-video" },
        });
      }
    } catch (e) {
      console.warn("[canvas-video] OSS 上传失败，保留本地", (e as Error)?.message);
    }
    writeFileSync(abs, buffer);
    return url;
  } finally {
    clearTimeout(timer);
  }
}

function validateVideoPayload(payload: CanvasVideoPayload): { prompt: string; model: string } {
  const prompt = String(payload.prompt || "").trim();
  const model = String(payload.model || "").trim();
  if (!prompt) throw Object.assign(new Error("缺少 prompt"), { status: 400 });
  if (!isHailuoH3Model(model) && !isSparkVideo20Model(model)) {
    throw Object.assign(
      new Error(
        `视频模型「${model || "(空)"}」尚未接入本站。当前已支持：hailuo-h3（海螺 H3）、seedance-2.0（Seedance 2.0）。`
      ),
      { status: 501 }
    );
  }
  return { prompt, model };
}

async function executeCanvasVideoJob(
  req: Request,
  payload: CanvasVideoPayload,
  deps: CanvasVideoBridgeDeps
): Promise<CanvasVideoResult> {
  const { prompt, model } = validateVideoPayload(payload);
  const images = collectUrls(payload.images);
  const videos = Array.isArray(payload.videos)
    ? payload.videos.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const audios = Array.isArray(payload.audios)
    ? payload.audios.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const spark = isSparkVideo20Model(model);
  const resolvedModel = spark ? SEEDANCE_2_MODEL_ID : HAILUO_H3_MODEL_ID;
  const logTag = spark ? "canvas-video/seedance-2.0" : "canvas-video/hailuo-h3";

  console.log(`[${logTag}]`, {
    images: images.length,
    videos: videos.length,
    audios: audios.length,
    resolution: payload.resolution,
    duration: payload.duration,
    ratio: payload.aspect_ratio,
    generateAudio: payload.generate_audio,
  });

  const upstreamUrl = spark
    ? await runSparkVideo20Job({
        prompt,
        images,
        videos,
        audios,
        resolution: payload.resolution,
        duration: payload.duration,
        ratio: payload.aspect_ratio,
        generateAudio: payload.generate_audio,
        realPersonMode: payload.real_person_mode,
        watermark: payload.watermark,
        seed: payload.seed,
        projectRoot: deps.projectRoot,
      })
    : await runHailuoH3VideoJob({
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
  deps.onPersisted?.(localUrl, req, {
    prompt,
    model: resolvedModel,
    duration: payload.duration,
    aspect_ratio: payload.aspect_ratio,
    resolution: payload.resolution,
  });

  console.log(`[${logTag}] done`, {
    localUrl,
    upstream: String(upstreamUrl || "").slice(0, 120),
  });

  return {
    videos: [{ url: localUrl, kind: "video" }],
    url: localUrl,
    model: resolvedModel,
    upstream_url: upstreamUrl,
  };
}

async function runCanvasVideoTask(
  taskId: string,
  req: Request,
  payload: CanvasVideoPayload,
  deps: CanvasVideoBridgeDeps
): Promise<void> {
  const task = tasks.get(taskId);
  if (!task) return;
  task.status = "running";
  task.updated_at = Date.now();
  try {
    const result = await executeCanvasVideoJob(req, payload, deps);
    task.status = "succeeded";
    task.result = result;
    task.error = "";
    task.updated_at = Date.now();
  } catch (e) {
    task.status = "failed";
    task.error = e instanceof Error ? e.message : String(e);
    task.updated_at = Date.now();
    console.error("[canvas-video-task] failed:", taskId, task.error);
  }
}

async function handleCanvasVideoSync(
  req: Request,
  res: Response,
  deps: CanvasVideoBridgeDeps
): Promise<void> {
  const payload = (req.body || {}) as CanvasVideoPayload;
  try {
    validateVideoPayload(payload);
    const result = await executeCanvasVideoJob(req, payload, deps);
    res.json(result);
  } catch (e) {
    const err = e as Error & { status?: number };
    const status = Number(err.status) || 502;
    const msg = err instanceof Error ? err.message : String(e);
    if (status >= 500) console.error("[canvas-video] failed:", msg);
    res.status(status).json({ error: msg });
  }
}

export function registerCanvasVideoRoutes(app: Express, deps: CanvasVideoBridgeDeps): void {
  const gate = deps.requireGate;

  app.post("/api/canvas-video-tasks", ...(gate ? [gate] : []), (req, res) => {
    try {
      const payload = (req.body || {}) as CanvasVideoPayload;
      validateVideoPayload(payload);
      const taskId = `canvas_vid_${uuidv4().replace(/-/g, "")}`;
      const now = Date.now();
      tasks.set(taskId, {
        id: taskId,
        status: "queued",
        created_at: now,
        updated_at: now,
        result: null,
        error: "",
      });
      void runCanvasVideoTask(taskId, req, payload, deps);
      res.json({ task_id: taskId, status: "queued" });
    } catch (e) {
      const err = e as Error & { status?: number };
      res.status(Number(err.status) || 400).json({
        error: err instanceof Error ? err.message : String(e),
      });
    }
  });

  app.get("/api/canvas-video-tasks/:taskId", ...(gate ? [gate] : []), (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) {
      return res.status(404).json({
        error: "视频任务不存在，可能服务已重启或任务已过期",
        status: "failed",
      });
    }
    return res.json({
      id: task.id,
      status: task.status,
      result: task.status === "succeeded" ? task.result : null,
      error: task.error || undefined,
      updated_at: task.updated_at,
    });
  });

  const syncHandlers: RequestHandler[] = [
    ...(gate ? [gate] : []),
    (req, res) => {
      void handleCanvasVideoSync(req, res, deps);
    },
  ];
  app.post("/api/canvas-video", ...syncHandlers);
}
